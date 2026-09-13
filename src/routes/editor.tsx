import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { getSiteAccess, getEditorPosts } from '@/lib/publishing/api';
import type { Post } from '@/lib/publishing/types';
import { dateKeyNY } from '@/lib/sports/time';
import { TEAMS } from '@/data/teams';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type SiteAccess = {
  signedIn: boolean;
  admin: boolean;
  adminConfigured: boolean;
  aiEnabled: boolean;
};

type ProtectedPublisherResponse = {
  ok: boolean;
  access?: SiteAccess;
  posts?: Post[];
  post?: Post;
  id?: string;
  date?: string;
  error?: string;
};

async function readProtectedJson(response: Response): Promise<ProtectedPublisherResponse> {
  const contentType = response.headers.get('content-type') ?? '';
  if (response.redirected || !contentType.toLowerCase().includes('application/json')) {
    throw new Error('Cloudflare Access session missing on this action. Reload /editor while signed in as the owner, then try again.');
  }
  return (await response.json()) as ProtectedPublisherResponse;
}

async function loadProtectedPublisherDesk(): Promise<{ access: SiteAccess; posts: Post[] }> {
  const response = await fetch('/editor?publisher=desk', {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  const body = await readProtectedJson(response);
  if (!response.ok || !body.ok || !body.access || !body.posts) {
    throw new Error(body.error || 'Could not load Publisher.');
  }
  return { access: body.access, posts: body.posts };
}

type Draft = { id?: string; date: string; kind: Post['kind']; title: string; body: string; eventTime: string; teamSlug?: string | null; published: boolean };

async function saveEditorPostViaAccess(data: Draft): Promise<Post> {
  const response = await fetch('/editor?publisher=save', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...data, eventTime: data.eventTime || null }),
  });
  const body = await readProtectedJson(response);
  if (!response.ok || !body.ok || !body.post) {
    throw new Error(body.error || 'The post could not be saved.');
  }
  return body.post;
}

async function runOwnerRecapViaAccess(date: string): Promise<{ ok: boolean; id?: string; date?: string; error?: string }> {
  const response = await fetch('/editor?publisher=recap', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ date }),
  });
  const body = await readProtectedJson(response);
  if (!response.ok && response.status !== 422) {
    throw new Error(body.error || 'Recap failed.');
  }
  return body;
}

export const Route = createFileRoute('/editor')({
  loader: async () => {
    if (typeof window !== 'undefined') return loadProtectedPublisherDesk();
    const access = await getSiteAccess();
    return { access, posts: access.admin ? await getEditorPosts() : [] as Post[] };
  },
  staleTime: 0,
  head: () => ({ meta: [{ title: 'Publisher — Keystone Beat' }, { name: 'robots', content: 'noindex' }] }),
  component: Editor,
});

type MessageTone = 'info' | 'success' | 'error';
type BusyAction = 'save' | 'publish' | 'recap' | null;

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
  const [messageTone, setMessageTone] = useState<MessageTone>('info');
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const busy = busyAction !== null;

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

  async function refreshPosts() {
    const fresh = await loadProtectedPublisherDesk();
    setPosts(fresh.posts);
  }

  async function save(publish: boolean) {
    setBusyAction(publish ? 'publish' : 'save');
    setMessage('');
    setMessageTone('info');
    try {
      const title = publish ? draft.title.replace(/\s*\(draft\)\s*$/i, '') : draft.title;
      const saved = await saveEditorPostViaAccess({ ...draft, title, published: publish });
      setDraft((d) => ({ ...d, id: saved.id, title: saved.title, published: Boolean(saved.published) }));
      setPosts((current) => [saved, ...current.filter((post) => post.id !== saved.id)]);
      setMessageTone('success');
      setMessage(publish ? 'Published successfully. This story is now public.' : 'Draft saved privately. It is not visible to visitors.');
    } catch (error) {
      setMessageTone('error');
      const fallback = publish ? 'Publish failed. Your draft is still here.' : 'Save failed. Your draft is still here.';
      const prefix = publish ? 'Publish failed: ' : 'Save failed: ';
      setMessage(error instanceof Error ? `${prefix}${error.message}` : fallback);
    } finally {
      setBusyAction(null);
    }
  }

  async function generateRecap() {
    setBusyAction('recap');
    setMessage('');
    setMessageTone('info');
    try {
      const result = await runOwnerRecapViaAccess(draft.date);
      if (result.ok) {
        await refreshPosts();
        setMessageTone('success');
        setMessage(`Recap draft saved for ${result.date ?? draft.date}. Open it from Saved posts.`);
      } else {
        setMessageTone('error');
        setMessage(result.error || 'Recap failed.');
      }
    } catch (error) {
      setMessageTone('error');
      setMessage(error instanceof Error ? error.message : 'Recap failed.');
    } finally {
      setBusyAction(null);
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
            <Button disabled={busy} type="submit">{busyAction === 'save' ? 'Saving…' : 'Save draft / unpublish'}</Button>
            <Button disabled={busy || !draft.title.trim() || !draft.body.trim()} type="button" onClick={() => void save(true)}>
              {busyAction === 'publish' ? 'Publishing…' : draft.published ? '✓ Published' : 'Publish'}
            </Button>
            <Button disabled={busy} type="button" variant="outline" onClick={() => void generateRecap()}>{busyAction === 'recap' ? 'Generating…' : 'Generate recap'}</Button>
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                if (!draft.body || window.confirm('Start a new draft? Unsaved edits will be discarded.')) {
                  setDraft(empty());
                  setMessage('');
                  setMessageTone('info');
                }
              }}
            >
              New post
            </Button>
          </div>
          {message ? (
            <p
              role="status"
              aria-live="polite"
              className={`rounded border border-border bg-surface px-3 py-2 text-sm ${messageTone === 'error' ? 'text-danger' : messageTone === 'success' ? 'text-accent' : 'text-muted'}`}
            >
              {message}
            </p>
          ) : null}
          <p className="text-sm text-muted">Generate recap writes a private draft for the date above. It spends a little OpenAI credit. A recap tagged to a team appears in that team’s recap archive once published.</p>
          {!access.aiEnabled ? <p className="text-sm text-danger">AI key is not visible to the Worker yet. Recap generate will fail until AI_API_KEY is readable.</p> : null}
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
                  setMessage('');
                  setMessageTone('info');
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
