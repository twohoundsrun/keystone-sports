#!/usr/bin/env node
/**
 * One-shot Beat M2 seed — REAL URLs only (data/beat-m2-seed.json).
 *
 * Usage:
 *   npm run beat:seed
 *   # or apply SQL directly:
 *   npx wrangler d1 execute keystone-sports --remote --file=drizzle/seed/beat_m2_real.sql
 *   npx wrangler d1 execute keystone-sports --local --file=drizzle/seed/beat_m2_real.sql
 *
 * Does not flip KEYSTONE_BEAT_M1. Seeded rows are approved in D1 but public strip
 * stays hidden until the parent enables the flag after verify.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sqlFile = join(root, "drizzle/seed/beat_m2_real.sql");
const remote = process.argv.includes("--remote");

const target = remote ? "--remote" : "--local";
console.log(`[beat:seed] applying ${sqlFile} (${target})`);
const result = spawnSync(
  "npx",
  ["wrangler", "d1", "execute", "keystone-sports", target, `--file=${sqlFile}`],
  { cwd: root, stdio: "inherit", env: process.env },
);
if (result.status !== 0) {
  console.error("[beat:seed] wrangler failed — ensure wrangler auth + migration 0002 applied.");
  console.error("[beat:seed] Fallback: npx wrangler d1 execute keystone-sports --local --file=drizzle/seed/beat_m2_real.sql");
  process.exit(result.status ?? 1);
}
const seed = JSON.parse(readFileSync(join(root, "data/beat-m2-seed.json"), "utf8"));
console.log(`[beat:seed] done — ${seed.items.length} real items (flag still off until parent flips).`);
