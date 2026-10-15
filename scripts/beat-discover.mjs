#!/usr/bin/env node
/**
 * Manual Beat discovery (candidate-only). Does not auto-publish.
 *
 * Preferred (operator bot / editorial JSON):
 *   npm run beat:discover -- --input candidates.json
 *   cat candidates.json | npm run beat:discover
 *   npm run beat:discover -- --input candidates.json --write-pending-sql
 *
 * Then POST pending rows via bot ingest:
 *   POST /api/editor/beat/ingest  Authorization: Bearer $KEYSTONE_BEAT_INGEST_SECRET
 *
 * Native Grok/X discovery runs outside the Worker; supply results as JSON.
 *
 * Legacy (often 429s — not for production):
 *   npm run beat:discover -- --legacy-syndication
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const writeSql = process.argv.includes("--write-pending-sql");
const legacySyndication = process.argv.includes("--legacy-syndication");
const inputIdx = process.argv.indexOf("--input");
const inputPath = inputIdx >= 0 ? process.argv[inputIdx + 1] : null;

function loadHelpers() {
  const allowPath = join(root, "src/lib/beat/allowlist.ts");
  const fpPath = join(root, "src/lib/beat/fingerprint.ts");
  const discoveryPath = join(root, "src/lib/beat/discovery.ts");

  const allowCode = stripTypeScriptTypes(readFileSync(allowPath, "utf8"), { mode: "transform" })
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, "")
    .replace(/\bexport /g, "")
    .replace(/import type[^;]+;/g, "");
  const allow = new Function(
    `${allowCode}\nreturn { classifyBeatMedia, normalizeBeatUrl, extractXStatusId, extractYouTubeId };`,
  )();

  const fpCode = stripTypeScriptTypes(readFileSync(fpPath, "utf8"), { mode: "transform" })
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, "")
    .replace(/\bexport /g, "");
  const fp = new Function(
    "normalizeBeatUrl",
    "extractXStatusId",
    "extractYouTubeId",
    `${fpCode}\nreturn { beatDuplicateFingerprint, beatStoryRelation };`,
  )(allow.normalizeBeatUrl, allow.extractXStatusId, allow.extractYouTubeId);

  const coverageCode = stripTypeScriptTypes(readFileSync(join(root, "src/lib/beat/coverage.ts"), "utf8"), { mode: "transform" }).replace(/\bexport /g, "");
  const { inferPaCoverage } = new Function(`${coverageCode}\nreturn { inferPaCoverage };`)();
  const priorityCode = stripTypeScriptTypes(
    readFileSync(join(root, "src/lib/beat/priority.ts"), "utf8"),
    { mode: "transform" },
  )
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, "")
    .replace(/\bexport /g, "");
  const priority = new Function("inferPaCoverage", `${priorityCode}\nreturn { discoveryPriority, hasUnconfirmedLanguage };`)(inferPaCoverage);

  const discCode = stripTypeScriptTypes(readFileSync(discoveryPath, "utf8"), { mode: "transform" })
    .replace(/^import\s+type[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, "")
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, "")
    .replace(/\bexport /g, "");
  const discovery = new Function(
    "beatDuplicateFingerprint",
    "classifyBeatMedia",
    "beatStoryRelation",
    "discoveryPriority",
    "hasUnconfirmedLanguage",
    `${discCode}\nreturn { discoverPaBeatCandidates, candidatesFromEditorialJson, PA_BEAT_DISCOVERY_ACCOUNTS, scoreDiscoveryCandidate, scoreBandForRelevance };`,
  )(
    fp.beatDuplicateFingerprint,
    allow.classifyBeatMedia,
    fp.beatStoryRelation,
    priority.discoveryPriority,
    priority.hasUnconfirmedLanguage,
  );

  return discovery;
}

async function readJsonInput() {
  if (inputPath) {
    if (!existsSync(inputPath)) throw new Error(`Input file not found: ${inputPath}`);
    return JSON.parse(readFileSync(inputPath, "utf8"));
  }
  // Stdin when piped (not a TTY)
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (text) return JSON.parse(text);
  }
  return null;
}

async function main() {
  const discovery = loadHelpers();
  let result;

  if (legacySyndication) {
    result = await discovery.discoverPaBeatCandidates({ perAccountLimit: 2 });
    result = { ...result, discarded: result.discarded ?? 0, mode: "legacy-syndication" };
  } else {
    const raw = await readJsonInput();
    if (!raw) {
      console.error(`[beat:discover] Provide --input <file.json>, pipe JSON on stdin, or pass --legacy-syndication.
Native Grok/X discovery is run by the operator bot outside the Worker; POST results to /api/editor/beat/ingest.`);
      process.exit(2);
    }
    result = { ...discovery.candidatesFromEditorialJson(raw), mode: "editorial-json" };
  }

  if (!writeSql) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2));
    return;
  }
  const esc = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
  for (const c of result.candidates) {
    const id = crypto.randomUUID();
    console.log(`INSERT OR IGNORE INTO beat_items (
  id, source, source_tier, author_account, team_slug, league, category, headline, context,
  original_url, embed_url, embed_id, oembed_html, timestamp, media_type, verified_official,
  expires_at, approval_status, approval_mode, approved_by, approved_at, pinned,
  relevance_score, duplicate_fingerprint, created_at, updated_at, created_by
) VALUES (
  ${esc(id)}, ${esc(c.source)}, ${esc(c.sourceTier)}, ${esc(c.account)}, ${esc(c.teamSlug)}, ${esc(c.league)},
  ${esc(c.categoryRecommendation)}, ${esc(c.headline)}, ${esc(c.suggestedContext)},
  ${esc(c.originalUrl)}, ${esc(c.embedUrl)}, ${esc(c.embedId)}, ${esc(c.oembedHtml)}, ${esc(c.timestamp)},
  ${esc(c.mediaType)}, ${c.verifiedOfficial ? 1 : 0}, ${esc(c.proposedExpiration)}, 'pending', 'manual',
  NULL, NULL, 0, ${c.relevanceScore}, ${esc(c.duplicateFingerprint)}, ${esc(c.timestamp)}, ${esc(c.timestamp)}, 'discover:cli'
);`);
  }
  console.error(
    `[beat:discover] ${result.candidates.length} pending SQL; skipped ${result.skippedDuplicates}; discarded ${result.discarded ?? 0}; errors ${(result.errors || []).length}`,
  );
}

main().catch((err) => {
  console.error("[beat:discover] failed:", err?.message || err);
  process.exit(1);
});
