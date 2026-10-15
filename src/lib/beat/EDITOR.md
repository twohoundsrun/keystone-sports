# Beat editor / Access admin (M2+)

Public `/news` must keep working if this surface or Cloudflare Access is down.

## Gate

Same owner gate as `/editor`:

- `KEYSTONE_ADMIN_EMAIL` wrangler var
- Cloudflare Access email header `cf-access-authenticated-user-email`
- Admin route: `/editor/beat` (`noindex`)

If Access is unavailable, visitors see a locked message; News RSS + Film Room are unaffected.

## Controls (D1-backed)

| Control | Behavior |
| --- | --- |
| **Approve** | `pending` → `approved` (+ `approvedBy` / `approvedAt`). Requires a verified Pennsylvania consequence in context; Breaking also requires `expiresAt`. |
| **Reject** | Hide from public feed (`rejected`) |
| **Edit context** | Change Keystone Beat caption / desk note only |
| **Change category** | Breaking / From the beat / Watch / Locker room / Reaction |
| **Pin / Unpin** | Float above editorial sort within public list |
| **Set expiration** | Set or clear `expiresAt` |
| **Open original** | Deep-link `originalUrl` |
| **Preview** | Side panel metadata + embed URL |
| **Run feed discovery** | Retained RSS/Atom → Phase 4C score/dedupe → at most ten **pending** candidates. One run per ten minutes, including dry-runs; owner-only report. Never auto-publishes |

## Bot ingest (M3)

Operator bots POST candidates as **PENDING only** (never auto-publish):

- `POST /api/editor/beat/ingest` — body `{ "candidates": [ ... ] }`
- `GET|POST /api/editor/beat/ingest/check` — duplicate lookup by `originalUrl` / fingerprint
- Auth: `Authorization: Bearer <KEYSTONE_BEAT_INGEST_SECRET>` or `X-Keystone-Secret` (header only; never `?secret=`)
- Set secret: `wrangler secret put KEYSTONE_BEAT_INGEST_SECRET` (value never in repo)

Discovery scoring bands: 90–100 breaking, 75–89 injuries/trades, 55–74 strong reporting, 35–54 interviews/highlights, 20–34 locker-room, <20 discard.

CLI: `npm run beat:discover -- --input candidates.json` (preferred). Native Grok/X discovery runs outside the Worker.

## Storage

- Table: `beat_items` (migration `0002_beat_items`)
- Public reads: approved + unexpired from D1 only
- Fixtures (`beat-poc.json`) stay for tests/dev — never on the production public path

## Feature flag

`KEYSTONE_BEAT_M1` gates the public Beat strip on `/news`.


## Feed discovery (Phase 4D)

Apply migration `0005_beat_discovery_state` before running the new default acquisition path. `POST /editor/beat?beatAction=discover` defaults to RSS; `mode: "legacy_x"` explicitly retains the old free X fallback. The TanStack server action uses the same feed service. No schedule was added or changed. Dry-runs update observation metadata/cooldown but never insert cards; a subsequent run within ten minutes returns the last report without fetching or inserting. Source-level Retry-After can extend that cooldown for a particular feed.

The collapsed feed report is owner-only. Counts describe observed feed activity, failure, stale/invalid timestamps, filtering, duplicates and request-budget deferrals. “No dedicated source” is a registry gap, not evidence that an important event was missed. Update timestamps link to originals for review and never reset original publication age. New/unverified sources must pass live access/content/terms checks before activation; see `docs/phase-4d-discovery.md`.
