/**
 * Bot-only Beat ingest — PENDING inserts only.
 * Never approve / publish / delete. Dedupes by original_url + duplicate_fingerprint.
 */

import type { Database } from "../publishing/runtime.server";
import type { BeatCategory } from "./types";
import { classifyBeatMedia, normalizeBeatUrl } from "./allowlist";
import { beatDuplicateFingerprint } from "./fingerprint";
import { upsertBeatItem, existingBeatFingerprints } from "./db.server";
import { isBeatUniquenessConflict } from "./ingest-errors";
import { BEAT_ITEM_COLUMNS, rowToBeatItem, type BeatItemRow } from "./row";
import {
  candidatesFromEditorialJson,
  type EditorialCandidateInput,
} from "./discovery";

export type IngestCandidateInput = EditorialCandidateInput;

export type IngestCheckResult = {
  duplicate: boolean;
  by: "original_url" | "fingerprint" | null;
  existingId?: string;
  approvalStatus?: string;
  fingerprint: string;
  originalUrl: string;
};

export async function findBeatDuplicate(
  database: Database,
  input: { originalUrl: string; teamSlug?: string | null; headline?: string; duplicateFingerprint?: string },
): Promise<IngestCheckResult> {
  const originalUrl = normalizeBeatUrl(input.originalUrl) ?? input.originalUrl.trim();
  const fingerprint =
    input.duplicateFingerprint ??
    beatDuplicateFingerprint({
      originalUrl,
      teamSlug: input.teamSlug,
      headline: input.headline,
    });

  const byUrl = await database
    .prepare(`SELECT ${BEAT_ITEM_COLUMNS} FROM beat_items WHERE original_url = ? LIMIT 1`)
    .bind(originalUrl)
    .first<BeatItemRow>();
  if (byUrl) {
    const item = rowToBeatItem(byUrl);
    return {
      duplicate: true,
      by: "original_url",
      existingId: item.id,
      approvalStatus: item.approvalStatus,
      fingerprint: item.duplicateFingerprint ?? fingerprint,
      originalUrl,
    };
  }

  const byFp = await database
    .prepare(
      `SELECT ${BEAT_ITEM_COLUMNS} FROM beat_items WHERE duplicate_fingerprint = ? LIMIT 1`,
    )
    .bind(fingerprint)
    .first<BeatItemRow>();
  if (byFp) {
    const item = rowToBeatItem(byFp);
    return {
      duplicate: true,
      by: "fingerprint",
      existingId: item.id,
      approvalStatus: item.approvalStatus,
      fingerprint,
      originalUrl,
    };
  }

  return { duplicate: false, by: null, fingerprint, originalUrl };
}

export async function ingestPendingCandidates(
  database: Database,
  raw: IngestCandidateInput[] | { candidates?: IngestCandidateInput[] },
  opts?: { newsUrls?: string[]; createdBy?: string },
): Promise<{
  inserted: number;
  skippedDuplicates: number;
  discarded: number;
  errors: string[];
  items: { id: string; originalUrl: string; relevanceScore: number; category: BeatCategory }[];
}> {
  const fingerprints = await existingBeatFingerprints(database);
  const normalized = candidatesFromEditorialJson(raw, {
    existingFingerprints: fingerprints,
    newsUrls: opts?.newsUrls,
  });
  const candidates = normalized.candidates;
  let skippedDuplicates = normalized.skippedDuplicates;
  const errors = [...normalized.errors];
  const discarded = normalized.discarded;

  const createdBy = opts?.createdBy ?? "ingest:bot";
  const items: { id: string; originalUrl: string; relevanceScore: number; category: BeatCategory }[] = [];
  let inserted = 0;

  for (const c of candidates) {
    try {
      // Force PENDING — ignore any approval fields a client might send.
      const dup = await findBeatDuplicate(database, {
        originalUrl: c.originalUrl,
        teamSlug: c.teamSlug,
        headline: c.headline,
        duplicateFingerprint: c.duplicateFingerprint,
      });
      if (dup.duplicate) {
        skippedDuplicates += 1;
        continue;
      }
      const { id } = await upsertBeatItem(database, {
        source: c.source,
        sourceTier: c.sourceTier,
        authorAccount: c.account,
        teamSlug: c.teamSlug,
        league: c.league,
        category: c.categoryRecommendation,
        headline: c.headline,
        context: c.suggestedContext,
        originalUrl: c.originalUrl,
        embedUrl: c.embedUrl,
        embedId: c.embedId,
        oembedHtml: c.oembedHtml,
        timestamp: c.timestamp,
        mediaType: c.mediaType,
        verifiedOfficial: c.verifiedOfficial,
        expiresAt: c.proposedExpiration ?? null,
        approvalStatus: "pending",
        approvalMode: "manual",
        approvedBy: null,
        approvedAt: null,
        pinned: false,
        relevanceScore: c.relevanceScore,
        duplicateFingerprint: c.duplicateFingerprint,
        createdBy,
      });
      inserted += 1;
      items.push({
        id,
        originalUrl: c.originalUrl,
        relevanceScore: c.relevanceScore,
        category: c.categoryRecommendation,
      });
    } catch (err) {
      // A concurrent insert can beat the pre-check and trip the unique indexes on
      // original_url / duplicate_fingerprint. That is a duplicate, not a failure;
      // any other database error must still surface in `errors`.
      if (isBeatUniquenessConflict(err)) {
        skippedDuplicates += 1;
        continue;
      }
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { inserted, skippedDuplicates, discarded, errors, items };
}

export async function loadNewsUrlsForDedupe(database: Database): Promise<string[]> {
  try {
    const news = await database
      .prepare(`SELECT body FROM posts WHERE published = 1 ORDER BY updated_at DESC LIMIT 50`)
      .all<{ body: string }>();
    return news.results.flatMap((r) => r.body.match(/https?:\/\/[^\s)]+/g) ?? []).slice(0, 100);
  } catch {
    return [];
  }
}

// Re-export media helper for callers that normalize before ingest.
export { classifyBeatMedia, normalizeBeatUrl };
