import { createStart } from '@tanstack/react-start';
import { apiMiddleware } from '@/lib/api-middleware';
import { publisherMiddleware } from '@/lib/publisher-middleware';

export const startInstance = createStart(() => ({
  requestMiddleware: [apiMiddleware, publisherMiddleware],
}));
