import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
// Exercise the production functions with injected network/storage boundaries.
function moduleFunctions(path, names, deps = {}) {
  const code = stripTypeScriptTypes(readFileSync(path, 'utf8'), { mode: 'transform' })
    .replace(/^import .*;\s*$/gm, '').replace(/\bexport /g, '');
  return new Function(...Object.keys(deps), code + `\nreturn {${names.join(',')}};`)(...Object.values(deps));
}
const { SportsCache } = moduleFunctions('src/lib/sports/cache.ts', ['SportsCache']);
const identity = moduleFunctions('src/lib/sports/identity.ts', ['sameGame', 'uniqueGames']);
const time = moduleFunctions('src/lib/sports/time.ts', ['validDate', 'checkedDate', 'addDays', 'eachDate', 'dateKeyNY', 'espnDateParam', 'monthBounds']);
const briefs = moduleFunctions('src/lib/sports/brief.ts', ['briefFacts', 'briefCacheKey']);
const teams = moduleFunctions('src/data/teams.ts', ['TEAMS', 'TEAM_BY_SLUG', 'ESPN_INDEX', 'MLB_INDEX', 'espnLogo', 'lookupSlug']);
const providers = moduleFunctions('src/lib/sports/providers.ts', ['normalizeBookName', 'normalizeProvider', 'canonicalizeProvider']);
const game = { id: '1', espnLeague: 'mlb', source: 'mlb', dateKey: '2020-01-01', start: '2020-01-01T18:00:00Z', name: 'Philadelphia at Pittsburgh', shortName: 'PHI @ PIT', statusText: 'Final', gameNumber: 1, away: { abbr: 'PHI', name: 'Philadelphia', score: '5' }, home: { abbr: 'PIT', name: 'Pittsburgh', score: '2' } };
