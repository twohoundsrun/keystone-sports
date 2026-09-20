import { TEAMS, TEAM_BY_SLUG, type Region } from "@/data/teams";
import type { ViewRegion } from "./prefs";
import { addDays, dateKeyNY, formatKick, formatLongDate, formatShortDate } from "./time";
import { similarHeadlines } from "./beat";
import type { Game, GameOdds, NewsItem } from "./types";

export function hasPostedOdds(game: { odds?: GameOdds | null }): boolean {
  const odds = game.odds;
  if (!odds) return false;
  const present = (value?: string) => Boolean(value && value.trim() && value.trim() !== "\u2014");
  return present(odds.spread) || present(odds.total) || present(odds.homeMl) || present(odds.awayMl) || present(odds.drawMl) || present(odds.details);
}

export function isFollowedGame(game: Game, followed: string[]): boolean {
  if (!followed.length) return false;
  return game.paSlugs.some((slug) => followed.includes(slug));
}

export function filterGames(games: Game[], region: "all" | Region, sport: string): Game[] {
  return games.filter((g) => {
    if (sport !== "all" && g.sport !== sport) return false;
    if (region === "all") return true;
    return g.paSlugs.some((slug) => TEAM_BY_SLUG[slug]?.region === region);
  });
}

/** Stable: followed clubs stay in original order, just move to the front. */
export function sortFollowed(games: Game[], followed: string[]): Game[] {
  if (!followed.length) return games;
  const mine: Game[] = [];
  const rest: Game[] = [];
  for (const g of games) (isFollowedGame(g, followed) ? mine : rest).push(g);
  return mine.concat(rest);
}

export function applyView(
  games: Game[],
  region: ViewRegion,
  sport: string,
  followed: string[],
  followHydrated: boolean,
): Game[] {
  const geo = region === "following" ? "all" : region;
  let next = filterGames(games, geo, sport);
  if (region === "following") {
    if (!followHydrated) return [];
    if (!followed.length) return [];
    next = next.filter((g) => isFollowedGame(g, followed));
  }
  return next;
}

const PA_WORDS = TEAMS.flatMap((t) => [
  t.shortName.toLowerCase(),
  t.nick.toLowerCase(),
  t.city.toLowerCase(),
  t.slug.replace("-", " "),
]).concat(["philly", "philadelphia", "pittsburgh", "penn state", "nittany", "eagles", "steelers"]);

function headlineKey(headline: string): string {
  return headline.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function rankPaNews(articles: NewsItem[], followed: string[] = []): NewsItem[] {
  const score = (a: NewsItem) => {
    let n = 0;
    const h = a.headline.toLowerCase();
    if (a.teamSlug && TEAM_BY_SLUG[a.teamSlug]) n += 4;
    if (a.teamSlug && followed.includes(a.teamSlug)) n += 3;
    if (PA_WORDS.some((w) => h.includes(w))) n += 3;
    if (a.image) n += 1;
    return n;
  };
  const ranked = [...articles].sort((a, b) => {
    const d = score(b) - score(a);
    if (d) return d;
    return (b.published || "").localeCompare(a.published || "");
  });
  const kept: NewsItem[] = [];
  const seen = new Set<string>();
  for (const item of ranked) {
    const key = headlineKey(item.headline);
    if (!key || seen.has(key)) continue;
    if (kept.some((prev) => similarHeadlines(prev.headline, item.headline))) continue;
    seen.add(key);
    kept.push(item);
  }
  return kept;
}

export function humanKicker(input: {
  date: string;
  recap?: { title: string; body: string; date: string } | null;
  slateCount: number;
  next?: { away: string; home: string; when: string } | null;
}): { line: string; lede?: string } {
  const recap = input.recap;
  if (recap?.title?.trim()) {
    const titled = recap.title.trim();
    const clean = recap.body.replace(/\s+/g, " ").trim();
    const sentence = clean.match(/^.{24,200}?[.!?]/)?.[0]?.trim();
    const lede = sentence && sentence.toLowerCase() !== titled.toLowerCase() ? sentence : undefined;
    return { line: `${formatShortDate(recap.date || input.date)} \u00b7 ${titled}`, lede };
  }
  const weekday = formatLongDate(input.date).split(",")[0] || "Today";
  if (input.slateCount > 0) {
    const n = input.slateCount === 1 ? "one Pennsylvania game" : `${input.slateCount} Pennsylvania games`;
    return { line: `${weekday} desk. ${n} on the board.` };
  }
  if (input.next?.away && input.next.home) {
    const when = input.next.when ? `, ${input.next.when}` : "";
    return { line: `${weekday} is a quiet one. Next up: ${input.next.away} at ${input.next.home}${when}.` };
  }
  return { line: `${weekday} desk. Nothing on the Pennsylvania slate.` };
}

function firstPlayable(list: Game[], followed: string[]): Game | undefined {
  const mine = (g: Game) => isFollowedGame(g, followed);
  return (
    list.find((g) => g.status === "in" && mine(g)) ??
    list.find((g) => g.status === "in") ??
    list.find((g) => g.status === "pre" && mine(g) && Boolean(g.broadcast)) ??
    list.find((g) => g.status === "pre" && Boolean(g.broadcast)) ??
    list.find((g) => g.status === "pre" && mine(g)) ??
    list.find((g) => g.status === "pre")
  );
}

export function pickFeatured(games: Game[], followed: string[] = [], upcoming: Game[] = []): Game | undefined {
  return firstPlayable(games, followed) ?? firstPlayable(upcoming, followed);
}

export function featuredLabel(game: Game): string {
  if (game.status === "in") return "Live now";
  if (game.status === "post") return "Final";
  const key = dateKeyNY(game.start);
  const today = dateKeyNY();
  if (key === today) return "Tonight";
  if (key === addDays(today, 1)) return "Tomorrow";
  return formatShortDate(key);
}

export function buildKicker(today: Game[], upcoming: Game[], recent: Game[]): string {
  const parts: string[] = [];
  const final = today.find((g) => g.status === "post") ?? recent.find((g) => g.status === "post");
  if (final && final.home.score != null && final.away.score != null) {
    const pa =
      (final.home.slug && final.paSlugs.includes(final.home.slug) ? final.home : undefined) ??
      (final.away.slug && final.paSlugs.includes(final.away.slug) ? final.away : undefined) ??
      final.home;
    const opp = pa === final.home ? final.away : final.home;
    parts.push(`${pa.abbr} ${pa.score}\u2013${opp.score}`);
  }
  const next = upcoming.find((g) => g.status === "pre") ?? upcoming[0];
  if (next && next.status !== "post") {
    parts.push(`Next: ${next.away.abbr} @ ${next.home.abbr}, ${formatKick(next.start)}`);
  }
  return parts.join(". ");
}

export function matchupLine(game: Game): string {
  const pa = TEAM_BY_SLUG[game.paSlugs[0] ?? ""];
  if (!pa) return game.shortName;
  const homePa = game.home.slug === pa.slug;
  if (game.status === "in") return `${pa.shortName} \u00b7 ${game.statusText}`;
  if (homePa) return `${pa.shortName} host ${game.away.name}`;
  return `${pa.shortName} at ${game.home.name}`;
}
