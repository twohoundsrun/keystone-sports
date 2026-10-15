/** Duplicate fingerprints for Beat discovery vs existing Beat + News links. */

import { normalizeBeatUrl, extractXStatusId, extractYouTubeId } from "./allowlist";

function simplifyHeadline(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** Stable fingerprint used for dedupe (URL preferred; else team+headline). */
export function beatDuplicateFingerprint(input: {
  originalUrl: string;
  teamSlug?: string | null;
  headline?: string;
}): string {
  const xId = extractXStatusId(input.originalUrl);
  if (xId) return `x:${xId}`;
  const ytId = extractYouTubeId(input.originalUrl);
  if (ytId) return `yt:${ytId}`;
  const norm = normalizeBeatUrl(input.originalUrl);
  if (norm) return `url:${norm.toLowerCase()}`;
  const team = (input.teamSlug || "site").toLowerCase();
  return `hl:${team}:${simplifyHeadline(input.headline || "")}`;
}

export function urlsLikelySameStory(a: string, b: string): boolean {
  const na = normalizeBeatUrl(a)?.toLowerCase();
  const nb = normalizeBeatUrl(b)?.toLowerCase();
  if (na && nb && na === nb) return true;
  const xa = extractXStatusId(a);
  const xb = extractXStatusId(b);
  if (xa && xb && xa === xb) return true;
  const ya = extractYouTubeId(a);
  const yb = extractYouTubeId(b);
  return Boolean(ya && yb && ya === yb);
}

export type BeatStoryReference = {
  originalUrl: string;
  headline: string;
  teamSlug?: string | null;
  timestamp?: string;
};

const HEADLINE_STOP_WORDS = new Set(
  "a an the breaking report reports sunday monday tuesday wednesday thursday friday saturday".split(
    " ",
  ),
);
const DEVELOPMENT_WORDS =
  /\b(out|cleared|returns?|signed|traded|waived|activated|suspended|fired|hired|surgery|concussion|injury|doubtful|questionable|confirmed|denied|not|no|never|update|correction)\b/gi;

function headlineWords(headline: string): string[] {
  return headline
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !HEADLINE_STOP_WORDS.has(word));
}

/**
 * Conservative syndication matching. URL identity is permanent; headline/event
 * matches require the same explicit team and a 48h window. Related coverage is
 * advisory, never discarded. Changed numbers or developments always survive.
 */
export function beatStoryRelation(
  a: BeatStoryReference,
  b: BeatStoryReference,
): "duplicate" | "related" | null {
  if (urlsLikelySameStory(a.originalUrl, b.originalUrl)) return "duplicate";
  if (!a.teamSlug || !b.teamSlug || a.teamSlug.toLowerCase() !== b.teamSlug.toLowerCase())
    return null;
  const timeA = Date.parse(a.timestamp ?? "");
  const timeB = Date.parse(b.timestamp ?? "");
  if (
    !Number.isFinite(timeA) ||
    !Number.isFinite(timeB) ||
    Math.abs(timeA - timeB) > 48 * 3_600_000
  )
    return null;
  const tokensA = headlineWords(a.headline);
  const tokensB = headlineWords(b.headline);
  const wordsA = new Set(tokensA);
  const wordsB = new Set(tokensB);
  if (Math.min(wordsA.size, wordsB.size) < 5) return null;
  const common = [...wordsA].filter((word) => wordsB.has(word)).length;
  const similarity = common / new Set([...wordsA, ...wordsB]).size;
  if (similarity < 0.4) return null;
  // Historical rows may contain only a shortened prefix. That cannot prove
  // two different URLs carry the same development. URL identity above remains exact.
  if (/…$|\.\.\.$/.test(a.headline.trim()) || /…$|\.\.\.$/.test(b.headline.trim()))
    return "related";
  const developments = (text: string) =>
    [...new Set(text.toLowerCase().match(DEVELOPMENT_WORDS) ?? [])].sort().join(" ");
  const numbers = (text: string) => (text.match(/\d+/g) ?? []).join(" ");
  const sameFacts =
    developments(a.headline) === developments(b.headline) &&
    numbers(a.headline) === numbers(b.headline);
  // Preserve word relationships: reversing a winner or trade participants is
  // a material change even if the unordered words and numbers match.
  if (sameFacts && tokensA.join(" ") === tokensB.join(" ")) return "duplicate";
  return "related";
}
