import { createMiddleware } from '@tanstack/react-start';
import { z } from 'zod';
import { TEAM_BY_SLUG } from '@/data/teams';
import { validDate } from '@/lib/sports/time';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });

const teamSlug = z.string().trim().max(40).nullable().optional()
  .refine((value) => !value || value in TEAM_BY_SLUG, 'Unknown team');

const postSchema = z.object({
  id: z.string().uuid().optional(),
  date: z.string().refine(validDate, 'Invalid date'),
  kind: z.enum(['note', 'event', 'recap']),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(10000),
  eventTime: z.string().max(40).nullable(),
  teamSlug,
  published: z.boolean(),
});

const recapSchema = z.object({
  date: z.string().refine(validDate, 'Invalid date').optional(),
});

const columns = 'id, date, kind, title, body, team_slug AS teamSlug, event_time AS eventTime, published, updated_at AS updatedAt';

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message || 'Invalid publisher request.';
}

async function ownerFromRequest(request: Request): Promise<
  | { ok: true; id: string; adminConfigured: boolean; aiEnabled: boolean }
  | { ok: false; response: Response }
> {
  const { runtime } = await import('@/lib/publishing/runtime.server');
  const env = runtime();
  const configuredEmail = env.KEYSTONE_ADMIN_EMAIL?.trim().toLowerCase();
  if (!configuredEmail) {
    return { ok: false, response: json({ ok: false, error: 'Publisher owner email is not configured.' }, 503) };
  }

  const accessEmail = request.headers.get('cf-access-authenticated-user-email')?.trim().toLowerCase();
  if (accessEmail) {
    if (accessEmail !== configuredEmail) {
      return { ok: false, response: json({ ok: false, error: 'Only the configured owner can use Publisher.' }, 403) };
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

/**
 * Publisher actions intentionally use the exact /editor route. That is the
 * route Cloudflare Access already proves is protected when the owner opens the
 * dashboard, so Save/Publish/Recap do not depend on wildcard coverage for a
 * nested API path. Public TanStack serverFns stay on their normal public path.
 */
export const publisherMiddleware = createMiddleware({ type: 'request' }).server(async ({ request, next }) => {
  if (!request) return next({});

  const url = new URL(request.url);
  if (url.pathname !== '/editor') return next({});

  const operation = url.searchParams.get('publisher');
  if (!operation) return next({});

  const owner = await ownerFromRequest(request);
  if ('response' in owner) return owner.response;

  const method = request.method.toUpperCase();

  if (operation === 'desk') {
    if (method !== 'GET') return json({ ok: false, error: 'GET only.' }, 405);
    try {
      const { db } = await import('@/lib/publishing/runtime.server');
      const posts = (await db()
        .prepare(`SELECT ${columns} FROM posts WHERE author_id = ? OR author_id = 'auto' ORDER BY updated_at DESC LIMIT 100`)
        .bind(owner.id)
        .all()).results;
      return json({
        ok: true,
        access: {
          signedIn: true,
          admin: true,
          adminConfigured: owner.adminConfigured,
          aiEnabled: owner.aiEnabled,
        },
        posts,
      });
    } catch {
      return json({ ok: false, error: 'Publisher is temporarily unavailable.' }, 500);
    }
  }

  if (operation === 'save') {
    if (method !== 'POST') return json({ ok: false, error: 'POST only.' }, 405);
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return json({ ok: false, error: 'Content-Type must be application/json.' }, 415);
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ ok: false, error: 'Invalid JSON.' }, 400);
    }

    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) return json({ ok: false, error: firstIssue(parsed.error) }, 422);

    const data = parsed.data;
    const { db } = await import('@/lib/publishing/runtime.server');
    const database = db();
    const now = new Date().toISOString();
    const team = data.teamSlug?.trim() || null;
    const title = data.published ? data.title.replace(/\s*\(draft\)\s*$/i, '') : data.title;
    const published = Number(data.published);

    try {
      const id = data.id ?? crypto.randomUUID();
      if (data.id) {
        const result = await database
          .prepare(
            'UPDATE posts SET date = ?, kind = ?, title = ?, body = ?, event_time = ?, team_slug = ?, published = ?, updated_at = ? WHERE id = ? AND (author_id = ? OR author_id = ?)',
          )
          .bind(data.date, data.kind, title, data.body, data.eventTime, team, published, now, data.id, owner.id, 'auto')
          .run();
        const changed = Number((result as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0);
        if (!changed) return json({ ok: false, error: 'Could not update that post. Reload /editor and try again.' }, 404);
      } else {
        await database
          .prepare(
            'INSERT INTO posts (id, author_id, date, kind, title, body, event_time, team_slug, published, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(id, owner.id, data.date, data.kind, title, data.body, data.eventTime, team, published, now)
          .run();
      }

      return json({
        ok: true,
        post: {
          id,
          date: data.date,
          kind: data.kind,
          title,
          body: data.body,
          eventTime: data.eventTime,
          teamSlug: team,
          published,
          updatedAt: now,
        },
      });
    } catch {
      return json({ ok: false, error: 'The post could not be saved. Your draft is still in the editor.' }, 500);
    }
  }

  if (operation === 'recap') {
    if (method !== 'POST') return json({ ok: false, error: 'POST only.' }, 405);
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return json({ ok: false, error: 'Content-Type must be application/json.' }, 415);
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ ok: false, error: 'Invalid JSON.' }, 400);
    }
    const parsed = recapSchema.safeParse(raw ?? {});
    if (!parsed.success) return json({ ok: false, error: firstIssue(parsed.error) }, 422);

    try {
      const { autoRecapDraft } = await import('@/lib/sports/auto-recap');
      const result = await autoRecapDraft(parsed.data.date);
      return json(result, result.ok ? 200 : 422);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : 'Recap failed.' }, 500);
    }
  }

  return json({ ok: false, error: 'Publisher endpoint not found.' }, 404);
});
