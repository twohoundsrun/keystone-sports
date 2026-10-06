/** Display helpers for board freshness. No feed I/O. */

export type LeagueFeed = {
  league: string;
  status: "ok" | "unavailable";
  fetchedAt: string;
  games: number;
};

const LABELS: Record<string, string> = {
  nfl: "NFL",
  mlb: "MLB",
  nhl: "NHL",
  "usa.1": "MLS",
  "college-football": "NCAAF",
  nba: "NBA",
  "mens-college-basketball": "NCAAB",
};

export function leagueLabel(league: string): string {
  return LABELS[league] ?? league.toUpperCase();
}

/** One text node, so the count cannot render as "3 game s". */
export function gameCount(n: number): string {
  return `${n} ${n === 1 ? "game" : "games"}`;
}

export function feedAgePhrase(fetchedAt: string, now = Date.now()): string {
  const age = now - Date.parse(fetchedAt);
  if (!Number.isFinite(age) || age < 20_000) return "just now";
  const mins = Math.max(1, Math.round(age / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.max(1, Math.round(mins / 60));
  return `${hours}h ago`;
}

export function leagueFeedLine(feeds: LeagueFeed[], now = Date.now()): string {
  return feeds
    .map((feed) => {
      const label = leagueLabel(feed.league);
      if (feed.status === "unavailable") return `${label} unavailable`;
      const late = now - Date.parse(feed.fetchedAt) > 90_000;
      return `${label} ${late ? "delayed" : feedAgePhrase(feed.fetchedAt, now)}`;
    })
    .join(" · ");
}
