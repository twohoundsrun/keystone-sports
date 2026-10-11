import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { z } from 'zod';

function moduleFunctions(path, names, deps = {}) {
  const code = stripTypeScriptTypes(readFileSync(path, 'utf8'), { mode: 'transform' })
    .replace(/^import .*;\s*$/gm, '')
    .replace(/\bexport /g, '');
  return new Function(...Object.keys(deps), code + `\nreturn {${names.join(',')}};`)(...Object.values(deps));
}

function loadMutation(getBeatItemById, patchBeatItem) {
  let code = stripTypeScriptTypes(readFileSync('src/lib/beat/mutate.server.ts', 'utf8'), { mode: 'transform' });
  code = code.replace(/^import\s+type[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  code = code.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  code = code.replace(/\bexport /g, '');
  return new Function('z', 'getBeatItemById', 'patchBeatItem', `${code}\nreturn { mutateBeatItemForAdmin };`)(
    z,
    getBeatItemById,
    patchBeatItem,
  ).mutateBeatItemForAdmin;
}

const staleness = moduleFunctions('src/lib/beat/staleness.ts', ['beatPendingStaleness', 'formatBeatAge', 'BEAT_PENDING_STALE_MS']);
const order = moduleFunctions('src/lib/beat/order.ts', ['selectPublicBeatItems', 'isBeatPubliclyVisible']);

const NOW = new Date('2026-10-11T12:00:00.000Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const hoursAhead = (h) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

function pending(overrides = {}) {
  return { approvalStatus: 'pending', createdAt: hoursAgo(1), expiresAt: undefined, ...overrides };
}

test('pending item older than 48h is stale by age', () => {
  const result = staleness.beatPendingStaleness(pending({ createdAt: hoursAgo(49) }), NOW);
  assert.equal(result.stale, true);
  assert.equal(result.reason, 'age');
});

test('pending item at exactly 48h is stale', () => {
  assert.equal(staleness.BEAT_PENDING_STALE_MS, 48 * 60 * 60 * 1000);
  const result = staleness.beatPendingStaleness(pending({ createdAt: hoursAgo(48) }), NOW);
  assert.equal(result.stale, true);
});

test('fresh pending item whose original expiration already passed is stale', () => {
  const result = staleness.beatPendingStaleness(pending({ createdAt: hoursAgo(1), expiresAt: hoursAgo(2) }), NOW);
  assert.equal(result.stale, true);
  assert.equal(result.reason, 'expired');
});

test('fresh pending item with a future expiration is not stale', () => {
  const result = staleness.beatPendingStaleness(pending({ createdAt: hoursAgo(3), expiresAt: hoursAhead(10) }), NOW);
  assert.equal(result.stale, false);
  assert.equal(result.reason, null);
});

test('fresh pending item without an expiration is not stale', () => {
  assert.equal(staleness.beatPendingStaleness(pending(), NOW).stale, false);
});

test('non-pending items are never flagged stale', () => {
  const old = { approvalStatus: 'approved', createdAt: hoursAgo(500), expiresAt: hoursAgo(1) };
  assert.equal(staleness.beatPendingStaleness(old, NOW).stale, false);
  assert.equal(staleness.beatPendingStaleness({ ...old, approvalStatus: 'rejected' }, NOW).stale, false);
});

test('formatBeatAge renders compact minutes, hours, and days', () => {
  assert.equal(staleness.formatBeatAge(45 * 60_000), '45m');
  assert.equal(staleness.formatBeatAge(6 * 3_600_000), '6h');
  assert.equal(staleness.formatBeatAge(72 * 3_600_000), '3d');
});

test('stale pending items are never selected for the public feed', () => {
  const items = [
    {
      id: 'stale-pending',
      category: 'from_the_beat',
      sourceTier: 'reporter_original',
      timestamp: hoursAgo(50),
      approvalStatus: 'pending',
      createdAt: hoursAgo(50),
      expiresAt: hoursAgo(1),
    },
    {
      id: 'approved-live',
      category: 'from_the_beat',
      sourceTier: 'reporter_original',
      timestamp: hoursAgo(2),
      approvalStatus: 'approved',
      createdAt: hoursAgo(2),
      expiresAt: hoursAhead(4),
    },
  ];
  const ids = order.selectPublicBeatItems(items, NOW).map((item) => item.id);
  assert.deepEqual(ids, ['approved-live']);
});

test('editor queue wires the accessible Stale indicator and age label', () => {
  const editor = readFileSync('src/routes/editor_.beat.tsx', 'utf8');
  assert.match(editor, /beatPendingStaleness\(item\)/);
  assert.match(editor, /staleness\.stale \?/);
  assert.match(editor, />\s*Stale\s*</);
  assert.match(editor, /pending \$\{formatBeatAge\(staleness\.ageMs\)\}/);
});

test('approve refuses a past expiration and requires an explicit future one', async () => {
  const item = {
    id: 'beat-expired',
    category: 'from_the_beat',
    approvalStatus: 'pending',
    context: 'A verified local consequence for Pennsylvania fans.',
    expiresAt: hoursAgo(2),
  };
  let writes = 0;
  const mutate = loadMutation(async () => item, async () => { writes += 1; });
  await assert.rejects(
    mutate({}, 'access:owner@example.com', { id: item.id, action: 'approve' }),
    /already in the past|future expiration/i,
  );
  assert.equal(writes, 0);
});

test('approve persists a future expiration supplied for a past-due pending card', async () => {
  let item = {
    id: 'beat-expired',
    category: 'from_the_beat',
    approvalStatus: 'pending',
    context: 'A verified local consequence for Pennsylvania fans.',
    expiresAt: hoursAgo(2),
  };
  const mutate = loadMutation(
    async () => item,
    async (_database, _id, patch) => { item = { ...item, ...patch }; },
  );
  const future = hoursAhead(6);
  const result = await mutate({}, 'access:owner@example.com', { id: item.id, action: 'approve', expiresAt: future });
  assert.deepEqual(result, { ok: true, id: 'beat-expired' });
  assert.equal(item.approvalStatus, 'approved');
  assert.equal(item.expiresAt, future);
});

test('approve keeps a still-valid future expiration when none is supplied', async () => {
  const future = hoursAhead(6);
  let item = {
    id: 'beat-valid',
    category: 'from_the_beat',
    approvalStatus: 'pending',
    context: 'A verified local consequence for Pennsylvania fans.',
    expiresAt: future,
  };
  const mutate = loadMutation(
    async () => item,
    async (_database, _id, patch) => { item = { ...item, ...patch }; },
  );
  await mutate({}, 'access:owner@example.com', { id: item.id, action: 'approve' });
  assert.equal(item.approvalStatus, 'approved');
  assert.equal(item.expiresAt, future);
});

test('approve still requires an expiration for Breaking items', async () => {
  const item = {
    id: 'beat-breaking',
    category: 'breaking',
    approvalStatus: 'pending',
    context: 'A verified local consequence for Pennsylvania fans.',
    expiresAt: undefined,
  };
  const mutate = loadMutation(async () => item, async () => { throw Error('Should not write'); });
  await assert.rejects(
    mutate({}, 'access:owner@example.com', { id: item.id, action: 'approve' }),
    /Breaking items require an expiration/i,
  );
});
