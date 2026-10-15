# Phase 4D — coverage-aware editorial feed discovery

## Baseline and architecture audit

The feature branch starts at master `3a412d41de316c07f704bd43cb8cea90304c66a0`. Git confirms PR #42 merged at `dbcb701`, PR #44 at `4772319`, and PR #45 at `3a412d4` (parent `59e32e4`). Thus the follow-up fixes are already in the baseline; this branch does not depend on an open PR #45. GitHub API requests are still proxy-denied, so merge evidence comes from actual remote Git commits/parents rather than API status.

| Mechanism before this change | Code/config | Actual status supported by evidence |
| --- | --- | --- |
| Operator JSON → normalization/Phase 4C score/dedupe → secret-authenticated ingest → pending D1 | `scripts/beat-discover.mjs`, `discovery.ts`, `ingest.server.ts`, `/api/editor/beat/ingest` | Implemented and locally tested. Whether an external operator bot runs is unknown; a comment naming Grok is not an operational integration. |
| Owner discovery button → curated X timelines → oEmbed → pending D1 | Both Access middleware and TanStack action | Manual; 12 curated accounts, mostly major pro teams, Penn State/Pitt football, two Eagles reporters. Legacy code explicitly warns of 429s. No successful live X retrieval established here. |
| ESPN + MLB StatsAPI scores/news, RSS wire and optional Reddit buzz | `src/lib/sports/server.ts`, `sports/beat.ts` | Public request-time read paths with caching/timeouts. These did not feed the editorial pending queue. Runtime/source availability is unverified in this environment. |
| Nine curated public-wire RSS endpoints | `BEAT_FEEDS` | Existing code calls these real endpoints. This review could not revalidate them; every attempted CONNECT was denied by the cloud proxy. Existence in the registry is not proof of operation. |
| Paid Apify X discovery worker | `workers/keystone-beat-jobs` | Disabled in checked-in config (`KEYSTONE_APIFY_ENABLED=false`). Source filters and scoring remain separate legacy worker code. No activation or paid call. |
| Expiration worker | jobs worker cron `15 * * * *` | Configured hourly, expire-only. Deployment/runtime execution is not claimed from config alone. Frequency unchanged. |
| AI recap draft job | main worker cron `0 1 * * *` | Separate opt-in/secret-gated workflow, not discovery. Unchanged and not invoked. |

The six official development skill packages remain outside the repository. Relevant guidance was used for diagnosis/regression fixtures, React/UI review, code review and browser tests. No skill implementation files are vendored here.

## Coverage audit

- **Professional:** X registry covers the eight named major teams, but reporters are heavily Philadelphia/Eagles weighted. RSS has explicit Eagles/Steelers/Phillies/Pirates feeds; 76ers, Penguins, Flyers and Union depend on general coverage or operator input.
- **College:** dedicated existing feed/account coverage is mainly Penn State, with a Pitt football X account. Temple, Villanova, Lehigh, Lafayette, Bucknell, Duquesne, Saint Joseph’s and smaller NCAA programs lack verified dedicated editorial acquisition. Their announcements can be recognized from a general feed/operator input, but that is not proof of adequate acquisition.
- **High school:** no dedicated verified PIAA/district intake. A general publication may carry stories; no candidates does not prove a championship or important result was missed.
- **Regional/minor league:** no dedicated verified RailRiders, IronPigs, SeaWolves or Senators intake. Prior keyword coverage was incomplete, and college words could obscure regional identities such as Lehigh Valley IronPigs.
- **Freshness/reliability:** manual X did not expose per-source health. Missing feeds, valid-but-old feeds, malformed responses and a quiet competition season were not distinguished at the editorial acquisition layer.

The implementation adds entity recognition for these schools, high-school competition markers, regional teams and additional Pennsylvania NCAA programs. It uses the Phase 4C score and its significance predicates, including coaching departures and national-tournament qualification. It does not award audience-size bonuses or create stories to meet quotas.

## Implementation

```
Owner manual request
  → durable D1 cooldown / source Retry-After
  → retained RSS/Atom sources (bounded fetch + validated XML metadata)
  → publication-time / PA coverage / significance eligibility
  → existing Phase 4C score + URL/headline/related-story matching
  → existing race-safe PENDING-only writer
  → priority queue + collapsed owner-only last-run report
```

Both owner entry points now default to this feed service. Explicit `mode: "legacy_x"` preserves the old free X path, and the operator JSON CLI/bot endpoint remain supported. No new scheduled discovery was added.

