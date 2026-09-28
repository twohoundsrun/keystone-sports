import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const code = stripTypeScriptTypes(readFileSync('src/lib/sports/home-stories.ts', 'utf8'), { mode: 'transform' })
  .replace(/^import .*;\s*$/gm, '').replace(/\bexport /g, '');
const { homeStories } = new Function(code + '\nreturn { homeStories };')();
const now = new Date('2026-09-28T17:00:00Z');

test('approved desk coverage leads, duplicate wire URLs collapse, and old news stays out of the current briefing', () => {
  const beat = [{ id: '1', headline: 'Eagles injury changes Sunday', context: 'The backup starts.',
    originalUrl: 'https://example.com/eagles', source: 'Local paper', timestamp: '2026-09-28T15:00:00Z' }];
  const wire = [
    { id: 'same', headline: 'Eagles injury changes Sunday', href: 'https://www.example.com/eagles?ref=rss', published: '2026-09-28T16:00:00Z' },
    { id: 'old', headline: 'Old team story', href: 'https://example.com/old', published: '2026-09-12T16:00:00Z' },
    { id: 'new', headline: 'Phillies game tonight', href: 'https://example.com/phillies', published: '2026-09-28T14:00:00Z', source: 'MLB' },
  ];
  const result = homeStories(beat, wire, now);
  assert.deepEqual(result.map((s) => s.id), ['beat:1', 'wire:new']);
  assert.equal(result[0].approved, true);
  assert.equal(result[0].context, 'The backup starts.');
});
