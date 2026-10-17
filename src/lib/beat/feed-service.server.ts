import { addDiscoveryHealth } from "./feed-health";
import type { Database } from "../publishing/runtime.server";
import { existingBeatFingerprints, existingBeatStories } from "./db.server";
import { insertNormalizedPendingCandidates, loadNewsUrlsForDedupe } from "./ingest.server";
import {
  discoverFeedCandidates,
  FEED_COOLDOWN_MS,
  type FeedDiscoveryReport,
} from "./feed-discovery";

export async function getFeedDiscoveryReport(
  database: Database,
): Promise<FeedDiscoveryReport | null> {
  try {
    const row = await database
      .prepare("SELECT report FROM beat_discovery_state WHERE id = 'rss'")
      .first<{ report: string | null }>();
    return row?.report ? (JSON.parse(row.report) as FeedDiscoveryReport) : null;
  } catch {
    return null;
  } // Older deployments can still read the editorial queue.
}

/** Manual, bounded acquisition. No cron, AI, external publish or approval side effect. */
export async function runFeedDiscovery(
  database: Database,
  opts: Parameters<typeof discoverFeedCandidates>[0] & {
    dryRun?: boolean;
    createdBy?: string;
  } = {},
) {
  const now = opts.now ?? new Date();
  const startedAt = now.toISOString();
  // D1 serializes this conditional claim across Worker isolates, including dry-runs.
  const claimed = await database
    .prepare(
      `INSERT INTO beat_discovery_state (id, started_at) VALUES ('rss', ?)
     ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at
     WHERE started_at <= ? RETURNING id`,
    )
    .bind(startedAt, new Date(now.getTime() - FEED_COOLDOWN_MS).toISOString())
    .first<{ id: string }>();
  if (!claimed) {
    return {
      dryRun: Boolean(opts.dryRun),
      cached: true,
      inserted: 0,
      candidates: [],
      skippedDuplicates: 0,
      discarded: 0,
      errors: [],
      report: await getFeedDiscoveryReport(database),
    };
  }
  const [existingFingerprints, existingStories, newsUrls, previousReport] = await Promise.all([
    existingBeatFingerprints(database),
    existingBeatStories(database, now),
    loadNewsUrlsForDedupe(database),
    getFeedDiscoveryReport(database),
  ]);
  const discovered = await discoverFeedCandidates({
    ...opts,
    now,
    existingFingerprints,
    existingStories,
    newsUrls,
    backoff: Object.fromEntries(
      (previousReport?.sources ?? []).filter((s) => s.retryAfter).map((s) => [s.id, s.retryAfter!]),
    ),
  });
  const written = opts.dryRun
    ? {
        inserted: 0,
        skippedDuplicates: discovered.skippedDuplicates,
        discarded: discovered.discarded,
        errors: discovered.errors,
      }
    : await insertNormalizedPendingCandidates(
        database,
        discovered,
        opts.createdBy ?? "discover:rss",
      );
  discovered.report.skippedDuplicates = written.skippedDuplicates;
  discovered.report.inserted = written.inserted;
  discovered.report.dryRun = Boolean(opts.dryRun);
  addDiscoveryHealth(discovered.report, previousReport);
  if (written.errors.length)
    discovered.report.issues.push(
      `${written.errors.length} candidate storage errors; inspect and retry after cooldown`,
    );
  await database
    .prepare("UPDATE beat_discovery_state SET report = ? WHERE id = 'rss' AND started_at = ?")
    .bind(JSON.stringify(discovered.report), startedAt)
    .run();
  return {
    dryRun: Boolean(opts.dryRun),
    cached: false,
    ...written,
    candidates: discovered.candidates,
    report: discovered.report,
  };
}
