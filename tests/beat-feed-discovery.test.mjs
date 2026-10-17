import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// Production bundlers resolve extensionless TS imports; reproduce that resolution
// while exercising the actual modules, not source-shaped mocks.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && context.parentURL) {
        const file = new URL(specifier + ".ts", context.parentURL);
        if (existsSync(file)) return next(file.href, context);
      }
      throw error;
    }
  },
});
const { discoverFeedCandidates, FEED_MAX_BYTES } =
  await import("../src/lib/beat/feed-discovery.ts");
const { parseDiscoveryFeed } = await import("../src/lib/beat/feed-parser.ts");
const { runFeedDiscovery, getFeedDiscoveryReport } =
  await import("../src/lib/beat/feed-service.server.ts");
const { listBeatItemsPage } = await import("../src/lib/beat/db.server.ts");
const { decodeBeatCursor } = await import("../src/lib/beat/queue.ts");
const { inferPaCoverage } = await import("../src/lib/beat/coverage.ts");
const { mutateBeatItemForAdmin } = await import("../src/lib/beat/mutate.server.ts");
const { listPublicBeatRows } = await import("../src/lib/beat/db.server.ts");
const now = new Date("2026-10-15T12:00:00.000Z");
const at = (hours) => new Date(now.getTime() - hours * 3600_000).toISOString();
const escape = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const rss = (articles) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture source</title>${articles.map((a) => `<item><title>${escape(a.title)}</title><link>${escape(a.url)}</link>${a.published === undefined ? "" : `<pubDate>${a.published}</pubDate>`}${a.updated ? `<updated>${a.updated}</updated>` : ""}</item>`).join("")}</channel></rss>`;
const source = (id, teamSlug, area) => ({
  id,
  label: `Fixture ${id}`,
  url: `https://fixture.test/${id}.xml`,
  teamSlug,
  area,
  sourceTier: "official_team_league",
  verification: "retained",
  enabled: true,
});
const article = (id, title, hours = 1) => ({
  url: `https://articles.test/${id}`,
  title,
  published: at(hours),
});
const scenario = JSON.parse(readFileSync("tests/fixtures/phase4d-feeds.json", "utf8")).sources;
function fetchScenario(rows = scenario, calls = []) {
  return async (url) => {
    calls.push(url);
    const row = rows.find((r) => r.source.url === url);
    assert.ok(row, `unexpected destination ${url}`);
    return new Response(row.xml ?? rss(row.articles ?? []), {
      status: row.status ?? 200,
      headers: { "Content-Type": "application/rss+xml" },
    });
  };
}
function options(extra = {}) {
  return { now, sources: scenario.map((s) => s.source), fetchImpl: fetchScenario(), ...extra };
}
function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("drizzle")
    .filter((p) => p.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(`drizzle/${file}`, "utf8"));
  return {
    sqlite,
    prepare(sql) {
      let args = [];
      const api = {
        bind(...values) {
          args = values;
          return api;
        },
        async first() {
          return sqlite.prepare(sql).get(...args) ?? null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...args) };
        },
        async run() {
          return sqlite.prepare(sql).run(...args);
        },
      };
      return api;
    },
    async batch(statements) {
      return Promise.all(statements.map((s) => s.run()));
    },
  };
}

test("RSS acquisition expands all four PA coverage areas through Phase4C", async () => {
  const result = await discoverFeedCandidates(options());
  assert.equal(result.candidates.length, 10);
  assert.equal(result.report.deferred, 3);
  assert.equal(result.skippedDuplicates, 1);
  assert.equal(result.discarded, 1);
  assert.deepEqual(result.errors, []);
  assert.ok(
    result.candidates.every(
      (c) =>
        c.source.startsWith("Fixture") &&
        c.originalUrl.startsWith("https://articles.test/") &&
        c.relevanceScore >= 55,
    ),
  );
  assert.ok(result.report.coverage.every((c) => c.candidates > 0));
  assert.equal(result.report.sources.find((s) => s.id === "stale").state, "stale");
  assert.equal(result.report.sources.filter((s) => s.state === "error").length, 2);
  const wire = result.report.sources.find((s) => s.id === "wire");
  assert.deepEqual(wire.rejected, { outside_coverage: 1, old: 1, missing_time: 2, future_time: 1 });
  assert.ok(
    result.report.updates.some((u) => u.url.endsWith("/old")),
    "updates are evidence, not a publication-age reset",
  );
  assert.ok(!result.candidates.some((c) => c.originalUrl.endsWith("/old")));
});

