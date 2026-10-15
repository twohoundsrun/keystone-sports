import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

function load(path, names, inject = {}) {
  const code = stripTypeScriptTypes(readFileSync(path, "utf8"), { mode: "transform" })
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, "")
    .replace(/\bexport /g, "");
  return new Function(...Object.keys(inject), `${code}\nreturn { ${names.join(",")} };`)(
    ...Object.values(inject),
  );
}
const allow = load("src/lib/beat/allowlist.ts", [
  "normalizeBeatUrl",
  "extractXStatusId",
  "extractYouTubeId",
  "classifyBeatMedia",
]);
const fingerprints = load(
  "src/lib/beat/fingerprint.ts",
  ["beatDuplicateFingerprint", "beatStoryRelation"],
  allow,
);
const priority = load("src/lib/beat/priority.ts", ["discoveryPriority"]);
const discovery = load(
  "src/lib/beat/discovery.ts",
  ["candidatesFromEditorialJson", "discoverPaBeatCandidates", "dedupeDiscoveryStories"],
  { ...allow, ...fingerprints, ...priority },
);
const fixture = JSON.parse(readFileSync("tests/fixtures/beat-discovery-20.json", "utf8"));
const now = new Date(fixture.now);
const run = () => discovery.candidatesFromEditorialJson(fixture.candidates, { now });
const url = (id) => `https://example.com/${id}`;

test("20-story fixture prioritizes consequential PA reporting, including school and regional stories", () => {
  assert.equal(fixture.candidates.length, 20);
  const result = run();
  assert.deepEqual(result.errors, []);
  assert.equal(result.discarded, 1);
  assert.equal(result.skippedDuplicates, 3);
  assert.equal(result.candidates.length, 16);
  const rank = (id) => result.candidates.findIndex((c) => c.originalUrl === url(id));
  assert.equal(rank("promo"), -1);
  for (const id of [
    "injury",
    "state-title",
    "small-college",
    "regional",
    "local",
    "investigation",
    "trade",
  ]) {
    assert.ok(
      rank(id) >= 0 && rank(id) < rank("reaction"),
      `${id} should outrank routine reaction`,
    );
    assert.ok(rank(id) < rank("non-pa"), `${id} should outrank non-PA news`);
  }
  assert.ok(rank("stale") > rank("injury"));
  assert.ok(rank("injury-followup") >= 0, "medical clearance is a legitimate follow-up");
  assert.ok(rank("followup-number") >= 0, "a changed result is retained for review");
  assert.ok(
    result.candidates.find((c) => c.originalUrl === url("injury-followup")).relatedStoryUrl,
  );
  assert.ok(result.candidates.every((c) => c.priorityReasons.length >= 3));
  assert.deepEqual(run(), result, "fixed-time result is repeatable");
});

test("source, category and audience size cannot overwhelm significance or manufacture freshness", () => {
  const score = (c) =>
    priority.discoveryPriority(
      {
        sourceTier: "reporter_original",
        verifiedOfficial: false,
        text: "Eagles quarterback ruled out with concussion",
        timestamp: fixture.now,
        ...c,
      },
      now,
    ).score;
  assert.ok(score({ timestamp: fixture.now }) > score({ timestamp: "2026-10-10T00:00:00Z" }));
  assert.ok(score({ timestamp: fixture.now }) > score({ timestamp: "invalid" }));
  assert.ok(score({ timestamp: fixture.now }) > score({ timestamp: "2026-10-20T00:00:00Z" }));
  assert.ok(
    score({}) > score({ text: "Rumor: Eagles quarterback could be ruled out with concussion" }),
  );
  assert.ok(score({}) > score({ sourceTier: "aggregator" }));
  const small = score({ text: "Kutztown clinches PSAC championship" });
  assert.ok(small >= 85, "small colleges get full local milestone credit");
  assert.equal(
    score({ sourceTier: "reporter_original", verifiedOfficial: true }),
    score({ sourceTier: "reporter_original" }),
    "official verification cannot boost a reporter",
  );
});

