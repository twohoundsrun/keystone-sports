# Phase 4D — PR #46 release-readiness audit

Audit date: October 15, 2026 (America/New_York). PR: https://github.com/twohoundsrun/keystone-sports/pull/46. Branch: `feat/phase4d-coverage-discovery`.

## A. Environment and baseline

A fresh native Codex `skills/list` scan with forced reload automatically found all six installed development skills enabled, without extra skill paths: `agent-browser`, `code-review`, `diagnosing-bugs`, `frontend-design`, `vercel-react-best-practices`, `web-design-guidelines`. No skill is missing. The conversation catalog itself lists only the cloud onboarding skill; native filesystem discovery works. Relevant diagnosis, parallel review, React and browser instructions were used. No environment configuration, credentials or secrets were changed.

Git fetch and GitHub API access work. Master is `3a412d41de316c07f704bd43cb8cea90304c66a0`, which merged PR #45; #42/#44 are already included. PR #46 was OPEN/MERGEABLE at original head `041a9d6`. This audit stays on that feature branch.

Publishing environment settings did improve HTTPS access, but selectively:

- All nine retained feed URLs returned a source HTTP response through the configured HTTPS proxy. No TLS verification was disabled.
- GitHub API inspection works. The original CI `check` job failed in **Install**; subsequent lint/tests/build/typecheck steps were skipped. `beat-jobs` passed. Log ZIP retrieval from `results-receiver.actions.githubusercontent.com` was proxy-forbidden, so its unavailable log contents are not quoted as evidence.
- A separate clean Node 22.23.3 / npm 10.9.4 reproduction failed with `npm ci` EUSAGE: `Missing: lru-cache@11.5.3 from lock file`. npm 11 had accepted the same lock. Regenerating with npm 10 adds only that nested optional/peer entry; clean install then succeeds (298 packages), with no existing locked version changed.
- Local workerd direct outbound execution is a separate limitation: live discovery produced `getaddrinfo(): DNS lookup failed` for `gopsusports.com` and `www.mlb.com`, plus configured-timeout failures for other enabled sources. It does not establish a publisher outage or deployed Worker incompatibility. No proxy was bypassed or access control circumvented.
- `keystonebeat.com` public `/`, `/news` and anonymous `/editor/beat` GETs were denied at proxy CONNECT with 403, before an origin response. Deployed homepage and Access policy could not be checked. No authenticated production editorial request was attempted.

## B. Live RSS validation

One bounded read per source, with limited follow-up for the actual Crossing Broad redirect. `curl` exit 0 means a completed source response; a proxy CONNECT failure is recorded separately. Bodies were parsed by the actual Phase 4D parser outside D1; gzip for GoPSU was decoded before parsing, as HTTP clients normally do. The inspected entry count is capped at 100. “Recent” below means original publication within 72 hours at inspection, not automatically newsworthy. All parsed entries had titles, original HTTPS article URLs and usable publication times; attribution comes from the reviewed registry and feed channel. No article pages/bodies were fetched separately or committed as fixtures.

| Source | Source HTTP / content type | Parsed entries / recent | Newest publication (Eastern, Oct 15) | Operational assessment |
| --- | --- | --- | --- | --- |
| Philadelphia Eagles | 200 `application/rss+xml` | 100 / 12 | 6:00 p.m. | Verified XML/parser compatible, recent PA team items. 112,005 bytes. |
| Pittsburgh Steelers | 200 `application/rss+xml` | 12 / 12 | 5:14 p.m. | Verified working, recent injury/team reports. 12,899 bytes. Team source context matters when a title omits “Steelers.” |
| Philadelphia Phillies | 200 `text/xml` | 25 / 9 | 6:10 p.m. | Verified working, current Phillies offseason coverage. 17,120 bytes. Eligibility gate may correctly select zero items. |
| Pittsburgh Pirates | 200 `text/xml` | 25 / 7 | 4:07 p.m. | Verified working, team/award coverage. 17,214 bytes; zero selected is not a coverage failure. |
| Penn State / GoPSU | 200 `text/xml`, gzip | 100 / 15 | 3:30 p.m. | Verified after HTTP gzip decoding: 118,668 decoded bytes (19,072 wire bytes). No parser relaxation needed. |
| PennLive Penn State | 200 `application/xml` | 50 / 32 | 6:59 p.m. | Valid/recent; 278,690 bytes exceeded the old 256 KiB limit. Fits corrected bound. |
| Philadelphia Inquirer | 200 `application/xml` | 57 / 54 | 6:46 p.m. | Valid/recent, 502,398 bytes. **Editorial intake disabled pending written publisher permission**; see restrictions below. |
| NBC Sports Philadelphia | 200 `text/xml` | 0 / 0 | No article dates | Valid RSS channel but **empty**. Not verified as an operational article source. Retained diagnostics report `empty`; no replacement URL invented. |
| Crossing Broad | Original `/feed`: 301 → `/feed/`; canonical: 200 `application/rss+xml` | 60 / 41 | 6:33 p.m. | Canonical endpoint independently retrieved and parsed, 529,208 bytes. Editorial registry now requests it directly; arbitrary redirects remain rejected. |

