import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Publisher browser actions use the exact Access-protected /editor route', () => {
  const middleware = readFileSync('src/lib/publisher-middleware.ts', 'utf8');
  const editor = readFileSync('src/routes/editor.tsx', 'utf8');
  const start = readFileSync('src/start.ts', 'utf8');

  assert.match(middleware, /url\.pathname !== '\/editor'/);
  assert.match(middleware, /searchParams\.get\('publisher'\)/);
  assert.match(middleware, /cf-access-authenticated-user-email/);
  assert.match(middleware, /operation === 'desk'/);
  assert.match(middleware, /operation === 'save'/);
  assert.match(middleware, /operation === 'recap'/);
  assert.match(middleware, /author_id = \? OR author_id = \?/);
  assert.match(middleware, /owner\.id, 'auto'/);

  assert.match(editor, /fetch\('\/editor\?publisher=desk'/);
  assert.match(editor, /fetch\('\/editor\?publisher=save'/);
  assert.match(editor, /fetch\('\/editor\?publisher=recap'/);
  assert.match(editor, /credentials:\s*'same-origin'/);
  assert.doesNotMatch(editor, /\/editor\/api\/publisher\//);
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
