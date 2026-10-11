/**
 * Operational diagnostics for the Beat editor queue. Pure derivation from
 * observable signals only (DB read success, status counts, recent job runs).
 * Never claims the discovery pipeline is healthy — discovery may be disabled by
 * design, so it is always reported as "unknown".
 */

export type BeatOperationalState = "healthy" | "degraded" | "unavailable";
export type BeatLastRunStatus = "ok" | "error" | "stale" | "unknown";

/** What we could observe about the most recent expire job run. */
export type BeatLastRunInput =
  | { known: false }
  | { known: true; at: string | null; error: string | null };

export type BeatLastExpireRun = {
  status: BeatLastRunStatus;
  at: string | null;
  error: string | null;
};

/** Editorial review backlog: a workload signal, orthogonal to pipeline health. */
export type BeatReviewBacklogLevel = "none" | "warn";
export type BeatReviewBacklog = {
  stalePending: number;
  level: BeatReviewBacklogLevel;
};

export type BeatQueueDiagnostics = {
  generatedAt: string;
  state: BeatOperationalState;
  database: { ok: boolean };
  lastExpireRun: BeatLastExpireRun;
  /** Always "unknown": the app cannot observe the discovery job's real state. */
  discovery: "unknown";
  /** Separate from `state`; a large backlog never changes pipeline health. */
  reviewBacklog: BeatReviewBacklog;
};

/** Stale pending backlog at/above this many items is surfaced as an editorial warning. */
export const BEAT_STALE_BACKLOG_WARN = 25;
/** An expire run older than this is treated as stale (cron is hourly). */
export const BEAT_LAST_RUN_STALE_MS = 6 * 60 * 60 * 1000;

export function classifyLastExpireRun(
  run: BeatLastRunInput,
  now: Date = new Date(),
): BeatLastExpireRun {
  if (!run.known) return { status: "unknown", at: null, error: null };
  if (run.error) return { status: "error", at: run.at, error: run.error };
  if (!run.at) return { status: "unknown", at: null, error: null };
  const started = Date.parse(run.at);
  if (!Number.isFinite(started)) return { status: "unknown", at: run.at, error: null };
  if (now.getTime() - started > BEAT_LAST_RUN_STALE_MS) {
    return { status: "stale", at: run.at, error: null };
  }
  return { status: "ok", at: run.at, error: null };
}

/**
 * healthy  — queue reads work and no pipeline degradation is observable
 * degraded — a failed or overdue expire run is observable
 * unavailable — the queue could not be read at all (distinct from empty)
 *
 * Editorial backlog (see `deriveBeatReviewBacklog`) is intentionally excluded:
 * a growing stale-pending backlog is a human review signal, not infrastructure
 * failure, so it never flips pipeline health. An "unknown" last-run does not by
 * itself degrade the queue, but it is never reported as healthy evidence either
 * (callers surface it explicitly).
 */
export function deriveBeatOperationalState(input: {
  databaseOk: boolean;
  lastRun: BeatLastRunInput;
  now?: Date;
}): BeatOperationalState {
  if (!input.databaseOk) return "unavailable";
  const { status } = classifyLastExpireRun(input.lastRun, input.now ?? new Date());
  if (status === "error" || status === "stale") return "degraded";
  return "healthy";
}

/**
 * Editorial review backlog level. Deliberately independent of
 * `deriveBeatOperationalState`: it is a workload warning only and must never
 * alter unavailable/unknown/degraded pipeline-health semantics.
 */
export function deriveBeatReviewBacklog(
  stalePending: number,
  threshold: number = BEAT_STALE_BACKLOG_WARN,
): BeatReviewBacklog {
  const count = Number.isFinite(stalePending) && stalePending > 0 ? Math.floor(stalePending) : 0;
  return { stalePending: count, level: count >= threshold ? "warn" : "none" };
}

/** Diagnostics payload used when the queue read itself failed. */
export function unavailableBeatDiagnostics(now: Date = new Date()): BeatQueueDiagnostics {
  return {
    generatedAt: now.toISOString(),
    state: "unavailable",
    database: { ok: false },
    lastExpireRun: { status: "unknown", at: null, error: null },
    discovery: "unknown",
    reviewBacklog: { stalePending: 0, level: "none" },
  };
}
