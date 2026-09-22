import { uniqueGames } from '@/lib/sports/identity';
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { FollowButton } from "@/components/follow-button";
import { GameCard } from "@/components/game-card";
import { PendingScreen } from "@/components/pending-screen";
import { ResponsibleGamblingNote } from "@/components/responsible-gambling-note";
import { RouteError } from "@/components/route-error";
import { HIGHLIGHT_BY_SLUG } from "@/data/highlights";
import { TEAM_BY_SLUG, teamLogo } from "@/data/teams";
import { getTeamPage } from "@/lib/sports/api";
import { getTeamPosts } from "@/lib/publishing/api";
import type { Post } from "@/lib/publishing/types";
import type { TeamPageData } from "@/lib/sports/types";
import { dateKeyNY, formatKick, relativeWhen, untilWhen } from "@/lib/sports/time";
import { cn } from "@/lib/utils";
import { socialMeta } from "@/lib/seo";

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export const Route = createFileRoute("/teams/$slug")({
  loader: async ({ params }) => {
    const team = TEAM_BY_SLUG[params.slug];
    if (!team) throw notFound();
    let page: TeamPageData | null = null;
    let loadWarning: string | undefined;
    try {
      page = await withTimeout(
        getTeamPage({ data: { slug: params.slug } }),
        20_000,
        "Team hub timed out while contacting feeds.",
      );
    } catch (e) {
      loadWarning = e instanceof Error ? e.message : "Team feeds are temporarily unavailable.";
      page = {
        slug: params.slug,
        generatedAt: new Date().toISOString(),
        games: [],
        articles: [],
        buzz: [],
        warnings: [loadWarning],
      };
    }
    const recaps = await withTimeout(
      getTeamPosts({ data: { slug: params.slug } }).catch(() => [] as Post[]),
      8_000,
      "recaps",
    ).catch(() => [] as Post[]);
    return { team, page, recaps, loadWarning };
  },
  staleTime: 20_000,
  pendingComponent: PendingScreen,
  errorComponent: RouteError,
  head: ({ loaderData }) => {
    const team = loaderData?.team;
    return socialMeta({
      title: team ? `${team.name} — Keystone Beat` : "Pennsylvania team hub — Keystone Beat",
      description: team ? `${team.name} ${team.league} schedule, scores, news, standings, and team updates from Keystone Beat.` : "Pennsylvania team schedules, scores, and news from Keystone Beat.",
      path: team ? `/teams/${team.slug}` : "/teams",
    });
  },
  component: TeamPage,
});