`feed-parser.ts` uses pinned `fast-xml-parser@5.11.2` rather than scraping article HTML. It imports title, original HTTPS URL and timestamps only; it does not fetch article pages, reproduce bodies, copy images, download video, follow paywalls or bypass authentication. HTML responses, invalid XML, DTD/entity declarations, credential-bearing/unsafe links and absent RSS/Atom structure are rejected. Missing/ambiguous timestamps never become intake time. Atom `updated` does not stand in for `published`.

All eligible source candidates pass through the same Phase 4C normalizer, scoring and conservative duplicate/related handling. The new acquisition gate only asks whether the existing model recognizes an editorial development; it does not add another ranking model. Complete titles and attribution are retained. New URLs with important changed facts survive matching. A known URL with a source update remains a duplicate, with its original link/update timestamp reported for human inspection; existing approved/pending content is not silently rewritten.

## Source inventory and access evidence

All probes in this task used ordinary public GETs with TLS verification. Every probe below failed at the cloud proxy with CONNECT HTTP 403, before a source response could be inspected. No live source XML, terms page or robots policy was available. This is an environment access limitation, not evidence that the publishers are down or do not support feeds.

### Retained destinations now connected to manual editorial discovery

| Registry source | Existing endpoint | Coverage / reason |
| --- | --- | --- |
| Eagles.com | `https://www.philadelphiaeagles.com/rss/news` | Existing official pro wire source; retain attribution. |
| Steelers.com | `https://www.steelers.com/rss/news` | Existing official western-PA pro wire source. |
| Phillies | `https://www.mlb.com/phillies/feeds/news/rss.xml` | Existing official MLB wire source. |
| Pirates | `https://www.mlb.com/pirates/feeds/news/rss.xml` | Existing official western-PA MLB wire source. Same host/path family retained; individual Pirates endpoint was not separately probed here. |
| GoPSU | `https://gopsusports.com/rss` | Existing official college wire source. |
| PennLive PSU | `https://www.pennlive.com/arc/outboundfeeds/rss/category/pennstate/?outputType=xml` | Existing publication feed, restricted to its Penn State category. |
| Inquirer sports | `https://www.inquirer.com/arc/outboundfeeds/rss/category/sports/?outputType=xml` | Existing general sports wire source. Only feed metadata/original links; no paywalled article fetch. |
| NBC Sports Philadelphia | `https://www.nbcsportsphiladelphia.com/feed/` | Retained existing general source; no successful live check in this task. |
| Crossing Broad | `https://www.crossingbroad.com/feed` | Retained existing general source; no successful live check in this task. |

There are **zero new remote destinations activated**. Nine existing public-wire sources gain an editorial intake path. Their live behavior and licensing/access requirements need revalidation from a permitted network before operational claims or expansion.

### Proposed additions deliberately not activated

| Proposed organization | Investigated public location | Decision |
| --- | --- | --- |
| Lehigh athletics | `https://lehighsports.com/rss.aspx` | Proxy denied. Candidate URL only; feed format, content, access and terms unverified. Not added. |
| Lafayette athletics | `https://goleopards.com/rss.aspx` | Same limitation; not added. |
| Bucknell athletics | `https://bucknellbison.com/rss` | Same limitation; not added. |
| Duquesne athletics | `https://goduquesne.com/rss.aspx` | Same limitation; not added. |
| Saint Joseph’s athletics | `https://sjuhawks.com/rss.aspx` | Same limitation; not added. |
| Pitt athletics | `https://pittsburghpanthers.com/rss.aspx` | Same limitation; not added. |
| PIAA | `https://www.piaa.org/` | Proxy denied even the public homepage. No supported feed established; do not invent an RSS URL. |
| IronPigs / MiLB | `https://www.milb.com/lehigh-valley/feeds/news/rss.xml` | Proxy denied; candidate endpoint not assumed to work. Not added. |
| Other district/college/minor-league sites | No verified endpoint | Registry gaps remain explicit. Validate an officially advertised feed and access/terms before adding it. |

Unavailable sources are not replaced with fragile scraping, unlicensed mirrors, subscriptions or paid AI. The source type also supports a disabled/pending verification status; tests prove such a source is never requested.

## Freshness, reporting and cost controls

