import type { BeatItem } from "./types";

/** Pending items become stale once they have sat unreviewed this long. */
export const BEAT_PENDING_STALE_MS = 48 * 60 * 60 * 1000;

export type BeatStaleReason = "age" | "expired";

export type BeatStaleness = {
  stale: boolean;
  reason: BeatStaleReason | null;
  ageMs: number;
  ageHours: number;
};

/**
 * Presentation-only staleness for the editor queue. Never changes approvalStatus:
 * pending items are stale once they are >= 48h old (measured from createdAt) or
 * once their original expiresAt has already passed. Approved, rejected, and
 * already-expired items are never flagged.
 */
export function beatPendingStaleness(
  item: Pick<BeatItem, "approvalStatus" | "createdAt" | "expiresAt">,
  now: Date = new Date(),
): BeatStaleness {
  const nowMs = now.getTime();
  const createdMs = Date.parse(item.createdAt);
  const ageMs = Number.isFinite(createdMs) ? Math.max(0, nowMs - createdMs) : 0;
  const ageHours = ageMs / 3_600_000;
  if (item.approvalStatus !== "pending") {
    return { stale: false, reason: null, ageMs, ageHours };
  }
  const expiresMs = item.expiresAt ? Date.parse(item.expiresAt) : Number.NaN;
  const pastDue = item.expiresAt != null && Number.isFinite(expiresMs) && expiresMs <= nowMs;
  const staleByAge = Number.isFinite(createdMs) && ageMs >= BEAT_PENDING_STALE_MS;
  if (!pastDue && !staleByAge) return { stale: false, reason: null, ageMs, ageHours };
  return { stale: true, reason: pastDue ? "expired" : "age", ageMs, ageHours };
}

/** Compact human-readable age for the editor queue, e.g. "45m", "6h", "3d". */
export function formatBeatAge(ageMs: number): string {
  const minutes = Math.max(0, Math.round(ageMs / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