function TeamPage() {
  const { team, page, recaps, loadWarning } = Route.useLoaderData();
  const today = dateKeyNY();
  const feedWarnings = [...(page?.warnings ?? []), ...(loadWarning ? [loadWarning] : [])];
  const games = uniqueGames(page?.games ?? []);
  const upcoming = games
    .filter((g) => g.status === "in" || (g.dateKey >= today && g.status !== "post"))
    .slice(0, 8);
  const recent = games.filter((g) => g.status === "post").slice(-6).reverse();
  const next = upcoming.find((g) => g.status === "pre") ?? upcoming[0];

  return (
    <>
      {feedWarnings.length ? (
        <div className="border-b border-border bg-elevated px-4 py-3 text-sm text-warn sm:px-6" role="status">
          {feedWarnings[0]} Club identity and links below still work.
        </div>
      ) : null}
      <section className="border-b border-border bg-surface" style={{ borderTop: `4px solid ${team.color}` }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-5 px-4 py-8 sm:px-6">
          <div className="flex h-20 w-20 items-center justify-center rounded-md bg-elevated p-2 sm:h-24 sm:w-24">
            <img data-logo src={teamLogo(team)} alt="" width={80} height={80} decoding="async" className="h-16 w-16 object-contain sm:h-20 sm:w-20" />
          </div>
          <div className="min-w-0 flex-1 basis-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-accent">Team hub</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted">{team.league} · {team.sport} · {team.city}</p>
            <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">{team.name}</h1>
            <p className="mt-1 text-muted">{team.nick}</p>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {team.xHandle ? (
                <a
                  href={`https://x.com/${team.xHandle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-fg hover:text-accent"
                >
                  @{team.xHandle}
                </a>
              ) : null}
              {HIGHLIGHT_BY_SLUG[team.slug] ? (
                <a
                  href={HIGHLIGHT_BY_SLUG[team.slug].href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted hover:text-fg"
                >
                  Highlights
                </a>
              ) : null}
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:basis-auto">
            <FollowButton slug={team.slug} name={team.shortName} />
            {page?.record?.summary ? (
              <div className="rounded-md bg-elevated px-4 py-3 text-right">
                <p className="font-display text-3xl tabular-nums">{page.record.summary}</p>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                  {page.record.standing ?? "Record"}
                </p>
              </div>
            ) : null}
          </div>
        </div>
        {next ? (
          <div className="mx-auto max-w-6xl border-t border-border px-4 py-3 text-sm sm:px-6">
            <span className="font-semibold">Next up: </span>
            <Link to="/game" search={{ date: next.dateKey, id: next.id }} className="font-semibold hover:text-accent">
              {next.away.abbr} @ {next.home.abbr}
            </Link>
            {next.status === "in" ? (
              <span className="ml-2 font-semibold text-accent">Live · {next.statusText}</span>
            ) : (
              <span className="ml-2 text-muted">
                {formatKick(next.start)}
                {untilWhen(next.start) ? ` · ${untilWhen(next.start)}` : ""}
                {next.broadcast ? ` · ${next.broadcast}` : ""}
                {next.odds?.spread ? ` · ${next.odds.spread}` : ""}
              </span>
            )}
          </div>
        ) : null}
        {page?.form?.length ? (
          <div className="mx-auto max-w-6xl border-t border-border px-4 py-3 sm:px-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Recent form</h3>
            <ul className="mt-2 flex flex-wrap gap-4">
              {page.form.map((f) => (
                <li key={f.dateKey} title={`${f.opponent} · ${f.score}`}>
                  <span
                    className={cn(
                      "inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold tabular-nums text-white",
                      f.result === "W" ? "bg-emerald-600" : f.result === "L" ? "bg-rose-600" : "bg-muted text-fg",
                    )}
                  >
                    {f.result}
                  </span>
                  <p className="mt-1 max-w-24 truncate text-[11px] leading-tight text-subtle">{f.opponent}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(16rem,0.8fr)]">
        <div>
          <h2 className="font-display text-2xl tracking-wide">Schedule</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {upcoming.length ? (
              upcoming.map((g) => <GameCard key={g.id} game={g} />)
            ) : (
              <p className="text-sm text-muted">No upcoming games in the current window.</p>
            )}
          </div>
          {recent.length ? (
            <>
              <h2 className="mt-10 font-display text-2xl tracking-wide">Recent</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {recent.map((g) => (
                  <GameCard key={g.id} game={g} />
                ))}
              </div>
            </>
          ) : null}
        </div>
        <aside className="space-y-10">
          {(page?.articles ?? []).length ? (
            <div>
              <h2 className="font-display text-2xl tracking-wide">Beat</h2>
              <ul className="mt-4 space-y-4">
                {(page?.articles ?? []).map((a) => (
                  <li key={a.id}>
                    <a href={a.href} target="_blank" rel="noreferrer" className="hover:text-accent">
                      <p className="text-sm font-semibold leading-snug">{a.headline}</p>
                    </a>
                    <p className="mt-1 text-xs uppercase tracking-wider text-subtle">
                      {a.published ? relativeWhen(a.published) : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {(recaps ?? []).length ? (
            <div>
              <h2 className="font-display text-2xl tracking-wide">Recap archive</h2>
              <ul className="mt-4 space-y-4">
                {recaps.map((p) => (
                  <li key={p.id}>
                    <p className="text-sm font-semibold leading-snug">{p.title}</p>
                    <p className="mt-1 text-xs uppercase tracking-wider text-subtle">{p.date}</p>
                    <p className="mt-1 text-sm text-muted">{p.body.slice(0, 160)}{p.body.length > 160 ? "…" : ""}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <h2 className="font-display text-2xl tracking-wide">Locker room</h2>
            <p className="mt-1 text-sm text-muted">Fan threads from r/{team.reddit}.</p>
            <ul className="mt-4 space-y-3">
              {(page?.buzz ?? []).map((b) => (
                <li key={b.id}>
                  <a href={b.href} target="_blank" rel="noreferrer" className="text-sm leading-snug hover:text-accent">
                    {b.title}
                  </a>
                  {b.updated ? (
                    <p className="mt-1 text-xs uppercase tracking-wider text-subtle">
                      r/{b.sub} · {relativeWhen(b.updated)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-sm text-muted">
            <Link to="/teams" className="hover:text-fg">
              All PA clubs
            </Link>
          </p>
        </aside>
      </div>
      <ResponsibleGamblingNote className="mx-auto max-w-6xl px-4 pb-8 sm:px-6" />
    </>
  );
}
