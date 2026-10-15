/** Deterministic desk guidance only. Never changes approval or publication. */
import type { SourceTier } from "./types";

export type DiscoveryPriorityInput = {
  text: string;
  sourceTier: SourceTier;
  verifiedOfficial: boolean;
  teamSlug?: string | null;
  timestamp?: string;
};

// Include community/college vocabulary; no audience-size or pro-league bonus.
const PA_TEAMS = new Set([
  "eagles",
  "steelers",
  "phillies",
  "pirates",
  "sixers",
  "flyers",
  "penguins",
  "union",
  "penn-state",
  "pitt",
  "temple",
  "villanova",
  "penn",
  "drexel",
  "duquesne",
  "lehigh",
  "lafayette",
  "bucknell",
  "kutztown",
  "slippery-rock",
  "erie-otters",
]);
const PA_HINT =
  /\b(pennsylvania|philly|philadelphia|pittsburgh|penn state|pitt|temple|villanova|drexel|duquesne|lehigh|lafayette|bucknell|kutztown|slippery rock|harrisburg|scranton|erie|altoona|lancaster|allentown|reading (?:royals|fightin phils)|williamsport|piaa|wpial|psac|eagles|steelers|phillies|pirates|sixers|flyers|penguins|philadelphia union)\b/i;
const DEVELOPMENT =
  /\b(ruled out|injur(?:y|ed)|concussion|surgery|suspend(?:s|ed)?|sign(?:s|ed)?|trade[ds]?|acquir(?:e|es|ed)|waive[ds]?|fire[ds]?|hire[ds]?|investigation|violations|clear(?:s|ed)?|returns? to practice|activate[ds]?)\b/i;
const MILESTONE =
  /\b(championship|champions|state title|playoff berth|clinches?|qualif(?:y|ies|ied)|record[- ]breaking)\b/i;
const RESULT = /\b(wins?|beats?|defeats?|overtime|final score)\b/i;
const PREVIEW = /\b(preview|power rankings?|mock draft|predictions?|things to watch)\b/i;
const PROMO =
  /\b(giveaway|sweepstakes|promo code|merchandise|win tickets?|jersey giveaway|parlay|betting|sponsored)\b/i;
const RUMOR = /\b(rumou?r|sources say|hearing|reportedly|per sources|could be)\b/i;

export function hasUnconfirmedLanguage(text: string): boolean {
  return RUMOR.test(text);
}

export function discoveryPriority(
  input: DiscoveryPriorityInput,
  now: Date = new Date(),
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const local = PA_TEAMS.has(input.teamSlug?.toLowerCase() ?? "") || PA_HINT.test(input.text);
  let score = 15;
  if (local) {
    score += 25;
    reasons.push("Pennsylvania connection");
  } else {
    score -= 15;
    reasons.push("Pennsylvania connection needs confirmation");
  }
  const credibility: Record<SourceTier, number> = {
    official_team_league: 18,
    reporter_original: 18,
    broadcaster_publication: 12,
    aggregator: 0,
  };
  score += credibility[input.sourceTier] ?? 0;
  reasons.push(
    input.sourceTier === "aggregator"
      ? "Aggregator: verify original reporting"
      : input.sourceTier === "official_team_league"
        ? "Official source"
        : "Reporting source",
  );
  if (input.verifiedOfficial && input.sourceTier === "official_team_league") score += 3;
  if (DEVELOPMENT.test(input.text)) {
    score += 25;
    reasons.push("Roster, availability or accountability development");
  } else if (MILESTONE.test(input.text)) {
    score += 25;
    reasons.push("Championship or competitive milestone");
  } else if (RESULT.test(input.text)) {
    score += 12;
    reasons.push("Game result");
  }
  if (PREVIEW.test(input.text)) {
    score -= 12;
    reasons.push("Preview or opinion");
  }
  const timestamp = Date.parse(input.timestamp ?? "");
  const ageHours = (now.getTime() - timestamp) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours < -1) {
    score -= 8;
    reasons.push("Publication time unconfirmed");
  } else if (ageHours <= 6) {
    score += 12;
    reasons.push("Published within 6 hours");
  } else if (ageHours <= 24) {
    score += 7;
    reasons.push("Published within 24 hours");
  } else if (ageHours > 72) {
    score -= 30;
    reasons.push("More than 72 hours old");
  } else if (ageHours > 36) {
    score -= 15;
    reasons.push("More than 36 hours old");
  }
  if (hasUnconfirmedLanguage(input.text)) {
    score -= 25;
    reasons.push("Unconfirmed language: manual verification required");
  }
  if (PROMO.test(input.text)) {
    score -= 85;
    reasons.push("Promotion or gambling content");
  }
  if (input.sourceTier === "aggregator") score = Math.min(score, 25);
  return { score: Math.max(0, Math.min(100, score)), reasons };
}
