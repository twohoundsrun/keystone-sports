import { createFileRoute } from "@tanstack/react-router";
import { PendingScreen } from "@/components/pending-screen";
import { RouteError } from "@/components/route-error";
import { BeatModule } from "@/components/beat/beat-module";
import { PublishedReports } from "@/components/published-reports";
import { BreakingAlert, DeskArticle, LockerRoom, WireList } from "@/components/news-feed";
import { isPremiumBeat } from "@/components/news-feed-utils";

import { getNewsWire } from "@/lib/sports/api";
import { getBeatDesk } from "@/lib/beat/api";
import { rankPaNews } from "@/lib/sports/filter";
import { useFollows } from "@/lib/sports/follow-store";

export const Route = createFileRoute("/news")({
  loader: async () => {
    const [wire, beat] = await Promise.all([getNewsWire(), getBeatDesk()]);
    return { wire, beat };
  },
  staleTime: 60_000,
  pendingComponent: PendingScreen,
  errorComponent: RouteError,
  head: () => ({
    meta: [{ title: "News — Keystone Beat" }],
  }),
  component: NewsPage,
});

function NewsPage() {
  const { wire, beat } = Route.useLoaderData();
  const followed = useFollows((s) => s.slugs);
  const ranked = rankPaNews(wire.articles, followed);
  const premium = beat.enabled ? beat.items.filter(isPremiumBeat) : [];
  const deskBeat = beat.enabled ? beat.items.filter((i) => !isPremiumBeat(i)) : [];
  const deskWire = ranked.filter((a) => a.image).slice(0, 8);
  const used = new Set(deskWire.map((a) => a.id));
  const wireList = ranked.filter((a) => !used.has(a.id));
  const highlights = [...(wire.highlights ?? [])].sort((a, b) => {
    const af = a.teamSlug && followed.includes(a.teamSlug) ? 0 : 1;
    const bf = b.teamSlug && followed.includes(b.teamSlug) ? 0 : 1;
    if (af !== bf) return af - bf;
    const filmA = a.label === "Official" ? 1 : 0;
    const filmB = b.label === "Official" ? 1 : 0;
    return filmA - filmB;
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">News</h1>
      <p className="mt-3 max-w-2xl text-muted">
        The beat, the local papers, and the locker room. Film rooms link out to the clubs — we don't host the tape.
      </p>

      {premium.length ? (
        <section className="mt-8 space-y-3" aria-label="Breaking and pinned">
          {premium.map((item) => (
            <BreakingAlert key={item.id} item={item} />
          ))}
        </section>
      ) : null}

      {beat.enabled ? <BeatModule items={deskBeat} generatedAt={beat.generatedAt} /> : null}

      <PublishedReports />

      {deskWire.length ? (
        <section className="mt-10" aria-label="Beat desk">
          <h2 className="font-display text-t4 tracking-display">From the papers</h2>
          <p className="mt-1 text-t2 text-muted">Curated PA wire with art — not the full national firehose.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {deskWire.map((a) => (
              <DeskArticle key={a.id} item={a} />
            ))}
          </div>
        </section>
      ) : null}

      {highlights.length ? (
        <section className="mt-8" aria-label="Highlights">
          <h2 className="font-display text-2xl tracking-wide">Highlights</h2>
          <p className="mt-1 text-sm text-muted">Official film rooms. We link out. No embeds.</p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {highlights.map((h) => (
              <li key={h.id}>
                <a
                  href={h.href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-baseline justify-between gap-3 rounded-md bg-surface px-3 py-3 text-sm shadow-[var(--shadow-border)] hover:text-accent"
                >
                  <span className="font-semibold leading-snug">{h.title}</span>
                  <span className="shrink-0 text-xs uppercase tracking-wider text-subtle">{h.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
        <WireList articles={wireList} />
        <LockerRoom items={wire.buzz} />
      </div>
    </div>
  );
}
