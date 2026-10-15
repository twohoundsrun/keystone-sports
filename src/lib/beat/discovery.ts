/**
 * PA sports Beat discovery — candidate-only (never auto-publishes).
 *
 * Primary path: editorial / operator-bot JSON candidates (stdin/file → ingest).
 * Native Grok/X discovery runs outside the Worker; the bot POSTs PENDING rows
 * to /api/editor/beat/ingest. X syndication remains an optional legacy fallback
 * (--legacy-syndication) and often 429s — do not rely on it in production.
 */

import type { BeatCategory, BeatDiscoveryCandidate, BeatMediaType, SourceTier } from "./types";
import {
  beatDuplicateFingerprint,
  beatStoryRelation,
  type BeatStoryReference,
} from "./fingerprint";
import { discoveryPriority } from "./priority";
import { classifyBeatMedia } from "./allowlist";

export type DiscoverAccount = {
  handle: string;
  source: string;
  sourceTier: SourceTier;
  teamSlug?: string;
  league?: string;
  verifiedOfficial: boolean;
  defaultCategory: BeatCategory;
};

/** Curated PA sports accounts — reference list for operators, not a firehose. */
export const PA_BEAT_DISCOVERY_ACCOUNTS: DiscoverAccount[] = [
  {
    handle: "Eagles",
    source: "@Eagles",
    sourceTier: "official_team_league",
    teamSlug: "eagles",
    league: "NFL",
    verifiedOfficial: true,
    defaultCategory: "reaction",
  },
  {
    handle: "steelers",
    source: "@steelers",
    sourceTier: "official_team_league",
    teamSlug: "steelers",
    league: "NFL",
    verifiedOfficial: true,
    defaultCategory: "reaction",
  },
  {
    handle: "Phillies",
    source: "@Phillies",
    sourceTier: "official_team_league",
    teamSlug: "phillies",
    league: "MLB",
    verifiedOfficial: true,
    defaultCategory: "reaction",
  },
  {
    handle: "Pirates",
    source: "@Pirates",
    sourceTier: "official_team_league",
    teamSlug: "pirates",
    league: "MLB",
    verifiedOfficial: true,
    defaultCategory: "reaction",
  },
  {
    handle: "sixers",
    source: "@sixers",
    sourceTier: "official_team_league",
    teamSlug: "sixers",
    league: "NBA",
    verifiedOfficial: true,
    defaultCategory: "reaction",
  },
  {
    handle: "NHLFlyers",
    source: "@NHLFlyers",
    sourceTier: "official_team_league",
    teamSlug: "flyers",
    league: "NHL",
    verifiedOfficial: true,
    defaultCategory: "reaction",
  },
  {
    handle: "penguins",
    source: "@penguins",
    sourceTier: "official_team_league",
    teamSlug: "penguins",
    league: "NHL",
    verifiedOfficial: true,
    defaultCategory: "reaction",
  },
  {
    handle: "PhilaUnion",
    source: "@PhilaUnion",
    sourceTier: "official_team_league",
    teamSlug: "union",
    league: "MLS",
    verifiedOfficial: true,
    defaultCategory: "reaction",
  },
  {
    handle: "PennStateFball",
    source: "@PennStateFball",
    sourceTier: "official_team_league",
    teamSlug: "penn-state",
    league: "NCAAF",
    verifiedOfficial: true,
    defaultCategory: "reaction",
  },
  {
    handle: "Pitt_FB",
    source: "@Pitt_FB",
    sourceTier: "official_team_league",
    teamSlug: "pitt",
    league: "NCAAF",
    verifiedOfficial: true,
    defaultCategory: "reaction",
  },
  {
    handle: "Jeff_McLane",
    source: "Inquirer / Jeff McLane",
    sourceTier: "reporter_original",
    teamSlug: "eagles",
    league: "NFL",
    verifiedOfficial: false,
    defaultCategory: "from_the_beat",
  },
  {
    handle: "DZangaroNBCS",
    source: "NBCS Philly / Dave Zangaro",
    sourceTier: "broadcaster_publication",
    teamSlug: "eagles",
    league: "NFL",
    verifiedOfficial: false,
    defaultCategory: "locker_room",
  },
];

/**
 * Editorial relevance score bands (desk guidance):
 *   90–100  breaking
 *   75–89   injuries / trades
 *   55–74   strong reporting
 *   35–54   interviews / highlights
 *   20–34   locker-room
 *   <20     discard
 */
export type ScoreBand =
  | "breaking"
  | "injuries_trades"
  | "strong_reporting"
  | "interviews_highlights"
  | "locker_room"
  | "discard";

