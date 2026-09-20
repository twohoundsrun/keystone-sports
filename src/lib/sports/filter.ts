import { TEAMS, TEAM_BY_SLUG, type Region } from "@/data/teams";
import type { ViewRegion } from "./prefs";
import { addDays, dateKeyNY, formatKick, formatLongDate, formatShortDate } from "./time";
import { similarHeadlines } from "./beat";
import type { Game, GameOdds, NewsItem } from "./types";

export function hasPostedOdds(game: { odds?: GameOdds | null }): boolean {
  const odds = game.odds;
  if (!odds) return false;
  const present = (value?: string) => {
    const v = value?.trim();
    return Boolean(v && v !== "-" && v !== "\u2014" && v !== "\u2013");
  };
  return present(odds.spread) || present(odds.total) || present(odds.homeMl) || present(odds.awayMl) || present(odds.drawMl) || present(odds.details);
}

export function isFollowedGame(game: Game, followed: string[]): boolean {
  if (!followed.length) return false;
  return game.paSlugs.some((slug) => followed.includes(slug));
}
