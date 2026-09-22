import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

function load(path, names, inject = {}) {
  let code = stripTypeScriptTypes(readFileSync(path, 'utf8'), { mode: 'transform' });
  code = code.replace(/^import\s+type[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  code = code.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  code = code.replace(/\bexport /g, '');
  return new Function(...Object.keys(inject), `${code}\nreturn { ${names.join(',')} };`)(...Object.values(inject));
}

const allow = load('src/lib/beat/allowlist.ts', [
  'classifyBeatMedia',
  'extractXStatusId',
  'extractYouTubeId',
  'normalizeBeatUrl',
]);
const sanitizer = load('src/lib/beat/sanitize-oembed.ts', ['sanitizeXOembedHtml']);
const fp = load(
  'src/lib/beat/fingerprint.ts',
  ['beatDuplicateFingerprint', 'urlsLikelySameStory'],
  {
    normalizeBeatUrl: allow.normalizeBeatUrl,
    extractXStatusId: allow.extractXStatusId,
    extractYouTubeId: allow.extractYouTubeId,
  },
);
const discovery = load(
  'src/lib/beat/discovery.ts',
  [
    'scoreDiscoveryCandidate',
    'recommendCategory',
    'extractStatusIdsFromSyndicationHtml',
    'proposeExpiration',
    'PA_BEAT_DISCOVERY_ACCOUNTS',
    'scoreBandForRelevance',
    'shouldDiscardByScore',
    'candidatesFromEditorialJson',
  ],
  {
    beatDuplicateFingerprint: fp.beatDuplicateFingerprint,
    classifyBeatMedia: allow.classifyBeatMedia,
  },
);

test('classifyBeatMedia maps X and YouTube; else link_out', () => {
  const x = allow.classifyBeatMedia('https://x.com/Phillies/status/2097848487366824203');
  assert.equal(x.mediaType, 'x_embed');
  assert.equal(x.embedId, '2097848487366824203');
  const yt = allow.classifyBeatMedia('https://www.youtube.com/watch?v=v3l96WUeXvs');
  assert.equal(yt.mediaType, 'youtube_embed');
  assert.equal(yt.embedId, 'v3l96WUeXvs');
  assert.match(yt.embedUrl, /youtube-nocookie/);
  const link = allow.classifyBeatMedia('https://www.inquirer.com/eagles/example');
  assert.equal(link.mediaType, 'link_out');
});

test('X oEmbed sanitizer keeps the allowlist and strips active HTML', () => {
  const sanitized = sanitizer.sanitizeXOembedHtml(
    '<blockquote class="twitter-tweet evil" data-dnt="true" onclick="alert(1)"><p lang="en" dir="ltr">Safe post</p><script>alert(1)</script><a href="javascript:alert(2)" target="_blank" style="color:red">Open</a><iframe src="https://evil.example"></iframe></blockquote>',
  );
  assert.match(sanitized, /<blockquote class="twitter-tweet" data-dnt="true">/);
  assert.match(sanitized, /<p lang="en" dir="ltr">Safe post<\/p>/);
  assert.match(sanitized, /<a target="_blank">Open<\/a>/);
  assert.doesNotMatch(sanitized, /script|iframe|onclick|style|javascript|evil/);
});

test('X oEmbed sanitizer preserves only HTTPS links and safe attributes', () => {
  const sanitized = sanitizer.sanitizeXOembedHtml(
    '<p class="twitter-tweet-rendered" lang="en-US"><a href="https://x.com/Eagles/status/123" rel="noopener noreferrer">View on X</a></p>',
  );
  assert.equal(
    sanitized,
    '<p class="twitter-tweet-rendered" lang="en-US"><a href="https://x.com/Eagles/status/123" rel="noopener noreferrer">View on X</a></p>',
  );
});

test('fingerprints prefer provider ids and dedupe URLs', () => {
  assert.equal(
    fp.beatDuplicateFingerprint({ originalUrl: 'https://x.com/Phillies/status/2097848487366824203' }),
    'x:2097848487366824203',
  );
  assert.equal(
    fp.beatDuplicateFingerprint({ originalUrl: 'https://www.youtube.com/watch?v=v3l96WUeXvs' }),
    'yt:v3l96WUeXvs',
  );
  assert.equal(
    fp.urlsLikelySameStory(
      'https://x.com/Phillies/status/2097848487366824203?s=20',
      'https://twitter.com/Phillies/status/2097848487366824203',
    ),
    true,
  );
});

test('discovery scoring prefers official/reporter and demotes rumor/aggregator', () => {
  const official = discovery.scoreDiscoveryCandidate({
    sourceTier: 'official_team_league',
    verifiedOfficial: true,
    text: 'Injury report listed Greenard limited',
    category: 'breaking',
  });
  const rumor = discovery.scoreDiscoveryCandidate({
    sourceTier: 'aggregator',
    verifiedOfficial: false,
    text: 'Rumor: sources say trade incoming',
    category: 'locker_room',
  });
  assert.ok(official > rumor);
  assert.ok(rumor <= 25);
  assert.equal(discovery.recommendCategory('Breaking: ruled out for Sunday', 'reaction'), 'breaking');
});

test('syndication HTML yields status ids', () => {
  const ids = discovery.extractStatusIdsFromSyndicationHtml(
    '<a href="https://x.com/Eagles/status/2098102480470937690">x</a> status/2098079091425517684',
  );
  assert.ok(ids.includes('2098102480470937690'));
  assert.ok(ids.includes('2098079091425517684'));
  assert.ok(discovery.PA_BEAT_DISCOVERY_ACCOUNTS.length >= 8);
});

test('real M2 seed covers categories + required embeds', () => {
  const seed = JSON.parse(readFileSync('data/beat-m2-seed.json', 'utf8')).items;
  assert.ok(seed.length >= 5 && seed.length <= 12);
  const cats = new Set(seed.map((i) => i.category));
  for (const c of ['breaking', 'from_the_beat', 'watch', 'locker_room', 'reaction']) assert.ok(cats.has(c), c);
  assert.ok(seed.some((i) => i.mediaType === 'x_embed' && i.originalUrl.includes('Phillies')));
  assert.ok(seed.some((i) => i.mediaType === 'youtube_embed' && i.embedId === 'v3l96WUeXvs'));
  assert.ok(seed.some((i) => i.mediaType === 'link_out'));
  assert.ok(seed.every((i) => i.approvalStatus === 'approved'));
  assert.ok(seed.every((i) => !/fixture|sample|0000000000000000001/i.test(i.originalUrl)));
});

test('migration 0002 creates beat_items', () => {
  const sql = readFileSync('drizzle/0002_beat_items.sql', 'utf8');
  assert.match(sql, /CREATE TABLE `beat_items`/);
  assert.match(sql, /duplicate_fingerprint/);
  assert.match(sql, /beat_items_pub/);
});

test('production wrangler documents Beat flag + keystonebeat routes + ingest secret', () => {
  const toml = readFileSync('wrangler.toml', 'utf8');
  assert.match(toml, /KEYSTONE_BEAT_M1\s*=/);
  assert.match(toml, /keystonebeat\.com/);
  assert.match(toml, /www\.keystonebeat\.com/);
  assert.match(toml, /KEYSTONE_BEAT_INGEST_SECRET/);
});

test('getBeatDesk source file never imports fixtures', () => {
  const api = readFileSync('src/lib/beat/api.ts', 'utf8');
  assert.equal(/from\s+["']\.\/fixtures["']/.test(api), false);
  assert.equal(/BEAT_POC_FIXTURES/.test(api), false);
  assert.match(api, /listPublicBeatRows/);
});

test('editorial score bands and discard threshold', () => {
  assert.equal(discovery.scoreBandForRelevance(95), 'breaking');
  assert.equal(discovery.scoreBandForRelevance(80), 'injuries_trades');
  assert.equal(discovery.scoreBandForRelevance(60), 'strong_reporting');
  assert.equal(discovery.scoreBandForRelevance(40), 'interviews_highlights');
  assert.equal(discovery.scoreBandForRelevance(25), 'locker_room');
  assert.equal(discovery.scoreBandForRelevance(10), 'discard');
  assert.equal(discovery.shouldDiscardByScore(19), true);
  assert.equal(discovery.shouldDiscardByScore(20), false);
});

test('candidatesFromEditorialJson scores, dedupes, discards low relevance', () => {
  const { candidates, skippedDuplicates, discarded } = discovery.candidatesFromEditorialJson({
    candidates: [
      {
        originalUrl: 'https://www.inquirer.com/eagles/example-story',
        headline: 'Eagles injury report: starter limited',
        source: 'Inquirer',
        sourceTier: 'reporter_original',
        teamSlug: 'eagles',
        category: 'breaking',
        relevanceScore: 88,
      },
      {
        originalUrl: 'https://www.inquirer.com/eagles/example-story',
        headline: 'duplicate url',
        relevanceScore: 90,
      },
      {
        originalUrl: 'https://example.com/noise',
        headline: 'offtopic meme',
        relevanceScore: 5,
      },
    ],
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].relevanceScore, 88);
  assert.equal(candidates[0].categoryRecommendation, 'breaking');
  assert.ok(candidates[0].duplicateFingerprint);
  assert.equal(skippedDuplicates, 1);
  assert.equal(discarded, 1);
});

test('www apex redirect helpers present in middleware', () => {
  const nitro = readFileSync('server/middleware/grok-pwa.ts', 'utf8');
  assert.match(nitro, /www\.keystonebeat\.com/);
  assert.match(nitro, /keystonebeat\.com/);
  assert.match(nitro, /301/);
  const api = readFileSync('src/lib/api-middleware.ts', 'utf8');
  assert.match(api, /\/api\/editor\/beat\/ingest/);
  assert.match(api, /KEYSTONE_BEAT_INGEST_SECRET/);
  assert.match(api, /www\.keystonebeat\.com/);
});
