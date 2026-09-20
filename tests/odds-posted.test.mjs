import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

function moduleFunctions(path, names, deps = {}) {
  const code = stripTypeScriptTypes(readFileSync(path, 'utf8'), { mode: 'transform' })
    .replace(/^import .*;\s*$/gm, '').replace(/\bexport /g, '');
  return new Function(...Object.keys(deps), code + `\nreturn {${names.join(',')}};`)(...Object.values(deps));
}

test('hasPostedOdds requires a real market number, not an empty odds object', () => {
  const { hasPostedOdds } = moduleFunctions('src/lib/sports/filter.ts', ['hasPostedOdds']);
  assert.equal(hasPostedOdds({}), false);
  assert.equal(hasPostedOdds({ odds: { provider: 'ESPN' } }), false);
  assert.equal(hasPostedOdds({ odds: { provider: 'ESPN', spread: '—' } }), false);
  assert.equal(hasPostedOdds({ odds: { provider: 'ESPN', spread: 'PHI -7' } }), true);
  assert.equal(hasPostedOdds({ odds: { provider: 'ESPN', total: '39.5' } }), true);
  assert.equal(hasPostedOdds({ odds: { provider: 'ESPN', homeMl: '-325' } }), true);
  assert.equal(hasPostedOdds({ odds: { provider: 'ESPN', details: 'PHI -7' } }), true);
});