export function scoreBandForRelevance(score: number): ScoreBand {
  if (score >= 90) return "breaking";
  if (score >= 75) return "injuries_trades";
  if (score >= 55) return "strong_reporting";
  if (score >= 35) return "interviews_highlights";
  if (score >= 20) return "locker_room";
  return "discard";
}

export function shouldDiscardByScore(score: number): boolean {
  return scoreBandForRelevance(score) === "discard";
}

const BREAKING_HINT =
  /\b(breaking|ruled out|activated|signed|traded|waived|injury report|ir\b|pup\b|suspended)\b/i;
const RUMOR_HINT = /\b(rumor|sources say|hearing|reportedly|per sources)\b/i;

export function scoreDiscoveryCandidate(
  input: {
    sourceTier: SourceTier;
    verifiedOfficial: boolean;
    text: string;
    category: BeatCategory;
    teamSlug?: string | null;
    timestamp?: string;
  },
  now: Date = new Date(),
): number {
  return discoveryPriority(input, now).score;
}

export function recommendCategory(text: string, fallback: BeatCategory): BeatCategory {
  if (BREAKING_HINT.test(text)) return "breaking";
  if (/\b(watch|highlights|full game|press conference)\b/i.test(text)) return "watch";
  if (/\b(locker|says|quote|react)\b/i.test(text)) return "locker_room";
  return fallback;
}

export function proposeExpiration(
  category: BeatCategory,
  timestampIso: string,
): string | undefined {
  const base = Date.parse(timestampIso);
  if (!Number.isFinite(base)) return undefined;
  const hours =
    category === "breaking"
      ? 24
      : category === "from_the_beat"
        ? 72
        : category === "reaction"
          ? 96
          : 120;
  return new Date(base + hours * 3600_000).toISOString();
}

/** Parse status IDs from X syndication timeline HTML (legacy fallback only). */
export function extractStatusIdsFromSyndicationHtml(html: string): string[] {
  const ids = new Set<string>();
  const re = /status\/(\d{10,})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) ids.add(m[1]);
  return [...ids];
}

export async function fetchSyndicationTimeline(
  handle: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(handle)}`;
  const res = await fetchImpl(url, {
    headers: { "user-agent": "KeystoneBeatDiscover/1.0 (+https://keystonebeat.com)" },
  });
  if (!res.ok) throw new Error(`Syndication fetch failed for @${handle}: ${res.status}`);
  return res.text();
}

export async function fetchXoEmbed(
  statusUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ html?: string; authorName?: string } | null> {
  const endpoint = `https://publish.twitter.com/oembed?omit_script=true&url=${encodeURIComponent(statusUrl)}`;
  const res = await fetchImpl(endpoint, {
    headers: { "user-agent": "KeystoneBeatDiscover/1.0 (+https://keystonebeat.com)" },
  });
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as { html?: string; author_name?: string };
    return { html: data.html, authorName: data.author_name };
  } catch {
    return null;
  }
}

export type DiscoverOptions = {
  accounts?: DiscoverAccount[];
  existingFingerprints?: Set<string>;
  existingStories?: BeatStoryReference[];
  /** Extra URLs already on the News wire (dedupe). */
  newsUrls?: string[];
  fetchImpl?: typeof fetch;
  /** Cap posts considered per account. */
  perAccountLimit?: number;
  now?: Date;
};

export type EditorialCandidateInput = {
  originalUrl: string;
  headline?: string;
  text?: string;
  source?: string;
  account?: string;
  authorAccount?: string;
  teamSlug?: string;
  league?: string;
  sourceTier?: SourceTier;
  verifiedOfficial?: boolean;
  category?: BeatCategory;
  context?: string;
  suggestedContext?: string;
  timestamp?: string;
  mediaType?: BeatMediaType;
  embedUrl?: string;
  embedId?: string;
  oembedHtml?: string;
  relevanceScore?: number;
  /** Alias some bots may send; mapped into relevanceScore / category guidance. */
  breakingScore?: number;
  expiresAt?: string;
  proposedExpiration?: string;
  duplicateFingerprint?: string;
};

function buildExistingSet(opts: DiscoverOptions = {}): Set<string> {
  const existing = new Set(opts.existingFingerprints ?? []);
  for (const u of opts.newsUrls ?? []) {
    existing.add(beatDuplicateFingerprint({ originalUrl: u }));
  }
  return existing;
}

/**
 * Normalize editorial / operator-bot JSON into scored PENDING candidates.
 * Discards relevance < 20. Dedupes against fingerprints + news URLs.
 */
