/**
 * Editor queue pagination primitives — status filters, keyset cursor encoding,
 * and DB-derived count shape. Pure (no I/O, no server imports) so it can be
 * shared by the middleware, the server functions, and tests.
 */

import type { ApprovalStatus } from "./types";

export type BeatQueueStatus = "all" | ApprovalStatus;

/** UI/route order includes "all" first; the editor renders pending first. */
export const BEAT_QUEUE_STATUSES: BeatQueueStatus[] = [
  "all",
  "pending",
  "approved",
  "rejected",
  "expired",
];

export const BEAT_QUEUE_DEFAULT_LIMIT = 50;
export const BEAT_QUEUE_MAX_LIMIT = 100;

/** Status counts derived in the database, not from the current page. */
export type BeatQueueCounts = {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  expired: number;
  /** Pending items that are >= 48h old or whose original expiration passed. */
  stalePending: number;
};

export const EMPTY_BEAT_QUEUE_COUNTS: BeatQueueCounts = {
  total: 0,
  pending: 0,
  approved: 0,
  rejected: 0,
  expired: 0,
  stalePending: 0,
};

export function isBeatQueueStatus(value: unknown): value is BeatQueueStatus {
  return typeof value === "string" && (BEAT_QUEUE_STATUSES as string[]).includes(value);
}

/**
 * Keyset cursor. `bucket` is 0 for pending and 1 for everything else so the
 * "all" view can list pending first while remaining deterministic and stable
 * across pages (pending score first, ties broken by updated_at then id, both descending).
 */
export type BeatQueueCursor = {
  bucket: 0 | 1;
  /** Stored pending relevance; old cursors must restart pagination. */
  priority: number;
  updatedAt: string;
  id: string;
};

function base64UrlEncode(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(text: string): string {
  const padded = text.length % 4 === 0 ? text : text + "=".repeat(4 - (text.length % 4));
  return atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
}

export function encodeBeatCursor(cursor: BeatQueueCursor): string {
  return base64UrlEncode(
    JSON.stringify({ b: cursor.bucket, u: cursor.updatedAt, i: cursor.id, p: cursor.priority }),
  );
}

/** Returns null for missing or malformed cursors (callers reject, never guess). */
export function decodeBeatCursor(raw: string | null | undefined): BeatQueueCursor | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const rec = parsed as Record<string, unknown>;
  if (rec.b !== 0 && rec.b !== 1) return null;
  if (typeof rec.u !== "string" || rec.u.length === 0) return null;
  if (typeof rec.i !== "string" || rec.i.length === 0) return null;
  if (typeof rec.p !== "number" || !Number.isFinite(rec.p) || rec.p < 0 || rec.p > 100) return null;
  return {
    bucket: rec.b,
    updatedAt: rec.u,
    id: rec.i,
    priority: rec.p,
  };
}

/** Clamp a requested page size to a safe range, defaulting on invalid input. */
export function clampBeatQueueLimit(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return BEAT_QUEUE_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), BEAT_QUEUE_MAX_LIMIT);
}
