# Phase 4D/4E production-readiness assessment

Audit: October 17, 2026 (America/New_York). Baseline: `master` `89c9907be2d7253139a0f5a4e75bf28d2de1f980`, merge of PR #47. No production mutation or authenticated editorial request was executed.

## Decision

**Production readiness is NOT VERIFIED; do not authorize rollout from this audit alone.** Master includes both discovery phases and its GitHub app/worker checks passed. A focused public-feed reliability fix is prepared separately; it must be reviewed/merged through the normal process before a release can include it. Nothing was merged or deployed during this task.

Outstanding release gates:

1. Establish which Worker version actually serves each production ingress.
2. Confirm live D1 binding and migration0005 tracker/schema using authorized read-only access.
3. Verify Cloudflare Access/header trust on every privileged ingress, including aliases/preview paths.
4. Complete owner-authorized deployed egress/queue smoke tests. Discovery and even its dry-run write D1 lease/report state, so neither was invoked here.

## Verified configuration and explicit assumptions

| Setting/evidence | Verified result | Limitation |
| --- | --- | --- |
| Git | PR47 MERGED, master89c9907; app and jobs CI SUCCESS | Not proof of deployed code |
| Cloudflare build | Build40b4d3de-6ee0-46e6-b662-666321b46994 SUCCESS, version `e7ba3992-d37b-42d6-8885-be5869fbde45` | Build/version creation does not prove active traffic allocation |
| Worker/account | `keystone-sports` / `9f99f068882ff62fff142655f4c9f0cc` in wrangler.toml | Live dashboard/bindings unavailable |
| Database | `DB` → `keystone-sports`, UUID `9d1f8f05-10d5-4a1c-87d5-fe038a328540` | Actual live target/schema not inspected |
| Migration | 0005 creates only `beat_discovery_state(id,started_at,report)`; no SQL change in this fix | Production application UNKNOWN; repository CI/deploy does not apply it automatically |
| Routes | keystonebeat.com, www.keystonebeat.com, keystone.twohoundsrun.com; `workers_dev=true` | Actual Access and workers.dev/version-preview policy unknown |
| Build | Cloudflare module entry and OpenAI wrapper retained | No Cloudflare upload/deploy invoked |
| Production access | Wrangler reports unauthenticated | No credential extraction, login, new secret or settings change attempted |
| Anonymous production GETs | All three hostnames: `/` and `/editor/beat?beatAction=desk` fail at CONNECT403, curl exit56, source status000 | Proxy denial, not an origin403 or evidence of functioning Access |

GitHub does not expose an active Cloudflare traffic record here. Automatic build/version creation is confirmed; automatic production activation cannot be confirmed or ruled out. An authorized operator must inspect deployments and version metadata, not infer activation from a green build.

## Editorial source and pipeline verification

The **merged repository registry**, not an authenticated live Worker configuration, has seven enabled editorial sources. One bounded HTTPS GET per enabled source returned HTTP200; actual Phase4D parser results:

| Source | Content type | Parsed / usable publication dates |
| --- | --- | --- |
| Eagles | application/rss+xml | 100 / 100 |
| Steelers | application/rss+xml | 12 / 12 |
| Phillies | text/xml | 25 / 25 |
| Pirates | text/xml | 25 / 25 |
| GoPSU | text/xml (HTTP gzip decoded) | 100 / 100 |
| PennLive PSU | application/xml | 50 / 50 |
| Crossing Broad canonical `/feed/` | application/rss+xml | 60 / 60 |

All seven supplied current dated material. This verifies read-only publisher responses/parser compatibility, not live Worker egress, quality of every headline or production ingestion. No real feed item was written to D1. Disabled Inquirer and NBC were not requested or activated; their existing permission/timestamp restrictions remain unchanged. Other public-wire integrations remain outside this fix and retain the licensing-review limitations in the Phase4E audit.

Code and local tests confirm:

- The ten-minute conditional D1 claim is shared across isolates and includes dry-runs; cached requests do not fetch/insert. Retry-After persists across runs.
- Nine-source safety cap, seven enabled sources, three concurrent requests,3.5s timeout,1MiB decoded bodies,100 inspected entries/source, eight net-new candidates/source and ten pending inserts/run remain unchanged.
- Phase4C ranking, exact URL identity, conservative related-story matching and significant follow-ups remain intact. No new source, paid call, cron or AI usage.
- Owner report retains bounded failure/empty streaks, comparable-volume notices, HTTP/metadata and candidate/duplicate/discard counts; cached/backoff behavior does not manufacture attempted failures.
- Shared ingest forces `pending`/`manual` and no approver. Public SQL filters approved/unexpired rows; public selection checks visibility again. Pending/rejected/expired records cannot appear through these public read paths without a separate owner approval action.