test("operator score hints remain bounded and cannot rescue promotion content", () => {
  const promo = fixture.candidates.find((c) => c.id === "promo");
  const result = discovery.candidatesFromEditorialJson(
    [{ ...promo, relevanceScore: 100, breakingScore: 100 }],
    { now },
  );
  assert.equal(result.candidates.length, 0);
  assert.equal(result.discarded, 1);
});

test("canonical URL identity cannot be bypassed using custom fingerprints", () => {
  const first = fixture.candidates.find((c) => c.id === "injury");
  const result = discovery.candidatesFromEditorialJson(
    [
      first,
      {
        ...first,
        originalUrl: first.originalUrl + "?utm_source=wire#top",
        duplicateFingerprint: "custom:new",
      },
    ],
    { now },
  );
  assert.equal(result.candidates.length, 1);
  assert.equal(result.skippedDuplicates, 1);
});

test("headline matching is conservative about entities, facts, timestamps and follow-ups", () => {
  const base = {
    originalUrl: url("first"),
    headline: "Eagles quarterback Jalen Hurts ruled out after concussion",
    teamSlug: "eagles",
    timestamp: fixture.now,
  };
  const other = (patch) => ({ ...base, originalUrl: url("second"), ...patch });
  assert.equal(
    fingerprints.beatStoryRelation(
      base,
      other({
        headline: "BREAKING: Eagles quarterback Jalen Hurts ruled out Sunday after concussion!",
      }),
    ),
    "duplicate",
  );
  assert.equal(
    fingerprints.beatStoryRelation(
      base,
      other({
        headline: "Eagles quarterback Jalen Hurts cleared after concussion, returns to practice",
      }),
    ),
    "related",
  );
  assert.equal(
    fingerprints.beatStoryRelation(
      base,
      other({ headline: "Eagles quarterback Jalen Hurts not ruled out after concussion" }),
    ),
    "related",
  );
  assert.equal(
    fingerprints.beatStoryRelation(
      base,
      other({ headline: "Eagles quarterback Tanner McKee ruled out after concussion" }),
    ),
    "related",
  );
  assert.equal(fingerprints.beatStoryRelation(base, other({ teamSlug: "steelers" })), null);
  assert.equal(fingerprints.beatStoryRelation(base, other({ teamSlug: undefined })), null);
  assert.equal(
    fingerprints.beatStoryRelation(base, other({ timestamp: "2026-10-01T00:00:00Z" })),
    null,
  );
  assert.equal(fingerprints.beatStoryRelation(base, other({ timestamp: "unknown" })), null);
});

test("headline repeats match existing coverage while a follow-up survives", () => {
  const existing = fixture.candidates.find((c) => c.id === "injury");
  const followup = fixture.candidates.find((c) => c.id === "injury-followup");
  const copy = fixture.candidates.find((c) => c.id === "injury-copy");
  const result = discovery.candidatesFromEditorialJson([copy, followup], {
    now,
    existingStories: [existing],
  });
  assert.equal(result.skippedDuplicates, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].relatedStoryUrl, existing.originalUrl);
});

test("legacy manual discovery uses encoded post age and never invents a story when oEmbed fails", async () => {
  const recentId = String((BigInt(now.getTime() - 3600_000) - 1288834974657n) << 22n);
  const oldId = String((BigInt(now.getTime() - 100 * 3600_000) - 1288834974657n) << 22n);
  const unavailableId = String(BigInt(recentId) + 1n);
  const fetchImpl = async (request) => {
    if (request.includes("syndication"))
      return new Response([recentId, oldId, unavailableId].map((id) => `status/${id}`).join(" "));
    if (request.includes(unavailableId)) return new Response("Unavailable", { status: 429 });
    return Response.json({
      html: "<p>Eagles quarterback Jalen Hurts ruled out after concussion</p>",
    });
  };
  const result = await discovery.discoverPaBeatCandidates({
    accounts: [
      {
        handle: "Eagles",
        source: "@Eagles",
        sourceTier: "official_team_league",
        verifiedOfficial: true,
        teamSlug: "eagles",
        defaultCategory: "reaction",
      },
    ],
    perAccountLimit: 3,
    fetchImpl,
    now,
  });
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].timestamp, new Date(now.getTime() - 3600_000).toISOString());
  assert.ok(result.candidates[0].relevanceScore > result.candidates[1].relevanceScore);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /No readable post content/);
});
