import { createMiddleware } from '@tanstack/react-start';
import { validDate } from '@/lib/sports/time';

const columns = 'id, date, kind, title, body, team_slug AS teamSlug, event_time AS eventTime, published, updated_at AS updatedAt';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });

/** Public read-only endpoint for already-published Publisher stories. */
export const publishedPostsMiddleware = createMiddleware({ type: 'request' }).server(async ({ request, next }) => {
  if (!request) return next({});

  const url = new URL(request.url);
  if (url.pathname !== '/api/published-posts') return next({});

  if (request.method.toUpperCase() !== 'GET') {
    return json({ ok: false, error: 'GET only.' }, 405);
  }

  const date = url.searchParams.get('date')?.trim() || undefined;
  if (date && !validDate(date)) {
    return json({ ok: false, error: 'Invalid date.' }, 422);
  }

  try {
    const { db } = await import('@/lib/publishing/runtime.server');
    const query = date
      ? db().prepare(`SELECT ${columns} FROM posts WHERE published = 1 AND date = ? ORDER BY updated_at DESC LIMIT 50`).bind(date)
      : db().prepare(`SELECT ${columns} FROM posts WHERE published = 1 ORDER BY date DESC, updated_at DESC LIMIT 100`);
    const posts = (await query.all()).results;
    return json({ ok: true, posts });
  } catch {
    return json({ ok: false, error: 'Published reports are temporarily unavailable.' }, 500);
  }
});
