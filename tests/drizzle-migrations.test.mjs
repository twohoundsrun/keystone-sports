import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

// Regression guard for the Drizzle migration metadata chain.
//
// Migrations 0003 and 0004 are intentionally OUT-OF-BAND (custom) SQL: their
// objects are not declared in db/schema.ts, so drizzle-kit (which derives every
// snapshot solely from the schema files) cannot represent them and their
// 0003_snapshot.json / 0004_snapshot.json are intentionally absent. This was
// verified against drizzle-kit 0.31.10: `check` passes, `generate` is a no-op,
// and forward diffs off the 0002 snapshot are correct. Do NOT fabricate
// snapshots to fill the gap.
//
// The real hazard this guard catches: if either out-of-band object is ever
// added to db/schema.ts, `drizzle-kit generate` emits a duplicate of its
// CREATE TABLE / CREATE INDEX. If another out-of-band migration is added, its
// tag must be listed below consciously.
const OUT_OF_BAND_NO_SNAPSHOT = ['0003_beat_job_runs', '0004_beat_fingerprint_unique'];

const MIGRATIONS_DIR = 'drizzle';
const META_DIR = 'drizzle/meta';

const journal = JSON.parse(readFileSync(`${META_DIR}/_journal.json`, 'utf8'));
const entries = journal.entries;

const pad = (idx) => String(idx).padStart(4, '0');
const snapshotPath = (idx) => `${META_DIR}/${pad(idx)}_snapshot.json`;

test('journal and migration SQL files correspond one-to-one', () => {
  const tags = entries.map((e) => e.tag);
  assert.equal(new Set(tags).size, tags.length, 'journal tags must be unique');
  entries.forEach((e, i) => assert.equal(e.idx, i, `journal idx must be contiguous at ${e.tag}`));

  for (const e of entries) {
    assert.ok(existsSync(`${MIGRATIONS_DIR}/${e.tag}.sql`), `missing SQL for journal entry ${e.tag}`);
  }

  const sqlTags = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.sql'))
    .map((d) => d.name.replace(/\.sql$/, ''));
  const journalTags = new Set(tags);
  for (const tag of sqlTags) {
    assert.ok(journalTags.has(tag), `orphan migration SQL with no journal entry: ${tag}.sql`);
  }
});

test('only the documented out-of-band migrations lack a snapshot', () => {
  const missing = entries.filter((e) => !existsSync(snapshotPath(e.idx))).map((e) => e.tag);
  assert.deepEqual(
    missing,
    OUT_OF_BAND_NO_SNAPSHOT,
    'entries without snapshots must exactly match the documented out-of-band allowlist',
  );
});

test('existing snapshots form an intact id/prevId chain from 0000', () => {
  // Deliberately does NOT assume contiguity or a fixed count: out-of-band
  // entries (no snapshot) may sit between generated ones, and future normal
  // migrations append snapshots. We only require that each present snapshot
  // links (via prevId) to the previous present snapshot, starting at 0000.
  const present = entries.filter((e) => existsSync(snapshotPath(e.idx)));
  assert.ok(present.length >= 1, 'at least snapshot 0000 must exist');
  assert.equal(present[0].idx, 0, 'the first snapshot must be 0000');
  let prevId = '00000000-0000-0000-0000-000000000000';
  for (const e of present) {
    const snap = JSON.parse(readFileSync(snapshotPath(e.idx), 'utf8'));
    assert.equal(snap.dialect, 'sqlite', `snapshot ${pad(e.idx)} dialect`);
    assert.equal(snap.prevId, prevId, `snapshot ${pad(e.idx)} prevId must link to the previous snapshot's id`);
    prevId = snap.id;
  }
});

test('out-of-band SQL still contains the objects the allowlist documents', () => {
  const m0003 = readFileSync(`${MIGRATIONS_DIR}/0003_beat_job_runs.sql`, 'utf8');
  assert.match(m0003, /CREATE TABLE `beat_job_runs`/);
  assert.match(m0003, /beat_job_runs_started/);
  assert.match(m0003, /beat_job_runs_type/);

  const m0004 = readFileSync(`${MIGRATIONS_DIR}/0004_beat_fingerprint_unique.sql`, 'utf8');
  assert.match(m0004, /CREATE UNIQUE INDEX IF NOT EXISTS `beat_items_duplicate_fingerprint_unique`/);
});

test('out-of-band objects are not declared in db/schema.ts', () => {
  const schema = readFileSync('db/schema.ts', 'utf8');
  assert.equal(
    schema.includes('beat_job_runs'),
    false,
    'db/schema.ts must not declare beat_job_runs (drizzle-kit would duplicate migration 0003)',
  );
  assert.equal(
    schema.includes('beat_items_duplicate_fingerprint_unique'),
    false,
    'db/schema.ts must not declare the out-of-band partial unique index',
  );
  const declaresUniqueFingerprint = schema
    .split('\n')
    .some((line) => line.includes('uniqueIndex') && line.includes('duplicateFingerprint'));
  assert.equal(
    declaresUniqueFingerprint,
    false,
    'db/schema.ts must not declare a unique index on duplicate_fingerprint (out-of-band in 0004)',
  );
});
