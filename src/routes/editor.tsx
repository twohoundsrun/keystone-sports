import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { getSiteAccess, getEditorPosts, saveEditorPost, runOwnerRecap } from '@/lib/publishing/api';
import type { Post } from '@/lib/publishing/types';
import { dateKeyNY } from '@/lib/sports/time';
import { TEAMS } from '@/data/teams';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export const Route = createFileRoute('/editor')({
  loader: async () => {
    const access = await getSiteAccess();
    return { access, posts: access.admin ? await getEditorPosts() : [] as Post[] };
  },
  staleTime: 0,
  head: () => ({ meta: [{ title: 'Publisher — Keystone Beat' }, { name: 'robots', content: 'noindex' }] }),
  component: Editor,
});

type Draft = { id?: string; date: string; kind: Post['kind']; title: string; body: string; eventTime: string; teamSlug?: string | null; published: boolean };

function empty(): Draft {
  return { date: dateKeyNY(), kind: 'note', title: '', body: '', eventTime: '', teamSlug: '', published: false };
}

function teamLabel(slug?: string | null): string {
  if (!slug) return 'Site-wide';
  return TEAMS.find((t) => t.slug === slug)?.shortName ?? slug;
}

function Editor() {
  const { access, posts: initial } = Route.useLoaderData();
  const [draft, setDraft] = useState<Draft>(empty);
  const [posts, setPosts] = useState(initial);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  if (!access.admin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="font-display text-4xl">Publisher dashboard</h1>
        <p className="my-4">
          {!access.adminConfigured
            ? 'Publishing is locked until the owner email is configured. No visitor can claim ownership.'
            : 'Only the configured Keystone owner can publish here.'}
        </p>
        {!access.signedIn ? (
          <p className="text-sm text-muted">
            Sign in with Cloudflare Access using the owner email (<code>KEYSTONE_ADMIN_EMAIL</code>), then reload this page.
          </p>
        ) : (
          <p className="text-sm text-muted">You are signed in, but not as the configured owner.</p>
        )}
      </div>
    );
  }

  async function save(publish: boolean) {
    setBusy(true);
    setMessage('');
    try {
      const result = await saveEditorPost({ data: { ...draft, eventTime: draft.eventTime || null, published: publish } });
      setDraft((d) => ({ ...d, id: result.id, published: publish }));
      setPosts(await getEditorPosts());
      setMessage(publish ? 'Published on Scores and Calendar for this date.' : 'Draft saved privately. It is not visible to visitors.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Save failed. Your draft is still here.');
    } finally {
      setBusy(false);
    }
  }

  async function generateRecap() {
    setBusy(true);
    setMessage('');
    try {
      const result = await runOwnerRecap({ data: { date: draft.date } });
      setPosts(await getEditorPosts());
      if (result.ok) {
        setMessage(`Recap draft saved for ${result.date}. Open it from Saved posts.`);
      } else {
        setMessage(result.error);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Recap failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 lg:grid-cols-[2fr_1fr]">
      <section>
        <h1 className="font-display text-4xl">Publisher dashboard</h1>
        <p className="mt-2 text-sm"><a href="/editor/beat" className="text-accent hover:underline">Beat desk</a></p>
        <p className="mt-3 text-muted">Draft privately, then publish notes, events, or reviewed recaps for everyone.</p>
        <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); void save(false); }}>
          <label className="block">
            Date
            <Input type="date" required value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          </label>
          <label className="block">
            Type
            <select className="mt-1 block min-h-11 w-full rounded border border-border bg-surface px-3" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Post['kind'] })}>
              <option value="note">News / note</option>
              <option value="event">Event</option>
              <option value="recap">Reviewed recap</option>
            </select>
          </label>
          <label className="block">
            Played by
            <select className="mt-1 block min-h-11 w-full rounded border border-border bg-surface px-3" value={draft.teamSlug ?? ''} onChange={(e) => setDraft({ ...draft, teamSlug: e.target.value })}>
              <option value="">Site-wide (no team)</option>
              {TEAMS.map((t) => (
                <option key={t.slug} value={t.slug}>{t.shortName} — {t.league}</option>
              ))}
            </select>
          </label>
          <label className="block">
            Title
            <Input required maxLength={160} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
          {draft.kind === 'event' ? (
            <label className="block">
              Time (Eastern)
              <Input type="time" value={draft.eventTime} onChange={(e) => setDraft({ ...draft, eventTime: e.target.value })} />
            </label>
          ) : null}
          <label className="block">
            Content
            <Textarea className="min-h-48" required maxLength={10000} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </label>
          <div className="flex flex-wrap gap-3">
            <Button disabled={busy} type="submit">Save draft / unpublish</Button>
            <Button disabled={busy || !draft.title.trim() || !draft.body.trim()} type="button" onClick={() => void save(true)}>Publish</Button>
            <Button disabled={busy} type="button" variant="outline" onClick={() => void generateRecap()}>Generate recap</Button>
            <Button variant="outline" type="button" onClick={() => { if (!draft.body || window.confirm('Start a new draft? Unsaved edits will be discarded.')) setDraft(empty()); }}>New post</Button>
          </div>
          <p className="text-sm text-muted">Generate recap writes a private draft for the date above. It spends a little OpenAI credit. A recap tagged to a team appears in that team’s recap archive once published.</p>
          {!access.aiEnabled ? <p className="text-sm text-danger">AI key is not visible to the Worker yet. Recap generate will fail until AI_API_KEY is readable.</p> : null}
          <p role="status">{message}</p>
        </form>
      </section>
      <aside>
        <h2 className="font-display text-2xl">Saved posts</h2>
        <ul className="mt-4 space-y-3">
          {posts.map((p) => (
            <li key={p.id}>
              <button
                className="w-full rounded border border-border bg-surface p-3 text-left"
                onClick={() => {
                  if (draft.body && !window.confirm('Open this post? Unsaved edits will be discarded.')) return;
                  setDraft({ ...p, eventTime: p.eventTime ?? '', published: Boolean(p.published) });
                }}
              >
                <strong>{p.title}</strong>
                <span className="block text-sm text-muted">
                  {p.date} · {p.published ? 'Published' : 'Draft'} · {teamLabel(p.teamSlug)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
