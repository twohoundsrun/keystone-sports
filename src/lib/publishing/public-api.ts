import type { Post } from './types';

type PublishedPostsResponse = {
  ok?: boolean;
  posts?: Post[];
  error?: string;
};

export async function fetchPublishedPosts(date?: string): Promise<Post[]> {
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  const query = params.toString();
  const response = await fetch(`/api/published-posts${query ? `?${query}` : ''}`, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error('Published reports returned an unexpected response.');
  }

  const body = (await response.json()) as PublishedPostsResponse;
  if (!response.ok || body.ok !== true || !Array.isArray(body.posts)) {
    throw new Error(body.error || 'Published reports are temporarily unavailable.');
  }

  return body.posts;
}
