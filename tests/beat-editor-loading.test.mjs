import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

/**
 * Editor queue loading reliability.
 *
 * `loadPage` used to `await loadBeatQueue(...)` with no catch/finally, so a
 * rejected fetch or a non-JSON Access redirect could leave the queue stuck in
 * `loading` and never surface the error panel. It also had no protection against
 * a stale in-flight page overwriting a newer one. These tests exercise the
 * extracted QueueLoader behaviorally (no DOM) plus the editor wiring.
 */

function loadQueueLoader() {
  const code = stripTypeScriptTypes(readFileSync('src/lib/beat/queue-loader.ts', 'utf8'), { mode: 'transform' }).replace(
    /\bexport /g,
    '',
  );
  return new Function(`${code}\nreturn { QueueLoader };`)().QueueLoader;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function recorder() {
  const states = [];
  return { states, listener: (state) => states.push({ ...state }) };
}

// --- Failure handling ---

test('a thrown/rejected load releases loading and reports a sanitized error', async () => {
  const QueueLoader = loadQueueLoader();
  const { states, listener } = recorder();
  const loader = new QueueLoader(
    () => Promise.reject(new Error('network unavailable')),
    (error) => `sanitized:${error.message}`,
    listener,
  );

  const wrote = await loader.load({});
  assert.equal(wrote, true);
  const final = loader.getState();
  assert.equal(final.loading, false);
  assert.equal(final.error, 'sanitized:network unavailable');
  assert.equal(final.data, null);
  assert.deepEqual(states.map((s) => s.loading), [true, false]);
});

test('a non-Error throw is still routed through the sanitizer', async () => {
  const QueueLoader = loadQueueLoader();
  const loader = new QueueLoader(
    () => {
      throw 'HTML access page';
    },
    (error) => `sanitized:${String(error)}`,
    () => {},
  );

  await loader.load({});
  assert.equal(loader.getState().error, 'sanitized:HTML access page');
  assert.equal(loader.getState().loading, false);
});

test('a failed outcome clears prior data and keeps diagnostics', async () => {
  const QueueLoader = loadQueueLoader();
  const loader = new QueueLoader(
    () => Promise.resolve({ ok: false, error: 'Could not load the Beat queue.', diagnostics: { state: 'unavailable' } }),
    (error) => String(error),
    () => {},
  );

  await loader.load({});
  const state = loader.getState();
  assert.equal(state.data, null);
  assert.equal(state.error, 'Could not load the Beat queue.');
  assert.deepEqual(state.errorDiagnostics, { state: 'unavailable' });
});

test('a retry clears the previous error and stale data up front', async () => {
  const QueueLoader = loadQueueLoader();
  const next = deferred();
  let fail = true;
  const loader = new QueueLoader(
    () => {
      if (fail) return Promise.resolve({ ok: false, error: 'boom', diagnostics: null });
      return next.promise;
    },
    (error) => String(error),
    () => {},
  );

  await loader.load({});
  assert.equal(loader.getState().error, 'boom');

  fail = false;
  const pending = loader.load({});
  const duringRetry = loader.getState();
  assert.equal(duringRetry.loading, true);
  assert.equal(duringRetry.error, null);
  assert.equal(duringRetry.data, null);

  next.resolve({ ok: true, data: 'fresh' });
  await pending;
  assert.equal(loader.getState().error, null);
  assert.equal(loader.getState().data, 'fresh');
});

// --- Race / latest-wins ---

test('a stale success cannot overwrite a newer response', async () => {
  const QueueLoader = loadQueueLoader();
  const first = deferred();
  const second = deferred();
  const queue = [first.promise, second.promise];
  const loader = new QueueLoader(
    () => queue.shift(),
    (error) => String(error),
    () => {},
  );

  const p1 = loader.load({});
  const p2 = loader.load({});

  second.resolve({ ok: true, data: 'newer' });
  assert.equal(await p2, true);

  first.resolve({ ok: true, data: 'older' });
  assert.equal(await p1, false);

  assert.equal(loader.getState().data, 'newer');
  assert.equal(loader.getState().loading, false);
});

test('a stale failure cannot clear a newer success', async () => {
  const QueueLoader = loadQueueLoader();
  const first = deferred();
  const second = deferred();
  const queue = [first.promise, second.promise];
  const loader = new QueueLoader(
    () => queue.shift(),
    (error) => String(error),
    () => {},
  );

  const p1 = loader.load({});
  const p2 = loader.load({});

  second.resolve({ ok: true, data: 'newer' });
  await p2;

  first.reject(new Error('stale boom'));
  await p1;

  const state = loader.getState();
  assert.equal(state.data, 'newer');
  assert.equal(state.error, null);
  assert.equal(state.loading, false);
});

test('loading is only released once the latest request settles', async () => {
  const QueueLoader = loadQueueLoader();
  const first = deferred();
  const second = deferred();
  const queue = [first.promise, second.promise];
  const loader = new QueueLoader(
    () => queue.shift(),
    (error) => String(error),
    () => {},
  );

  const p1 = loader.load({});
  const p2 = loader.load({});

  first.resolve({ ok: true, data: 'older' });
  await p1;
  assert.equal(loader.getState().loading, true, 'an earlier settle must not clear loading for the latest request');

  second.resolve({ ok: true, data: 'newer' });
  await p2;
  assert.equal(loader.getState().loading, false);
  assert.equal(loader.getState().data, 'newer');
});

// --- Source invariants ---

test('QueueLoader clears stale data on load start and guards with a token', () => {
  const source = readFileSync('src/lib/beat/queue-loader.ts', 'utf8');
  assert.match(source, /token !== this\.token/);
  assert.match(source, /loading: true, error: null, data: null, errorDiagnostics: null/);
  assert.match(source, /this\.sanitizeError\(error\)/);
});

test('the editor delegates loadPage to the guarded loader', () => {
  const source = readFileSync('src/routes/editor_.beat.tsx', 'utf8');
  assert.match(source, /import \{ QueueLoader/);
  assert.match(source, /new QueueLoader</);
  assert.match(source, /function loadPage\(nextStatus: BeatQueueStatus, cursor: string \| null\) \{\s*return loader\.load\(/);
  assert.doesNotMatch(source, /const result = await loadBeatQueue\(\{ status: nextStatus/);
});
