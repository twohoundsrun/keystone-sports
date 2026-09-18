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
const time = moduleFunctions('src/lib/sports/time.ts', ['validDate', 'checkedDate', 'addDays', 'dateKeyNY', 'espnDateParam', 'monthBounds']);
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
  const dateParams = urls.map(u => new URL(u).searchParams.get('dates')).filter(Boolean);
  // Historical boards use the exact requested day; ESPN date ranges are not reliable.
  assert(dateParams.includes('20200101'));
  assert(dateParams.every(p => !p.includes('-')));
  assert.equal(board.games[0].dateKey, '2020-01-01'); assert.equal(board.games[0].home.score, '21');
  assert.equal(server.parseEspnEvent({ ...fixture, status: { type: { state: 'pre', shortDetail: 'Postponed' } } }, 'nfl').statusText, 'Postponed');
});

test('loadToday uses single-day ESPN scoreboards and schedule fallbacks', async () => {
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
  // Five in-season leagues (NBA/NCAAB skipped in September) × the selected day only.
  assert.equal(scoreboardUrls.length, 5);
  assert(scoreboardUrls.every(u => new URL(u).searchParams.get('dates') === '20260910'));
  assert(scoreboardUrls.every(u => !new URL(u).searchParams.get('dates').includes('-')));
  assert(urls.some(u => String(u).includes('/schedule')));
});

test('week odds supplement never sends an ESPN date range', async () => {
  const urls = [];
  const fetch = async url => {
    urls.push(String(url));
    const body = { events: [], dates: [] };
    const raw = JSON.stringify(body);
    return { ok: true, status: 200, json: async () => body, text: async () => raw };
  };
  const server = moduleFunctions('src/lib/sports/server.ts', ['weekOddsBoards'], { SportsCache, ...identity, ...time, ...teams, ...briefs, ...providers, fetch });
  await server.weekOddsBoards('2026-09-10');
  const scoreboardUrls = urls.filter(u => u.includes('/scoreboard'));
  assert.equal(scoreboardUrls.length, 3);
  assert(scoreboardUrls.every(u => new URL(u).searchParams.get('dates') === '20260911'));
  assert(scoreboardUrls.every(u => !new URL(u).searchParams.get('dates').includes('-')));
});

