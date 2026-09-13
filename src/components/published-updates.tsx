import { useEffect, useState } from "react";
import { fetchPublishedPosts } from "@/lib/publishing/public-api";
import type { Post } from "@/lib/publishing/types";

const PREVIEW_CHARS = 400;

function PostBody({ body, expanded, onToggle }: { body: string; expanded: boolean; onToggle: () => void }) {
  const needsTruncate = body.length > PREVIEW_CHARS;
  const text =
    !needsTruncate || expanded ? body : `${body.slice(0, PREVIEW_CHARS).trimEnd()}…`;

  return (
    <div>
      <p className="mt-3 whitespace-pre-wrap leading-relaxed">{text}</p>
      {needsTruncate ? (
        <button
          type="button"
          onClick={onToggle}
          className="mt-2 text-sm font-semibold text-accent underline-offset-2 hover:underline"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      ) : null}
    </div>
  );
}

function RecapHero({ post }: { post: Post }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="rounded-md border border-accent/40 bg-surface p-5 shadow-[var(--shadow-border)] sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">From Keystone Beat</p>
      <p className="mt-2 text-sm text-muted">
        {post.date}
        {post.eventTime ? ` · ${post.eventTime} ET` : ""} · {post.kind}
      </p>
      <h2 className="mt-1 font-display text-3xl leading-tight tracking-wide sm:text-4xl">{post.title}</h2>
      <PostBody body={post.body} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
    </article>
  );
}

export function PublishedUpdates({ date }: { date?: string }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;
    setPosts([]);
    setError(false);
    void fetchPublishedPosts(date)
      .then((p) => {
        if (active) setPosts(p);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [date]);

  if (error) {
    return <p className="my-3 text-sm text-muted">Publisher updates are temporarily unavailable.</p>;
  }
  if (!posts.length) return null;

  const sorted = [...posts].sort((a, b) => {
    if (a.kind === "recap" && b.kind !== "recap") return -1;
    if (b.kind === "recap" && a.kind !== "recap") return 1;
    return (b.updatedAt || "").localeCompare(a.updatedAt || "");
  });
  const [hero, ...rest] = sorted;

  return (
    <section className="my-6 space-y-4" aria-label="Keystone Beat updates">
      <RecapHero post={hero} />
      {rest.length ? (
        <div className="space-y-3">
          <h2 className="font-display text-xl text-muted">More from Keystone Beat</h2>
          {rest.map((p) => {
            const expanded = Boolean(expandedIds[p.id]);
            return (
              <article key={p.id} className="rounded-md border border-border bg-surface p-4">
                <p className="text-sm text-muted">
                  {p.date}
                  {p.eventTime ? ` · ${p.eventTime} ET` : ""} · {p.kind}
                </p>
                <h3 className="mt-1 font-display text-xl">{p.title}</h3>
                <PostBody
                  body={p.body}
                  expanded={expanded}
                  onToggle={() => setExpandedIds((m) => ({ ...m, [p.id]: !m[p.id] }))}
                />
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
