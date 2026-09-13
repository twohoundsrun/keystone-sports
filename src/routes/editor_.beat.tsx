import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getSiteAccess } from "@/lib/publishing/api";
import { getBeatAdminDesk, type BeatDeskPayload } from "@/lib/beat/api";
import {
  BEAT_CATEGORIES,
  BEAT_CATEGORY_LABELS,
  SOURCE_TIER_LABELS,
  type BeatCategory,
  type BeatItem,
  type BeatMutationInput,
  type SourceTier,
} from "@/lib/beat/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TEAMS } from "@/data/teams";

type SiteAccess = {
  signedIn: boolean;
  admin: boolean;
  adminConfigured: boolean;
  aiEnabled: boolean;
};

type ProtectedDeskResponse = {
  ok: boolean;
  access?: SiteAccess;
  desk?: BeatDeskPayload;
  error?: string;
};

type DiscoveryResponse = {
  ok?: boolean;
  candidates: unknown[];
  skippedDuplicates: number;
  inserted?: number;
  errors?: string[];
  error?: string;
};

const BEAT_DESK_PATH = "/editor/beat";

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type") ?? "";
  if (response.redirected || !contentType.toLowerCase().includes("application/json")) {
    throw new Error("Cloudflare Access session missing on this action. Reload /editor/beat while signed in as the owner, then try again.");
  }
  return (await response.json()) as Record<string, unknown>;
}