test('calendar month uses PA schedules instead of ESPN range scoreboards', async () => {
  const urls = [];
  const fetch = async url => {
    urls.push(String(url));
    const body = { events: [], dates: [] };
    const raw = JSON.stringify(body);
    return { ok: true, status: 200, json: async () => body, text: async () => raw };
  };
  const server = moduleFunctions('src/lib/sports/server.ts', ['loadMonth'], { SportsCache, ...identity, ...time, ...teams, ...briefs, ...providers, fetch });
  await server.loadMonth('2026-09');
  assert.equal(urls.filter(u => u.includes('/scoreboard')).length, 0);
  assert(urls.some(u => u.includes('/schedule')));
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

test('CHI/DET ESPN ids do not stamp Flyers or Penguins as PA', () => {
  const server = moduleFunctions('src/lib/sports/server.ts', ['parseEspnEvent', 'isPaEvent'], { SportsCache, ...identity, ...time, ...teams, ...briefs, ...providers, fetch: async () => ({ ok: true, json: async () => ({}) }) });
  const event = (home, away) => ({
    id: 'nhl-leak',
    date: '2026-09-26T23:00:00Z',
    name: away.name + ' at ' + home.name,
    competitions: [{ competitors: [
      { homeAway: 'home', team: home },
      { homeAway: 'away', team: away },
    ] }],
    status: { type: { state: 'pre', shortDetail: 'Sat, September 26th' } },
  });
  const chi = event(
    { id: '4', abbreviation: 'CHI', displayName: 'Chicago Blackhawks' },
    { id: '19', abbreviation: 'STL', displayName: 'St. Louis Blues' },
  );
  const det = event(
    { id: '5', abbreviation: 'DET', displayName: 'Detroit Red Wings' },
    { id: '29', abbreviation: 'CBJ', displayName: 'Columbus Blue Jackets' },
  );
  const phi = event(
    { id: '15', abbreviation: 'PHI', displayName: 'Philadelphia Flyers' },
    { id: '1', abbreviation: 'BOS', displayName: 'Boston Bruins' },
  );
  const pit = event(
    { id: '16', abbreviation: 'PIT', displayName: 'Pittsburgh Penguins' },
    { id: '8', abbreviation: 'WSH', displayName: 'Washington Capitals' },
  );
  const chiGame = server.parseEspnEvent(chi, 'nhl');
  const detGame = server.parseEspnEvent(det, 'nhl');
  const phiGame = server.parseEspnEvent(phi, 'nhl');
  const pitGame = server.parseEspnEvent(pit, 'nhl');
  assert.deepEqual(chiGame.paSlugs, []);
  assert.deepEqual(detGame.paSlugs, []);
  assert.equal(server.isPaEvent(chiGame, 'nhl', chi), false);
  assert.equal(server.isPaEvent(detGame, 'nhl', det), false);
  assert.deepEqual(phiGame.paSlugs, ['flyers']);
  assert.deepEqual(pitGame.paSlugs, ['penguins']);
  assert.equal(server.isPaEvent(phiGame, 'nhl', phi), true);
  assert.equal(server.isPaEvent(pitGame, 'nhl', pit), true);
  const abbrOnly = event(
    { id: '999', abbreviation: 'PHI', displayName: 'Philadelphia Flyers' },
    { id: '1', abbreviation: 'BOS', displayName: 'Boston Bruins' },
  );
  assert.deepEqual(server.parseEspnEvent(abbrOnly, 'nhl').paSlugs, ['flyers']);
});


test('standings ignore CFB subcategory stat overwrites and sort by win percent', async () => {
  const urls = [];
  const cfbPayload = {
    name: 'FBS',
    season: { year: 2026, displayName: '2026', startDate: '2026-02-01T08:00Z', endDate: '2027-01-28T07:59Z' },
    seasons: [{
      year: 2026, displayName: '2026', startDate: '2026-02-01T08:00Z', endDate: '2027-01-28T07:59Z',
      types: [
        { abbreviation: 'pre', name: 'Preseason', startDate: '2026-02-01T08:00Z', endDate: '2026-08-22T06:59Z' },
        { abbreviation: 'reg', name: 'Regular Season', startDate: '2026-08-22T07:00Z', endDate: '2026-12-13T07:59Z' },
      ],
    }],
    children: [{
      id: '5', name: 'Big Ten Conference',
      standings: { entries: [{
        team: { id: '194', abbreviation: 'PSU', displayName: 'Penn State Nittany Lions' },
        stats: [
          { name: 'gamesBehind', type: 'gamesbehind', displayValue: '0.5', value: 0.5 },
          { name: 'streak', type: 'streak', displayValue: 'W1', value: 1 },
          { name: 'wins', type: 'wins', displayValue: '1', value: 1 },
          { name: 'overall', type: 'total', displayValue: '1-0', value: null },
          { name: 'wins', type: 'awayrecord_wins', displayValue: '0', value: 0 },
          { name: 'streak', type: 'awayrecord_streak', displayValue: '-', value: 0 },
          { name: 'gamesBehind', type: 'awayrecord_gamesbehind', displayValue: '-', value: 0 },
          { name: 'Away', type: 'awayrecord', displayValue: '0-0', value: null },
        ],
      }, {
        team: { id: '84', abbreviation: 'IND', displayName: 'Indiana Hoosiers' },
        stats: [
          { name: 'wins', type: 'wins', displayValue: '0', value: 0 },
          { name: 'overall', type: 'total', displayValue: '0-1', value: null },
          { name: 'streak', type: 'streak', displayValue: 'L1', value: -1 },
          { name: 'gamesBehind', type: 'gamesbehind', displayValue: '1.5', value: 1.5 },
          { name: 'wins', type: 'awayrecord_wins', displayValue: '0', value: 0 },
        ],
      }] },
    }],
  };
  const mlbEast = {
    name: 'National League',
    season: { year: 2026, displayName: '2026' },
    seasons: [{ year: 2026, displayName: '2026', types: [
      { abbreviation: 'reg', name: 'Regular Season', startDate: '2026-03-25T07:00Z', endDate: '2026-09-29T06:59Z' },
    ]}],
    children: [{
      id: '4', name: 'National League East',
      standings: { entries: [
        { team: { id: '26', abbreviation: 'SF', displayName: 'San Francisco Giants' }, stats: [
          { name: 'wins', type: 'wins', displayValue: '62' }, { name: 'losses', type: 'losses', displayValue: '85' },
          { name: 'winPercent', type: 'winpercent', displayValue: '.422' }, { name: 'gamesBehind', type: 'gamesbehind', displayValue: '29' },
          { name: 'streak', type: 'streak', displayValue: 'W3' },
        ]},
        { team: { id: '19', abbreviation: 'PHI', displayName: 'Philadelphia Phillies' }, stats: [
          { name: 'wins', type: 'wins', displayValue: '82' }, { name: 'losses', type: 'losses', displayValue: '64' },
          { name: 'winPercent', type: 'winpercent', displayValue: '.562' }, { name: 'gamesBehind', type: 'gamesbehind', displayValue: '8.5' },
          { name: 'streak', type: 'streak', displayValue: 'W1' },
        ]},
        { team: { id: '15', abbreviation: 'ATL', displayName: 'Atlanta Braves' }, stats: [
          { name: 'wins', type: 'wins', displayValue: '85' }, { name: 'losses', type: 'losses', displayValue: '61' },
          { name: 'winPercent', type: 'winpercent', displayValue: '.582' }, { name: 'gamesBehind', type: 'gamesbehind', displayValue: '5.5' },
          { name: 'streak', type: 'streak', displayValue: 'L3' },
        ]},
      ] },
    }],
  };
  const fetch = async (url) => {
    urls.push(url);
    const u = String(url);
    let body = { name: 'empty', children: [], standings: { entries: [] }, season: {}, seasons: [] };
    if (u.includes('college-football')) body = cfbPayload;
    else if (u.includes('baseball/mlb') && u.includes('group=8')) body = mlbEast;
    else if (u.includes('baseball/mlb') && u.includes('group=7')) body = { name: 'American League', children: [], season: mlbEast.season, seasons: mlbEast.seasons };
    return { ok: true, json: async () => body, status: 200 };
  };
  const server = moduleFunctions('src/lib/sports/server.ts', ['loadStandings'], { SportsCache, ...identity, ...time, ...teams, ...briefs, ...providers, fetch });
  const cfb = await server.loadStandings('cfb');
  const psu = cfb.groups.flatMap(g => g.rows).find(r => r.abbr === 'PSU');
  assert.equal(psu.wins, 1);
  assert.equal(psu.losses, 0);
  assert.equal(psu.streak, 'W1');
  assert.equal(psu.gamesBehind, '0.5');
  assert.deepEqual(cfb.groups[0].rows.map(r => r.abbr), ['PSU', 'IND']);
  assert.equal(cfb.groups[0].name, 'Big Ten — Penn State');

  const mlb = await server.loadStandings('mlb');
  assert(urls.some(u => String(u).includes('group=8')));
  const east = mlb.groups.find(g => /East/i.test(g.name));
  assert(east, 'expected NL East group');
  assert.equal(east.name, 'NL East');
  assert.deepEqual(east.rows.map(r => r.abbr), ['ATL', 'PHI', 'SF']);
  assert.equal(east.rows[1].slug, 'phillies');
});

test('standings label NBA off-season finals from ESPN season types', async () => {
  const payload = {
    name: 'Eastern Conference',
    season: { year: 2027, displayName: '2026-27', startDate: '2026-09-30T07:00Z', endDate: '2027-06-26T06:59Z' },
    seasons: [{
      year: 2026, displayName: '2025-26', startDate: '2025-10-01T07:00Z', endDate: '2026-06-27T06:59Z',
      types: [
        { abbreviation: 'reg', name: 'Regular Season', startDate: '2025-10-21T07:00Z', endDate: '2026-04-13T06:59Z' },
        { abbreviation: 'off', name: 'Off Season', startDate: '2026-06-27T07:00Z', endDate: '2026-09-30T06:59Z' },
      ],
    }],
    children: [{
      id: '1', name: 'Atlantic',
      standings: { entries: [{
        team: { id: '20', abbreviation: 'PHI', displayName: 'Philadelphia 76ers' },
        stats: [
          { name: 'wins', type: 'wins', displayValue: '45' },
          { name: 'losses', type: 'losses', displayValue: '37' },
          { name: 'winPercent', type: 'winpercent', displayValue: '.549' },
          { name: 'gamesBehind', type: 'gamesbehind', displayValue: '11' },
          { name: 'streak', type: 'streak', displayValue: 'L1' },
        ],
      }] },
    }],
  };
  const fetch = async (url) => {
    const u = String(url);
    let body = payload;
    if (u.includes('group=6')) body = { name: 'Western Conference', children: [], season: payload.season, seasons: payload.seasons };
    return { ok: true, status: 200, json: async () => body };
  };
  const server = moduleFunctions('src/lib/sports/server.ts', ['loadStandings'], { SportsCache, ...identity, ...time, ...teams, ...briefs, ...providers, fetch });
  const board = await server.loadStandings('nba');
  assert.match(board.seasonNote || '', /season is over|final standings/i);
  assert.equal(board.seasonLabel, '2025-26');
  assert.equal(board.groups[0].name, 'Atlantic Division');
  assert.equal(board.groups[0].rows[0].slug, 'sixers');
});

test('normalizeBookName canonicalizes sportsbook variants', () => {
  const cases = [
    ['Draft Kings', 'DraftKings'],
    ['draftkings', 'DraftKings'],
    ['DRAFTKINGS', 'DraftKings'],
    ['DraftKings', 'DraftKings'],
    ['draft kings', 'DraftKings'],
    ['  Draft  Kings ', 'DraftKings'],
    ['FanDuel', 'FanDuel'],
    ['fan duel', 'FanDuel'],
    ['FANDUEL', 'FanDuel'],
    ['BetMGM', 'BetMGM'],
    ['bet mgm', 'BetMGM'],
    ['Bet MGM', 'BetMGM'],
    ['Caesars', 'Caesars'],
    ['caesars sportsbook', 'Caesars'],
    ['PointsBet', 'PointsBet'],
    ['points bet', 'PointsBet'],
    ['PointBet', 'PointsBet'],
    ['Bet365', 'Bet365'],
    ['bet 365', 'Bet365'],
    ['ESPN BET', 'ESPN BET'],
    ['espn bet', 'ESPN BET'],
    ['ESPN', 'ESPN'],
    ['Some Local Book', 'Some Local Book'],
  ];
  for (const [input, want] of cases) {
    assert.equal(providers.normalizeBookName(input), want, input);
    assert.equal(providers.normalizeProvider(input), want, input);
    assert.equal(providers.canonicalizeProvider(input), want, input);
  }
});

test('ESPN odds parse routes provider names through normalizeBookName', () => {
  const server = moduleFunctions('src/lib/sports/server.ts', ['normalizeProvider', 'parseEspnEvent'], {
    SportsCache, ...identity, ...time, ...teams, ...briefs, ...providers,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  });
  assert.equal(server.normalizeProvider('Draft Kings'), 'DraftKings');

  const fixture = {
    id: '401',
    date: '2026-09-10T23:15:00Z',
    name: 'Philadelphia Eagles at Dallas Cowboys',
    shortName: 'PHI @ DAL',
    competitions: [{
      date: '2026-09-10T23:15:00Z',
      competitors: [
        { homeAway: 'away', team: { id: '21', abbreviation: 'PHI', displayName: 'Philadelphia Eagles', logo: 'http://a.espncdn.com/i/teamlogos/nfl/500/phi.png' } },
        { homeAway: 'home', team: { id: '6', abbreviation: 'DAL', displayName: 'Dallas Cowboys', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/dal.png' } },
      ],
      odds: [{ provider: { name: 'Draft Kings' }, details: 'DAL -3.5', overUnder: '47.5', homeTeamOdds: { moneyLine: -180 }, awayTeamOdds: { moneyLine: 150 } }],
      status: { type: { state: 'pre', shortDetail: '8:15 PM ET' } },
    }],
    links: [{ href: 'http://www.espn.com/nfl/game/_/gameId/401' }],
    status: { type: { state: 'pre', shortDetail: '8:15 PM ET' } },
  };
  const game = server.parseEspnEvent(fixture, 'nfl');
  assert.equal(game.odds.provider, 'DraftKings');
  assert.equal(game.sourceUrl, 'https://www.espn.com/nfl/game/_/gameId/401');
  assert.match(game.away.logo, /^https:\/\/a\.espncdn\.com\//);
});

test('ensureEspnHttps upgrades ESPN hosts only', () => {
  const server = moduleFunctions('src/lib/sports/server.ts', ['ensureEspnHttps'], {
    SportsCache, ...identity, ...time, ...teams, ...briefs, ...providers,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  });
  assert.equal(server.ensureEspnHttps('http://www.espn.com/story'), 'https://www.espn.com/story');
  assert.equal(server.ensureEspnHttps('https://www.espn.com/story'), 'https://www.espn.com/story');
  assert.equal(server.ensureEspnHttps('http://example.com/x'), 'http://example.com/x');
  assert.equal(server.ensureEspnHttps(undefined), undefined);
});
