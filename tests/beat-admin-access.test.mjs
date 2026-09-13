import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { z } from 'zod';

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

function pendingItem(overrides = {}) {
  return {
    id: 'beat-test',
    category: 'from_the_beat',
    approvalStatus: 'pending',
    expiresAt: undefined,
    approvedBy: undefined,
    approvedAt: undefined,
    pinned: false,
    ...overrides,
  };
}

test('Approve transitions a pending Beat item and records the Access owner', async () => {
  let item = pendingItem();
  const mutate = loadMutation(
    async () => item,
    async (_database, _id, patch) => { item = { ...item, ...patch }; },
  );
  const result = await mutate({}, 'access:owner@example.com', { id: item.id, action: 'approve' });
  assert.deepEqual(result, { ok: true, id: 'beat-test' });
  assert.equal(item.approvalStatus, 'approved');
  assert.equal(item.approvedBy, 'access:owner@example.com');
  assert.match(item.approvedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('Reject hides a Beat item and clears prior approval metadata', async () => {
  let item = pendingItem({
    approvalStatus: 'approved',
    approvedBy: 'access:owner@example.com',
    approvedAt: '2026-09-12T12:00:00.000Z',
  });
  const mutate = loadMutation(
    async () => item,
    async (_database, _id, patch) => { item = { ...item, ...patch }; },
  );
  await mutate({}, 'access:owner@example.com', { id: item.id, action: 'reject' });
  assert.equal(item.approvalStatus, 'rejected');
  assert.equal(item.approvedBy, null);
  assert.equal(item.approvedAt, null);
});

test('Beat Desk browser actions use the exact Access-protected /editor/beat route', () => {
  const middleware = readFileSync('src/lib/beat-admin-middleware.ts', 'utf8');
  const editor = readFileSync('src/routes/editor_.beat.tsx', 'utf8');
  const start = readFileSync('src/start.ts', 'utf8');
  const vite = readFileSync('vite.config.ts', 'utf8');
  const standalone = readFileSync('vite.standalone.config.ts', 'utf8');

  assert.match(middleware, /url\.pathname !== ['"]\/editor\/beat['"]/);
  assert.match(middleware, /searchParams\.get\(['"]beatAction['"]\)/);
  assert.match(middleware, /operation === ['"]desk['"]/);
  assert.match(middleware, /operation === ['"]mutate['"]/);
  assert.match(middleware, /operation === ['"]create['"]/);
  assert.match(middleware, /operation === ['"]discover['"]/);
  assert.match(middleware, /cf-access-authenticated-user-email/);

  assert.match(editor, /BEAT_DESK_PATH = ['"]\/editor\/beat['"]/);
  assert.match(editor, /beatAction=/);
  assert.match(editor, /createBeatItemViaAccess/);
  assert.match(editor, /discoverBeatCandidatesViaAccess/);
  assert.doesNotMatch(editor, /fetch\(['"]\/editor\/api\/beat/);
  assert.doesNotMatch(editor, /createBeatItem\s*\(\{\s*data:/);
  assert.doesNotMatch(editor, /discoverBeatCandidates\s*\(\{\s*data:/);

  assert.match(start, /beatAdminMiddleware/);
  assert.doesNotMatch(vite, /serverFns:\s*\{\s*base:\s*['"]\/editor/);
  assert.doesNotMatch(standalone, /serverFns:\s*\{\s*base:\s*['"]\/editor/);
});

test('public chrome no longer exposes My Notes or the owner AI login prompt', () => {
  const shell = readFileSync('src/components/desk-shell.tsx', 'utf8');
  const home = readFileSync('src/routes/index.tsx', 'utf8');
  assert.doesNotMatch(shell, /My Notes|label:\s*["']Notes["']/);
  assert.doesNotMatch(home, /My Notes|Your private notes|Owner AI unlocks after Cloudflare Access sign-in/);
});
