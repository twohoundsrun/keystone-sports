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

test('cache serves bounded stale data on failure and never resets its original fetch time', async () => {
  let now = 0; const c = new SportsCache(() => now);
  await c.get('score', 10, async () => ['5-2']); now = 15;
  assert.deepEqual(await c.get('score', 10, async () => { throw Error('offline'); }, 20), ['5-2']);
  assert.equal(c.entries.get('score').at, 0); now = 21;
  await assert.rejects(c.get('score', 10, async () => { throw Error('offline'); }, 20));
  assert.equal(c.peek('score'), undefined);
});
test('valid empty results replace old games; concurrent requests coalesce; capacity is bounded', async () => {
  let now = 0, calls = 0; const c = new SportsCache(() => now, 2);
  await c.get('a', 10, async () => [game]); now = 20;
  assert.deepEqual(await c.get('a', 10, async () => []), []);
  const fetcher = async () => { calls++; return 1; };
  await Promise.all([c.get('b', 10, fetcher), c.get('b', 10, fetcher)]);
  assert.equal(calls, 1); await c.get('c', 10, fetcher); assert.equal(c.entries.size, 2);
});
test('doubleheaders survive even if both games share a time placeholder', () => {
  const second = { ...game, id: '2', gameNumber: 2 };
  assert.equal(identity.uniqueGames([game, second, game]).length, 2);
  assert.equal(identity.sameGame(game, { ...second, source: 'espn' }), false);
  assert.equal(identity.sameGame(game, { ...game, source: 'espn', id: 'other-id' }), true);
});
test('invalid calendar dates and out-of-range dates are rejected', () => {
  assert.equal(time.validDate('2024-02-29'), true);
  for (const value of ['2026-02-29','2026-13-01','bad','2026-09-00']) assert.equal(time.validDate(value), false);
  assert.throws(() => time.checkedDate('1999-12-31'));
});
test('recap keys isolate users and change with notes, scores, game dates, and headlines', async () => {
  const input = { date: '2020-01-01', userId: 'owner', note: 'Private', games: [game], articles: [] };
  const original = await briefs.briefCacheKey(input);
  for (const updated of [ { ...input, userId: 'other' }, { ...input, note: 'New' }, { ...input, games: [{ ...game, away: { ...game.away, score: '6' } }] }, { ...input, games: [{ ...game, dateKey: '2020-01-02' }] }, { ...input, articles: [{ headline: 'Changed', href: 'https://example.com', published: '2020-01-01' }] } ]) assert.notEqual(await briefs.briefCacheKey(updated), original);
  const facts = JSON.parse(briefs.briefFacts(input)); assert.equal(facts.games[0].away.score, '5'); assert.equal(facts.games[0].date, '2020-01-01');
});
test('historical board fetches the requested date rather than filtering the present pool', async () => {
  const urls = [];
  const fixture = { id: '99', date: '2020-01-01T18:00:00Z', name: 'PHI vs PIT', competitions: [{ competitors: [
    { homeAway: 'home', team: { id: '21', abbreviation: 'PHI', displayName: 'Eagles' }, score: '21' },
    { homeAway: 'away', team: { id: '23', abbreviation: 'PIT', displayName: 'Steelers' }, score: '17' },
  ] }], status: { type: { state: 'post', shortDetail: 'Final' } } };
  const payload = (url) => url.includes('/nfl/scoreboard') ? { events: [fixture] } : { events: [], dates: [] };
  const fetch = async url => {
    urls.push(url);
    const body = payload(String(url));
    const raw = JSON.stringify(body);
    return { ok: true, status: 200, json: async () => body, text: async () => raw };
  };
  const server = moduleFunctions('src/lib/sports/server.ts', ['loadToday', 'parseEspnEvent'], { SportsCache, ...identity, ...time, ...teams, ...briefs, ...providers, fetch });
  const board = await server.loadToday('2020-01-01');
  const dateParams = urls.filter(u => String(u).includes('/scoreboard')).map(u => new URL(u).searchParams.get('dates')).filter(Boolean);
  // ESPN only accepts a single YYYYMMDD. Homepage walks day-1..day+1.
  assert(dateParams.includes('20200101'));
  assert(dateParams.includes('20191231'));
  assert(dateParams.includes('20200102'));
  assert(dateParams.every(d => !d.includes('-')));
  assert.equal(board.games[0].dateKey, '2020-01-01'); assert.equal(board.games[0].home.score, '21');
  assert.equal(server.parseEspnEvent({ ...fixture, status: { type: { state: 'pre', shortDetail: 'Postponed' } } }, 'nfl').statusText, 'Postponed');
});

