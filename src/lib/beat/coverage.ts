/** Entity recognition, not ranking. A small institution gets the same PA credit. */
export type CoverageArea = "professional" | "college" | "high_school" | "regional";
export const COVERAGE_AREAS: CoverageArea[] = [
  "professional",
  "college",
  "high_school",
  "regional",
];
export const PA_ENTITIES: { slug: string; area: CoverageArea; pattern: RegExp }[] = [
  { slug: "eagles", area: "professional", pattern: /\b(?:philadelphia eagles|eagles)\b/i },
  { slug: "steelers", area: "professional", pattern: /\bsteelers\b/i },
  { slug: "phillies", area: "professional", pattern: /\bphillies\b/i },
  { slug: "pirates", area: "professional", pattern: /\b(?:pittsburgh pirates|pirates)\b/i },
  { slug: "sixers", area: "professional", pattern: /\b(?:76ers|sixers)\b/i },
  { slug: "penguins", area: "professional", pattern: /\b(?:pittsburgh penguins|penguins)\b/i },
  { slug: "flyers", area: "professional", pattern: /\bflyers\b/i },
  { slug: "union", area: "professional", pattern: /\bphiladelphia union\b/i },
  {
    slug: "riverhounds",
    area: "professional",
    pattern: /\b(?:Pittsburgh Riverhounds|Riverhounds)\b/i,
  },
  { slug: "philadelphia-wings", area: "professional", pattern: /\bPhiladelphia Wings\b/i },
  { slug: "penn-state", area: "college", pattern: /\b(?:penn state|nittany lions)\b/i },
  { slug: "pitt", area: "college", pattern: /\b(?:pitt(?:sburgh)? panthers|pitt)\b/i },
  ...[
    "Temple",
    "Villanova",
    "Lehigh",
    "Lafayette",
    "Bucknell",
    "Duquesne",
    "Drexel",
    "Kutztown",
    "Slippery Rock",
    "Shippensburg",
    "West Chester",
    "Millersville",
    "Bloomsburg",
    "Lock Haven",
    "East Stroudsburg",
    "Edinboro",
    "Mercyhurst",
    "Gannon",
    "Saint Francis",
  ].map((name) => ({
    slug: name.toLowerCase().replaceAll(" ", "-"),
    area: "college" as const,
    pattern: new RegExp(`\\b${name}\\b`, "i"),
  })),
  { slug: "saint-josephs", area: "college", pattern: /\b(?:saint|st\.?) joseph['’]?s\b/i },
  { slug: "penn", area: "college", pattern: /\b(?:penn quakers|university of pennsylvania)\b/i },
  {
    slug: "railriders",
    area: "regional",
    pattern: /\b(?:railriders|scranton[ /-]wilkes[ -]barre)\b/i,
  },
  { slug: "ironpigs", area: "regional", pattern: /\b(?:ironpigs|lehigh valley ironpigs)\b/i },
  { slug: "seawolves", area: "regional", pattern: /\b(?:erie seawolves|seawolves)\b/i },
  { slug: "senators", area: "regional", pattern: /\bharrisburg senators\b/i },
  { slug: "reading-fightin-phils", area: "regional", pattern: /\bReading Fightin(?:g)? Phils\b/i },
  { slug: "altoona-curve", area: "regional", pattern: /\bAltoona Curve\b/i },
  {
    slug: "crosscutters",
    area: "regional",
    pattern: /\b(?:Williamsport Crosscutters|Crosscutters)\b/i,
  },
  { slug: "york-revolution", area: "regional", pattern: /\bYork Revolution\b/i },
  { slug: "lancaster-barnstormers", area: "regional", pattern: /\bLancaster Barnstormers\b/i },
  { slug: "erie-otters", area: "regional", pattern: /\berie otters\b/i },
  { slug: "reading-royals", area: "regional", pattern: /\breading royals\b/i },
];

// Common college nicknames shared with PA pro teams are not PA evidence alone.
const NON_PA_NAMES: Record<string, RegExp> = {
  eagles: /\b(?:Boston College|Georgia Southern|Eastern Washington|Eastern Michigan)\b/i,
  pirates: /\b(?:Seton Hall|East Carolina)\b/i,
  flyers: /\bDayton\b/i,
  penguins: /\bYoungstown State\b/i,
};

export function inferPaCoverage(
  text: string,
  sourceTeam?: string,
): { area: CoverageArea; teamSlug: string } | null {
  // Explicit school competition markers take precedence over shared nicknames.
  if (/\b(?:PIAA|WPIAL|PIHL|Pennsylvania high school)\b/i.test(text))
    return { area: "high_school", teamSlug: "pa-high-school" };
  const trusted = PA_ENTITIES.find((entity) => entity.slug === sourceTeam);
  // Prefer a source's known entity over ambiguous nicknames in its headlines.
  if (trusted) return { area: trusted.area, teamSlug: trusted.slug };
  // Regional names must precede college terms such as Lehigh.
  const match = [
    ...PA_ENTITIES.filter((e) => e.area === "regional"),
    ...PA_ENTITIES.filter((e) => e.area !== "regional"),
  ].find((entity) => entity.pattern.test(text) && !NON_PA_NAMES[entity.slug]?.test(text));
  if (match) return { area: match.area, teamSlug: match.slug };
  if (
    /\b(?:Pennsylvania|Harrisburg|Scranton|Allentown|Altoona|Lancaster)\b/i.test(text) &&
    /\b(?:district|high school)\b/i.test(text)
  )
    return { area: "high_school", teamSlug: "pa-high-school" };
  return null;
}