test("entity recognition includes the requested schools and minor league teams", () => {
  for (const [text, area] of [
    ["Pittsburgh Panthers", "college"],
    ["Saint Joseph's Hawks", "college"],
    ["Lafayette", "college"],
    ["Bucknell", "college"],
    ["Duquesne", "college"],
    ["Lehigh Valley IronPigs", "regional"],
    ["Scranton/Wilkes-Barre RailRiders", "regional"],
    ["PIAA championship", "high_school"],
  ])
    assert.equal(inferPaCoverage(text)?.area, area, text);
  assert.equal(inferPaCoverage("Lakers sign a forward"), null);
});

test("Atom links, escaping and publication/update times retain original attribution", () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Temple wins &amp; qualifies</title><link rel="self" href="https://example.test/feed"/><link rel="alternate" href="https://example.test/story?a=1&amp;b=2"/><published>${at(8)}</published><updated>${at(1)}</updated></entry></feed>`;
  const [row] = parseDiscoveryFeed(atom);
  assert.equal(row.title, "Temple wins & qualifies");
  assert.equal(row.href, "https://example.test/story?a=1&b=2");
  assert.equal(row.published, at(8));
  assert.equal(row.updated, at(1));
});

test("rejects HTML, malformed XML, external entities and unsafe article schemes", () => {
  for (const xml of [
    "<html><body>Blocked</body></html>",
    "<rss><item>",
    `<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss><channel/></rss>`,
  ])
    assert.throws(() => parseDiscoveryFeed(xml));
  assert.deepEqual(
    parseDiscoveryFeed(
      rss([{ title: "Eagles sign veteran player", url: "javascript:alert(1)", published: at(1) }]),
    ),
    [],
  );
});

test("missing publication time cannot masquerade as fresh through an Atom updated tag", async () => {
  const only = {
    source: source("missing"),
    articles: [
      {
        ...article("only", "Kutztown wins NCAA championship"),
        published: undefined,
        updated: at(0),
      },
    ],
  };
  const result = await discoverFeedCandidates(
    options({ sources: [only.source], fetchImpl: fetchScenario([only]) }),
  );
  assert.equal(result.candidates.length, 0);
  assert.equal(result.report.sources[0].state, "error");
  assert.equal(result.report.sources[0].rejected.missing_time, 1);
});

test("request caps, no retries, disabled-source verification and source item caps", async () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    source: source(`source${i}`, "eagles"),
    articles: Array.from({ length: 20 }, (_, n) =>
      article(`s${i}-${n}`, `Eagles sign veteran player number ${n}`),
    ),
  }));
  rows[0].source.verification = "pending";
  const calls = [];
  const result = await discoverFeedCandidates(
    options({ sources: rows.map((r) => r.source), fetchImpl: fetchScenario(rows, calls) }),
  );
  assert.equal(calls.length, 8);
  assert.equal(result.report.sources.length, 9);
  assert.equal(result.report.sources[0].state, "disabled");
  assert.ok(result.candidates.length <= 10);
  assert.ok(
    result.candidates.every(
      (c) => result.candidates.filter((other) => other.account === c.account).length <= 8,
    ),
  );
});

test("repeated runs advance past eight already queued items from the same source", async () => {
  const rows = [
    {
      source: source("busy", "eagles"),
      articles: Array.from({ length: 9 }, (_, n) =>
        article(`transaction-${n}`, `Eagles sign veteran player number ${n}`, 1 + n / 10),
      ),
    },
  ];
  const opts = options({ sources: rows.map((r) => r.source), fetchImpl: fetchScenario(rows) });
  const first = await discoverFeedCandidates(opts);
  assert.equal(first.candidates.length, 8);
  assert.equal(first.report.deferred, 1);
  const second = await discoverFeedCandidates({
    ...opts,
    existingFingerprints: new Set(first.candidates.map((c) => c.duplicateFingerprint)),
  });
  assert.equal(second.skippedDuplicates, 8);
  assert.equal(second.candidates.length, 1);
  assert.ok(!first.candidates.some((c) => c.originalUrl === second.candidates[0].originalUrl));
});

test("timeout, oversize and redirects fail independently without retries", async () => {
  const sources = [source("timeout"), source("large"), source("redirect")];
  let calls = 0;
  const fetchImpl = async (url, { signal }) => {
    calls++;
    if (url.includes("timeout"))
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      );
    return url.includes("large")
      ? new Response("x".repeat(FEED_MAX_BYTES + 1))
      : new Response(null, { status: 302, headers: { Location: "https://another.test/feed" } });
  };
  const result = await discoverFeedCandidates(options({ sources, fetchImpl, timeoutMs: 10 }));
  assert.equal(calls, 3);
  assert.equal(result.report.sources.filter((s) => s.state === "error").length, 3);
  assert.equal(result.candidates.length, 0);
});

test("source retrieval to real SQLite queue uses pending-only writer, cooldown, pagination and approval guard", async () => {
  const db = database();
  const calls = [];
  try {
    const first = await runFeedDiscovery(
      db,
      options({ fetchImpl: fetchScenario(scenario, calls) }),
    );
    assert.equal(first.inserted, 10);
    assert.equal(first.cached, false);
    const cached = await runFeedDiscovery(
      db,
      options({
        fetchImpl: () => {
          throw new Error("must not fetch during cooldown");
        },
      }),
    );
    assert.equal(cached.cached, true);
    assert.equal(calls.length, scenario.length);
    assert.equal((await getFeedDiscoveryReport(db)).candidates, 10);
    const ids = [];
    let cursor = null;
    do {
      const page = await listBeatItemsPage(db, { status: "pending", limit: 4, cursor });
      ids.push(...page.items.map((i) => i.id));
      cursor = decodeBeatCursor(page.nextCursor);
    } while (cursor);
    assert.equal(new Set(ids).size, 10);
    assert.equal((await listPublicBeatRows(db)).length, 0);
    const later = await runFeedDiscovery(
      db,
      options({ now: new Date(now.getTime() + 11 * 60_000) }),
    );
    assert.equal(later.inserted, 3);
    assert.ok(later.skippedDuplicates >= 10);
    // Approval still requires an explicit owner action and future expiration.
    const id = ids[0];
    const future = new Date(Date.now() + 86400000).toISOString();
    await mutateBeatItemForAdmin(db, "fixture-owner", {
      id,
      action: "set_expiration",
      expiresAt: future,
    });
    await mutateBeatItemForAdmin(db, "fixture-owner", { id, action: "approve" });
    assert.equal((await listPublicBeatRows(db)).length, 1);
    await mutateBeatItemForAdmin(db, "fixture-owner", { id, action: "reject" });
    assert.equal((await listPublicBeatRows(db)).length, 0);
  } finally {
    db.sqlite.close();
  }
});

test("concurrent manual requests across service instances share a durable cooldown", async () => {
  const db = database();
  let calls = 0;
  try {
    const one = options({
      sources: [scenario[0].source],
      fetchImpl: async (...args) => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return fetchScenario()(...args);
      },
    });
    const results = await Promise.all([runFeedDiscovery(db, one), runFeedDiscovery(db, one)]);
    assert.equal(calls, 1);
    assert.equal(results.filter((r) => r.cached).length, 1);
  } finally {
    db.sqlite.close();
  }
});

test("Retry-After survives later owner runs and avoids hammering an unavailable source", async () => {
  const db = database();
  let calls = 0;
  const selected = source("limited");
  const fetchImpl = async () => {
    calls++;
    return new Response(null, { status: 429, headers: { "Retry-After": "3600" } });
  };
  try {
    const first = await runFeedDiscovery(db, options({ sources: [selected], fetchImpl }));
    assert.equal(
      first.report.sources[0].retryAfter,
      new Date(now.getTime() + 3600_000).toISOString(),
    );
    const second = await runFeedDiscovery(
      db,
      options({ sources: [selected], fetchImpl, now: new Date(now.getTime() + 11 * 60_000) }),
    );
    assert.equal(calls, 1);
    assert.equal(second.report.sources[0].state, "backoff");
  } finally {
    db.sqlite.close();
  }
});

test("all failed sources report evidence and dedicated-source gaps, not invented missing events", async () => {
  const result = await discoverFeedCandidates(
    options({
      sources: [source("only-pro", "eagles", "professional")],
      fetchImpl: async () => new Response(null, { status: 503 }),
    }),
  );
  assert.equal(result.candidates.length, 0);
  assert.equal(result.report.sources[0].state, "error");
  assert.equal(
    result.report.coverage.find((c) => c.area === "high_school").state,
    "no_dedicated_source",
  );
  assert.ok(result.report.issues.every((issue) => !issue.includes("missed")));
});

test("dry-run observes health and shares cooldown without inserting stories", async () => {
  const db = database();
  try {
    const result = await runFeedDiscovery(db, options({ dryRun: true }));
    assert.equal(result.candidates.length, 10);
    assert.equal(result.inserted, 0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM beat_items").get().n, 0);
    assert.equal((await getFeedDiscoveryReport(db)).candidates, 10);
  } finally {
    db.sqlite.close();
  }
});

test("ambiguous timezone-free timestamps and feeds without channels are unusable", () => {
  const row = parseDiscoveryFeed(
    rss([
      { ...article("ambiguous", "Penn State starter ruled out"), published: "2026-10-15T10:00:00" },
    ]),
  )[0];
  assert.equal(row.published, "");
  assert.throws(() => parseDiscoveryFeed("<rss/>"));
});

test("updated existing originals are flagged for human review, never rewritten or re-aged", async () => {
  const db = database();
  const selected = source("updates", "eagles");
  try {
    const original = article("same", "Eagles quarterback ruled out with concussion");
    await runFeedDiscovery(
      db,
      options({
        sources: [selected],
        fetchImpl: fetchScenario([{ source: selected, articles: [original] }]),
      }),
    );
    const updated = {
      ...original,
      title: "Eagles quarterback cleared to return after concussion",
      updated: at(0),
    };
    const result = await runFeedDiscovery(
      db,
      options({
        now: new Date(now.getTime() + 11 * 60_000),
        sources: [selected],
        fetchImpl: fetchScenario([{ source: selected, articles: [updated] }]),
      }),
    );
    assert.equal(result.inserted, 0);
    assert.equal(result.skippedDuplicates, 1);
    assert.equal(result.report.updates[0].url, original.url);
    const stored = db.sqlite
      .prepare("SELECT headline,timestamp,approval_status FROM beat_items")
      .get();
    assert.equal(stored.headline, original.title);
    assert.equal(stored.timestamp, original.published);
    assert.equal(stored.approval_status, "pending");
  } finally {
    db.sqlite.close();
  }
});

test("shared out-of-state nicknames do not supply PA coverage evidence", () => {
  for (const text of [
    "Boston College Eagles win conference championship",
    "Dayton Flyers coach steps down",
    "Seton Hall Pirates qualify for NCAA tournament",
    "Youngstown State Penguins win title",
  ])
    assert.equal(inferPaCoverage(text), null, text);
  assert.equal(inferPaCoverage("Dayton Flyers coach hired by Villanova")?.teamSlug, "villanova");
  assert.equal(
    inferPaCoverage("Eagles sign a Boston College receiver", "eagles")?.teamSlug,
    "eagles",
  );
});

test("invalid ISO calendar dates never roll over into fresh timestamps", () => {
  const [row] = parseDiscoveryFeed(
    rss([
      {
        ...article("invalid-day", "Kutztown wins championship"),
        published: "2026-02-30T12:00:00Z",
      },
    ]),
  );
  assert.equal(row.published, "");
});

test("retained publisher feeds fit a bounded one-MiB intake budget", async () => {
  const xml = rss([article("publisher-budget", "Eagles sign veteran quarterback")]).replace(
    "</channel>",
    `<description>${"x".repeat(600_000)}</description></channel>`,
  );
  const result = await discoverFeedCandidates(
    options({
      sources: [source("publisher", "eagles")],
      fetchImpl: async () =>
        new Response(xml, { headers: { "content-type": "application/rss+xml" } }),
    }),
  );
  assert.equal(result.report.sources[0].state, "ok");
  assert.equal(result.candidates.length, 1);
  assert.equal(FEED_MAX_BYTES, 1024 * 1024);
});

test("editorial registry uses independently verified canonical Crossing Broad feed", async () => {
  const { DISCOVERY_FEED_SOURCES } = await import("../src/lib/beat/feed-sources.ts");
  assert.equal(
    DISCOVERY_FEED_SOURCES.find((s) => s.url.includes("crossingbroad.com")).url,
    "https://www.crossingbroad.com/feed/",
  );
});

test("Inquirer editorial discovery waits for permission and reports why without fetching", async () => {
  const { DISCOVERY_FEED_SOURCES } = await import("../src/lib/beat/feed-sources.ts");
  const restricted = DISCOVERY_FEED_SOURCES.find((s) => s.url.includes("inquirer.com"));
  const result = await discoverFeedCandidates(
    options({
      sources: [restricted],
      fetchImpl: () => {
        throw new Error("restricted publisher must never be requested");
      },
    }),
  );
  assert.equal(result.report.sources[0].state, "disabled");
  assert.match(result.report.sources[0].error, /permission/i);
});

test("Phase4E quality fixture admits meaningful PA developments and suppresses preview/promotion noise", async () => {
  const fixture = JSON.parse(readFileSync("tests/fixtures/phase4e-quality.json", "utf8"));
  const evalNow = new Date(fixture.now);
  const toArticle = (c) => ({
    ...article(c.id, c.title),
    published: new Date(evalNow.getTime() - 3600000).toISOString(),
  });
  const rows = [
    {
      source: { ...source("quality"), sourceTier: "broadcaster_publication" },
      articles: fixture.cases.map(toArticle),
    },
  ];
  const result = await discoverFeedCandidates(
    options({ now: evalNow, sources: rows.map((r) => r.source), fetchImpl: fetchScenario(rows) }),
  );
  // Evaluate each headline separately so budgets cannot disguise a classification error.
  for (const c of fixture.cases) {
    const one = [{ ...rows[0], articles: [toArticle(c)] }];
    const r = await discoverFeedCandidates(
      options({ now: evalNow, sources: one.map((r) => r.source), fetchImpl: fetchScenario(one) }),
    );
    assert.equal(r.candidates.length, c.admit ? 1 : 0, c.id);
  }
  assert.ok(result.candidates.length <= 10);
});

test("non-PA shared nicknames do not receive PA ranking credit", async () => {
  const { discoveryPriority } = await import("../src/lib/beat/priority.ts");
  for (const text of [
    "Boston College Eagles win national tournament",
    "Seton Hall Pirates hire head coach",
  ]) {
    const p = discoveryPriority(
      { text, sourceTier: "broadcaster_publication", verifiedOfficial: false, timestamp: at(1) },
      now,
    );
    assert.ok(p.reasons.includes("Pennsylvania connection needs confirmation"), text);
  }
});

test("nonempty feeds containing unusable article links are reported as metadata errors", async () => {
  const r = await discoverFeedCandidates(
    options({
      sources: [source("bad-links")],
      fetchImpl: async () =>
        new Response(
          "<rss><channel><item><title>Eagles sign veteran</title><link>javascript:bad</link></item></channel></rss>",
        ),
    }),
  );
  assert.equal(r.report.sources[0].state, "error");
  assert.equal(r.report.sources[0].entries, 1);
  assert.equal(r.report.sources[0].ignored, 1);
});

test("persisted source failures accumulate only on eligible attempts and recover after success", async () => {
  const db = database();
  try {
    const sources = [source("flaky", "eagles")];
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response("outage", { status: 503, headers: { "Retry-After": "1200" } });
    };
    const run = (minutes) =>
      runFeedDiscovery(
        db,
        options({ sources, fetchImpl, now: new Date(now.getTime() + minutes * 60000) }),
      );
    assert.equal((await run(0)).report.sources[0].consecutiveFailures, 1);
    assert.equal((await run(1)).cached, true);
    assert.equal(calls, 1);
    const backed = await run(11);
    assert.equal(backed.report.sources[0].state, "backoff");
    assert.equal(backed.report.sources[0].consecutiveFailures, 1);
    assert.equal(calls, 1);
    await run(22);
    const third = await run(44);
    assert.equal(third.report.sources[0].consecutiveFailures, 3);
    assert.ok(third.report.issues.some((s) => s.includes("3 consecutive failed")));
    const recovered = await runFeedDiscovery(
      db,
      options({
        sources,
        now: new Date(now.getTime() + 66 * 60000),
        fetchImpl: async () =>
          new Response(rss([article("recovered", "Eagles sign veteran quarterback")])),
      }),
    );
    assert.equal(recovered.report.sources[0].consecutiveFailures, 0);
    assert.ok(recovered.report.sources[0].lastSuccessAt);
    assert.equal(recovered.inserted, 1);
  } finally {
    db.sqlite.close();
  }
});

test("volume comparisons require comparable successful source activity and support old reports", async () => {
  const { addDiscoveryHealth } = await import("../src/lib/beat/feed-health.ts");
  const report = (eligible, state = "ok") => ({
    checkedAt: now.toISOString(),
    sources: [
      {
        id: "s",
        label: "S",
        state,
        eligible,
        observed: eligible,
        newestPublished: null,
        rejected: {},
      },
    ],
    candidates: 0,
    deferred: 0,
    skippedDuplicates: 0,
    coverage: [],
    issues: [],
    updates: [],
  });
  const high = report(30);
  addDiscoveryHealth(high, report(5));
  assert.equal(high.volume, "increased");
  const low = report(0);
  addDiscoveryHealth(low, report(30));
  assert.equal(low.volume, "decreased");
  const failed = report(0, "error");
  addDiscoveryHealth(failed, report(30));
  assert.equal(failed.volume, "not_comparable");
  assert.ok(!failed.issues.some((s) => s.includes("volume")));
  const first = report(5);
  addDiscoveryHealth(first, null);
  assert.equal(first.volume, "first_run");
  const empty = report(0, "empty");
  const prior = report(0, "empty");
  prior.sources[0].consecutiveEmpty = 2;
  addDiscoveryHealth(empty, prior);
  assert.equal(empty.sources[0].consecutiveEmpty, 3);
  assert.ok(empty.issues.some((s) => s.includes("3 consecutive empty")));
});

test("NBC remains disabled pending permission; no timezone is invented for its advertised feed", async () => {
  const { DISCOVERY_FEED_SOURCES } = await import("../src/lib/beat/feed-sources.ts");
  const s = DISCOVERY_FEED_SOURCES.find((s) => s.id === "nbcphilly");
  assert.equal(s.enabled, false);
  assert.match(s.disabledReason, /permission/i);
  const r = await discoverFeedCandidates(
    options({
      sources: [s],
      fetchImpl: () => {
        throw new Error("must not fetch");
      },
    }),
  );
  assert.equal(r.report.sources[0].state, "disabled");
  assert.equal(
    parseDiscoveryFeed(
      rss([
        { ...article("no-zone", "Sixers sign veteran"), published: "Sat, Oct 17 2026 12:26:56 PM" },
      ]),
    )[0].published,
    "",
  );
});

test("major school and regional achievements receive the same significance as pro injuries", async () => {
  const { discoveryPriority } = await import("../src/lib/beat/priority.ts");
  const score = (text) =>
    discoveryPriority(
      { text, sourceTier: "broadcaster_publication", verifiedOfficial: false, timestamp: at(1) },
      now,
    );
  const pro = score("Eagles quarterback sidelined with blood clot");
  for (const text of [
    "PIAA District 3 champion crowned",
    "Gannon earns NCAA tournament berth",
    "Lehigh wrestler named first-team All-American",
    "Altoona Curve clinch championship",
  ]) {
    const p = score(text);
    assert.equal(p.score, pro.score, text);
    assert.ok(p.reasons.includes("Championship or competitive milestone"));
  }
  assert.ok(score("PIAA championship preview").score < pro.score);
});

test("declared oversized bodies are cancelled before reading", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  const r = await discoverFeedCandidates(
    options({
      sources: [source("oversize")],
      fetchImpl: async () =>
        new Response(body, { headers: { "content-length": String(FEED_MAX_BYTES + 1) } }),
    }),
  );
  assert.equal(r.report.sources[0].state, "error");
  assert.ok(cancelled);
});
