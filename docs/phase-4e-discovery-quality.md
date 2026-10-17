# Phase 4E — discovery quality and coverage

## Baseline and authorized production audit

Started from actual default branch `master` at `82064ef` (merged PR #46); this repository has no `main` branch. The existing architecture remains owner manual request → durable D1 claim → bounded RSS metadata → Phase 4C score/dedupe → shared PENDING-only writer → priority-paginated Beat Desk. JSON/operator ingest and explicit legacy X remain unchanged. There is no scheduled RSS discovery.

Baseline limits: ten-minute cross-isolate cooldown (including dry runs), nine configured source slots/eight enabled requests, three concurrent fetches, 3.5 seconds through body reading, 1 MiB decoded bodies, 100 entries/source, eight net-new candidates/source and ten pending inserts/run. Retry-After persists in the singleton migration-0005 report row. Exact URLs are permanently deduped; different-URL matching remains conservative, with meaningful follow-ups retained.

Production inspection is **limited**: Wrangler reports unauthenticated. Anonymous `keystonebeat.com` homepage and editorial-desk GETs fail at proxy CONNECT 403 before an origin response. No production D1/readable source-health report, deployed Access policy, actual cooldown or live Worker egress is claimed verified. No production DB write, authenticated editorial action, deployment or secret/configuration change occurred. “Dry run” is not used against production: it writes the lease/report.

The previous audit observed NBC `/feed/` returning a valid empty RSS channel. A new limited public GET on October 17 confirmed HTTP200 `text/xml`, 1,168 bytes and no items. NBC's public robots file explicitly advertises `/?rss=y&most_recent=y`; this alternate returned HTTP200 `text/xml`, 203,357 bytes and 25 actual articles. The production parser extracted all 25 original HTTPS links/titles, but **zero usable publication timestamps**: item dates such as `Sat, Oct 17 2026 12:26:56 PM` omit a timezone. The channel's dated build time cannot substitute for original publication. No timezone or freshness was invented.

NBC's homepage links `/terms-of-service/`. The retrieved terms §2 restrict use to personal/noncommercial use, and access restrictions prohibit extraction tools aggregating content. Explicit robots allowance establishes technical discoverability, not a syndication license. Consequently NBC editorial discovery is now disabled with a permission/timestamp diagnostic. Inquirer remains disabled. Existing public-wire behavior is outside this change and still requires its separate owner licensing review.

## Prioritized coverage gaps and source decisions

1. **High school/PIAA/district:** no independently verified dedicated feed; largest acquisition blind spot. Important title/champion stories can be recognized when supplied, but recognition is not acquisition.
2. **Smaller colleges:** dedicated intake remains Penn State-heavy. Official athletics/conference feeds require accessible advertised endpoints and permission checks.
3. **Regional reporting:** limited dedicated intake for minor-league teams and smaller communities; added entity vocabulary helps existing general feeds/operator input without quotas.
4. **Professional:** 76ers/Flyers/Penguins/Union and other leagues lack the dedicated official feeds available for Eagles/Steelers/MLB. The NBC alternate cannot safely fill this gap yet.

| Source investigated | Observed access | Decision |
| --- | --- | --- |
| NBC current/advertised alternate | HTTP200 XML, empty current / 25 undated alternate articles | Disable editorial intake pending permission and reliable original timestamps; do not replace with alternate |
| Inquirer | Existing permission restriction | Remains disabled; no request or activation in this task |
| Pitt, Lehigh, Bucknell | `pittsburghpanthers.com`, `lehighsports.com`, `bucknellbison.com`: proxy CONNECT403 | No feed/terms verified, no source added |
| PSAC | `psacsports.org`: CONNECT403 | No conference feed verified; no source added |
| PIAA / WPIAL / District3 | `www.piaa.org`, `wpial.org`, `piaad3.org`: CONNECT403 | No official feed advertisement verified; no source added |
| Regional news | `tribhssn.triblive.com`, `www.wnep.com`: CONNECT403 | No publisher integration verified; no source added |
| Penguins / Sixers / Union | `www.nhl.com`, `www.nba.com`, `www.philadelphiaunion.com`: CONNECT403 | No official feed verified; no source added |
| PennLive sports page | Origin HTTP403 HTML (different from CONNECT denial) | Stop at restriction; no bypass or guessed replacement feed |
| Other retained feeds | Registry retained, no new destination/terms assertion | Previous Phase4D live validation remains historical evidence, not a fresh operational guarantee |

No new remote source is activated. Blocked access means unverified, not nonexistent. Public official feed advertisements, valid dated relevant items, access/usage permission and bounded response behavior are prerequisites for later additions; swap or rebalance existing slots rather than increasing requests.

## Implemented changes

- Extend the existing Phase4C significance vocabulary for district champions, NCAA tournament berths, named All-Americans, medical sidelining and named coaches. Explicit PA regional entities now include Reading Fightin Phils, Altoona Curve, Williamsport Crosscutters, York Revolution and Lancaster Barnstormers; additional pro entities include Riverhounds and Philadelphia Wings.
- Promotional signup/ticket-sale language receives the existing promotional penalty. Championship previews without a real development are ineligible; preview/operator scores receive a stronger penalty. A genuine injury/transaction with preview language still reaches review. No replacement scoring model or institution-size bonus.
- Shared out-of-state nicknames (Boston College Eagles, Seton Hall Pirates, Dayton Flyers, Youngstown State Penguins) no longer receive PA ranking credit merely from the generic keyword fallback. Explicit trusted PA source context remains supported.
- Add bounded parser diagnostics: actual inspected entry count versus usable metadata. Nonempty feeds with only unsafe/missing article links become `error`, not misleading `empty`. Missing dates remain conservatively rejected. Preserve the existing metadata-only parser API and XML/URL restrictions.
- Owner report now exposes HTTP status/content type, selected/inserted/discarded/duplicate/deferred counts, usable versus ignored metadata, Retry-After and last successful valid feed read. Oversize Content-Length responses are cancelled immediately before reading.
- Reuse the existing JSON report for capped consecutive failed/empty attempt counters. Cached cooldown requests do not increment; backoff preserves the streak without claiming another request; successful reads reset failures. Three failed/empty attempts produce inspectable notices. A valid empty/stale read still counts as successful parsing, not fresh useful coverage.
- Detect threefold eligible-volume changes with a 20-item minimum only when both runs successfully read the same attempted source set. Outages, backoff or registry changes produce `not_comparable`, not claims of missing events. This is a one-run comparison, not a statistical anomaly model.
- Existing owner score explanations are now collapsible and explicitly describe **current** signals versus the stored intake score used by queue SQL. Loading a story does not rescore, approve or rewrite it. Old JSON reports remain displayable; new fields are optional.

## Repeatable evaluation

`tests/fixtures/phase4e-quality.json` has 18 synthetic labeled headlines: 12 consequential PA developments and six preview/promotion/out-of-state/routine negatives. Same fixed time/source credibility for each headline. Evaluation runs each separately, so source/global caps cannot conceal classification errors.

| On this labeled fixture only | Phase4D master | Phase4E |
| --- | --- | --- |
| Relevant developments admitted | 4/12 | 12/12 |
| Relevant developments missed | 8 | 0 |
| Noise admitted | 2/6 | 0/6 |
| Noise correctly excluded | 4/6 | 6/6 |

The reference implementation was read from the baseline Git tree and executed with identical inputs, not manually approximated. These are regression-fixture measurements, not measured production precision/recall or proof of broader live acquisition. Tests also assert equal significance for major pro injuries versus school/regional championships, conservative duplicate suppression and follow-up retention.

## Validation and rollout

Run root tests/sports alias/typecheck/lint/production build, worker tests/typecheck, and Drizzle chain check. Local integration uses synthetic fetch responses and isolated actual Wrangler D1; browser checks cover owner diagnostics, score guidance, preview/filters, signed-out editorial/public pages and mobile widths. Final PR evidence records executed counts and remote CI.

No new migration, dependency, secret, binding, paid API, recurring AI call, cron change, request-frequency increase, deployment or publishing automation. Existing migration0005 must be present before discovery; reports enrich its JSON in place. At most **seven enabled requests** now; all other budgets remain unchanged. D1 statement count is unchanged. No extra calls are made to diagnose a failed source.

The production release prerequisites in [Phase4D's runbook](phase-4d-release-readiness.md) still apply. Revalidate deployed Access/Worker egress and source licensing through authorized operator access. No production claims should be inferred from synthetic integration success. Public wire licensing and verified new high-school/college acquisition remain explicit limitations.

### Executed validation

- Root suite: **181 passed**, zero failures/skips, including **28 feed tests**. Sports alias repeats the same suite successfully (not additional unique tests).
- Jobs worker: **37 passed**; worker and root type checks passed.
- Lint: zero errors, existing unrelated unused `weekOddsBoards` warning only.
- Production build passed and generated both Cloudflare `index.mjs` and OpenAI wrapper/hosting assets. Drizzle chain check passed; no SQL/schema/dependency/lockfile changes.
- Isolated actual Wrangler D1 UUID `00000000-0000-0000-0000-00000000004e`: existing migrations applied locally; **14 workflow assertions** passed for access, priority pagination, manual approval/rejection and visibility, report persistence, failures and cooldown. Separate later runs inserted three deferred candidates, then zero repeats; two sources retained three-attempt failure streaks.
- Chromium: **19 assertions** passed across owner/signed-out desk, health counts/current-score explanation, preview/filters, repeated failures and 320/390px layout, plus public `/` and `/news` without private diagnostics. The signed-out public-page checks used a local-only wrapper returning synthetic empty upstream responses. With actual workerd outbound networking, the original homepage navigation timed out while ESPN DNS failed; its server response eventually completed HTTP200 after about 32 seconds. Live public data and deployed behavior are not claimed passed. The local harness/configuration is outside the repository, with AI/Apify disabled and no production identifiers.

### Standards

Independent full-diff review found zero material documented-standard violations, correctness/security blockers or blocking refactoring concerns. The reviewer independently ran all 28 feed tests. Auth, PENDING-only writing, append-only migration history and existing budgets are intact.

### Spec

Independent full-diff review found zero code blockers. Explicit partial requirements: no new remote source activation or proof of wider live acquisition; production behavior remains unverified due unavailable authorization/network access. The fixture results establish recognition/classification improvement only.

Review totals: Standards **0 open findings**; Spec **0 open code findings**, with the external acquisition/production limitations retained.
