import { getSiteAccess, getPublishedPosts } from '@/lib/publishing/api';
import type { Post } from '@/lib/publishing/types';
import { FeedStatus } from '@/components/feed-status';
import { PublishedUpdates } from '@/components/published-updates';
import { FollowOnboarding } from '@/components/follow-onboarding';
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Copy, PenLine, RefreshCw } from "lucide-react";
import { FilterChips } from "@/components/filter-chips";
import { GameCard, GameRow } from "@/components/game-card";
import { WeekStrip } from "@/components/week-strip";
import { FadeSwap } from "@/components/fade-swap";
import { PendingScreen } from "@/components/pending-screen";
import { RouteError } from "@/components/route-error";

import { TeamRail } from "@/components/team-rail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TEAM_BY_SLUG } from "@/data/teams";
import { getNewsFeed, getTodayBoard, generateBrief } from "@/lib/sports/api";
import { rememberBoard } from "@/lib/sports/board-cache";
import { useFollows } from "@/lib/sports/follow-store";
import { applyView, featuredLabel, humanKicker, isFollowedGame, pickFeatured, rankPaNews } from "@/lib/sports/filter";
import { parseRegion, readPrefs, writePrefs } from "@/lib/sports/prefs";
import { addDays, dateKeyNY, formatKick, formatLongDate, relativeWhen } from "@/lib/sports/time";
import type { NewsItem } from "@/lib/sports/types";
import { cn } from "@/lib/utils";
import { socialMeta } from "@/lib/seo";

type Search = { date?: string; region?: string; sport?: string };

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    date: typeof s.date === "string" ? s.date : undefined,
    region: typeof s.region === "string" ? s.region : undefined,
    sport: typeof s.sport === "string" ? s.sport : undefined,
  }),
  loaderDeps: ({ search }) => ({ date: search.date }),
  loader: async ({ deps }) => {
    const board = await getTodayBoard({ data: { date: deps.date } });
    const [posts, news] = await Promise.all([
      getPublishedPosts({ data: { date: board.date } }).catch(() => [] as Post[]),
      getNewsFeed().catch(() => ({ articles: [] as NewsItem[] })),
    ]);
    return { board, posts, news };
  },
  staleTime: 20_000,
  pendingComponent: PendingScreen,
  errorComponent: RouteError,
  head: () => socialMeta({
    title: "Pennsylvania sports scores — Keystone Beat",
    description: "Live Pennsylvania sports scores: Eagles, Steelers, Phillies, Pirates, Sixers, Flyers, Penguins, Union, Penn State, Pitt, Temple, Villanova.",
  }),
  component: TodayPage,
});

function TodayPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const loader = Route.useLoaderData();
  const [board, setBoard] = useState(loader.board);
  const [news, setNews] = useState<{ articles: NewsItem[] }>(loader.news ?? { articles: [] });
  const [brief, setBrief] = useState<string | null>(null);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiAccess, setAiAccess] = useState({ signedIn: false, aiEnabled: false });
  useEffect(() => { let active = true; void getSiteAccess().then(a => { if (active) setAiAccess(a); }).catch(() => {}); return () => { active = false; }; }, []);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const date = search.date ?? board.date;
  const region = parseRegion(search.region);
  const sport = search.sport ?? "all";
  const today = dateKeyNY();

  const followed = useFollows((s) => s.slugs);
  const followHydrated = useFollows((s) => s.hydrated);

  useEffect(() => {
    setBoard(loader.board);
    rememberBoard(loader.board);
  }, [loader]);

  useEffect(() => {
    if (loader.news) setNews(loader.news);
  }, [loader]);

  useEffect(() => {
    if (search.region || search.sport) return;
    const prefs = readPrefs();
    if (prefs.region === "all" && prefs.sport === "all") return;
    void navigate({
      search: { date: search.date, region: prefs.region, sport: prefs.sport },
      replace: true,
    });
  }, [navigate, search.date, search.region, search.sport]);

  useEffect(() => {
    let active = true;
    const t = setInterval(() => {
      if (document.hidden) return;
      void getTodayBoard({ data: { date } }).then((b) => {
        if (!active) return;
        rememberBoard(b);
        setBoard(b);
      }).catch(() => { if (active) setBoard(b => ({ ...b, warnings: ["Could not refresh scores."] })); });
    }, 60_000);
    return () => { active = false; clearInterval(t); };
  }, [date]);

  useEffect(() => { setBrief(null); setBriefError(null); }, [date, region, sport]);

  const waitingFollows = region === "following" && !followHydrated;
  const games = useMemo(
    () => applyView(board.games, region, sport, followed, followHydrated),
    [board.games, region, sport, followed, followHydrated],
  );
  const upcomingAll = useMemo(
    () => applyView(board.upcoming, region, sport, followed, followHydrated),
    [board.upcoming, region, sport, followed, followHydrated],
  );
  const recent = useMemo(
    () => applyView(board.recent, region, sport, followed, followHydrated),
    [board.recent, region, sport, followed, followHydrated],
  );
  const live = games.filter((g) => g.status === "in");
  const feature = pickFeatured(games, followed, upcomingAll);
  const liveStrip = live.filter((g) => g.id !== feature?.id);
  const rest = games.filter((g) => g.id !== feature?.id);
  const upcoming = upcomingAll.filter((g) => g.id !== feature?.id).slice(0, 8);
  const recap = (loader.posts ?? []).find((p) => p.kind === "recap") ?? null;
  const nextUp = upcomingAll.find((g) => g.status !== "post") ?? board.upcoming.find((g) => g.status !== "post");
  const desk = humanKicker({
    date,
    recap,
    slateCount: board.games.length,
    next: nextUp
      ? { away: nextUp.away.abbr, home: nextUp.home.abbr, when: formatKick(nextUp.start) }
      : null,
  });
  const rankedNews = useMemo(() => rankPaNews(news.articles, followed), [news.articles, followed]);
  const lead = rankedNews.find((a) => a.image) ?? rankedNews[0];
  const moreNews = rankedNews.filter((a) => a.id !== lead?.id).slice(0, 6);
  const takeSources = useMemo(
    () => Array.from(new Set(rankedNews.map((article) => article.source).filter((source): source is string => Boolean(source)))).slice(0, 4),
    [rankedNews],
  );

  const weekSource = useMemo(() => [...board.games, ...board.upcoming], [board.games, board.upcoming]);
  const weekGames = useMemo(
    () => applyView(weekSource, region, sport, followed, followHydrated),
    [weekSource, region, sport, followed, followHydrated],
  );
  const liveDays = useMemo(() => {
    const set = new Set<string>();
    for (const g of weekSource) if (g.status === "in") set.add(g.dateKey);
    return set;
  }, [weekSource]);

  function patch(next: Search) {
    const regionNext = (next.region ?? search.region) as string | undefined;
    const sportNext = next.sport ?? search.sport;
    if (regionNext || sportNext) {
      writePrefs({
        region: parseRegion(regionNext),
        sport: sportNext || "all",
      });
    }
    void navigate({
      search: {
        date: next.date ?? search.date,
        region: next.region ?? search.region,
        sport: next.sport ?? search.sport,
      },
    });
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const [b, n] = await Promise.all([getTodayBoard({ data: { date } }), getNewsFeed()]);
      rememberBoard(b);
      setBoard(b);
      setNews(n);
    } catch {
      setBoard(b => ({ ...b, warnings: ["Could not refresh scores. Please try again."] }));
    } finally {
      setRefreshing(false);
    }
  }

  async function runBrief() {
    setBusy(true);
    setBriefError(null);
    try {
      const res = await generateBrief({
        data: {
          date,
          region, sport, followed,
        },
      });
      if (res.ok) setBrief(res.text);
      else setBriefError(res.error);
    } catch (error) {
      setBriefError(error instanceof Error ? error.message : "Could not write the recap.");
    } finally {
      setBusy(false);
    }
  }

  async function copyBrief() {
    if (!brief) return;
    try {
      await navigator.clipboard.writeText(brief);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Keystone Beat",
    description: "Pennsylvania sports scores, calendars, and news.",
    about: games.slice(0, 8).map((g) => ({
      "@type": "SportsEvent",
      name: g.name,
      startDate: g.start,
      location: g.venue,
      homeTeam: g.home.name,
      awayTeam: g.away.name,
    })),
  };

  return (
    <div className="editorial-home">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\u003c') }} />
      <section className="home-summary border-b border-border bg-bg">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
            <div>
              <p className="editorial-label">Pennsylvania sports</p>
              <h1 className="mt-1 font-serif text-3xl font-black tracking-tight sm:text-5xl">
                {date === today ? "Today in Pennsylvania sports" : formatLongDate(date)}
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-fg sm:text-base">
                Scores, stories, and the teams people across the Keystone State actually follow.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => patch({ date: addDays(date, -1) })}>
                Prev
              </Button>
              <Button variant="outline" size="sm" onClick={() => patch({ date: today })}>
                Today
              </Button>
              <Button variant="outline" size="sm" onClick={() => patch({ date: addDays(date, 1) })}>
                Next
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void refresh()}
                disabled={refreshing}
                aria-label="Refresh scores"
              >
                <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            </div>
          </div>
          <p className="mt-2 max-w-2xl font-serif text-base font-semibold leading-snug text-fg sm:text-lg">{desk.line}</p>
          {desk.lede ? <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{desk.lede}</p> : null}
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            {followed.length ? <button className="font-semibold text-accent underline" onClick={() => patch({ region: 'following' })}>My Teams ({followed.length})</button> : <Link to="/teams" className="font-semibold text-accent underline">Follow your teams →</Link>}
          </div>
          <FeedStatus at={board.generatedAt} warnings={board.warnings} />
          <WeekStrip
            origin={today}
            selected={date}
            games={weekGames}
            liveDays={liveDays}
            onSelect={(d) => patch({ date: d })}
          />
          {liveStrip.length ? (
            <section className="mt-4 border-y border-ok/40 py-3" aria-label="Other live games">
              <div className="mb-2 flex items-center gap-2">
                <Badge variant="live">Live now</Badge>
                <span className="text-xs font-semibold uppercase tracking-widest text-muted">
                  {live.length} game{live.length === 1 ? "" : "s"} in progress
                </span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
              {liveStrip.map((g) => (
                <Link
                  key={g.id}
                  to="/game"
                  search={{ date: g.dateKey, id: g.id }}
                  className="flex shrink-0 items-center gap-2 border-r border-border pr-3 text-sm hover:text-accent"
                >
                  <span className="font-semibold">{g.away.abbr} {g.away.score} · {g.home.abbr} {g.home.score}</span>
                  <span className="text-muted">{g.statusText}</span>
                </Link>
              ))}
              </div>
            </section>
          ) : null}
          {waitingFollows ? (
            <div className="mt-5 h-40 animate-pulse rounded-md bg-elevated" aria-hidden />
          ) : feature || lead ? (
            <div className="mt-6 grid gap-6 border-y border-border py-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
              {lead ? (
                <article className="order-1 lg:order-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-accent">The lead</p>
                  {lead.image ? (
                    <a href={lead.href} target="_blank" rel="noreferrer" className="mt-3 block">
                      <img src={lead.image} alt="" width={704} height={260} loading="lazy" decoding="async" className="aspect-[2.2/1] w-full object-cover" />
                    </a>
                  ) : null}
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-muted">
                    {TEAM_BY_SLUG[lead.teamSlug ?? ""]?.shortName ?? lead.league}
                    {lead.published ? ` \u00b7 ${relativeWhen(lead.published)}` : ""}
                  </p>
                  <a href={lead.href} target="_blank" rel="noreferrer" className="mt-1 block hover:text-accent">
                    <h2 className="font-serif text-3xl font-black leading-[1.02] tracking-tight sm:text-4xl">{lead.headline}</h2>
                  </a>
                  {lead.description ? <p className="mt-2 text-sm leading-relaxed text-muted">{lead.description}</p> : null}
                </article>
              ) : null}
              {feature ? (
                <FadeSwap id={`feature-${date}-${feature.id}`} className="order-2">
                  <section className="lg:border-l lg:border-border lg:pl-6" aria-label="Live and featured game">
                    <div className="mb-2 flex items-baseline justify-between gap-3">
                      <p className="editorial-label">{featuredLabel(feature)}</p>
                      <Link to="/calendar" className="text-xs font-semibold text-accent hover:underline">Full scoreboard →</Link>
                    </div>
                    <GameCard game={feature} featured nextUp={feature.status === "pre" && isFollowedGame(feature, followed)} />
                  </section>
                </FadeSwap>
              ) : null}
            </div>
          ) : null}
          <PublishedUpdates date={date} />
        </div>
      </section>

      <FollowOnboarding />
      <TeamRail />

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.85fr)]">
        <div>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <div>
              <p className="editorial-label">The scoreboard</p>
              <h2 className="mt-1 font-serif text-3xl font-black tracking-tight">Today&apos;s games</h2>
            </div>
            <span className="text-right text-xs text-muted">{games.length} game{games.length === 1 ? "" : "s"}</span>
          </div>
          <FilterChips
            region={region}
            sport={sport}
            onRegion={(id) => patch({ region: id })}
            onSport={(id) => patch({ sport: id })}
          />

          {waitingFollows ? null : rest.length ? (
            <FadeSwap id={`slate-${date}-${board.generatedAt}`}>
              <div className={cn("grid gap-3 sm:grid-cols-2", feature ? "mt-4" : "mt-6")}>
                {rest.map((g) => (
                  <GameCard key={g.id} game={g} />
                ))}
              </div>
            </FadeSwap>
          ) : !feature ? (
            <div className="mt-6 rounded-md bg-surface px-5 py-10 text-center shadow-[var(--shadow-border)]">
              <p className="font-display text-2xl">
                {region === "following" && followHydrated && !followed.length ? "No clubs pinned" : "Off day"}
              </p>
              <p className="mt-2 text-sm text-muted">
                {region === "following" && followHydrated && !followed.length
                  ? "Star a club on Teams or a team page to pin it here."
                  : region === "following"
                    ? upcoming.length
                      ? "None of your clubs play on this date. Next slate is below."
                      : "None of your clubs play on this date. Check the calendar for the next one."
                    : "No PA games on this date. Next slate is below."}
              </p>
            </div>
          ) : null}

          {upcoming.length ? (
            <section className="mt-10">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-serif text-2xl font-black tracking-tight">Coming up</h2>
                <Link to="/calendar" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
                  Full calendar <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="editorial-flat-list px-4">
                {upcoming.map((g) => (
                  <GameRow key={g.id} game={g} />
                ))}
              </div>
            </section>
          ) : null}

          {recent.length ? (
            <section className="mt-10">
              <h2 className="mb-3 font-serif text-2xl font-black tracking-tight">Last night</h2>
              <div className="editorial-flat-list px-4">
                {recent.map((g) => (
                  <GameRow key={g.id} game={g} />
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="space-y-6">
          {moreNews.length ? (
            <section>
              <div className="mb-3 flex items-baseline justify-between">
                    <h2 className="font-serif text-2xl font-black tracking-tight">Headlines</h2>
                <Link to="/news" className="text-sm text-muted hover:text-fg">
                  All
                </Link>
              </div>
              <ul className="space-y-3">
                {moreNews.map((a) => (
                  <li key={a.id} className="border-t border-border pt-3 first:border-0 first:pt-0">
                    <a href={a.href} target="_blank" rel="noreferrer" className="group block">
                      <p className="text-sm font-semibold leading-snug group-hover:text-accent">{a.headline}</p>
                      <p className="mt-1 text-xs uppercase tracking-wider text-subtle">
                        {TEAM_BY_SLUG[a.teamSlug ?? ""]?.shortName ?? a.league}
                        {a.published ? ` \u00b7 ${relativeWhen(a.published)}` : ""}
                      </p>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="editorial-section-rule py-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="editorial-label">The Pennsylvania take</p>
              <Badge variant={brief ? "ok" : aiAccess.aiEnabled ? "outline" : "default"}>{brief ? "Filed" : aiAccess.aiEnabled ? "Desk note" : "Watching"}</Badge>
            </div>
            <h2 className="mt-1 font-serif text-3xl font-black tracking-tight">What matters tonight</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              A quick read on the teams, games, and stories shaping the day across the commonwealth.
            </p>
            <div className="mt-3 rounded-sm border border-border bg-elevated/50 p-3 text-xs text-muted">
              <p className="font-semibold uppercase tracking-wider text-subtle">Source check</p>
              <p className="mt-1">{games.length} game{games.length === 1 ? "" : "s"} on the board · {rankedNews.length} headline{rankedNews.length === 1 ? "" : "s"} available{takeSources.length ? ` · ${takeSources.join(", ")}` : ""}</p>
            </div>
            {aiAccess.aiEnabled && aiAccess.signedIn ? (
              <Button className="mt-4 w-full" onClick={() => void runBrief()} disabled={busy}>
                <PenLine className="h-4 w-4" />
                {busy ? "Writing…" : "Write the recap"}
              </Button>
            ) : (
              <p className="mt-4 border-t border-border pt-4 text-sm text-muted">
                The desk is watching tonight&apos;s board. Check back after the games for the local angle.
              </p>
            )}
            {briefError ? <p className="mt-3 text-sm text-danger">{briefError}</p> : null}
            {brief ? (
              <div className="mt-4 space-y-3 border-t border-border pt-4 text-sm leading-relaxed text-fg">
                <p className="text-xs font-semibold uppercase tracking-wider text-accent">Desk note · {formatLongDate(date)}</p>
                {brief.split(/\n\n+/).map((para) => (
                  <p key={para.slice(0, 24)}>{para}</p>
                ))}
                <Button variant="outline" size="sm" onClick={() => void copyBrief()}>
                  <Copy className="h-4 w-4" />
                  {copied ? "Copied" : "Copy recap"}
                </Button>
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
