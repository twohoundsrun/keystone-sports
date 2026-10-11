/** D1 accessors for beat_items. Never returns fixtures. */

import type { BeatItem, BeatCategory, ApprovalStatus } from "./types";
import { BEAT_ITEM_COLUMNS, rowToBeatItem, type BeatItemRow } from "./row";
import { beatDuplicateFingerprint } from "./fingerprint";
import { classifyBeatMedia, normalizeBeatUrl } from "./allowlist";
import {
  BEAT_QUEUE_DEFAULT_LIMIT,
  clampBeatQueueLimit,
  encodeBeatCursor,
  type BeatQueueCounts,
  type BeatQueueCursor,
  type BeatQueueStatus,
} from "./queue";
import {
  classifyLastExpireRun,
  deriveBeatOperationalState,
  deriveBeatReviewBacklog,
  type BeatLastRunInput,
  type BeatQueueDiagnostics,
} from "./diagnostics";
import { BEAT_PENDING_STALE_MS } from "./staleness";
import type { Database } from "../publishing/runtime.server";

function nowIso() {
  return new Date().toISOString();
}

export async function listBeatItems(database: Database, opts?: { status?: ApprovalStatus | "all" }): Promise<BeatItem[]> {
  const status = opts?.status ?? "all";
  const stmt =
    status === "all"
      ? database.prepare(`SELECT ${BEAT_ITEM_COLUMNS} FROM beat_items ORDER BY updated_at DESC LIMIT 200`)
      : database.prepare(
          `SELECT ${BEAT_ITEM_COLUMNS} FROM beat_items WHERE approval_status = ? ORDER BY updated_at DESC LIMIT 200`,
        ).bind(status);
  const { results } = await stmt.all<BeatItemRow>();
  return results.map(rowToBeatItem);
}

export type BeatQueuePage = {
  items: BeatItem[];
  nextCursor: string | null;
  limit: number;
};

/**
 * Status-filtered, keyset-paginated editor queue. The status filter runs in SQL
 * BEFORE the LIMIT so older records are reachable and pending items always sort
 * first in the "all" view. Ordering is deterministic (updated_at DESC, id DESC)
 * with the pending bucket as the primary key, so pages never duplicate or omit
 * rows for a stable dataset.
 */
export async function listBeatItemsPage(
  database: Database,
  opts?: { status?: BeatQueueStatus; cursor?: BeatQueueCursor | null; limit?: number },
): Promise<BeatQueuePage> {
  const status: BeatQueueStatus = opts?.status ?? "all";
  const cursor = opts?.cursor ?? null;
  const size = clampBeatQueueLimit(opts?.limit ?? BEAT_QUEUE_DEFAULT_LIMIT);
  const fetchSize = size + 1; // one extra row tells us whether another page exists

  let rows: (BeatItemRow & { queue_rank: number })[];
  if (status === "all") {
    const rank = "(CASE WHEN approval_status = 'pending' THEN 0 ELSE 1 END)";
    rows = cursor
      ? (
          await database
            .prepare(
              `SELECT ${BEAT_ITEM_COLUMNS}, ${rank} AS queue_rank FROM beat_items
               WHERE (${rank} > ?)
                  OR (${rank} = ? AND (updated_at < ? OR (updated_at = ? AND id < ?)))
               ORDER BY queue_rank ASC, updated_at DESC, id DESC
               LIMIT ?`,
            )
            .bind(cursor.bucket, cursor.bucket, cursor.updatedAt, cursor.updatedAt, cursor.id, fetchSize)
            .all<BeatItemRow & { queue_rank: number }>()
        ).results
      : (
          await database
            .prepare(
              `SELECT ${BEAT_ITEM_COLUMNS}, ${rank} AS queue_rank FROM beat_items
               ORDER BY queue_rank ASC, updated_at DESC, id DESC
               LIMIT ?`,
            )
            .bind(fetchSize)
            .all<BeatItemRow & { queue_rank: number }>()
        ).results;
  } else {
    rows = cursor
      ? (
          await database
            .prepare(
              `SELECT ${BEAT_ITEM_COLUMNS}, 0 AS queue_rank FROM beat_items
               WHERE approval_status = ?
                 AND (updated_at < ? OR (updated_at = ? AND id < ?))
               ORDER BY updated_at DESC, id DESC
               LIMIT ?`,
            )
            .bind(status, cursor.updatedAt, cursor.updatedAt, cursor.id, fetchSize)
            .all<BeatItemRow & { queue_rank: number }>()
        ).results
      : (
          await database
            .prepare(
              `SELECT ${BEAT_ITEM_COLUMNS}, 0 AS queue_rank FROM beat_items
               WHERE approval_status = ?
               ORDER BY updated_at DESC, id DESC
               LIMIT ?`,
            )
            .bind(status, fetchSize)
            .all<BeatItemRow & { queue_rank: number }>()
        ).results;
  }

  const hasMore = rows.length > size;
  const pageRows = hasMore ? rows.slice(0, size) : rows;
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeBeatCursor({
          bucket: last.queue_rank === 0 ? 0 : 1,
          updatedAt: last.updated_at,
          id: last.id,
        })
      : null;

  return { items: pageRows.map(rowToBeatItem), nextCursor, limit: size };
}