- Maximum nine destinations, three concurrent requests, 3.5-second timeout through body reading, 256 KiB per response, first 100 parsed entries per source. No redirects are followed without registry review, and no immediate retries occur.
- A D1 conditional claim applies a **ten-minute shared cooldown**, including dry-runs. This is a manual-action request limit, not a cron-frequency change. A dry-run updates diagnostic metadata but inserts no cards; a subsequent request during cooldown returns the saved report without fetching or inserting. In-progress runs may not yet have a report.
- Source `Retry-After` dates/seconds are saved and honored on later runs even after the shared cooldown expires. One bounded latest report/lease row is stored; no historical dashboard, cleanup job or recurring poller is added.
- Publication age stays original. Articles older than 72 hours, undated/ambiguous dates, and more than five minutes in the future are excluded. Updates are evidence for inspecting an original, not permission to re-age it or rewrite it. Routine posts and out-of-coverage stories are filtered before scoring.
- Up to eight eligible entries per source are considered, newest first. Phase 4C ranks the combined unique candidates; at most **ten inserts per run** fit the conservative request/query budget. Additional candidates are explicitly reported as deferred. A later run dedupes already inserted candidates and can admit the remainder.
- Worst-case planned discovery work is nine HTTP fetches plus about 36 D1 statements (three writer statements per candidate, six coordination/global reads/writes), below a conservative 50-operation budget. Dry-run work is lower. Owner queue reads add one small report lookup. Existing global fingerprint scans remain a scalability limit at very large archive sizes.
- Reports distinguish unavailable, malformed, empty, stale, disabled/backoff sources; observed/eligible/selected counts; timestamp/routine/out-of-area rejections; duplicate-heavy runs; relevance discards; budget deferrals; and missing dedicated coverage sources. These are evidence about acquisition, not assertions that a particular event was missed.
- **No paid API, new secret, recurring AI usage, subscription, cron change, Apify activation or automatic publication.** One XML parser dependency adds eight packages, with no existing locked package versions upgraded. npm regenerated optional/peer metadata; frozen-lockfile installation was tested.

The existing public news wire is unchanged. Its separate parsing/dedupe behavior is not silently replaced by editorial logic.

## Deterministic comparison and validation

`tests/fixtures/phase4d-feeds.json` contains 22 synthetic RSS items across eight fixture sources. It includes pro injury/roster news, Penn State/Pitt, Bucknell/Saint Joseph’s, PIAA/district results, four minor-league teams, a duplicate across sources, a meaningful injury follow-up, old/updated reports, malformed/missing/future timestamps, routine/promo content, an out-of-state story, an XML failure and a 503 outage. Tests also exercise Atom, redirects, size/time limits, Retry-After, concurrent cooldown claims, dry-runs and same-URL updates.

| Measured fixture behavior | Before Phase 4D | After |
| --- | --- | --- |
| RSS-to-editorial acquisition path | None; wire feed items did not enter pending discovery | Actual parser → Phase 4C → pending writer |
| First-run synthetic candidates | 0 from this RSS path | 10 pending across all four areas; three further candidates reported deferred |
| Second run after cooldown | No RSS intake | Remaining three inserted; prior candidates deduped |
| Repeated run during cooldown | No shared RSS mechanism | No fetches or inserts |
| Duplicate/promotion control | No editorial RSS observation | One repeated report suppressed; one promo discarded by Phase 4C |
| Old, undated, malformed/future-time and out-of-state reports | No editorial RSS diagnostics | Excluded with reason counts |
| Source failures | Not represented in editorial discovery health | Two fixture failures and one stale feed reported without aborting other sources |
| Ownership/publication | Existing owner gate/manual approval | Preserved and tested; report stays owner-only |

These results prove fixture behavior, **not that the real feeds currently work or that live coverage breadth has already improved**. The next operational step is live verification of retained and proposed sources from a permitted network.

Integration uses an isolated Wrangler/D1 database (`00000000-0000-0000-0000-00000000004d`), a local-only fixture-fetch wrapper outside the repository, and the actual production build reading the same local D1 state. No production database, live publishing service, paid service or deployment is touched. Unit tests also execute real generated queue SQL against SQLite.

Run `npm test`, `npm run test:sports` (same suite), `npm run lint`, `npm run build`, `npm run typecheck`, plus the jobs worker's tests/typecheck. Browser checks cover the owner report, partial outages, cached discovery, filters, preview, signed-out restrictions and mobile layout. Final results and the PR description record the executed counts.

## Review/deployment implications

Apply the new generated migration `0005_beat_discovery_state` through the normal reviewed release process before using feed discovery. The queue can still be read if the report table is absent; the old explicit X mode is retained. This task does not apply a production migration or deploy.

The cloud network proxy currently prevents GitHub API access as well as source checks, even though Git fetch/push work. If PR creation remains blocked, use the pushed branch comparison link. New-source activation and live Cloudflare Access policy verification remain separate follow-up work; do not mistake passing local synthetic tests for those checks.