export function candidatesFromEditorialJson(
  input: EditorialCandidateInput[] | { candidates?: EditorialCandidateInput[] } | null | undefined,
  opts: DiscoverOptions = {},
): {
  candidates: BeatDiscoveryCandidate[];
  skippedDuplicates: number;
  discarded: number;
  errors: string[];
} {
  const list: EditorialCandidateInput[] = Array.isArray(input)
    ? input
    : Array.isArray(input?.candidates)
      ? input!.candidates!
      : [];
  const existing = buildExistingSet(opts);
  const nowIso = (opts.now ?? new Date()).toISOString();
  const candidates: BeatDiscoveryCandidate[] = [];
  const errors: string[] = [];
  let skippedDuplicates = 0;
  let discarded = 0;

  for (const raw of list) {
    try {
      const originalUrl = String(raw.originalUrl ?? "").trim();
      if (!originalUrl) {
        errors.push("Candidate missing originalUrl");
        continue;
      }
      const account = String(raw.account ?? raw.authorAccount ?? "editorial").trim() || "editorial";
      const headline =
        String(raw.headline ?? raw.text ?? "").trim() || truncateHeadline(originalUrl, 140);
      const text = String(raw.text ?? raw.headline ?? raw.context ?? "").trim() || headline;
      const sourceTier: SourceTier = raw.sourceTier ?? "reporter_original";
      const verifiedOfficial = Boolean(raw.verifiedOfficial);
      const category = raw.category ?? recommendCategory(text, "from_the_beat");
      const media =
        raw.mediaType && raw.embedUrl !== undefined
          ? { mediaType: raw.mediaType, embedUrl: raw.embedUrl, embedId: raw.embedId }
          : classifyBeatMedia(originalUrl);
      // Always retain the canonical URL key, even if an operator supplies an
      // additional fingerprint. A caller cannot evade URL dedupe with a new key.
      const canonicalFingerprint = beatDuplicateFingerprint({
        originalUrl,
        teamSlug: raw.teamSlug,
        headline,
      });
      const fingerprint = raw.duplicateFingerprint ?? canonicalFingerprint;
      if (existing.has(fingerprint) || existing.has(canonicalFingerprint)) {
        skippedDuplicates += 1;
        continue;
      }
      const priority = discoveryPriority(
        { sourceTier, verifiedOfficial, text, teamSlug: raw.teamSlug, timestamp: raw.timestamp },
        opts.now,
      );
      const suppliedScore =
        typeof raw.relevanceScore === "number" && Number.isFinite(raw.relevanceScore)
          ? raw.relevanceScore
          : undefined;
      const breakingScore =
        typeof raw.breakingScore === "number" && Number.isFinite(raw.breakingScore)
          ? raw.breakingScore
          : undefined;
      // Operator hints can adjust a score by at most 15 points. They cannot
      // turn promotions, stale/off-topic items or aggregators into top stories.
      const ceiling = sourceTier === "aggregator" ? 25 : Math.min(100, priority.score + 15);
      const relevanceScore = Math.max(
        0,
        Math.min(ceiling, Math.max(suppliedScore ?? priority.score, breakingScore ?? 0)),
      );
      if (shouldDiscardByScore(relevanceScore)) {
        discarded += 1;
        continue;
      }
      const timestamp =
        raw.timestamp && Number.isFinite(Date.parse(raw.timestamp)) ? raw.timestamp : nowIso;
      const proposedExpiration =
        raw.proposedExpiration ?? raw.expiresAt ?? proposeExpiration(category, timestamp);
      const candidate: BeatDiscoveryCandidate = {
        originalUrl,
        account,
        teamSlug: raw.teamSlug,
        league: raw.league,
        categoryRecommendation: category,
        timestamp,
        sourceTier,
        verifiedOfficial,
        suggestedContext:
          raw.suggestedContext ??
          raw.context ??
          (RUMOR_HINT.test(text)
            ? "Rumor language detected — keep pending and label before any approve."
            : `Editorial candidate (priority ${relevanceScore}/100). Desk: confirm category, Keystone Beat context, and expiration before approve.`),
        headline: truncateHeadline(headline, 140),
        source: raw.source ?? account,
        mediaType: media.mediaType,
        embedUrl: media.embedUrl,
        embedId: media.embedId,
        oembedHtml: raw.oembedHtml,
        relevanceScore,
        priorityReasons: priority.reasons,
        duplicateFingerprint: fingerprint,
        proposedExpiration,
      };
      candidates.push(candidate);
      existing.add(fingerprint);
      existing.add(canonicalFingerprint);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const matched = dedupeDiscoveryStories(candidates, opts.existingStories);
  return {
    candidates: matched.candidates,
    skippedDuplicates: skippedDuplicates + matched.skippedDuplicates,
    discarded,
    errors,
  };
}

/**
 * Legacy X syndication discovery. Prefer candidatesFromEditorialJson / bot ingest.
 * Does NOT write to D1 — caller inserts as pending.
 */
export async function discoverPaBeatCandidates(opts: DiscoverOptions = {}): Promise<{
  candidates: BeatDiscoveryCandidate[];
  skippedDuplicates: number;
  errors: string[];
}> {
  const accounts = opts.accounts ?? PA_BEAT_DISCOVERY_ACCOUNTS;
  const existing = buildExistingSet(opts);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const limit = opts.perAccountLimit ?? 3;
  const candidates: BeatDiscoveryCandidate[] = [];
  const errors: string[] = [];
  let skippedDuplicates = 0;

  for (const account of accounts) {
    try {
      const html = await fetchSyndicationTimeline(account.handle, fetchImpl);
      const ids = extractStatusIdsFromSyndicationHtml(html).slice(0, limit);
      for (const id of ids) {
        const originalUrl = `https://x.com/${account.handle}/status/${id}`;
        const fingerprint = beatDuplicateFingerprint({ originalUrl, teamSlug: account.teamSlug });
        if (existing.has(fingerprint) || existing.has(`x:${id}`)) {
          skippedDuplicates += 1;
          continue;
        }
        const oembed = await fetchXoEmbed(originalUrl, fetchImpl);
        if (!oembed?.html) {
          errors.push(`No readable post content for @${account.handle} status ${id}`);
          continue;
        }
        const text = stripTags(oembed.html);
        const category = recommendCategory(text, account.defaultCategory);
        const media = classifyBeatMedia(originalUrl);
        // X snowflakes encode creation time; discovery time is not freshness.
        const timestamp = new Date(Number((BigInt(id) >> 22n) + 1288834974657n)).toISOString();
        const relevanceScore = scoreDiscoveryCandidate(
          {
            sourceTier: account.sourceTier,
            verifiedOfficial: account.verifiedOfficial,
            text,
            category,
            teamSlug: account.teamSlug,
            timestamp,
          },
          opts.now,
        );
        if (shouldDiscardByScore(relevanceScore)) continue;
        const candidate: BeatDiscoveryCandidate = {
          originalUrl,
          account: `@${account.handle}`,
          teamSlug: account.teamSlug,
          league: account.league,
          categoryRecommendation: category,
          timestamp,
          sourceTier: account.sourceTier,
          verifiedOfficial: account.verifiedOfficial,
          suggestedContext: RUMOR_HINT.test(text)
            ? "Rumor language detected — keep pending and label before any approve."
            : `Candidate from @${account.handle}. Desk: confirm category, Keystone Beat context, and expiration before approve.`,
          headline: truncateHeadline(stripTags(oembed?.html ?? `@${account.handle} update`), 140),
          source: account.source,
          mediaType: media.mediaType,
          embedUrl: media.embedUrl,
          embedId: media.embedId,
          oembedHtml: oembed?.html,
          relevanceScore,
          duplicateFingerprint: fingerprint,
          proposedExpiration: proposeExpiration(category, timestamp),
        };
        candidates.push(candidate);
        existing.add(fingerprint);
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const matched = dedupeDiscoveryStories(candidates, opts.existingStories);
  return {
    candidates: matched.candidates,
    skippedDuplicates: skippedDuplicates + matched.skippedDuplicates,
    errors,
  };
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateHeadline(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

/** Score before headline matching so the strongest source represents a repeat. */
export function dedupeDiscoveryStories(
  candidates: BeatDiscoveryCandidate[],
  existingStories: BeatStoryReference[] = [],
): { candidates: BeatDiscoveryCandidate[]; skippedDuplicates: number } {
  const accepted: BeatDiscoveryCandidate[] = [];
  let skippedDuplicates = 0;
  const ordered = [...candidates].sort(
    (a, b) => b.relevanceScore - a.relevanceScore || a.originalUrl.localeCompare(b.originalUrl),
  );
  for (const candidate of ordered) {
    const stories = [...existingStories, ...accepted];
    if (stories.some((story) => beatStoryRelation(candidate, story) === "duplicate")) {
      skippedDuplicates += 1;
      continue;
    }
    const related = stories.find((story) => beatStoryRelation(candidate, story) === "related");
    accepted.push(related ? { ...candidate, relatedStoryUrl: related.originalUrl } : candidate);
  }
  return { candidates: accepted, skippedDuplicates };
}
