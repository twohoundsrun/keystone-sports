import type { Game } from './types';
export function sameGame(a: Game, b: Game): boolean {
  if (a.espnLeague !== b.espnLeague) return false;
  if (a.id === b.id && a.source === b.source) return true;
  if (a.away.abbr !== b.away.abbr || a.home.abbr !== b.home.abbr || a.dateKey !== b.dateKey) return false;
  if (a.gameNumber && b.gameNumber && a.gameNumber !== b.gameNumber) return false;
  // Schedule and scoreboard feeds can assign different IDs or shift announced
  // start times slightly. Keep actual doubleheaders separate by game number/time.
  return Math.abs(Date.parse(a.start) - Date.parse(b.start)) <= 30 * 60_000;
}
export function uniqueGames(games: Game[]): Game[] {
  return games.filter((game, index) => games.findIndex(other => sameGame(game, other)) === index);
}