test('loadToday does not double-fetch every league scoreboard', async () => {
  const urls = [];
  const fetch = async url => {
    urls.push(url);
    const body = { events: [], dates: [] };
    const raw = JSON.stringify(body);
    return { ok: true, status: 200, json: async () => body, text: async () => raw };
  };
  const server = moduleFunctions('src/lib/sports/server.ts', ['loadToday'], { SportsCache, ...identity, ...time, ...teams, ...briefs, ...providers, fetch });
  await server.loadToday('2026-09-10');
  const scoreboardUrls = urls.filter(u => String(u).includes('/scoreboard'));
  // Five in-season leagues (NBA/NCAAB skipped in September) × day-1..day+1.
  assert.equal(scoreboardUrls.length, 15);
  const dates = [...new Set(scoreboardUrls.map(u => new URL(u).searchParams.get('dates')))].sort();
  assert.deepEqual(dates, ['20260909', '20260910', '20260911']);
  assert(scoreboardUrls.every(u => !String(new URL(u).searchParams.get('dates') || '').includes('-')));
});

test('eachDate walks inclusive days and rejects inverted ranges', () => {
  assert.deepEqual(time.eachDate('2026-09-17', '2026-09-17'), ['2026-09-17']);
  assert.deepEqual(time.eachDate('2026-09-17', '2026-09-19'), ['2026-09-17', '2026-09-18', '2026-09-19']);
  assert.deepEqual(time.eachDate('2026-09-19', '2026-09-17'), []);
  assert.deepEqual(time.eachDate('nope', '2026-09-17'), []);
});

test('college team hubs use espnId and survive schedule failure', async () => {
  const urls = [];
  const fetch = async url => {
    urls.push(String(url));
    if (String(url).includes('/schedule')) throw new Error('upstream down');
    if (String(url).includes('/news')) return { ok: true, json: async () => ({ articles: [] }) };
    if (String(url).includes('/teams/')) return { ok: true, json: async () => ({ team: { record: { items: [{ summary: '1-0' }] } } }) };
    return { ok: true, text: async () => '<feed></feed>', json: async () => ({}) };
  };
  const server = moduleFunctions('src/lib/sports/server.ts', ['loadTeamPage', 'scheduleTeamId'], { SportsCache, ...identity, ...time, ...teams, ...briefs, ...providers, fetch });
  assert.equal(server.scheduleTeamId(teams.TEAM_BY_SLUG['penn-state']), '213');
  assert.equal(server.scheduleTeamId(teams.TEAM_BY_SLUG['temple']), '218');
  assert.equal(server.scheduleTeamId(teams.TEAM_BY_SLUG['eagles']), 'phi');
  const page = await server.loadTeamPage('penn-state');
  assert.equal(page.slug, 'penn-state');
  assert(Array.isArray(page.games));
  assert(page.warnings?.length);
  assert(urls.some(u => u.includes('/college-football/teams/213/schedule')));
  assert(!urls.some(u => u.includes('/college-football/teams/psu/schedule')));
});
test('publisher rejects anonymous, wrong-owner and unconfigured identities', () => {
  for (const headers of [{}, { 'oai-authenticated-user-id': 'other', 'oai-authenticated-user-email': 'other@example.com' }, { 'cf-access-authenticated-user-email': 'other@example.com' }]) {
    const auth = moduleFunctions('src/lib/publishing/runtime.server.ts', ['requireAdmin'], { env: { KEYSTONE_ADMIN_EMAIL: 'owner@example.com' }, getRequestHeader: key => headers[key], setResponseHeader() {} });
    assert.throws(() => auth.requireAdmin());
  }
  const headers = { 'oai-authenticated-user-id': 'owner-id', 'oai-authenticated-user-email': 'owner@example.com' };
  const deps = { env: { KEYSTONE_ADMIN_EMAIL: 'owner@example.com' }, getRequestHeader: key => headers[key], setResponseHeader() {} };
  assert.equal(moduleFunctions('src/lib/publishing/runtime.server.ts', ['requireAdmin'], deps).requireAdmin(), 'owner-id');
  assert.throws(() => moduleFunctions('src/lib/publishing/runtime.server.ts', ['requireAdmin'], { ...deps, env: {} }).requireAdmin());
  const accessDeps = { env: { KEYSTONE_ADMIN_EMAIL: 'owner@example.com' }, getRequestHeader: key => ({ 'cf-access-authenticated-user-email': 'owner@example.com' })[key], setResponseHeader() {} };
  assert.equal(moduleFunctions('src/lib/publishing/runtime.server.ts', ['requireAdmin'], accessDeps).requireAdmin(), 'access:owner@example.com');
});

test('calendar export preserves UTC starts and escapes content instead of injecting events', () => {
  const { calendarFile } = moduleFunctions('src/lib/sports/calendar.ts', ['calendarFile']);
  const text = calendarFile({ ...game, name: 'Game\nBEGIN:VEVENT;extra' });
  assert(text.includes('DTSTART:20200101T180000Z'));
  assert.equal(text.split('\r\nBEGIN:VEVENT').length, 2);
  assert(text.includes('Game\\nBEGIN:VEVENT\\;extra'));
});
