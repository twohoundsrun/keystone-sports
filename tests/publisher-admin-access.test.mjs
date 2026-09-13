import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Publisher browser actions use Access-protected /editor endpoints', () => {
  const middleware = readFileSync('src/lib/publisher-middleware.ts', 'utf8');
  const editor = readFileSync('src/routes/editor.tsx', 'utf8');
  const start = readFileSync('src/start.ts', 'utf8');

  assert.match(middleware, /\/editor\/api\/publisher\/desk/);
  assert.match(middleware, /\/editor\/api\/publisher\/save/);
  assert.match(middleware, /\/editor\/api\/publisher\/recap/);
  assert.match(middleware, /requireAdmin\(\)/);
  assert.match(middleware, /author_id = \?/);
  assert.match(middleware, /author_id = \?/);
  assert.match(middleware, /author_id = \? OR author_id = \?/);
  assert.match(middleware, /adminId, 'auto'/);

  assert.match(editor, /fetch\('\/editor\/api\/publisher\/desk'/);
  assert.match(editor, /fetch\('\/editor\/api\/publisher\/save'/);
  assert.match(editor, /fetch\('\/editor\/api\/publisher\/recap'/);
  assert.match(editor, /credentials:\s*'same-origin'/);
  assert.doesNotMatch(editor, /saveEditorPost\s*\(/);
  assert.doesNotMatch(editor, /runOwnerRecap\s*\(/);

  assert.match(start, /publisherMiddleware/);
});

test('Public serverFns remain outside the Cloudflare Access-only editor path', () => {
  const vite = readFileSync('vite.config.ts', 'utf8');
  const standalone = readFileSync('vite.standalone.config.ts', 'utf8');
  assert.doesNotMatch(vite, /serverFns:\s*\{\s*base:\s*['"]\/editor/);
  assert.doesNotMatch(standalone, /serverFns:\s*\{\s*base:\s*['"]\/editor/);
});
