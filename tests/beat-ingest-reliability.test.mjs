import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

/**
 * Part C — concurrent duplicate ingestion reliability.
 *
 * The ingest pre-check (`findBeatDuplicate`) has a TOCTOU window. When two
 * writers race, the loser trips a UNIQUE index on original_url /
 * duplicate_fingerprint. That is a duplicate skip, not a failure — but any
 * other database error must still surface. No migration/index changes.
 */

function load(path, names, inject = {}) {
  let code = stripTypeScriptTypes(readFileSync(path, 'utf8'), { mode: 'transform' });
  code = code.replace(/^import\s+type[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  code = code.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  code = code.replace(/\bexport /g, '');
  return new Function(...Object.keys(inject), `${code}\nreturn { ${names.join(',')} };`)(...Object.values(inject));
}

const errors = load('src/lib/beat/ingest-errors.ts', ['isBeatUniquenessConflict']);

function makeCandidatesFromEditorial(raw) {
  const list = Array.isArray(raw)
    ? raw
    : raw && Array.isArray(raw.candidates)
      ? raw.candidates
      : raw
        ? [raw]
        : [];
  const candidates = list.map((c, i) => ({
    originalUrl: c.originalUrl ?? `https://example.com/story-${i}`,
    teamSlug: null,
    headline: 'A verified Keystone consequence',
    source: 'Inquirer',
    sourceTier: 'reporter_original',
    account: '@reporter',
    categoryRecommendation: 'from_the_beat',
    timestamp: '2026-10-11T12:00:00.000Z',
    mediaType: 'link_out',
    verifiedOfficial: false,
    suggestedContext: 'Context',
    relevanceScore: 80,
    duplicateFingerprint: c.duplicateFingerprint ?? `fp-${i}`,
    embedUrl: null,
    embedId: null,
    oembedHtml: null,
  }));
  return { candidates, skippedDuplicates: 0, discarded: 0, errors: [] };
}

function buildIngest(upsertImpl) {
  return load('src/lib/beat/ingest.server.ts', ['ingestPendingCandidates'], {
    classifyBeatMedia: () => ({ mediaType: 'link_out', embedUrl: null, embedId: null }),
    normalizeBeatUrl: (value) => value,
    beatDuplicateFingerprint: (input) => `fp:${input.originalUrl}`,
    upsertBeatItem: upsertImpl,
    existingBeatFingerprints: async () => new Set(),
    isBeatUniquenessConflict: errors.isBeatUniquenessConflict,
    BEAT_ITEM_COLUMNS: 'id, original_url',
    rowToBeatItem: (r) => r,
    candidatesFromEditorialJson: makeCandidatesFromEditorial,
  }).ingestPendingCandidates;
}

function emptyDb() {
  return {
    prepare() {
      const api = {
        bind() {
          return api;
        },
        async first() {
          return null;
        },
        async all() {
          return { results: [] };
        },
      };
      return api;
    },
  };
}

// --- Pure classifier ---

test('recognized dedupe uniqueness conflicts are classified as duplicates', () => {
  assert.equal(errors.isBeatUniquenessConflict('D1_ERROR: UNIQUE constraint failed: beat_items.original_url: SQLITE_CONSTRAINT'), true);
  assert.equal(errors.isBeatUniquenessConflict('UNIQUE constraint failed: beat_items.duplicate_fingerprint'), true);
  assert.equal(errors.isBeatUniquenessConflict(new Error('UNIQUE constraint failed: beat_items.original_url')), true);
  assert.equal(errors.isBeatUniquenessConflict('unique constraint failed: BEAT_ITEMS.ORIGINAL_URL'), true);
});

test('other database errors are never masked as duplicates', () => {
  assert.equal(errors.isBeatUniquenessConflict('no such table: beat_items'), false);
  assert.equal(errors.isBeatUniquenessConflict('D1_ERROR: network unavailable'), false);
  assert.equal(errors.isBeatUniquenessConflict('UNIQUE constraint failed: beat_items.id'), false);
  assert.equal(errors.isBeatUniquenessConflict(''), false);
  assert.equal(errors.isBeatUniquenessConflict(undefined), false);
});

// --- Behavioral ingest ---

test('a concurrent unique conflict is counted as a skipped duplicate, not an error', async () => {
  const ingest = buildIngest(async () => {
    throw new Error('D1_ERROR: UNIQUE constraint failed: beat_items.original_url: SQLITE_CONSTRAINT');
  });
  const result = await ingest(emptyDb(), { originalUrl: 'https://example.com/story' }, {});
  assert.equal(result.inserted, 0);
  assert.equal(result.skippedDuplicates, 1);
  assert.deepEqual(result.errors, []);
});

test('a fingerprint conflict is also a duplicate skip', async () => {
  const ingest = buildIngest(async () => {
    throw new Error('UNIQUE constraint failed: beat_items.duplicate_fingerprint');
  });
  const result = await ingest(emptyDb(), { originalUrl: 'https://example.com/story' }, {});
  assert.equal(result.skippedDuplicates, 1);
  assert.deepEqual(result.errors, []);
});

test('two racing duplicates both resolve as skips', async () => {
  const ingest = buildIngest(async () => {
    throw new Error('D1_ERROR: UNIQUE constraint failed: beat_items.original_url');
  });
  const result = await ingest(
    emptyDb(),
    [{ originalUrl: 'https://example.com/a' }, { originalUrl: 'https://example.com/b' }],
    {},
  );
  assert.equal(result.inserted, 0);
  assert.equal(result.skippedDuplicates, 2);
  assert.deepEqual(result.errors, []);
});

test('non-uniqueness database errors still surface in the errors array', async () => {
  const ingest = buildIngest(async () => {
    throw new Error('D1_ERROR: network unavailable');
  });
  const result = await ingest(emptyDb(), { originalUrl: 'https://example.com/story' }, {});
  assert.equal(result.skippedDuplicates, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /network unavailable/);
});

test('successful inserts still force pending-only invariants', async () => {
  const calls = [];
  const ingest = buildIngest(async (_database, input) => {
    calls.push(input);
    return { id: `new-${calls.length}` };
  });
  const result = await ingest(emptyDb(), { originalUrl: 'https://example.com/story' }, {});
  assert.equal(result.inserted, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].approvalStatus, 'pending');
  assert.equal(calls[0].approvalMode, 'manual');
  assert.equal(calls[0].approvedBy, null);
  assert.equal(calls[0].approvedAt, null);
  assert.equal(calls[0].pinned, false);
});

// --- Source invariants ---

test('ingest wires the classifier and keeps pending-only hardening', () => {
  const source = readFileSync('src/lib/beat/ingest.server.ts', 'utf8');
  assert.match(source, /isBeatUniquenessConflict/);
  assert.match(source, /skippedDuplicates \+= 1/);
  assert.match(source, /approvalStatus: "pending"/);
  assert.match(source, /approvalMode: "manual"/);
  assert.match(source, /approvedBy: null/);
  assert.match(source, /approvedAt: null/);
  assert.match(source, /pinned: false/);
  assert.doesNotMatch(source, /approvalStatus: "approved"/);
});

test('migration 0004 dedupe index is unchanged', () => {
  const sql = readFileSync('drizzle/0004_beat_fingerprint_unique.sql', 'utf8');
  assert.match(sql, /CREATE UNIQUE INDEX/);
  assert.match(sql, /WHERE `duplicate_fingerprint` IS NOT NULL/);
  assert.ok(!/DELETE\s+FROM/i.test(sql));
});
