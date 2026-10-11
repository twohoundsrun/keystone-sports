import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

/**
 * Part B — queue read failures and operational diagnostics.
 *
 * Diagnostics are derived from observable signals only (DB read success, recent
 * expire runs). The discovery job is never reported healthy because the app
 * cannot observe it. `beat_job_runs` is read best-effort; a missing/unreadable
 * table must degrade to "unknown", never to a false healthy. The editorial
 * review backlog is reported separately and never changes pipeline health.
 */

function load(path, names, inject = {}) {
  let code = stripTypeScriptTypes(readFileSync(path, 'utf8'), { mode: 'transform' });
  code = code.replace(/^import\s+type[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  code = code.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  code = code.replace(/\bexport /g, '');
  return new Function(...Object.keys(inject), `${code}\nreturn { ${names.join(',')} };`)(...Object.values(inject));
}

const diagnostics = load('src/lib/beat/diagnostics.ts', [
  'deriveBeatOperationalState',
  'deriveBeatReviewBacklog',
  'classifyLastExpireRun',
  'unavailableBeatDiagnostics',
  'BEAT_STALE_BACKLOG_WARN',
]);

const row = load('src/lib/beat/row.ts', ['rowToBeatItem', 'BEAT_ITEM_COLUMNS']);
const queue = load('src/lib/beat/queue.ts', ['clampBeatQueueLimit', 'encodeBeatCursor', 'BEAT_QUEUE_DEFAULT_LIMIT']);
const db = load('src/lib/beat/db.server.ts', ['getBeatQueueDiagnostics'], {
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

const NOW = new Date('2026-10-11T12:00:00.000Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function jobRunDb(row) {
  return {
    prepare(sql) {
      const text = sql.replace(/\s+/g, ' ');
      const api = {
        bind() {
          return api;
        },
        async first() {
          if (/FROM beat_job_runs/.test(text)) {
            if (row === null) throw new Error('no such table: beat_job_runs');
            return row;
          }
          return null;
        },
      };
      return api;
    },
  };
}

const COUNTS = { total: 0, pending: 0, approved: 0, rejected: 0, expired: 0, stalePending: 0 };

// --- Pure classification ---

test('a readable recent expire run is "ok"', () => {
  assert.deepEqual(diagnostics.classifyLastExpireRun({ known: true, at: hoursAgo(1), error: null }, NOW), {
    status: 'ok',
    at: hoursAgo(1),
    error: null,
  });
});

test('an expire run that recorded an error is "error"', () => {
  const result = diagnostics.classifyLastExpireRun({ known: true, at: hoursAgo(1), error: 'boom' }, NOW);
  assert.equal(result.status, 'error');
  assert.equal(result.error, 'boom');
});

test('an expire run older than the staleness window is "stale"', () => {
  assert.equal(diagnostics.classifyLastExpireRun({ known: true, at: hoursAgo(48), error: null }, NOW).status, 'stale');
});

test('unreadable or empty job runs classify as "unknown", never healthy', () => {
  assert.equal(diagnostics.classifyLastExpireRun({ known: false }, NOW).status, 'unknown');
  assert.equal(diagnostics.classifyLastExpireRun({ known: true, at: null, error: null }, NOW).status, 'unknown');
});

test('derived state: unavailable when the queue read fails', () => {
  const state = diagnostics.deriveBeatOperationalState({
    databaseOk: false,
    lastRun: { known: true, at: hoursAgo(1), error: null },
    now: NOW,
  });
  assert.equal(state, 'unavailable');
});

test('derived state: healthy with a readable queue and no pipeline degradation', () => {
  assert.equal(
    diagnostics.deriveBeatOperationalState({
      databaseOk: true,
      lastRun: { known: true, at: hoursAgo(1), error: null },
      now: NOW,
    }),
    'healthy',
  );
});

test('derived state: degraded on a failed or overdue expire run', () => {
  assert.equal(
    diagnostics.deriveBeatOperationalState({
      databaseOk: true,
      lastRun: { known: true, at: hoursAgo(1), error: 'boom' },
      now: NOW,
    }),
    'degraded',
  );
  assert.equal(
    diagnostics.deriveBeatOperationalState({
      databaseOk: true,
      lastRun: { known: true, at: hoursAgo(48), error: null },
      now: NOW,
    }),
    'degraded',
  );
});

test('derived state: unknown job data does not degrade, but is never a healthy-run claim', () => {
  assert.equal(
    diagnostics.deriveBeatOperationalState({
      databaseOk: true,
      lastRun: { known: false },
      now: NOW,
    }),
    'healthy',
  );
  assert.equal(diagnostics.classifyLastExpireRun({ known: false }, NOW).status, 'unknown');
});

// --- Editorial backlog is orthogonal to pipeline health ---

test('review backlog warns at the threshold (25) and stays "none" below it', () => {
  assert.equal(diagnostics.BEAT_STALE_BACKLOG_WARN, 25);
  assert.deepEqual(diagnostics.deriveBeatReviewBacklog(24), { stalePending: 24, level: 'none' });
  assert.deepEqual(diagnostics.deriveBeatReviewBacklog(25), { stalePending: 25, level: 'warn' });
  assert.deepEqual(diagnostics.deriveBeatReviewBacklog(0), { stalePending: 0, level: 'none' });
});

test('a large stale backlog never changes pipeline-health state', () => {
  const lastRun = { known: true, at: hoursAgo(1), error: null };
  assert.equal(diagnostics.deriveBeatReviewBacklog(200).level, 'warn');
  // Healthy pipeline stays healthy despite a warning-level backlog.
  assert.equal(
    diagnostics.deriveBeatOperationalState({ databaseOk: true, lastRun, now: NOW }),
    'healthy',
  );
  // Degraded is driven only by the job run...
  assert.equal(
    diagnostics.deriveBeatOperationalState({
      databaseOk: true,
      lastRun: { known: true, at: hoursAgo(1), error: 'boom' },
      now: NOW,
    }),
    'degraded',
  );
  // ...and unavailable only by a failed read.
  assert.equal(
    diagnostics.deriveBeatOperationalState({ databaseOk: false, lastRun, now: NOW }),
    'unavailable',
  );
});

test('unavailable diagnostics payload is explicit and never throws', () => {
  const payload = diagnostics.unavailableBeatDiagnostics(NOW);
  assert.equal(payload.state, 'unavailable');
  assert.equal(payload.database.ok, false);
  assert.equal(payload.lastExpireRun.status, 'unknown');
  assert.equal(payload.discovery, 'unknown');
  assert.deepEqual(payload.reviewBacklog, { stalePending: 0, level: 'none' });
});

// --- DB-backed diagnostics ---

test('missing beat_job_runs degrades to unknown rather than claiming healthy', async () => {
  const result = await db.getBeatQueueDiagnostics(jobRunDb(null), COUNTS, NOW);
  assert.equal(result.lastExpireRun.status, 'unknown');
  assert.equal(result.discovery, 'unknown');
  assert.equal(result.database.ok, true);
  assert.deepEqual(result.reviewBacklog, { stalePending: 0, level: 'none' });
  // No false degradation from an unreadable optional table.
  assert.equal(result.state, 'healthy');
});

test('recent successful expire run yields healthy with an ok last-run', async () => {
  const result = await db.getBeatQueueDiagnostics(
    jobRunDb({ started_at: hoursAgo(1), error: null }),
    COUNTS,
    NOW,
  );
  assert.equal(result.lastExpireRun.status, 'ok');
  assert.equal(result.state, 'healthy');
});

test('recorded expire error degrades the queue and surfaces the error', async () => {
  const result = await db.getBeatQueueDiagnostics(
    jobRunDb({ started_at: hoursAgo(1), error: 'cron failed' }),
    COUNTS,
    NOW,
  );
  assert.equal(result.lastExpireRun.status, 'error');
  assert.equal(result.lastExpireRun.error, 'cron failed');
  assert.equal(result.state, 'degraded');
});

test('discovery is always reported as unknown (never a false healthy claim)', async () => {
  const result = await db.getBeatQueueDiagnostics(
    jobRunDb({ started_at: hoursAgo(1), error: null }),
    COUNTS,
    NOW,
  );
  assert.equal(result.discovery, 'unknown');
});

test('db diagnostics surfaces the review backlog without touching pipeline health', async () => {
  const result = await db.getBeatQueueDiagnostics(
    jobRunDb({ started_at: hoursAgo(1), error: null }),
    { ...COUNTS, stalePending: 30 },
    NOW,
  );
  assert.deepEqual(result.reviewBacklog, { stalePending: 30, level: 'warn' });
  assert.equal(result.state, 'healthy');
});

// --- Wiring ---

test('the desk middleware reports diagnostics on read failure instead of a bare error', () => {
  const middleware = readFileSync('src/lib/beat-admin-middleware.ts', 'utf8');
  assert.match(middleware, /getBeatQueueDiagnostics/);
  assert.match(middleware, /unavailableBeatDiagnostics/);
  assert.match(middleware, /diagnostics:/);
  assert.match(middleware, /The Beat desk is temporarily unavailable/);
});

test('editor surfaces pipeline state and the backlog warning separately; public feed exposes neither', () => {
  const editor = readFileSync('src/routes/editor_.beat.tsx', 'utf8');
  assert.match(editor, /Pipeline health:/);
  assert.match(editor, /diagnostics\.state/);
  assert.match(editor, /lastExpireRun/);
  // Backlog renders as its own warning, never folded into the health line.
  assert.match(editor, /reviewBacklog\.level === "warn"/);
  assert.match(editor, /Review backlog:/);
  assert.match(editor, /reviewBacklog\.stalePending/);
  const api = readFileSync('src/lib/beat/api.ts', 'utf8');
  const publicDesk = api.slice(api.indexOf('export const getBeatDesk'), api.indexOf('export const getBeatAdminDesk'));
  assert.doesNotMatch(publicDesk, /diagnostics|lastExpireRun|adminStatus|reviewBacklog/);
});

test('diagnostics never call the worker /health endpoint as a health signal', () => {
  const middleware = readFileSync('src/lib/beat-admin-middleware.ts', 'utf8');
  const diagnosticsSrc = readFileSync('src/lib/beat/diagnostics.ts', 'utf8');
  assert.doesNotMatch(middleware, /\/health/);
  assert.doesNotMatch(diagnosticsSrc, /apifyEnabled|autoPublish|fetch\(/);
});