async function beatDeskRequest(operation: string, method: "GET" | "POST", data?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${BEAT_DESK_PATH}?beatAction=${encodeURIComponent(operation)}`, {
    method,
    credentials: "same-origin",
    headers: method === "POST"
      ? { "Content-Type": "application/json", Accept: "application/json" }
      : { Accept: "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(data ?? {}) } : {}),
  });
  const body = await readJsonResponse(response);
  if (!response.ok || body.ok !== true) {
    throw new Error(typeof body.error === "string" ? body.error : "Beat action failed.");
  }
  return body;
}

async function loadProtectedBeatDesk(): Promise<{ access: SiteAccess; desk: BeatDeskPayload }> {
  const body = (await beatDeskRequest("desk", "GET")) as ProtectedDeskResponse;
  if (!body.access || !body.desk) {
    throw new Error(body.error || "Could not load the Beat desk.");
  }
  return { access: body.access, desk: body.desk };
}

async function mutateBeatItemViaAccess(data: BeatMutationInput): Promise<void> {
  await beatDeskRequest("mutate", "POST", data);
}

async function createBeatItemViaAccess(data: unknown): Promise<void> {
  await beatDeskRequest("create", "POST", data);
}

async function discoverBeatCandidatesViaAccess(data: { dryRun: boolean; perAccountLimit: number }): Promise<DiscoveryResponse> {
  return (await beatDeskRequest("discover", "POST", data)) as unknown as DiscoveryResponse;
}

/** Surface serverFn / Access failures clearly (opaque HTML redirects, serialized errors). */
function beatActionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    const msg = error.message.trim();
    // Access challenge often returns HTML login page as the thrown text.
    if (
      /cf-access|cloudflare\s+access|attention required/i.test(msg) ||
      (/<!doctype html/i.test(msg) && /access/i.test(msg))
    ) {
      return "Cloudflare Access session missing on this action. Reload /editor/beat while signed in as the owner, then try again.";
    }
    if (/only the configured owner/i.test(msg) || /sign in as the site owner/i.test(msg)) {
      return `${msg} If the desk loaded but Approve fails, reload while signed into Access so the admin cookie covers server actions.`;
    }
    return msg;
  }
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const rec = error as Record<string, unknown>;
    if (typeof rec.message === "string" && rec.message.trim()) return rec.message.trim();
    if (typeof rec.error === "string" && rec.error.trim()) return rec.error.trim();
  }
  return "Action failed. Check your Cloudflare Access session and try again.";
}

export const Route = createFileRoute("/editor_/beat")({
  loader: async () => {
    if (typeof window !== "undefined") return loadProtectedBeatDesk();
    const access = await getSiteAccess();
    const desk = access.admin
      ? await getBeatAdminDesk()
      : { enabled: false, generatedAt: "", items: [], adminItems: [] as BeatItem[], source: "empty" as const };
    return { access, desk };
  },
  staleTime: 0,
  head: () => ({
    meta: [
      { title: "Beat desk — Keystone Beat" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BeatEditorPage,
});

function BeatEditorPage() {
  const { access, desk } = Route.useLoaderData();
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "error">("ok");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    originalUrl: "",
    source: "",
    authorAccount: "",
    sourceTier: "reporter_original" as SourceTier,
    teamSlug: "",
    category: "from_the_beat" as BeatCategory,
    headline: "",
    context: "",
    verifiedOfficial: false,
    expiresAt: "",
  });

  const [rows, setRows] = useState(desk.adminItems ?? []);
  const visible = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r.approvalStatus === filter);
  }, [rows, filter]);
  const preview = rows.find((r) => r.id === previewId) ?? visible[0] ?? null;

  if (!access.admin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="font-display text-4xl">Beat desk (admin)</h1>
        <p className="my-4 text-muted">
          {!access.adminConfigured
            ? "Beat editing is locked until the owner email is configured."
            : "Only the configured Keystone owner can review Beat cards here."}
        </p>
        {!access.signedIn ? (
          <p className="text-sm text-muted">
            Sign in with Cloudflare Access using the owner email (<code>KEYSTONE_ADMIN_EMAIL</code>), then reload.
          </p>
        ) : (
          <p className="text-sm text-muted">You are signed in, but not as the configured owner.</p>
        )}
        <p className="mt-6 text-sm text-muted">
          Public <Link to="/news">/news</Link> keeps working without this panel.
        </p>
      </div>
    );
  }

  async function refresh(msg?: string) {
    if (msg) {
      setMessageTone("ok");
      setMessage(msg);
    }
    const fresh = await loadProtectedBeatDesk();
    setRows(fresh.desk.adminItems ?? []);
  }

  async function run(action: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMessage("");
    setMessageTone("ok");
    try {
      await action();
      await refresh(ok || undefined);
      if (ok) setMessageTone("ok");
    } catch (error) {
      setMessageTone("error");
      setMessage(beatActionErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <p className="text-sm text-muted">
        <Link to="/editor" className="hover:text-fg">
          ← Publisher
        </Link>
      </p>
      <h1 className="mt-2 font-display text-4xl">Beat desk</h1>
      <p className="mt-3 max-w-2xl text-muted">
        D1-backed candidate queue. Approve is manual only — discovery never auto-publishes. Public strip flag:{" "}
        <code>KEYSTONE_BEAT_M1</code> ({desk.enabled ? "on" : "off"}). Storage: {desk.source}.
      </p>
      {message ? <p className={`mt-3 rounded-md px-3 py-2 text-sm ${messageTone === "error" ? "bg-red-950/40 text-red-200 ring-1 ring-red-500/40" : "text-accent"}`} role={messageTone === "error" ? "alert" : "status"}>{message}</p> : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {(["pending", "approved", "rejected", "all"] as const).map((key) => (
          <Button key={key} type="button" variant={filter === key ? "default" : "outline"} disabled={busy} onClick={() => setFilter(key)}>
            {key} ({key === "all" ? rows.length : rows.filter((r) => r.approvalStatus === key).length})
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(
              () => discoverBeatCandidatesViaAccess({ dryRun: false, perAccountLimit: 2 }),
              "Discovery finished — new rows are pending only.",
            )
          }
        >
          Run discovery (pending)
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await discoverBeatCandidatesViaAccess({ dryRun: true, perAccountLimit: 2 });
              setMessageTone("ok");
              setMessage(`Dry-run: ${result.candidates.length} candidates, ${result.skippedDuplicates} dupes.`);
            }, "")
          }
        >
          Discovery dry-run
        </Button>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <section>
          <h2 className="font-display text-2xl">Queue</h2>
          {!visible.length ? (
            <p className="mt-3 text-sm text-muted">No items in this filter. Seed with <code>npm run beat:seed</code> or add a URL below.</p>
          ) : null}
          <ul className="mt-4 space-y-4">
            {visible.map((item) => (
              <li key={item.id} className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                  <span>{BEAT_CATEGORY_LABELS[item.category]}</span>
                  <span>·</span>
                  <span>{item.approvalStatus}</span>
                  <span>·</span>
                  <span>{item.mediaType}</span>
                  <span>·</span>
                  <span>{SOURCE_TIER_LABELS[item.sourceTier]}</span>
                  {item.pinned ? <span className="rounded-sm bg-accent px-1.5 py-0.5 text-accent-fg">Pinned</span> : null}
                  {typeof item.relevanceScore === "number" ? <span>score {item.relevanceScore}</span> : null}
                </div>
                <p className="mt-2 font-display text-xl tracking-wide">{item.headline}</p>
                {item.context ? <p className="mt-1 text-sm text-muted">{item.context}</p> : null}
                <p className="mt-2 text-xs text-subtle">
                  {item.source} · {item.authorAccount}
                  {item.expiresAt ? ` · expires ${item.expiresAt}` : ""}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" size="sm" disabled={busy || item.approvalStatus === "approved"} onClick={() => void run(() => mutateBeatItemViaAccess({ id: item.id, action: "approve", expiresAt: item.expiresAt ?? undefined }), "Approved.")}>
                    Approve
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => mutateBeatItemViaAccess({ id: item.id, action: "reject" }), "Rejected.")}>
                    Reject
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setPreviewId(item.id)}>
                    Preview
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      const next = window.prompt("Keystone context (1–3 sentences)", item.context ?? "");
                      if (next == null) return;
                      void run(() => mutateBeatItemViaAccess({ id: item.id, action: "edit_context", context: next }), "Context updated.");
                    }}
                  >
                    Edit context
                  </Button>
                  <label className="inline-flex items-center gap-1 text-xs">
                    Category
                    <select
                      className="rounded border border-border bg-surface px-2 py-1"
                      value={item.category}
                      disabled={busy}
                      onChange={(e) =>
                        void run(
                          () =>
                            mutateBeatItemViaAccess({
                              id: item.id, action: "change_category", category: e.target.value as BeatCategory,
                            }),
                          "Category updated.",
                        )
                      }
                    >
                      {BEAT_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {BEAT_CATEGORY_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => mutateBeatItemViaAccess({ id: item.id, action: item.pinned ? "unpin" : "pin" }),
                        item.pinned ? "Unpinned." : "Pinned.",
                      )
                    }
                  >
                    {item.pinned ? "Unpin" : "Pin"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      const next = window.prompt("Expiration ISO (empty to clear)", item.expiresAt ?? "");
                      if (next == null) return;
                      void run(
                        () =>
                          mutateBeatItemViaAccess({
                            id: item.id, action: "set_expiration", expiresAt: next.trim() ? next.trim() : null,
                          }),
                        "Expiration updated.",
                      );
                    }}
                  >
                    Set expiration
                  </Button>
                  <a href={item.originalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center text-sm font-semibold text-accent hover:underline">
                    Open original
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <aside className="space-y-8">
          <section className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
            <h2 className="font-display text-2xl">Preview</h2>
            {preview ? (
              <div className="mt-3 space-y-2 text-sm">
                <p className="font-semibold uppercase tracking-wider text-muted">{BEAT_CATEGORY_LABELS[preview.category]}</p>
                <p className="font-display text-xl">{preview.headline}</p>
                <p className="text-muted">{preview.context}</p>
                <p className="text-xs text-subtle">{preview.mediaType} · {preview.originalUrl}</p>
                {preview.embedUrl ? <p className="text-xs break-all text-subtle">embed {preview.embedUrl}</p> : null}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">Select Preview on a row.</p>
            )}
          </section>

          <section className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
            <h2 className="font-display text-2xl">Add URL</h2>
            <p className="mt-1 text-xs text-muted">Creates a <strong>pending</strong> candidate. Approve separately.</p>
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  () =>
                    createBeatItemViaAccess({
                      ...draft,
                      teamSlug: draft.teamSlug || null,
                      expiresAt: draft.expiresAt || null,
                    }),
                  "Candidate saved as pending.",
                );
              }}
            >
              <label className="block text-sm">
                Original URL
                <Input required value={draft.originalUrl} onChange={(e) => setDraft({ ...draft, originalUrl: e.target.value })} />
              </label>
              <label className="block text-sm">
                Headline / Keystone caption
                <Input required value={draft.headline} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} />
              </label>
              <label className="block text-sm">
                Context
                <Textarea value={draft.context} onChange={(e) => setDraft({ ...draft, context: e.target.value })} rows={3} />
              </label>
              <label className="block text-sm">
                Source
                <Input required value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
              </label>
              <label className="block text-sm">
                Account / byline
                <Input required value={draft.authorAccount} onChange={(e) => setDraft({ ...draft, authorAccount: e.target.value })} />
              </label>
              <label className="block text-sm">
                Tier
                <select
                  className="mt-1 block min-h-11 w-full rounded border border-border bg-surface px-3"
                  value={draft.sourceTier}
                  onChange={(e) => setDraft({ ...draft, sourceTier: e.target.value as SourceTier })}
                >
                  {(Object.keys(SOURCE_TIER_LABELS) as SourceTier[]).map((t) => (
                    <option key={t} value={t}>
                      {SOURCE_TIER_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Category
                <select
                  className="mt-1 block min-h-11 w-full rounded border border-border bg-surface px-3"
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value as BeatCategory })}
                >
                  {BEAT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {BEAT_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Team
                <select
                  className="mt-1 block min-h-11 w-full rounded border border-border bg-surface px-3"
                  value={draft.teamSlug}
                  onChange={(e) => setDraft({ ...draft, teamSlug: e.target.value })}
                >
                  <option value="">Site-wide</option>
                  {TEAMS.map((t) => (
                    <option key={t.slug} value={t.slug}>
                      {t.shortName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Expiration (ISO, required later for Breaking)
                <Input value={draft.expiresAt} onChange={(e) => setDraft({ ...draft, expiresAt: e.target.value })} placeholder="2026-09-14T23:59:00.000Z" />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.verifiedOfficial} onChange={(e) => setDraft({ ...draft, verifiedOfficial: e.target.checked })} />
                Verified / official
              </label>
              <Button type="submit" disabled={busy}>
                Save pending candidate
              </Button>
            </form>
          </section>
        </aside>
      </div>
    </div>
  );
}
