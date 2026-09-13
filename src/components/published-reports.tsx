import { useEffect, useMemo, useState } from 'react';
import { fetchPublishedPosts } from '@/lib/publishing/public-api';
import type { Post } from '@/lib/publishing/types';

function preview(body: string): string {
  const clean = body.trim();
  return clean.length > 260 ? `${clean.slice(0, 260).trimEnd()}…` : clean;
}

export function PublishedReports() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void fetchPublishedPosts()
      .then((next) => {
        if (!active) return;
        setPosts(next);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Published reports are temporarily unavailable.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const published = useMemo(
    () => [...posts]
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, 8),
    [posts],
  );

  return (
    <section className="mt-10" aria-label="Keystone Beat reports">
      <h2 className="font-display text-t4 tracking-display">Keystone Beat reports</h2>
      <p className="mt-1 text-t2 text-muted">Published recaps and editor notes from Keystone Beat.</p>

      {loading ? <p className="mt-4 text-sm text-muted">Loading published reports…</p> : null}
      {!loading && error ? <p className="mt-4 rounded-md border border-red-500/40 bg-red-950/20 p-3 text-sm text-red-200">{error}</p> : null}
      {!loading && !error && !published.length ? <p className="mt-4 text-sm text-muted">No published reports yet.</p> : null}

      {published.length ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {published.map((post, index) => (
            <article
              key={post.id}
              className={`rounded-md border bg-surface p-4 shadow-[var(--shadow-border)] ${index === 0 ? 'border-accent/50 sm:col-span-2' : 'border-border'}`}
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-accent">
                {post.kind === 'recap' ? 'Recap' : post.kind === 'event' ? 'Event' : 'Update'} · {post.date}
              </p>
              <h3 className={`mt-2 font-display leading-tight ${index === 0 ? 'text-3xl' : 'text-2xl'}`}>{post.title}</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted">{preview(post.body)}</p>
              <a
                href={`/?date=${encodeURIComponent(post.date)}`}
                className="mt-3 inline-flex text-sm font-semibold text-accent underline-offset-2 hover:underline"
              >
                Open that day's Scores page
              </a>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
