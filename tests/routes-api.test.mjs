import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

// Regression guard: the unauthenticated ESPN debug proxy at /api/standings-debug
// was removed. It must not return via a file-based route, and the generated
// route tree must not reference it either.
test('public standings debug endpoint is not registered', () => {
  for (const ext of ['tsx', 'ts', 'jsx', 'js']) {
    assert.equal(
      existsSync(`src/routes/api/standings-debug.${ext}`),
      false,
      `unexpected public debug route: src/routes/api/standings-debug.${ext}`,
    );
  }
  const treePath = 'src/routeTree.gen.ts';
  if (existsSync(treePath)) {
    assert.equal(
      readFileSync(treePath, 'utf8').includes('standings-debug'),
      false,
      'generated route tree still references standings-debug',
    );
  }
});