Production report contents, cooldown execution, pending counts and actual source failure history remain UNKNOWN because no authorized Cloudflare/D1 session is available.

## Access requirements and boundaries

Existing identity code trusts Cloudflare Access email headers matched to the configured owner, with legacy hosted-identity fallback. This remains unchanged. Correct operation depends on the trusted gateway preventing spoofed headers or unprotected alternate ingress; local injected-header tests cannot verify that deployment assumption.

The operator must inspect:

- `/editor` and its `publisherAction` operations: server-side owner gate.
- `/editor/beat` including `beatAction=desk`, `discover`, `mutate`, create and other operations: owner gate before execution.
- Legacy `/editor/api/beat/desk` (identity-gated public-row read) and `/editor/api/beat/mutate` (owner-only mutation).
- Owner-only TanStack server functions under `/_serverFn/*`: admin desk, create/mutate/discover, publishing and AI operations enforce identity/requireAdmin. Public score/news/public-Beat functions use the same prefix, so do not blindly block every server function and break public reads. Verify the privileged function ingress and trusted-header boundary specifically.
- Bot `/api/editor/beat/ingest` and `/check`: independent header-secret authentication, pending-only writes. Do not exercise ingest to test RSS; do not add credentials to URLs.
- `/api/auto-recap`: separate header-secret/AI workflow, outside RSS verification. Do not invoke it.
- Every custom domain plus any workers.dev/version-preview ingress. Protect or eliminate bypass paths through the normal separately authorized settings process. No policy/audience/header-stripping setting is asserted verified here.

These are configuration-dependent exposure risks, not a demonstrated production bypass. Only anonymous GETs were attempted against production; no forged-owner headers, authenticated actions, discovery or dry-run.

## Homepage delay: independently reproduced defects and narrow fix

The prior native local homepage completed after32.055s during ESPN DNS failures. Actual route/server code shows independent waits accumulating:

1. Homepage awaited scores before starting independent news and approved-Beat reads. The optional future-odds board can wait20s; news can wait12s. A controlled test executing the actual route callback reproduces this32s waterfall.
2. `fetchWithRetry` gave each of three attempts a fresh10s (JSON) or8s (text) timer, plus retry waits. These were per-attempt timers, not request budgets.
3. Timers were cleared when headers arrived, before JSON/text body reads. Body stalls had no deadline. AbortController alone did not release the caller when a transport ignored abort during DNS.

Four minimal regressions failed on baseline: ignored-abort transport, stalled body, retry-delay budget and independent homepage starts. The fix:

- Starts news and approved editorial reads alongside the board. Published posts still wait for the board's validated date; data/approval semantics are unchanged.
- Uses one elapsed timer and Promise.race through fetch, body and retry waits. Abort is propagated; a late response is cancelled without reading or another retry.
- Keeps at most three attempts and existing backoff for transient failures **within** the original single-request timeout. Nonretryable HTTP, malformed JSON and failed body reads do not acquire extra retries. Error bodies are cancelled.
- Leaves all cache TTLs, stale-data bounds/timestamps, parsing, league selection and successful payloads unchanged. No fabricated scores, promoted freshness, background polling or new API integration.

Controlled20s-board/12s-news execution now finishes at20s, not32s. A cold request to the **actual built local Worker with native outbound fetch**, without upstream mocks, returned HTTP200 in **20.105s** despite DNS failures. These are local observations, not a production latency guarantee. The existing optional future-odds20s window remains a material latency floor during an outage; cache/D1/render time is outside the network deadline. Reducing coverage/wait windows is not part of this focused reliability patch.

## Validation

- Root suite: **189 tests passed**, zero failures/skips; sports alias same suite passed. Eight new regressions cover deadlines, retries, bodies, late cancellation, successful data and homepage orchestration.
- Jobs worker: **37 passed** and typecheck passed; worker unchanged.
- Root typecheck, production build and Drizzle chain check passed. Lint: zero errors, existing unused `weekOddsBoards` warning only.
- Existing migrations0–5 applied only to isolated local D1 UUID `00000000-0000-0000-0000-00000000004f`; no new migration/dependency/secret/config change.
- Actual built app/local D1: **14 workflow assertions** passed for anonymous/wrong-owner denial, priority pagination, pending-only discovery, cooldown/report persistence, manual approval/rejection and visibility. Later fixture runs exercise deferred intake/failure history. Discovery fetches in this local-only harness are synthetic, never publisher-to-production ingest.
- Chromium: **19 assertions** passed for owner diagnostics/preview/filters, signed-out editorial withholding, pending/private-data withholding on homepage and public news, failure history and320/390px layouts. Public pages used the native built Worker, with real local egress attempts and fallback behavior, not the prior synthetic-upstream wrapper. Authenticated-owner cases use explicitly synthetic trusted headers against local D1 only; deployed Access remains unverified.

