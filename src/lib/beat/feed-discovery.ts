import { DISCOVERY_FEED_SOURCES, type DiscoveryFeedSource } from "./feed-sources";
import { parseDiscoveryFeed } from "./feed-parser";
import { COVERAGE_AREAS, inferPaCoverage, type CoverageArea } from "./coverage";
import { hasEditorialDevelopment } from "./priority";
import {
  candidatesFromEditorialJson,
  type DiscoverOptions,
  type EditorialCandidateInput,
} from "./discovery";

export const FEED_MAX_BYTES = 256 * 1024;
export const FEED_MAX_SOURCES = 9;
// At most30 candidate SQL operations +6 coordination reads/writes +9 HTTP
// requests, below the conservative50 subrequest/query budget for a manual run.
export const FEED_MAX_CANDIDATES = 10;
export const FEED_COOLDOWN_MS = 10 * 60_000;
export type SourceObservation = {
  id: string;
  label: string;
  state: "ok" | "empty" | "stale" | "error" | "disabled" | "backoff";
  observed: number;
  eligible: number;
  newestPublished: string | null;
  retryAfter?: string;
  rejected: Record<string, number>;
  error?: string;
};
export type FeedDiscoveryReport = {
  checkedAt: string;
  sources: SourceObservation[];
  candidates: number;
  deferred: number;
  skippedDuplicates: number;
  coverage: {
    area: CoverageArea;
    eligible: number;
    candidates: number;
    state: "observed" | "no_eligible_items" | "no_dedicated_source";
  }[];
  issues: string[];
  updates: { url: string; updatedAt: string }[];
};

async function readBounded(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length")) > FEED_MAX_BYTES)
    throw new Error("Feed exceeds size limit");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response body");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let xml = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > FEED_MAX_BYTES) throw new Error("Feed exceeds size limit");
      xml += decoder.decode(value, { stream: true });
    }
    return xml + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Acquisition/eligibility only; Phase 4C normalizes, scores and deduplicates. */
