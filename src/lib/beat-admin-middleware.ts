import { createMiddleware } from '@tanstack/react-start';
import { z } from 'zod';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });

const categorySchema = z.enum(['breaking', 'from_the_beat', 'watch', 'locker_room', 'reaction']);
const sourceTierSchema = z.enum(['official_team_league', 'reporter_original', 'broadcaster_publication', 'aggregator']);
const isoOrNull = z.union([
  z.string().refine((value) => Number.isFinite(Date.parse(value)), 'Invalid expiration'),
  z.null(),
]);

const createSchema = z.object({
  source: z.string().trim().min(1).max(120),
  sourceTier: sourceTierSchema,
  authorAccount: z.string().trim().min(1).max(120),
  teamSlug: z.string().trim().max(40).nullable().optional(),
  category: categorySchema,
  headline: z.string().trim().min(1).max(240),
  context: z.string().trim().max(2000).optional(),
  originalUrl: z.string().url().max(500),
  verifiedOfficial: z.boolean().optional(),
  expiresAt: isoOrNull.optional(),
});

const discoverSchema = z.object({
  dryRun: z.boolean().optional(),
  perAccountLimit: z.number().int().min(1).max(5).optional(),
});

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message || 'Invalid Beat request.';
}

async function ownerFromRequest(request: Request): Promise<
  | { ok: true; id: string; adminConfigured: boolean; aiEnabled: boolean }
  | { ok: false; response: Response }
> {
  const { runtime } = await import('@/lib/publishing/runtime.server');
  const env = runtime();
  const configuredEmail = env.KEYSTONE_ADMIN_EMAIL?.trim().toLowerCase();
  if (!configuredEmail) {
    return { ok: false, response: json({ ok: false, error: 'Beat desk owner email is not configured.' }, 503) };
  }

  const accessEmail = request.headers.get('cf-access-authenticated-user-email')?.trim().toLowerCase();
  if (accessEmail) {
    if (accessEmail !== configuredEmail) {
      return { ok: false, response: json({ ok: false, error: 'Only the configured owner can use the Beat desk.' }, 403) };
    }
    return {
      ok: true,
      id: `access:${accessEmail}`,
      adminConfigured: true,
      aiEnabled: env.KEYSTONE_AI_ENABLED === 'true' && Boolean(env.AI_API_KEY),
    };
  }

  const oaiId = request.headers.get('oai-authenticated-user-id')?.trim();
  const oaiEmail = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  if (oaiId && oaiEmail === configuredEmail) {
    return {
      ok: true,
      id: oaiId,
      adminConfigured: true,
      aiEnabled: env.KEYSTONE_AI_ENABLED === 'true' && Boolean(env.AI_API_KEY),
    };
  }

  return { ok: false, response: json({ ok: false, error: 'Cloudflare Access owner identity is missing.' }, 401) };
}

async function parseJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return { ok: false, response: json({ ok: false, error: 'Content-Type must be application/json.' }, 415) };
  }
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, response: json({ ok: false, error: 'Invalid JSON.' }, 400) };
  }
}

/**
 * Beat Desk actions intentionally use the exact /editor/beat route. Cloudflare
 * Access already protects that page, so admin actions do not depend on wildcard
 * coverage for nested API paths or TanStack server-function endpoints.
 */
