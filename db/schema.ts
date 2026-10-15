import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const posts = sqliteTable('posts', {
  id: text('id').primaryKey(),
  authorId: text('author_id').notNull(),
  date: text('date').notNull(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  eventTime: text('event_time'),
  teamSlug: text('team_slug'),
  published: integer('published').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('posts_published_date').on(table.published, table.date),
  index('posts_team_date').on(table.teamSlug, table.date),
]);

export const usage = sqliteTable('ai_usage', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  expiresAt: integer('expires_at').notNull(),
});

/** Curated Beat desk cards — public reads are approved + unexpired only. */
export const beatItems = sqliteTable('beat_items', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  sourceTier: text('source_tier').notNull(),
  authorAccount: text('author_account').notNull(),
  teamSlug: text('team_slug'),
  league: text('league'),
  category: text('category').notNull(),
  headline: text('headline').notNull(),
  context: text('context'),
  originalUrl: text('original_url').notNull(),
  embedUrl: text('embed_url'),
  embedId: text('embed_id'),
  oembedHtml: text('oembed_html'),
  timestamp: text('timestamp').notNull(),
  mediaType: text('media_type').notNull(),
  verifiedOfficial: integer('verified_official').notNull().default(0),
  expiresAt: text('expires_at'),
  approvalStatus: text('approval_status').notNull().default('pending'),
  approvalMode: text('approval_mode').notNull().default('manual'),
  approvedBy: text('approved_by'),
  approvedAt: text('approved_at'),
  pinned: integer('pinned').notNull().default(0),
  relevanceScore: real('relevance_score'),
  duplicateFingerprint: text('duplicate_fingerprint'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  createdBy: text('created_by').notNull(),
}, (table) => [
  uniqueIndex('beat_items_original_url').on(table.originalUrl),
  index('beat_items_pub').on(table.approvalStatus, table.expiresAt, table.category),
  index('beat_items_team').on(table.teamSlug, table.approvalStatus),
  index('beat_items_fingerprint').on(table.duplicateFingerprint),
]);

/** One bounded owner-only discovery report and cross-isolate request cooldown. */
export const beatDiscoveryState = sqliteTable('beat_discovery_state', {
  id: text('id').primaryKey(),
  startedAt: text('started_at').notNull(),
  report: text('report'),
});