function count(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Status counts across the whole table (not the current page). stalePending
 * reuses the exact Phase 4A semantics: pending AND (>= 48h old OR expires_at
 * already passed). Presentation only — approval_status is never mutated.
 */
export async function countBeatItemsByStatus(database: Database, now = new Date()): Promise<BeatQueueCounts> {
  const currentIso = now.toISOString();
  const staleCutoffIso = new Date(now.getTime() - BEAT_PENDING_STALE_MS).toISOString();
  const row = await database
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN approval_status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN approval_status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
         SUM(CASE WHEN approval_status = 'expired' THEN 1 ELSE 0 END) AS expired,
         SUM(CASE WHEN approval_status = 'pending'
             AND (created_at <= ? OR (expires_at IS NOT NULL AND expires_at <= ?))
           THEN 1 ELSE 0 END) AS stale_pending
       FROM beat_items`,
    )
    .bind(staleCutoffIso, currentIso)
    .first<{
      total: number;
      pending: number | null;
      approved: number | null;
      rejected: number | null;
      expired: number | null;
      stale_pending: number | null;
    }>();
  return {
    total: count(row?.total),
    pending: count(row?.pending),
    approved: count(row?.approved),
    rejected: count(row?.rejected),
    expired: count(row?.expired),
    stalePending: count(row?.stale_pending),
  };
}

/**
 * Best-effort read of the most recent expire job run. The `beat_job_runs` table
 * is written by the jobs worker in the same D1 database (migration 0003). If it
 * is missing or unreadable we report `known: false` rather than guessing.
 */
async function recentExpireRun(database: Database): Promise<BeatLastRunInput> {
  try {
    const row = await database
      .prepare(
        `SELECT started_at, error FROM beat_job_runs
         WHERE job_type = 'expire'
         ORDER BY started_at DESC
         LIMIT 1`,
      )
      .first<{ started_at: string | null; error: string | null }>();
    if (!row) return { known: true, at: null, error: null };
    return { known: true, at: row.started_at, error: row.error ?? null };
  } catch {
    return { known: false };
  }
}

/** Observable-state diagnostics for the editor queue. Never throws. */
export async function getBeatQueueDiagnostics(
  database: Database,
  counts: BeatQueueCounts,
  now = new Date(),
): Promise<BeatQueueDiagnostics> {
  const lastRun = await recentExpireRun(database);
  const lastExpireRun = classifyLastExpireRun(lastRun, now);
  const state = deriveBeatOperationalState({
    databaseOk: true,
    lastRun,
    now,
  });
  return {
    generatedAt: now.toISOString(),
    state,
    database: { ok: true },
    lastExpireRun,
    discovery: "unknown",
    reviewBacklog: deriveBeatReviewBacklog(counts.stalePending),
  };
}

export async function listPublicBeatRows(database: Database, now = new Date()): Promise<BeatItem[]> {
  const iso = now.toISOString();
  const { results } = await database
    .prepare(
      `SELECT ${BEAT_ITEM_COLUMNS} FROM beat_items
       WHERE approval_status = 'approved'
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY pinned DESC, updated_at DESC
       LIMIT 100`,
    )
    .bind(iso)
    .all<BeatItemRow>();
  return results.map(rowToBeatItem);
}

export async function getBeatItemById(database: Database, id: string): Promise<BeatItem | null> {
  const row = await database
    .prepare(`SELECT ${BEAT_ITEM_COLUMNS} FROM beat_items WHERE id = ?`)
    .bind(id)
    .first<BeatItemRow>();
  return row ? rowToBeatItem(row) : null;
}

export async function existingBeatFingerprints(database: Database): Promise<Set<string>> {
  const { results } = await database
    .prepare(`SELECT duplicate_fingerprint AS fp, original_url AS url FROM beat_items`)
    .all<{ fp: string | null; url: string }>();
  const set = new Set<string>();
  for (const r of results) {
    if (r.fp) set.add(r.fp);
    const n = normalizeBeatUrl(r.url);
    if (n) set.add(`url:${n.toLowerCase()}`);
  }
  return set;
}

export type UpsertBeatInput = {
  id?: string;
  source: string;
  sourceTier: BeatItem["sourceTier"];
  authorAccount: string;
  teamSlug?: string | null;
  league?: string | null;
  category: BeatCategory;
  headline: string;
  context?: string | null;
  originalUrl: string;
  embedUrl?: string | null;
  embedId?: string | null;
  oembedHtml?: string | null;
  timestamp: string;
  mediaType?: BeatItem["mediaType"];
  verifiedOfficial?: boolean;
  expiresAt?: string | null;
  approvalStatus?: ApprovalStatus;
  approvalMode?: BeatItem["approvalMode"];
  approvedBy?: string | null;
  approvedAt?: string | null;
  pinned?: boolean;
  relevanceScore?: number | null;
  duplicateFingerprint?: string | null;
  createdBy: string;
};

export async function upsertBeatItem(database: Database, input: UpsertBeatInput): Promise<{ id: string }> {
  const id = input.id ?? crypto.randomUUID();
  const originalUrl = normalizeBeatUrl(input.originalUrl) ?? input.originalUrl.trim();
  const classified = classifyBeatMedia(originalUrl);
  const mediaType = input.mediaType ?? classified.mediaType;
  const embedUrl = input.embedUrl ?? classified.embedUrl ?? null;
  const embedId = input.embedId ?? classified.embedId ?? null;
  const fingerprint =
    input.duplicateFingerprint ??
    beatDuplicateFingerprint({
      originalUrl,
      teamSlug: input.teamSlug,
      headline: input.headline,
    });
  const ts = nowIso();
  await database
    .prepare(
      `INSERT INTO beat_items (
        id, source, source_tier, author_account, team_slug, league, category, headline, context,
        original_url, embed_url, embed_id, oembed_html, timestamp, media_type, verified_official,
        expires_at, approval_status, approval_mode, approved_by, approved_at, pinned,
        relevance_score, duplicate_fingerprint, created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source = excluded.source,
        source_tier = excluded.source_tier,
        author_account = excluded.author_account,
        team_slug = excluded.team_slug,
        league = excluded.league,
        category = excluded.category,
        headline = excluded.headline,
        context = excluded.context,
        original_url = excluded.original_url,
        embed_url = excluded.embed_url,
        embed_id = excluded.embed_id,
        oembed_html = excluded.oembed_html,
        timestamp = excluded.timestamp,
        media_type = excluded.media_type,
        verified_official = excluded.verified_official,
        expires_at = excluded.expires_at,
        approval_status = excluded.approval_status,
        approval_mode = excluded.approval_mode,
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        pinned = excluded.pinned,
        relevance_score = excluded.relevance_score,
        duplicate_fingerprint = excluded.duplicate_fingerprint,
        updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      input.source,
      input.sourceTier,
      input.authorAccount,
      input.teamSlug ?? null,
      input.league ?? null,
      input.category,
      input.headline,
      input.context ?? null,
      originalUrl,
      embedUrl,
      embedId,
      input.oembedHtml ?? null,
      input.timestamp,
      mediaType,
      Number(Boolean(input.verifiedOfficial)),
      input.expiresAt ?? null,
      input.approvalStatus ?? "pending",
      input.approvalMode ?? "manual",
      input.approvedBy ?? null,
      input.approvedAt ?? null,
      Number(Boolean(input.pinned)),
      input.relevanceScore ?? null,
      fingerprint,
      ts,
      ts,
      input.createdBy,
    )
    .run();
  return { id };
}

export async function patchBeatItem(
  database: Database,
  id: string,
  patch: Partial<{
    context: string | null;
    headline: string;
    category: BeatCategory;
    approvalStatus: ApprovalStatus;
    approvedBy: string | null;
    approvedAt: string | null;
    pinned: boolean;
    expiresAt: string | null;
  }>,
): Promise<void> {
  const current = await getBeatItemById(database, id);
  if (!current) throw new Error("Beat item not found.");
  const next = {
    context: patch.context !== undefined ? patch.context : current.context ?? null,
    headline: patch.headline ?? current.headline,
    category: patch.category ?? current.category,
    approvalStatus: patch.approvalStatus ?? current.approvalStatus,
    approvedBy: patch.approvedBy !== undefined ? patch.approvedBy : current.approvedBy ?? null,
    approvedAt: patch.approvedAt !== undefined ? patch.approvedAt : current.approvedAt ?? null,
    pinned: patch.pinned !== undefined ? patch.pinned : Boolean(current.pinned),
    expiresAt: patch.expiresAt !== undefined ? patch.expiresAt : current.expiresAt ?? null,
  };
  await database
    .prepare(
      `UPDATE beat_items SET context = ?, headline = ?, category = ?, approval_status = ?,
       approved_by = ?, approved_at = ?, pinned = ?, expires_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      next.context,
      next.headline,
      next.category,
      next.approvalStatus,
      next.approvedBy,
      next.approvedAt,
      Number(next.pinned),
      next.expiresAt,
      nowIso(),
      id,
    )
    .run();
}
