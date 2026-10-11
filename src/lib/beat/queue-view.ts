/**
 * Pure view-state helpers for the editor queue. Kept separate from the React
 * route so the "empty vs failed" distinction and filter labels are testable.
 */

import type { BeatQueueCounts, BeatQueueStatus } from "./queue";

export type BeatQueueViewState = "ok" | "empty" | "error";

/**
 * A failed queue read must never render as an empty queue: "error" is distinct
 * from "empty" so the editor can show diagnostics plus a retry path.
 */
export function deriveBeatQueueViewState(input: { ok: boolean; itemCount: number }): BeatQueueViewState {
  if (!input.ok) return "error";
  return input.itemCount > 0 ? "ok" : "empty";
}

export const BEAT_QUEUE_FILTER_LABELS: Record<BeatQueueStatus, string> = {
  all: "All",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
};

/** Filter button label with a server-derived count (and stale hint for pending). */
export function beatQueueFilterLabel(status: BeatQueueStatus, counts: BeatQueueCounts): string {
  const count = status === "all" ? counts.total : counts[status];
  const base = `${BEAT_QUEUE_FILTER_LABELS[status]} (${count})`;
  if (status === "pending" && counts.stalePending > 0) {
    return `${base} · ${counts.stalePending} stale`;
  }
  return base;
}
