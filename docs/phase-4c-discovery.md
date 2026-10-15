# Phase 4C: editorial discovery priority

## Scope and baseline

Based on `dbcb701` (master's merge of PR #42). This changes candidate guidance and the owner-only pending queue. Approval stays manual. Public feed ordering, production data, deployment configuration, AI calls and disabled Apify discovery are unchanged.

The manual desk action uses legacy X syndication/oEmbed against the curated account list in `discovery.ts`; the operator CLI and bot ingest use editorial JSON. Paid scheduled X discovery has separate legacy heuristics in the jobs worker and remains disabled. The public RSS/news wire is separate from these candidate intake paths. This work does not add sources or expand small-school acquisition: it gives relevant school and regional stories full credit when supplied.

## Ranking

`priority.ts` computes a bounded 0–100 score with explicit signals:

- Base 15; a recognized PA team/location/association adds 25; an unconfirmed PA connection subtracts 15.
- Official and original reporting add 18; publications add 12. Verified official sources add 3. No bonus depends on audience size or professional league status.
- Roster/availability/accountability developments or competitive milestones add 25; ordinary results add 12. Preview/opinion subtracts 12.
- Freshness adds 12 within 6 hours or 7 within 24 hours; subtracts 15 after 36 hours and 30 after 72 hours. Missing/invalid or more-than-one-hour-future times subtract 8.
- Unconfirmed language subtracts 25; promotion/gambling language subtracts 85. Aggregators remain capped at 25. Scores below 20 are discarded.

Operator relevance/breaking hints may adjust a score up to 15 points above the deterministic score, still subject to the aggregator cap. They cannot rescue the fixture promotion. Labels/categories do not manufacture significance. These are heuristics for review, not fact verification or a learned semantic model; vocabulary will need editorial calibration.

Pending rows sort by stored discovery score **in SQL before pagination**, then update time and id. The All view keeps pending first; non-pending views retain update-time order. Scores are not retroactively backfilled or continuously decayed. Freshness signals on the desk are recomputed from the headline/timestamp at read time, so they describe current signals rather than an exact historical score breakdown. Existing unscored rows sort as zero. Newly issued keyset cursors carry the priority tie-breaker; pre-upgrade cursors are rejected with a reload instruction rather than silently skipping scored rows; stable datasets are covered across 240 rows with score ties and nulls.

Manual X discovery derives creation time from the X snowflake ID instead of treating discovery time as publication time. Missing oEmbed content yields an explicit error instead of a placeholder candidate. For editorial JSON with no valid timestamp, scoring penalizes unknown time, but the existing storage contract still uses intake time as the timestamp; operators should supply source publication time.

## Duplicate and related coverage

Canonical URL/provider fingerprints remain the hard dedupe key, even when a caller supplies an additional fingerprint. Global lookup derives provider keys from every stored URL as well as retaining custom keys, so an old X/Twitter or YouTube alias remains a duplicate outside the recent-headline window. Tracking URLs and X/Twitter URL forms retain their existing normalization. Near-identical headline matching requires the same explicit team and publication times within 48 hours, at least five informative words, and identical ordered informative tokens after removing punctuation, articles and day wrappers. Changed participants, word relationships, numbers, negations or development terms remain available for review. Complete source headlines are preserved for matching and storage; a shared first 140 characters cannot suppress a later material development. Historical headlines ending in an ellipsis are treated as incomplete evidence and can only suggest related coverage across different URLs. Candidates are scored before headline suppression so the stronger source represents syndicated coverage.

Overlapping coverage (token overlap >= 0.4 in the same team/time window) is labeled related and retained. Both manual entry points and bot ingest compare against at most the 500 latest rows from the last 48 hours; global URL fingerprints have no such window. Related links are advisory. Headlines without team tags, paraphrases and older events can remain duplicates for editors to resolve. No migration or production cleanup is performed.

## Fixed-time 20-story comparison

Fixture: `tests/fixtures/beat-discovery-20.json`, evaluated at **2026-10-14 16:00 UTC**. Old scores/ranks come from PR #42's actual scorer at `dbcb701`; new ranks use the normalized, deduplicated candidate result. Synthetic stories are examples, not claims about real events.

| Candidate | Before rank / score | After rank / score |
| --- | ---: | ---: |
| Eagles official jersey giveaway: win tickets tonight | 1 / 80 | discarded |
| Phillies fans react to a fun clubhouse dance | 2 / 80 | 12 / 73 |
| Eagles quarterback Jalen Hurts ruled out after concussion | 3 / 80 | 2 / 95 |
| Harrisburg wins PIAA state championship in overtime | 16 / 55 | 8 / 89 |
| Kutztown clinches PSAC championship and NCAA playoff berth | 4 / 80 | 1 / 98 |
| Erie Otters coach fired after investigation | 17 / 55 | 7 / 89 |
| Lakers trade veteran center to Suns | 10 / 65 | 14 / 55 |
| Rumor: Eagles could be trading star receiver | 20 / 20 | 16 / 25 |
| Steelers sign veteran linebacker to active roster | 5 / 80 | 13 / 56 |
| Pirates acquire starting pitcher in trade | 11 / 65 | 5 / 95 |
| Eagles quarterback Jalen Hurts ruled out after concussion | 8 / 70 | duplicate suppressed |
| Eagles quarterback Jalen Hurts cleared after concussion, returns to practice | 12 / 65 | 3 / 95 |
| Eagles quarterback Jalen Hurts ruled out after concussion | 6 / 80 | duplicate suppressed |
| Penn State game preview: five things to watch | 18 / 55 | 15 / 47 |
| Pitt coach discusses practice in postgame interview | 7 / 80 | 11 / 73 |
| Scranton wins district championship to reach PIAA final | 19 / 55 | 6 / 89 |
| Flyers beat Penguins 4-2 in season opener | 13 / 65 | 10 / 82 |
| Temple athletics faces NCAA investigation into recruiting violations | 14 / 65 | 4 / 95 |
| Eagles quarterback Jalen Hurts ruled out Sunday after concussion | 9 / 70 | duplicate suppressed |
| Flyers beat Penguins 5-2 in season opener | 15 / 65 | 9 / 82 |

The fixture yields 16 candidates, three duplicate skips and one promotion discard. Medical clearance and a changed game result survive as related follow-ups. `node --test tests/beat-discovery-intelligence.test.mjs` verifies the priorities, bounded hints, freshness, entity/number/negation safeguards, existing-story comparisons, and manual discovery age/content behavior. `tests/beat-editor-queue.test.mjs` executes the generated queue SQL against real in-memory SQLite.

## Verification and environment

Use the normal root checks: `npm test`, `npm run lint`, `npm run build`, then `npm run typecheck`; worker checks are `npm test` and `npm run typecheck` under `workers/keystone-beat-jobs`. `test:sports` is an alias of the same root suite.

For browser validation, use an isolated **local** Wrangler configuration and D1 state with synthetic stories, a fixture owner identity, and AI disabled. Never point fixture commands at the production database. Check priority explanations, related links, empty-state/status filters, preview, mobile overflow, and anonymous access denial. No actual stories need to be approved/rejected/published to validate these flows.

The six upstream skills are installed outside this repository in `$HOME/.agents/skills`; agent-browser uses the existing Chromium. The cloud environment draft saves pinned upstream revisions and a repeatable installer. Publication and automatic discovery in a fresh task must be verified separately; files in the current task alone do not establish persistence. GitHub API access is separately required for PR creation, even when Git clone/push works.
