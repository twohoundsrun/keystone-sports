import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { Post } from './types';
import { validDate } from '../sports/time';
import { TEAM_BY_SLUG } from '@/data/teams';

const teamSlug = z.string().trim().max(40).nullable().optional()
  .refine((v) => !v || v in TEAM_BY_SLUG, 'Unknown team');

const schema = z.object({
  id: z.string().uuid().optional(),
  date: z.string().refine(validDate),
  kind: z.enum(['note', 'event', 'recap']),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(10000),
  eventTime: z.string().max(40).nullable(),
  teamSlug,
  published: z.boolean(),
});

const columns = 'id, date, kind, title, body, team_slug AS teamSlug, event_time AS eventTime, published, updated_at AS updatedAt';

export const getSiteAccess = createServerFn({ method: 'GET' }).handler(async () => {
  const { identity, runtime } = await import('./runtime.server');
  const user = identity();
  return { signedIn: Boolean(user.id), admin: user.admin, adminConfigured: user.adminConfigured, aiEnabled: runtime().KEYSTONE_AI_ENABLED === 'true' && Boolean(runtime().AI_API_KEY) };
});

export const getPublishedPosts = createServerFn({ method: 'GET' })
  .validator((input: { date?: string }) => z.object({ date: z.string().refine(validDate).optional() }).parse(input))
  .handler(async ({ data }) => {
    const { db } = await import('./runtime.server');
    const query = data.date ? db().prepare(`SELECT ${columns} FROM posts WHERE published = 1 AND date = ? ORDER BY updated_at DESC LIMIT 50`).bind(data.date)
      : db().prepare(`SELECT ${columns} FROM posts WHERE published = 1 ORDER BY date DESC, updated_at DESC LIMIT 100`);
    return (await query.all<Post>()).results;
  });

export const getEditorPosts = createServerFn({ method: 'GET' }).handler(async () => {
  const { db, requireAdmin } = await import('./runtime.server');
  return (await db().prepare(`SELECT ${columns} FROM posts WHERE author_id = ? OR author_id = 'auto' ORDER BY updated_at DESC LIMIT 100`).bind(requireAdmin()).all<Post>()).results;
});

export const getTeamPosts = createServerFn({ method: 'GET' })
  .validator((input: { slug?: string }) => ({ slug: typeof input?.slug === 'string' ? input.slug.slice(0, 40) : '' }))
  .handler(async ({ data }) => {
    if (!data.slug) return [] as Post[];
    const { db } = await import('./runtime.server');
    return (await db().prepare(`SELECT ${columns} FROM posts WHERE published = 1 AND team_slug = ? ORDER BY date DESC, updated_at DESC LIMIT 30`).bind(data.slug).all<Post>()).results;
  });

export const saveEditorPost = createServerFn({ method: 'POST' }).validator(input => schema.parse(input)).handler(async ({ data }) => {
  const { db, requireAdmin } = await import('./runtime.server');
  const userId = requireAdmin();
  const id = data.id ?? crypto.randomUUID();
  const team = data.teamSlug?.trim() || null;
  const now = new Date().toISOString();
  const published = Number(data.published);

  if (data.id) {
    const result = await db()
      .prepare(
        'UPDATE posts SET date = ?, kind = ?, title = ?, body = ?, event_time = ?, team_slug = ?, published = ?, updated_at = ? WHERE id = ? AND (author_id = ? OR author_id = ?)',
      )
      .bind(data.date, data.kind, data.title, data.body, data.eventTime, team, published, now, data.id, userId, 'auto')
      .run();
    const changed = Number((result as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0);
    if (!changed) throw new Error('Could not update that post. Reload /editor and try Publish again.');
    return { id: data.id };
  }

  await db()
    .prepare(
      'INSERT INTO posts (id, author_id, date, kind, title, body, event_time, team_slug, published, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(id, userId, data.date, data.kind, data.title, data.body, data.eventTime, team, published, now)
    .run();
  return { id };
});

export const runOwnerRecap = createServerFn({ method: 'POST' })
  .validator((input: { date?: string } | undefined) => ({
    date: typeof input?.date === 'string' && input.date ? input.date : undefined,
  }))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import('./runtime.server');
    requireAdmin();
    const { autoRecapDraft } = await import('../sports/auto-recap');
    return autoRecapDraft(data.date);
  });