## Release checklist — operator actions only

Do not execute the mutation/deploy/smoke steps without separate explicit authorization. Read-only command syntax is supported by pinned Wrangler4.149.0. From repository root on a trusted operator machine with normal approved Cloudflare authentication:

```bash
WRANGLER="./workers/keystone-beat-jobs/node_modules/.bin/wrangler"
"$WRANGLER" whoami
"$WRANGLER" deployments list --name keystone-sports --config wrangler.toml --json
"$WRANGLER" versions view e7ba3992-d37b-42d6-8885-be5869fbde45 --name keystone-sports --config wrangler.toml --json
"$WRANGLER" d1 info DB --config wrangler.toml --json
"$WRANGLER" d1 migrations list DB --remote --config wrangler.toml
"$WRANGLER" d1 execute DB --remote --config wrangler.toml --json --command "SELECT name FROM d1_migrations ORDER BY id; SELECT name, sql FROM sqlite_master WHERE name='beat_discovery_state'; PRAGMA table_info(beat_discovery_state); SELECT approval_status, COUNT(*) FROM beat_items GROUP BY approval_status;"
```

1. **Pin code and traffic.** Verify reviewed current master and new reliability PR status. Confirm live version IDs/traffic percentages/commit metadata, not just uploaded versions. The Phase4E version may already serve traffic; record any split and prior version. Do not deploy redundantly or overwrite a split blindly.
2. **Verify target and migration.** Match account, binding and UUID above. If0005/table/tracker agree, do not reapply manually. If other unexpected migrations are pending or table/tracker disagree, stop and reconcile. `preview_database_id` equals production: never use this config for synthetic/preview writes.
3. **Back up before a needed mutation.** Under a coordinated quiet editorial window, record a Time Travel bookmark and protected full/editorial exports. The paths below are examples of approved private storage; create/review them before use, keep exports outside Git and do not print contents:

```bash
umask 077
"$WRANGLER" d1 time-travel info DB --config wrangler.toml --json > /secure-backup/keystone-bookmark-before.json
"$WRANGLER" d1 export DB --remote --config wrangler.toml --output /secure-backup/keystone-before.sql
"$WRANGLER" d1 export DB --remote --config wrangler.toml --table beat_items --no-schema --output /secure-backup/beat-before.sql
```

4. **Migration only if pending, after authorization.** Verify only reviewed migration0005 is pending; then `"$WRANGLER" d1 migrations apply DB --remote --config wrangler.toml`. Normal migration tracking skips completed SQL; do not rerun raw CREATE TABLE, alter snapshots, delete tracking rows or drop an existing table. Verify all three columns, one tracker entry and editorial preservation before continuing. Compare counts plus normalized full editorial exports, accounting for concurrent expiry/editorial activity; [the prior runbook](phase-4d-release-readiness.md) explains recovery precautions. A newly created discovery table is empty; an already-used table may have `rss` and must not be cleared.
5. **Verify Access before release.** Inspect all ingress/policy requirements above. From a permitted signed-out browser, check editor challenges/denials and lack of private data. From normal owner sign-in, inspect read-only desk/diagnostics. Do not infer production Access from a locally injected header or attempt an authenticated action here.
6. **Deploy only after separate approval and review.** This task leaves the reliability fix in a PR. After it is separately merged/authorized and migration verified: `npm ci`, `npm run build`, `"$WRANGLER" deploy --dry-run --config wrangler.toml`, review bindings/assets, then authorize `"$WRANGLER" deploy --config wrangler.toml` if the desired version is not already active. Do not deploy the jobs worker, change schedules, activate sources/Apify or create secrets. Save resulting deployment/version allocation.
7. **Post-release read-only smoke.** Check homepage/news response time, warning/fallback accuracy, mobile layout and no pending/private data. Confirm owner/anonymous/non-owner separation and version actually receiving traffic. Record cold versus warm behavior separately.
8. **Discovery smoke needs explicit D1-write approval.** No standalone read-only discovery egress probe exists. Even the dry-run writes lease/report. After authorization, inspect its source health/metadata and zero card inserts, wait the existing ten-minute cooldown/Retry-After, then optionally authorize one pending-ingest run. Check source attribution, duplicate/follow-up behavior, new rows remaining pending/manual with no approver/public visibility, and cached repeat yielding zero inserts. Do not approve/reject/publish existing articles just for testing.
9. **Recovery.** Stop discovery and separately authorize a return to the known prior Worker version if needed. Leave the additive table in place. Whole-D1 Time Travel/export restoration can overwrite later unrelated stories; it requires a controlled incident decision and verified backups, not an automatic rollback.

No production migration, database write/export, deployment, source activation, discovery/dry-run, paid API, secret change or authenticated editorial action was performed. All local synthetic state/configuration is outside production, and no credential values are included in this report.
