import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

/**
 * Part A — editor queue pagination + status filters.
 *
 * The D1 database is not available offline, so `listBeatItemsPage` is exercised
 * against an in-memory SQLite database executing the real ordering / keyset / LIMIT
 * SQL. Status counts and recent job runs use small fixture adapters.
 */

function load(path, names, inject = {}) {
  let code = stripTypeScriptTypes(readFileSync(path, 'utf8'), { mode: 'transform' });
  code = code.replace(/^import\s+type[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  code = code.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  code = code.replace(/\bexport /g, '');
  return new Function(...Object.keys(inject), `${code}\nreturn { ${names.join(',')} };`)(...Object.values(inject));
}

const queue = load('src/lib/beat/queue.ts', [
  'encodeBeatCursor',
  'decodeBeatCursor',
  'clampBeatQueueLimit',
  'isBeatQueueStatus',
  'BEAT_QUEUE_DEFAULT_LIMIT',
  'BEAT_QUEUE_MAX_LIMIT',
  'EMPTY_BEAT_QUEUE_COUNTS',
]);
const row = load('src/lib/beat/row.ts', ['rowToBeatItem', 'BEAT_ITEM_COLUMNS']);
const diagnostics = load('src/lib/beat/diagnostics.ts', ['deriveBeatOperationalState', 'classifyLastExpireRun', 'deriveBeatReviewBacklog']);
const priority = load('src/lib/beat/priority.ts', ['discoveryPriority'], load('src/lib/beat/coverage.ts', ['inferPaCoverage']));
const db = load('src/lib/beat/db.server.ts', ['listBeatItemsPage', 'countBeatItemsByStatus'], {
  discoveryPriority: priority.discoveryPriority,
  beatStoryRelation: () => null,
  BEAT_ITEM_COLUMNS: row.BEAT_ITEM_COLUMNS,
  rowToBeatItem: row.rowToBeatItem,
  beatDuplicateFingerprint: (input) => `fp:${input.originalUrl}`,
  classifyBeatMedia: () => ({ mediaType: 'link_out', embedUrl: null, embedId: null }),
  normalizeBeatUrl: (value) => value,
  BEAT_QUEUE_DEFAULT_LIMIT: queue.BEAT_QUEUE_DEFAULT_LIMIT,
  clampBeatQueueLimit: queue.clampBeatQueueLimit,
  encodeBeatCursor: queue.encodeBeatCursor,
  BEAT_PENDING_STALE_MS: 48 * 60 * 60 * 1000,
  classifyLastExpireRun: diagnostics.classifyLastExpireRun,
  deriveBeatOperationalState: diagnostics.deriveBeatOperationalState,
  deriveBeatReviewBacklog: diagnostics.deriveBeatReviewBacklog,
});

// --- In-memory D1 mock reproducing the generated SQL semantics ---

function rowValues(index, overrides = {}) {
  const base = Date.parse('2026-10-01T00:00:00.000Z');
  return {
    id: overrides.id ?? `id-${String(index).padStart(4, '0')}`,
    source: 'Inquirer',
    source_tier: 'reporter_original',
    author_account: '@reporter',
    team_slug: 'eagles',
    league: 'nfl',
    category: 'from_the_beat',
    headline: `Headline ${index}`,
    context: 'A verified consequence for Pennsylvania fans.',
    original_url: `https://example.com/story-${index}`,
    embed_url: null,
    embed_id: null,
    oembed_html: null,
    timestamp: new Date(base - index * 60_000).toISOString(),
    media_type: 'link_out',
    verified_official: 0,
    expires_at: null,
    approval_status: 'pending',
    approval_mode: 'manual',
    approved_by: null,
    approved_at: null,
    pinned: 0,
    relevance_score: null,
    duplicate_fingerprint: null,
    created_at: new Date(base - index * 60_000).toISOString(),
    updated_at: new Date(base - index * 60_000).toISOString(),
    created_by: 'seed',
    ...overrides,
  };
}

function makeDb(rows, jobRuns = null) {
  return {
    prepare(sql) {
      const text = sql.replace(/\s+/g, ' ');
      let bound = [];
      const api = {
        bind(...args) {
          bound = args;
          return api;
        },
        async all() {
          if (/FROM beat_job_runs/.test(text)) return { results: [] };
          return { results: selectRows(rows, text, bound) };
        },
        async first() {
          if (/FROM beat_job_runs/.test(text)) {
            if (!jobRuns) throw new Error('no such table: beat_job_runs');
            return jobRuns;
          }
          if (/COUNT\(\*\) AS total/.test(text)) return computeCounts(rows, bound);
          return null;
        },
      };
      return api;
    },
  };
}

function selectRows(allRows, text, bound) {
  // Execute the real generated SQL rather than teaching a mock how it sorts.
  const sqlite = new DatabaseSync(":memory:");
  try {
    const columns = Object.keys(rowValues(0));
    sqlite.exec(
      `CREATE TABLE beat_items (${columns.map((key) => `${key} ${key === "relevance_score" ? "REAL" : "TEXT"}`).join(", ")})`,
    );
    const insert = sqlite.prepare(
      `INSERT INTO beat_items VALUES (${columns.map(() => "?").join(", ")})`,
    );
    for (const item of allRows) insert.run(...columns.map((key) => item[key] ?? null));
    return sqlite.prepare(text).all(...bound);
  } finally {
    sqlite.close();
  }
}

function computeCounts(rows, bound) {
  const staleCutoff = bound[0];
  const nowIso = bound[1];
  let pending = 0;
  let approved = 0;
  let rejected = 0;
  let expired = 0;
  let stale = 0;
  for (const r of rows) {
    if (r.approval_status === 'pending') {
      pending++;
      if (r.created_at <= staleCutoff || (r.expires_at != null && r.expires_at <= nowIso)) stale++;
    } else if (r.approval_status === 'approved') approved++;
    else if (r.approval_status === 'rejected') rejected++;
    else if (r.approval_status === 'expired') expired++;
  }
  return { total: rows.length, pending, approved, rejected, expired, stale_pending: stale };
}

async function walkAllPages(database, status) {
  const seen = [];
  let cursor = null;
  let guard = 0;
  do {
    const page = await db.listBeatItemsPage(database, { status, cursor, limit: 50 });
    for (const item of page.items) seen.push(item.id);
    cursor = page.nextCursor ? queue.decodeBeatCursor(page.nextCursor) : null;
    guard++;
    if (guard > 50) throw new Error('pagination did not terminate');
  } while (cursor);
  return seen;
}

// --- Cursor + limit primitives ---

test('cursor round-trips and rejects malformed input', () => {
  const cursor = { bucket: 1, priority: 0, updatedAt: '2026-10-01T00:00:00.000Z', id: 'abc' };
  const encoded = queue.encodeBeatCursor(cursor);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(queue.decodeBeatCursor(encoded), cursor);
  assert.equal(queue.decodeBeatCursor('not-base64!!'), null);
  assert.equal(queue.decodeBeatCursor(null), null);
  assert.equal(queue.decodeBeatCursor(''), null);
  assert.equal(queue.decodeBeatCursor(queue.encodeBeatCursor({ bucket: 0, priority: 0, updatedAt: '', id: 'x' })), null);
});

test('limit clamps to a safe 1..100 range with a default', () => {
  assert.equal(queue.clampBeatQueueLimit(500), queue.BEAT_QUEUE_MAX_LIMIT);
  assert.equal(queue.clampBeatQueueLimit('10'), 10);
  assert.equal(queue.clampBeatQueueLimit(0), queue.BEAT_QUEUE_DEFAULT_LIMIT);
  assert.equal(queue.clampBeatQueueLimit('nonsense'), queue.BEAT_QUEUE_DEFAULT_LIMIT);
});

test('status validation accepts known values only', () => {
  assert.equal(queue.isBeatQueueStatus('pending'), true);
  assert.equal(queue.isBeatQueueStatus('all'), true);
  assert.equal(queue.isBeatQueueStatus('archived'), false);
});

// --- >200 items remain fully navigable, pending first, no dup/omission ---

function dataset() {
  const rows = [];
  for (let i = 0; i < 260; i++) {
    const status = i % 2 === 0 ? 'pending' : 'approved';
    rows.push(rowValues(i, { approval_status: status, id: `id-${String(i).padStart(4, '0')}` }));
  }
  return rows;
}

test('the full status-filtered queue stays reachable past the old 200 cap', async () => {
  const database = makeDb(dataset());
  const ids = await walkAllPages(database, 'all');
  assert.equal(ids.length, 260);
  assert.equal(new Set(ids).size, 260);
});

test('the "all" view lists every pending row before any non-pending row', async () => {
  const database = makeDb(dataset());
  const ids = await walkAllPages(database, 'all');
  const byId = new Map(dataset().map((r) => [r.id, r.approval_status]));
  const firstApproved = ids.findIndex((id) => byId.get(id) !== 'pending');
  const lastPending = ids.reduce((acc, id, i) => (byId.get(id) === 'pending' ? i : acc), -1);
  assert.ok(firstApproved > -1 && lastPending > -1);
  assert.ok(lastPending < firstApproved, 'pending rows must precede non-pending rows');
});

test('status filter is applied in SQL before pagination', async () => {
  const database = makeDb(dataset());
  const page = await db.listBeatItemsPage(database, { status: 'approved', limit: 50 });
  assert.equal(page.items.length, 50);
  assert.ok(page.items.every((item) => item.approvalStatus === 'approved'));
  const ids = await walkAllPages(database, 'approved');
  assert.equal(ids.length, 130);
});

test('a short page terminates pagination with a null cursor', async () => {
  const database = makeDb(dataset().slice(0, 20));
  const page = await db.listBeatItemsPage(database, { status: 'all', limit: 50 });
  assert.equal(page.items.length, 20);
  assert.equal(page.nextCursor, null);
});

test('server-derived counts match the dataset and keep Phase 4A stale semantics', async () => {
  const now = new Date('2026-10-11T12:00:00.000Z');
  const staleOld = { approval_status: 'pending', created_at: '2026-10-01T00:00:00.000Z' };
  const staleExpired = { approval_status: 'pending', created_at: '2026-10-11T10:00:00.000Z', expires_at: '2026-10-11T11:00:00.000Z' };
  const freshPending = { approval_status: 'pending', created_at: '2026-10-11T10:00:00.000Z' };
  const rows = [
    rowValues(0, staleOld),
    rowValues(1, staleExpired),
    rowValues(2, freshPending),
    rowValues(3, { approval_status: 'approved' }),
    rowValues(4, { approval_status: 'rejected' }),
    rowValues(5, { approval_status: 'expired' }),
  ];
  const counts = await db.countBeatItemsByStatus(makeDb(rows), now);
  assert.deepEqual(counts, { total: 6, pending: 3, approved: 1, rejected: 1, expired: 1, stalePending: 2 });
});

// --- Editor wiring ---

test('editor resets the cursor and page on filter change and paginates the server', () => {
  const editor = readFileSync('src/routes/editor_.beat.tsx', 'utf8');
  assert.match(editor, /changeFilter\(next: BeatQueueStatus\)/);
  assert.match(editor, /setCursorStack\(\[null\]\)/);
  assert.match(editor, /setPageIndex\(0\)/);
  assert.match(editor, /loadBeatQueue\(\{ status: params\.status, cursor: params\.cursor, limit: PAGE_SIZE \}\)/);
  assert.match(editor, /adminNextCursor/);
  assert.match(editor, /goNext/);
  assert.match(editor, /goPrev/);
  // Status filtering happens on the server, not by filtering the 200-row page.
  assert.doesNotMatch(editor, /rows\.filter\(\(r\) => r\.approvalStatus/);
});

test('editor distinguishes an empty queue from a failed read', () => {
  const editor = readFileSync('src/routes/editor_.beat.tsx', 'utf8');
  assert.match(editor, /deriveBeatQueueViewState/);
  assert.match(editor, /queueError/);
  assert.match(editor, /adminDiagnostics/);
  assert.match(editor, /Retry/);
});

test('queue-view marks failed reads as error (never empty)', () => {
  const view = load('src/lib/beat/queue-view.ts', [
    'deriveBeatQueueViewState',
    'beatQueueFilterLabel',
  ]);
  assert.equal(view.deriveBeatQueueViewState({ ok: false, itemCount: 0 }), 'error');
  assert.equal(view.deriveBeatQueueViewState({ ok: true, itemCount: 0 }), 'empty');
  assert.equal(view.deriveBeatQueueViewState({ ok: true, itemCount: 3 }), 'ok');
  const counts = { total: 12, pending: 5, approved: 4, rejected: 2, expired: 1, stalePending: 3 };
  assert.equal(view.beatQueueFilterLabel('pending', counts), 'Pending (5) · 3 stale');
  assert.equal(view.beatQueueFilterLabel('all', counts), 'All (12)');
});

test('paginated SQL keeps the status filter, keyset predicate, and pending-first order', () => {
  const source = readFileSync('src/lib/beat/db.server.ts', 'utf8');
  assert.match(source, /WHERE approval_status = \?/);
  assert.match(source, /updated_at < \? OR \(updated_at = \? AND id < \?\)/);
  assert.match(source, /ORDER BY queue_rank ASC, queue_priority DESC, updated_at DESC, id DESC/);
  assert.match(source, /CASE WHEN approval_status = 'pending' THEN 0 ELSE 1 END/);
});

test('the public Beat feed shape never exposes admin queue metadata', () => {
  const api = readFileSync('src/lib/beat/api.ts', 'utf8');
  const publicDesk = api.slice(api.indexOf('export const getBeatDesk'), api.indexOf('export const getBeatAdminDesk'));
  assert.doesNotMatch(publicDesk, /adminItems|adminCounts|adminDiagnostics|adminNextCursor/);
  const source = readFileSync('src/lib/beat/db.server.ts', 'utf8');
  const publicRows = source.slice(source.indexOf('export async function listPublicBeatRows'), source.indexOf('export async function getBeatItemById'));
  assert.match(publicRows, /approval_status = 'approved'/);
});

test("pending priority applies before LIMIT and survives keyset pagination with ties and null scores", async () => {
  const rows = Array.from({ length: 240 }, (_, i) =>
    rowValues(i, {
      relevance_score: i % 5 === 0 ? null : (i % 4) * 25,
      approval_status: i % 7 === 0 ? "approved" : "pending",
    }),
  );
  // Strongest row is also oldest: sorting only the current page would miss it.
  rows[239].relevance_score = 100;
  rows[239].approval_status = "pending";
  const database = makeDb(rows);
  for (const status of ["all", "pending"]) {
    const first = await db.listBeatItemsPage(database, { status, limit: 7 });
    assert.equal(first.items[0].id, rows[239].id);
    assert.equal(
      queue.decodeBeatCursor(first.nextCursor).priority,
      first.items.at(-1).relevanceScore ?? 0,
    );
    const ids = await walkAllPages(database, status);
    const expected = rows
      .filter((r) => status === "all" || r.approval_status === status)
      .sort(
        (a, b) =>
          Number(a.approval_status !== "pending") - Number(b.approval_status !== "pending") ||
          (b.approval_status === "pending" ? (b.relevance_score ?? 0) : 0) -
            (a.approval_status === "pending" ? (a.relevance_score ?? 0) : 0) ||
          b.updated_at.localeCompare(a.updated_at) ||
          b.id.localeCompare(a.id),
      );
    assert.deepEqual(
      ids,
      expected.map((r) => r.id),
    );
    assert.equal(new Set(ids).size, ids.length);
  }
});

test("priority cursors validate score and round-trip numeric ties", () => {
  const cursor = { bucket: 0, priority: 88, updatedAt: "2026-10-14T16:00:00.000Z", id: "item" };
  assert.deepEqual(queue.decodeBeatCursor(queue.encodeBeatCursor(cursor)), cursor);
  assert.equal(queue.decodeBeatCursor(queue.encodeBeatCursor({ ...cursor, priority: 101 })), null);
});

test("pre-priority cursors are rejected instead of silently skipping scored stories", () => {
  const old = btoa(JSON.stringify({ b: 0, u: "2026-10-01T00:00:00Z", i: "old-item" }));
  assert.equal(queue.decodeBeatCursor(old), null);
  assert.match(readFileSync("src/lib/beat-admin-middleware.ts", "utf8"), /Reload the desk to restart pagination/);
});
