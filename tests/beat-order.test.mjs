import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

function moduleFunctions(path, names, deps = {}) {
  const code = stripTypeScriptTypes(readFileSync(path, 'utf8'), { mode: 'transform' })
    .replace(/^import .*;\s*$/gm, '')
    .replace(/\bexport /g, '');
  return new Function(...Object.keys(deps), code + `\nreturn {${names.join(',')}};`)(...Object.values(deps));
}

const order = moduleFunctions('src/lib/beat/order.ts', [
  'beatEditorialBucket',
  'isBeatPubliclyVisible',
  'sortBeatItems',
  'selectPublicBeatItems',
  'toPublicBeatItem',
]);
const flag = moduleFunctions('src/lib/beat/flag.ts', ['isBeatM1Enabled', 'readBeatM1Flag', 'BEAT_M1_FLAG']);
const attribution = moduleFunctions('src/lib/beat/attribution.ts', ['distinctAttributionParts', 'formatAttribution']);
const fixtures = JSON.parse(readFileSync('src/data/beat-poc.json', 'utf8'));

test('editorial buckets follow Breaking → original → official watch → watch → locker → reaction', () => {
  assert.equal(order.beatEditorialBucket({ category: 'breaking', sourceTier: 'official_team_league' }), 0);
  assert.equal(order.beatEditorialBucket({ category: 'from_the_beat', sourceTier: 'reporter_original' }), 1);
  assert.equal(order.beatEditorialBucket({ category: 'watch', sourceTier: 'official_team_league' }), 2);
  assert.equal(order.beatEditorialBucket({ category: 'watch', sourceTier: 'broadcaster_publication' }), 3);
  assert.equal(order.beatEditorialBucket({ category: 'locker_room', sourceTier: 'broadcaster_publication' }), 4);
  assert.equal(order.beatEditorialBucket({ category: 'reaction', sourceTier: 'official_team_league' }), 5);
});

test('sortBeatItems is editorial, not pure newest, and pins float first', () => {
  const items = [
    { id: 'reaction-new', category: 'reaction', sourceTier: 'official_team_league', timestamp: '2026-09-10T20:00:00.000Z' },
    { id: 'breaking-old', category: 'breaking', sourceTier: 'official_team_league', timestamp: '2026-09-09T10:00:00.000Z' },
    { id: 'watch-official', category: 'watch', sourceTier: 'official_team_league', timestamp: '2026-09-08T10:00:00.000Z' },
    { id: 'from-beat', category: 'from_the_beat', sourceTier: 'reporter_original', timestamp: '2026-09-10T12:00:00.000Z' },
    { id: 'watch-link', category: 'watch', sourceTier: 'broadcaster_publication', timestamp: '2026-09-10T18:00:00.000Z' },
    { id: 'locker', category: 'locker_room', sourceTier: 'broadcaster_publication', timestamp: '2026-09-10T19:00:00.000Z' },
    { id: 'pinned-reaction', category: 'reaction', sourceTier: 'aggregator', timestamp: '2026-09-01T00:00:00.000Z', pinned: true },
  ];
  const sorted = order.sortBeatItems(items).map((i) => i.id);
  assert.deepEqual(sorted, [
    'pinned-reaction',
    'breaking-old',
    'from-beat',
    'watch-official',
    'watch-link',
    'locker',
    'reaction-new',
  ]);
});

test('selectPublicBeatItems drops pending and expired rows', () => {
  const now = new Date('2026-09-10T16:00:00.000Z');
  const publicIds = order.selectPublicBeatItems(fixtures, now).map((i) => i.id);
  assert.ok(publicIds.includes('beat-m1-breaking-eagles'));
  assert.ok(publicIds.includes('beat-m1-from-beat-reporter'));
  assert.ok(publicIds.includes('beat-m1-watch-official-yt'));
  assert.ok(publicIds.includes('beat-m1-watch-film-link'));
  assert.ok(publicIds.includes('beat-m1-locker-x'));
  assert.ok(publicIds.includes('beat-m1-reaction-x'));
  assert.equal(publicIds.includes('beat-m1-pending-hidden'), false);
  assert.equal(publicIds.includes('beat-m1-expired-hidden'), false);
  assert.equal(publicIds.length, 6);
  // Pinned breaking leads the public list.
  assert.equal(publicIds[0], 'beat-m1-breaking-eagles');
});

test('fixture inventory covers all categories and media types', () => {
  const cats = new Set(fixtures.map((f) => f.category));
  const media = new Set(fixtures.map((f) => f.mediaType));
  for (const c of ['breaking', 'from_the_beat', 'watch', 'locker_room', 'reaction']) assert.ok(cats.has(c), c);
  for (const m of ['x_embed', 'youtube_embed', 'link_out']) assert.ok(media.has(m), m);
  assert.equal(fixtures.length, 8);
});

test('attribution removes duplicate source and author labels without losing distinct values', () => {
  assert.equal(attribution.formatAttribution('The Philadelphia Inquirer', 'the philadelphia inquirer', '76ers', '2d ago'), 'The Philadelphia Inquirer · 76ers · 2d ago');
  assert.deepEqual(attribution.distinctAttributionParts('  AP  ', '', 'AP', 'Pirates'), ['AP', 'Pirates']);
});

test('KEYSTONE_BEAT_M1 flag defaults off and accepts true/1', () => {
  assert.equal(flag.BEAT_M1_FLAG, 'KEYSTONE_BEAT_M1');
  assert.equal(flag.isBeatM1Enabled(undefined), false);
  assert.equal(flag.isBeatM1Enabled('false'), false);
  assert.equal(flag.isBeatM1Enabled('true'), true);
  assert.equal(flag.isBeatM1Enabled('1'), true);
  assert.equal(flag.readBeatM1Flag({ KEYSTONE_BEAT_M1: 'false' }), false);
  assert.equal(flag.readBeatM1Flag({ KEYSTONE_BEAT_M1: 'true' }), true);
});

test('isBeatPubliclyVisible respects approval and expiresAt', () => {
  const now = new Date('2026-09-10T12:00:00.000Z');
  assert.equal(order.isBeatPubliclyVisible({ approvalStatus: 'approved' }, now), true);
  assert.equal(order.isBeatPubliclyVisible({ approvalStatus: 'pending' }, now), false);
  assert.equal(order.isBeatPubliclyVisible({ approvalStatus: 'approved', expiresAt: '2026-09-10T11:00:00.000Z' }, now), false);
  assert.equal(order.isBeatPubliclyVisible({ approvalStatus: 'approved', expiresAt: '2026-09-10T13:00:00.000Z' }, now), true);
});