export const beatAdminMiddleware = createMiddleware({ type: 'request' }).server(async ({ request, next }) => {
  if (!request) return next({});

  const url = new URL(request.url);
  if (url.pathname !== '/editor/beat') return next({});

  const operation = url.searchParams.get('beatAction');
  if (!operation) return next({});

  const owner = await ownerFromRequest(request);
  if ('response' in owner) return owner.response;

  const method = request.method.toUpperCase();

  if (operation === 'desk') {
    if (method !== 'GET') return json({ ok: false, error: 'GET only.' }, 405);
    try {
      const { db, runtime } = await import('@/lib/publishing/runtime.server');
      const { listBeatItems, listPublicBeatRows } = await import('@/lib/beat/db.server');
      const { selectPublicBeatItems } = await import('@/lib/beat/order');
      const { readBeatM1Flag } = await import('@/lib/beat/flag');
      const database = db();
      const [adminItems, publicRows] = await Promise.all([
        listBeatItems(database),
        listPublicBeatRows(database),
      ]);
      return json({
        ok: true,
        access: {
          signedIn: true,
          admin: true,
          adminConfigured: owner.adminConfigured,
          aiEnabled: owner.aiEnabled,
        },
        desk: {
          enabled: readBeatM1Flag(runtime() as unknown as Record<string, unknown>),
          generatedAt: new Date().toISOString(),
          items: selectPublicBeatItems(publicRows),
          adminItems,
          source: 'd1',
        },
      });
    } catch {
      return json({ ok: false, error: 'The Beat desk is temporarily unavailable.' }, 500);
    }
  }

  if (operation === 'mutate') {
    if (method !== 'POST') return json({ ok: false, error: 'POST only.' }, 405);
    const parsedBody = await parseJson(request);
    if (!parsedBody.ok) return parsedBody.response;
    try {
      const { db } = await import('@/lib/publishing/runtime.server');
      const { mutateBeatItemForAdmin } = await import('@/lib/beat/mutate.server');
      return json({ ok: true, ...(await mutateBeatItemForAdmin(db(), owner.id, parsedBody.body)) });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'Beat item not found.') return json({ ok: false, error: message }, 404);
      if (/required|invalid|expiration|too_big|too_small/i.test(message)) {
        return json({ ok: false, error: message || 'Invalid Beat action.' }, 422);
      }
      return json({ ok: false, error: message || 'The Beat action failed.' }, 500);
    }
  }

  if (operation === 'create') {
    if (method !== 'POST') return json({ ok: false, error: 'POST only.' }, 405);
    const parsedBody = await parseJson(request);
    if (!parsedBody.ok) return parsedBody.response;
    const parsed = createSchema.safeParse(parsedBody.body);
    if (!parsed.success) return json({ ok: false, error: firstIssue(parsed.error) }, 422);

    try {
      const { db } = await import('@/lib/publishing/runtime.server');
      const { upsertBeatItem } = await import('@/lib/beat/db.server');
      const { classifyBeatMedia, normalizeBeatUrl } = await import('@/lib/beat/allowlist');
      const { beatDuplicateFingerprint } = await import('@/lib/beat/fingerprint');
      const data = parsed.data;
      const originalUrl = normalizeBeatUrl(data.originalUrl) ?? data.originalUrl;
      const media = classifyBeatMedia(originalUrl);
      const now = new Date().toISOString();
      const result = await upsertBeatItem(db(), {
        source: data.source,
        sourceTier: data.sourceTier,
        authorAccount: data.authorAccount,
        teamSlug: data.teamSlug ?? null,
        category: data.category,
        headline: data.headline,
        context: data.context,
        originalUrl,
        embedUrl: media.embedUrl,
        embedId: media.embedId,
        timestamp: now,
        mediaType: media.mediaType,
        verifiedOfficial: data.verifiedOfficial,
        expiresAt: data.expiresAt ?? null,
        approvalStatus: 'pending',
        approvalMode: 'manual',
        approvedBy: null,
        approvedAt: null,
        pinned: false,
        duplicateFingerprint: beatDuplicateFingerprint({
          originalUrl,
          teamSlug: data.teamSlug,
          headline: data.headline,
        }),
        createdBy: owner.id,
      });
      return json({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      return json({ ok: false, error: message || 'Could not save that Beat candidate.' }, 500);
    }
  }

  if (operation === 'discover') {
    if (method !== 'POST') return json({ ok: false, error: 'POST only.' }, 405);
    const parsedBody = await parseJson(request);
    if (!parsedBody.ok) return parsedBody.response;
    const parsed = discoverSchema.safeParse(parsedBody.body ?? {});
    if (!parsed.success) return json({ ok: false, error: firstIssue(parsed.error) }, 422);

    try {
      const { db } = await import('@/lib/publishing/runtime.server');
      const { existingBeatFingerprints, upsertBeatItem } = await import('@/lib/beat/db.server');
      const { discoverPaBeatCandidates } = await import('@/lib/beat/discovery');
      const database = db();
      const fingerprints = await existingBeatFingerprints(database);
      let newsUrls: string[] = [];
      try {
        const news = await database
          .prepare('SELECT body FROM posts WHERE published = 1 ORDER BY updated_at DESC LIMIT 50')
          .all<{ body: string }>();
        newsUrls = news.results
          .flatMap((row) => row.body.match(/https?:\/\/[^\s)]+/g) ?? [])
          .slice(0, 100);
      } catch {
        // News rows are optional for discovery dedupe.
      }

      const discovered = await discoverPaBeatCandidates({
        existingFingerprints: fingerprints,
        newsUrls,
        perAccountLimit: parsed.data.perAccountLimit ?? 2,
      });

      if (parsed.data.dryRun) {
        return json({ ok: true, dryRun: true, inserted: 0, ...discovered });
      }

      let inserted = 0;
      for (const candidate of discovered.candidates) {
        try {
          await upsertBeatItem(database, {
            source: candidate.source,
            sourceTier: candidate.sourceTier,
            authorAccount: candidate.account,
            teamSlug: candidate.teamSlug,
            league: candidate.league,
            category: candidate.categoryRecommendation,
            headline: candidate.headline,
            context: candidate.suggestedContext,
            originalUrl: candidate.originalUrl,
            embedUrl: candidate.embedUrl,
            embedId: candidate.embedId,
            oembedHtml: candidate.oembedHtml,
            timestamp: candidate.timestamp,
            mediaType: candidate.mediaType,
            verifiedOfficial: candidate.verifiedOfficial,
            expiresAt: candidate.proposedExpiration ?? null,
            approvalStatus: 'pending',
            approvalMode: 'manual',
            relevanceScore: candidate.relevanceScore,
            duplicateFingerprint: candidate.duplicateFingerprint,
            createdBy: `discover:${owner.id}`,
          });
          inserted += 1;
        } catch (error) {
          discovered.errors.push(error instanceof Error ? error.message : String(error));
        }
      }

      return json({ ok: true, dryRun: false, inserted, ...discovered });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : 'Beat discovery failed.' }, 500);
    }
  }

  return json({ ok: false, error: 'Beat desk endpoint not found.' }, 404);
});
