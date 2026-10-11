# Keystone Beat outside Grok

The default build runs Keystone Beat as a Cloudflare module Worker on Sites. It does not require the Grok preview host or a Grok subscription. A separate `vite.config.ts` is retained for local dev/preview (nitro `vercel` preset); the production build uses `vite.standalone.config.ts`.

## Using the site

- Scores, teams, news, calendar and odds use sports feeds without an AI key.
- Select My Teams to personalize the board in the current browser.
- Open a game for available statistics and player highlights. Pregame cards offer calendar downloads; scheduled times can change.
- `/editor` is the owner publishing dashboard. Save drafts, publish updates, or unpublish them. Published items appear to people who can access the site. The initial deployment is private to the owner.
- `/desk` is My Notes: personal notes stored only in the current browser. They are separate from shared publishing; export them for a backup.

## Configuration

Sites supplies the `DB` D1 binding and applies the SQL migrations in `drizzle/`. Published posts and drafts use this database. Owner access is enforced on the server using Cloudflare Access (`Cf-Access-Authenticated-User-Email`) matched to `KEYSTONE_ADMIN_EMAIL` (already set for the verified owner). Put Access in front of `/editor` (and optionally `/desk`) on the Worker; public score pages stay open. Do not trust identity headers on an unprotected Worker. Legacy ChatGPT host headers are only recognized as a fallback when present.

AI is optional. The production Worker already has `KEYSTONE_AI_ENABLED=true` and defaults to OpenAI `gpt-5-nano` at `https://api.openai.com/v1`. Enable spending by setting the server secret `AI_API_KEY` (an OpenAI platform key) and redeploying. Keep keys out of browser code and out of git. OpenAI usage bills against that account; cap the project at $5 in the OpenAI dashboard so the trial credit cannot overspend. Manual recaps from `/editor` are capped at five per owner per day and fifty site-wide. The 01:00 UTC cron writes one draft only when that New York date has completed games and no auto draft already exists. Recaps use fetched game facts; unavailable feeds skip generation instead of guessing.

## Development and deployment

1. `npm ci`
2. `npm run typecheck`
3. `npm run test:sports`
4. `npm run build`

The independent configuration is `vite.standalone.config.ts`; deployable output is in `dist`. The Sites manifest retains this site's identity. Use the Sites build and packaging helpers, push the exact source commit, save a version, then deploy that version. Do not create a new site for routine updates. A raw Vite development server cannot supply Cloudflare's D1 binding or trusted identity; use the hosting runtime for database-backed flows.

## Verification and limits

The `tests/` suite covers cache expiry, empty results, request coalescing, doubleheaders, dates, recap fact isolation, historical score requests, owner authorization, calendar formatting, and Beat ingest hardening. Type checking and a production build pass. Production Worker HTTP rendering was checked with fixture feeds and an in-memory database. This is not a live-feed, browser-layout, or paid xAI integration test. Feed availability, statistics, broadcasts, and odds vary by league and provider. Delay indicators show when upstream retrieval fails.