The original request destinations are listed in the [implementation inventory](phase-4d-discovery.md#source-inventory-and-access-evidence). Only the independently verified Crossing Broad canonical path changes; no new host or source is activated. Existing public-wire registry/behavior is unchanged.

Replaying these retrieved responses through the real acquisition/Phase 4C pipeline, with Inquirer disabled, produced **10 selected candidates**: Eagles 4, Steelers 2, PennLive 3, Crossing Broad 1; seven sources `ok`, NBC `empty`, Inquirer `disabled`. This is a read-only captured-response compatibility check, not a successful live workerd egress test, editorial quality endorsement, or production ingest. No real publisher record was written to any D1 database.

### Publisher restrictions

Public `robots.txt` responses were retrieved for all eight distinct existing hosts. Eagles/Steelers exclude search/internal paths, MLB excludes listed app/search paths, and GoPSU allows crawling; their RSS paths were not excluded. Inquirer lists search/wire exclusions; PennLive and NBC include explicit blocks for several AI/crawler agents. These were recorded, not treated as permission to evade blocks. The application uses its existing identified `KeystoneBeatDiscovery/1.0` agent for metadata acquisition, performs no AI feed calls/training, and does not fetch article pages. Robots access is not a content license.

The Inquirer feed itself links to `https://www.inquirer.com/about/terms_and_conditions/#Use`. The retrieved terms §8 restrict use to personal use and require prior written consent for commercial use; §11 prohibits tools gathering material through automated navigation without prior written permission. Consequently editorial acquisition is disabled with an owner-visible permission reason. No claim is made that public access authorizes reuse. The pre-existing public wire’s Inquirer integration remains a separate owner licensing-review item; this audit does not expand or alter it. Full publisher permission and changing terms cannot be established solely by a feed returning 200.

### Potential expansion sources — none activated

| Organization | Public location inspected | Result / future suitability |
| --- | --- | --- |
| Pittsburgh Athletics | `pittsburghpanthers.com` | CONNECT 403; homepage/feed advertisement unavailable. No feed verified. |
| Lehigh Athletics | `lehighsports.com` | CONNECT 403; no feed verified. |
| Lafayette Athletics | `goleopards.com` | CONNECT 403; no feed verified. |
| Bucknell Athletics | `bucknellbison.com` | CONNECT 403; no feed verified. |
| Duquesne Athletics | `goduquesne.com` | CONNECT 403; no feed verified. |
| Saint Joseph’s Athletics | `sjuhawks.com` | CONNECT 403; no feed verified. |
| PIAA | `www.piaa.org` | CONNECT 403; no supported RSS endpoint established. |
| WPIAL district competitions | `wpial.org` | CONNECT 403; no feed verified. |
| IronPigs / RailRiders | `www.milb.com/lehigh-valley`, `/scranton-wb` | CONNECT 403 for `www.milb.com`; no feed verified. |

These are environment restrictions, not evidence that feeds do not exist. Official supported feed advertisements, current content and usage requirements must be checked from a permitted network before a later expansion. No guessed alternate RSS URL was added.

## C. Database migration and deployment runbook

`0005_beat_discovery_state.sql` only creates `beat_discovery_state(id TEXT PRIMARY KEY NOT NULL, started_at TEXT NOT NULL, report TEXT)`. No drop/alter/update of editorial records, index removal or backfill occurs. Ordering follows 0000–0004; Drizzle journal/snapshot-chain check passes. The existing custom 0003/0004 snapshot omissions remain intentional, as documented in AGENTS.md.

Isolated local D1 UUID: `00000000-0000-0000-0000-000000000046`. Separate fresh and upgrade state directories were used; no production ID/account/routes in local configs.

- Fresh database: all six migrations applied successfully.
- Upgrade: applied 0000–0004, seeded a realistic synthetic pending record, then applied 0005. The existing record remained identical field-for-field.
- Repeating `wrangler d1 migrations apply` reports no migrations to apply. Exactly one migration tracker row exists for 0005. The raw `CREATE TABLE` SQL is intentionally not idempotent; do not execute it manually twice or hide an unexpected existing table with `IF NOT EXISTS`.
- Missing 0005: report read returns null; discovery fails before fetching sources or writing candidates. Existing queue reads remain usable. This is fail-closed behavior, not a reason to omit the migration.
- Actual D1 persists the report/shared lease; cached requests perform zero source fetches/inserts. Existing deterministic tests cover concurrent claims, cooldown expiration and Retry-After persistence.

**Migration is manual.** Repository GitHub CI builds/tests but has no D1 migration step. `wrangler deploy` does not automatically apply SQL migrations. Cloudflare’s externally managed build/deploy settings are not versioned here and were not inspected or changed.

### Later authorized release — commands prepared, not executed remotely

From repository root, after approval and with normal Cloudflare operator authentication. Install the pinned worker toolchain with `(cd workers/keystone-beat-jobs && npm ci)` if needed. Every command below targets the production configuration intentionally; **none was run during this audit**.

```bash
# 1. Verify target account/database in wrangler.toml and pending migration order.
./workers/keystone-beat-jobs/node_modules/.bin/wrangler d1 migrations list DB --remote --config wrangler.toml

# 2. Record a Time Travel bookmark and take a protected export before any mutation.
./workers/keystone-beat-jobs/node_modules/.bin/wrangler d1 time-travel info DB --config wrangler.toml --json
./workers/keystone-beat-jobs/node_modules/.bin/wrangler d1 export DB --remote --config wrangler.toml --output /secure-backup/keystone-before-phase4d.sql

# 3. Capture existing editorial counts/schema; confirm only reviewed migrations are pending.
./workers/keystone-beat-jobs/node_modules/.bin/wrangler d1 execute DB --remote --config wrangler.toml --command "SELECT approval_status, COUNT(*) AS count FROM beat_items GROUP BY approval_status; SELECT name FROM d1_migrations ORDER BY id; SELECT name, sql FROM sqlite_master WHERE name='beat_discovery_state';"

# 4. Apply reviewed migrations BEFORE deploying the new application.
./workers/keystone-beat-jobs/node_modules/.bin/wrangler d1 migrations apply DB --remote --config wrangler.toml

# 5. Verify structure, tracker entry and unchanged editorial counts.
./workers/keystone-beat-jobs/node_modules/.bin/wrangler d1 execute DB --remote --config wrangler.toml --command "PRAGMA table_info(beat_discovery_state); SELECT name FROM d1_migrations WHERE name='0005_beat_discovery_state.sql'; SELECT approval_status, COUNT(*) AS count FROM beat_items GROUP BY approval_status; SELECT COUNT(*) AS discovery_rows FROM beat_discovery_state;"

# 6. Only after separate deployment authorization, build and use the normal release.
npm ci
npm run build
./workers/keystone-beat-jobs/node_modules/.bin/wrangler deploy --config wrangler.toml
```

Use a real protected backup directory; keep exports outside the repository. If migrations other than 0005 are unexpectedly pending, stop and reconcile deployment history. Perform count comparisons with editorial activity paused or account for concurrent changes. Verify all three columns, one tracker entry and initially zero report rows; later discovery should create only the singleton `rss` row. Retain backup/bookmark and the previous Worker version identifier.

**Recovery:** stop discovery and roll the application back to the known prior Worker version if necessary; the additive table can safely remain for old code. Do not drop it or delete migration tracking records automatically. Whole-database Time Travel/export restore can overwrite unrelated articles and later edits; it requires a separate incident decision, backup validation and controlled writes. No automatic rollback is assumed.

## D. Editorial workflow and authorization

The actual built Cloudflare module and a local-only synthetic-fetch harness used the same isolated D1 state. The harness exists outside the repository; no production test hook or source override was added.

- **14 workflow assertions passed:** anonymous/wrong-owner desk/discover/mutate denied; source-to-pending queue priority pagination with no omissions; report persistence/all four areas; partial failures; shared cooldown; no automatic public cards; explicit owner approval and rejection; filters/counts.
- First source run inserted ten synthetic pending/manual cards, with one duplicate suppressed, one promotional item discarded and three candidates deferred. A later eligible run inserted the remaining three and suppressed eleven repeated reports. An intervening owner reject remained rejected.
- **10 Chromium checks passed:** source errors and four-area diagnostics, cached discovery control, preview, rejected/empty filters, no overflow at 320 and 390px, no browser errors, signed-out withholding of queue/report.
- Unit/integration tests additionally cover shared cross-instance claim races, persistent source backoff, dry-run behavior, eight-then-one source-cap advancement, meaningful injury follow-ups and same-URL update reporting.

These are local application authorization checks using synthetic trusted headers. Production Cloudflare Access must protect the configured host aliases, `/editor`, `/editor/beat` and any privileged server-function/API paths, and prevent untrusted identity headers reaching an unprotected origin. `workers_dev=true` and legacy hosted-identity fallback remain existing deployment considerations. No deployed Access policy/audience or bypass-host configuration is verified here. No signed-in production action was attempted.

## E. Code quality and CI

Local checks on Node 22.23.3/npm 10.9.4, matching CI’s Node major:

| Check | Result |
| --- | --- |
| Frozen npm install | Pass after lock repair; 298 packages |
| App test suite | 173 passed, zero failed/skipped; includes 20 feed tests |
| Sports test alias | Same 173-test suite passed; not counted as additional unique tests |
| Jobs worker | 37 tests passed; typecheck passed |
| Root typecheck | Pass |
| Lint | Zero errors; pre-existing unused `weekOddsBoards` warning |
| Drizzle chain | Pass |
| Production build | Pass; Cloudflare `index.mjs`, OpenAI `index.js` wrapper and hosting/migration assets present |
| Actual local D1 workflow | 14 assertions plus separate upgrade/repeat/deferred checks passed |
| Chromium | 10 checks passed |
| Remote GitHub CI | Updated after pushing fixes; see final report/current PR checks |

No dependencies were upgraded or unrelated source refactors introduced. The lock repair adds the missing nested `nitro/node_modules/lru-cache@11.5.3` optional/peer record only. New production XML parser remains pinned to 5.11.2. Existing public homepage/sports wire files are unchanged by audit fixes; no live public regression claim is possible through the blocked production hostname.

## F. Findings, fixes and operational implications

1. **CI portability:** npm 10 rejected the npm 11-generated lock. Fixed through npm’s lock generator; clean Node22/npm10 install now passes.
2. **Valid feeds too large:** PennLive/Inquirer exceeded 256 KiB and canonical Crossing Broad is ~529 KiB. Bounded decoded-body limit becomes **1 MiB**, covered by a 600 KB synthetic regression and an over-limit rejection test. Compressed wire size never substitutes for decoded bound.
3. **Registered redirect rejected:** Crossing Broad `/feed` returned 301. Only its verified canonical editorial URL changes to `/feed/`; redirects elsewhere still fail safely.
4. **Publisher restriction:** Inquirer editorial source disabled with an explicit owner-visible permission reason and no-fetch regression. Public accessibility is not treated as authorization.

At most **eight active source requests** now (registry safety cap remains nine), three concurrent, 3.5 seconds through body read, no redirects or immediate retries, ten-minute durable cooldown and ten maximum inserts. Maximum permitted decoded data is now 8 MiB per fully populated run (old bound was 2.25 MiB across nine); current captured enabled feeds total about 1.1 MiB. XML CPU/memory and deployed egress/latency still need observation on the real Worker plan. Existing archive-wide fingerprint scans remain a growth limitation. No extra paid calls, cron, AI usage, secret, binding, publishing automation or Apify activation.

### Standards

Independent reviewer confirmed the size and redirect defects; re-review of the targeted fixes is recorded with the final PR audit. No additional documented-standard violation or material heuristic smell was found. Auth, pending-only writing, append-only migration and two-target build remain intact.

### Spec

Independent reviewer found no additional implementation defect beyond the tracked source/CI blockers. The fixed source-cap regression, follow-up behavior and diagnostics satisfy workflow scope. External source expansion, deployed Access and direct workerd networking remain limitations, not passed checks.

## G. Release decision

Merge and deployment are separate decisions. Code can be **READY TO MERGE** once the updated remote app/worker CI checks are confirmed green. This is not **READY TO DEPLOY AFTER MIGRATION**: live deployed egress/timeout behavior, Access policy on every ingress and the production homepage could not be verified from this environment. Inquirer stays disabled until permission; NBC remains empty; smaller-college/high-school/minor-league feed expansion remains unverified and inactive.

A later authorized release must apply 0005 first, satisfy the Access/egress prerequisites, deploy through the normal process, and conduct owner-approved manual discovery/diagnostic smoke testing. No merge, deployment, remote migration, production editorial/database write, production secret change or scheduled/paid-service activation was performed in this audit.
