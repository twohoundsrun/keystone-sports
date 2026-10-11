import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expireStale } from "../src/expire.ts";
import type { Env } from "../src/types.ts";

type Row = { id: string; approval_status: string; expires_at: string | null };

const expireSource = readFileSync(new URL("../src/expire.ts", import.meta.url), "utf8");

/**
 * Which source statuses the UPDATE is allowed to expire. Parsed from the real
 * WHERE clause so a regression to `IN ('pending','approved')` fails the tests
 * below rather than being masked by the mock.
 */
function expirableStatuses(sql: string): Set<string> {
  const where = sql.split(/WHERE/i)[1] ?? "";
  return new Set([...where.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
}

function makeMockDb(rows: Row[]) {
  return {
    prepare: (sql: string) => ({
      bind: (...vals: unknown[]) => ({
        run: async () => {
          const nowIso = String(vals[0] ?? "");
          const statuses = expirableStatuses(sql);
          let changes = 0;
          for (const row of rows) {
            if (statuses.has(row.approval_status) && row.expires_at != null && row.expires_at <= nowIso) {
              row.approval_status = "expired";
              changes += 1;
            }
          }
          return { meta: { changes } };
        },
        first: async () => null,
        all: async () => ({ results: [] }),
      }),
    }),
    batch: async (stmts: unknown[]) => stmts.map(() => ({})),
  };
}

function envWith(rows: Row[]): Env {
  return { DB: makeMockDb(rows) as unknown as D1Database };
}

const NOW = "2026-10-11T12:00:00.000Z";
const past = "2026-10-01T00:00:00.000Z";
const future = "2026-11-01T00:00:00.000Z";

describe("expireStale source", () => {
  it("only targets approved items, never pending", () => {
    assert.match(expireSource, /approval_status = 'approved'/);
    assert.doesNotMatch(expireSource, /'pending'/);
    assert.doesNotMatch(expireSource, /approval_status IN \(/);
  });

  it("still gates on a present, past-due expires_at", () => {
    assert.match(expireSource, /expires_at IS NOT NULL/);
    assert.match(expireSource, /expires_at <= \?/);
  });
});

describe("expireStale behavior", () => {
  it("does not expire an unreviewed pending item past its expiration", async () => {
    const rows: Row[] = [{ id: "p1", approval_status: "pending", expires_at: past }];
    const result = await expireStale(envWith(rows), NOW);
    assert.equal(result.expired, 0);
    assert.equal(rows[0].approval_status, "pending");
  });

  it("expires an approved item once its expiration passes", async () => {
    const rows: Row[] = [{ id: "a1", approval_status: "approved", expires_at: past }];
    const result = await expireStale(envWith(rows), NOW);
    assert.equal(result.expired, 1);
    assert.equal(rows[0].approval_status, "expired");
  });

  it("leaves rejected, already-expired, and future-approved rows untouched", async () => {
    const rows: Row[] = [
      { id: "r1", approval_status: "rejected", expires_at: past },
      { id: "e1", approval_status: "expired", expires_at: past },
      { id: "a2", approval_status: "approved", expires_at: future },
      { id: "n1", approval_status: "approved", expires_at: null },
    ];
    const result = await expireStale(envWith(rows), NOW);
    assert.equal(result.expired, 0);
    assert.deepEqual(rows.map((r) => r.approval_status), ["rejected", "expired", "approved", "approved"]);
  });

  it("is idempotent across repeated runs", async () => {
    const rows: Row[] = [
      { id: "a1", approval_status: "approved", expires_at: past },
      { id: "p1", approval_status: "pending", expires_at: past },
    ];
    const env = envWith(rows);
    assert.equal((await expireStale(env, NOW)).expired, 1);
    assert.equal((await expireStale(env, NOW)).expired, 0);
    assert.deepEqual(rows.map((r) => r.approval_status), ["expired", "pending"]);
  });
});
