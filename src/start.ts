import { createStart } from '@tanstack/react-start';
import { apiMiddleware } from '@/lib/api-middleware';
import { publisherMiddleware } from '@/lib/publisher-middleware';
import { beatAdminMiddleware } from '@/lib/beat-admin-middleware';
import { publishedPostsMiddleware } from '@/lib/published-posts-middleware';

export const startInstance = createStart(() => ({
  requestMiddleware: [publishedPostsMiddleware, apiMiddleware, publisherMiddleware, beatAdminMiddleware],
}));