export async function discoverFeedCandidates(
  opts: DiscoverOptions & {
    sources?: DiscoveryFeedSource[];
    timeoutMs?: number;
    backoff?: Record<string, string>;
  } = {},
) {
  const now = opts.now ?? new Date();
  const configured = opts.sources ?? DISCOVERY_FEED_SOURCES;
  const sources = configured.slice(0, FEED_MAX_SOURCES);
  const raw: EditorialCandidateInput[] = [];
  const observations: SourceObservation[] = [];
  const updates: FeedDiscoveryReport["updates"] = [];
  const eligible: Partial<Record<CoverageArea, number>> = {};
  let next = 0;
  async function worker() {
    while (next < sources.length) {
      const source = sources[next++];
      const observation: SourceObservation = {
        id: source.id,
        label: source.label,
        state: "empty",
        observed: 0,
        eligible: 0,
        newestPublished: null,
        rejected: {},
      };
      observations.push(observation);
      if (!source.enabled || source.verification === "pending") {
        observation.state = "disabled";
        continue;
      }
      const retryAfter = opts.backoff?.[source.id];
      if (retryAfter && Date.parse(retryAfter) > now.getTime()) {
        observation.state = "backoff";
        observation.retryAfter = retryAfter;
        continue;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 3500);
      const reject = (reason: string) => {
        observation.rejected[reason] = (observation.rejected[reason] ?? 0) + 1;
      };
      try {
        // Redirects require explicit registry review: never silently crawl another host.
        const response = await (opts.fetchImpl ?? fetch)(source.url, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
            "User-Agent": "KeystoneBeatDiscovery/1.0 (+https://keystonebeat.com)",
          },
        });
        if (!response.ok) {
          const retry = response.headers.get("retry-after");
          if (retry) {
            const retryMs = /^\d+$/.test(retry)
              ? now.getTime() + Number(retry) * 1000
              : Date.parse(retry);
            if (Number.isFinite(retryMs) && retryMs > now.getTime() && retryMs <= 8.64e15)
              observation.retryAfter = new Date(retryMs).toISOString();
          }
          await response.body?.cancel();
          throw new Error(`HTTP ${response.status}`);
        }
        if (/text\/html|application\/json/i.test(response.headers.get("content-type") ?? "")) {
          await response.body?.cancel();
          throw new Error("Unexpected feed content type");
        }
        const articles = parseDiscoveryFeed(await readBounded(response));
        observation.observed = articles.length;
        for (const article of [...articles].sort(
          (a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0),
        )) {
          const ms = Date.parse(article.published);
          if (!Number.isFinite(ms)) {
            reject("missing_time");
            continue;
          }
          if (ms > now.getTime() + 5 * 60_000) {
            reject("future_time");
            continue;
          }
          if (!observation.newestPublished || article.published > observation.newestPublished)
            observation.newestPublished = article.published;
          if (
            article.updated &&
            Date.parse(article.updated) > ms &&
            Date.parse(article.updated) <= now.getTime() + 5 * 60_000 &&
            !updates.some((u) => u.url === article.href) &&
            updates.length < 20
          )
            updates.push({ url: article.href, updatedAt: article.updated });
          // An updated tag alone is not evidence of a new development. Preserve
          // original publication age and direct editors to the source instead.
          if (now.getTime() - ms > 72 * 3_600_000) {
            reject("old");
            continue;
          }
          const coverage = inferPaCoverage(article.title, source.teamSlug);
          if (!coverage) {
            reject("outside_coverage");
            continue;
          }
          if (!hasEditorialDevelopment(article.title)) {
            reject("routine");
            continue;
          }
          observation.eligible += 1;
          eligible[coverage.area] = (eligible[coverage.area] ?? 0) + 1;
          raw.push({
            originalUrl: article.href,
            headline: article.title,
            timestamp: article.published,
            source: source.label,
            account: source.id,
            sourceTier: source.sourceTier,
            verifiedOfficial: source.sourceTier === "official_team_league",
            teamSlug: coverage.teamSlug,
            category: "from_the_beat",
            context: `Source: ${source.label}. Review the original announcement and add the Pennsylvania consequence before approval.`,
          });
        }
        observation.state = !articles.length
          ? "empty"
          : !observation.newestPublished
            ? "error"
            : observation.newestPublished &&
                now.getTime() - Date.parse(observation.newestPublished) > 72 * 3_600_000
              ? "stale"
              : "ok";
        if (articles.length && !observation.newestPublished)
          observation.error = "No usable publication timestamps";
      } catch (error) {
        observation.state = "error";
        observation.error = controller.signal.aborted
          ? "Feed request timed out"
          : error instanceof Error
            ? error.message
            : "Feed unavailable";
      } finally {
        clearTimeout(timer);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, sources.length) }, () => worker()));
  const normalized = candidatesFromEditorialJson(raw, { ...opts, now });
  // Cap net-new candidates, not feed entries: previously queued reports must
  // never consume the slots needed to reach the next fresh development.
  const sourceCounts = new Map<string, number>();
  const available = normalized.candidates.length;
  normalized.candidates = normalized.candidates
    .filter((candidate) => {
      const count = sourceCounts.get(candidate.account) ?? 0;
      sourceCounts.set(candidate.account, count + 1);
      return count < 8;
    })
    .slice(0, FEED_MAX_CANDIDATES);
  const deferred = available - normalized.candidates.length;
  const issues = observations
    .filter((s) => s.state !== "ok")
    .map((s) => `${s.label}: ${s.state}${s.error ? ` (${s.error})` : ""}`);
  if (configured.length > sources.length)
    issues.push(
      `${configured.length - sources.length} sources not requested because of the per-run source budget`,
    );
  if (deferred)
    issues.push(`${deferred} additional candidates deferred by the per-run request budget`);
  if (raw.length && normalized.skippedDuplicates / raw.length >= 0.7)
    issues.push(
      `${normalized.skippedDuplicates}/${raw.length} eligible items repeat existing coverage`,
    );
  if (normalized.discarded)
    issues.push(`${normalized.discarded} eligible items discarded by Phase 4C relevance`);
  const report: FeedDiscoveryReport = {
    checkedAt: now.toISOString(),
    sources: observations.sort((a, b) => a.id.localeCompare(b.id)),
    candidates: normalized.candidates.length,
    deferred,
    skippedDuplicates: normalized.skippedDuplicates,
    issues,
    updates,
    coverage: COVERAGE_AREAS.map((area) => ({
      area,
      eligible: eligible[area] ?? 0,
      candidates: normalized.candidates.filter(
        (c) => inferPaCoverage(c.headline, c.teamSlug)?.area === area,
      ).length,
      state: eligible[area]
        ? "observed"
        : sources.some((s) => s.enabled && s.verification !== "pending" && s.area === area)
          ? "no_eligible_items"
          : "no_dedicated_source",
    })),
  };
  return { ...normalized, report };
}
