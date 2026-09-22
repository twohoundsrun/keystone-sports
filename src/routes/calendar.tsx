import { FeedStatus } from '@/components/feed-status';
import { DataEmptyState } from '@/components/data-empty-state';
import { PublishedUpdates } from '@/components/published-updates';
import { GameRow } from '@/components/game-card';
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { FilterChips } from "@/components/filter-chips";
import { GameCard } from "@/components/game-card";
import { FadeSwap } from "@/components/fade-swap";
import { MonthGrid } from "@/components/month-grid";
import { PendingScreen } from "@/components/pending-screen";
import { RouteError } from "@/components/route-error";

import { Button } from "@/components/ui/button";
import { getMonthBoard } from "@/lib/sports/api";
import { useDesk } from "@/lib/sports/desk-store";
import { useFollows } from "@/lib/sports/follow-store";
import { applyView } from "@/lib/sports/filter";
import { parseRegion, writePrefs } from "@/lib/sports/prefs";
import { dateKeyNY, formatLongDate, shiftMonth } from "@/lib/sports/time";
import { socialMeta } from "@/lib/seo";

type Search = { month?: string; region?: string; sport?: string; day?: string };

export const Route = createFileRoute("/calendar")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    month: typeof s.month === "string" ? s.month : undefined,
    region: typeof s.region === "string" ? s.region : undefined,
    sport: typeof s.sport === "string" ? s.sport : undefined,
    day: typeof s.day === "string" ? s.day : undefined,
  }),
  loaderDeps: ({ search }) => ({ month: search.month }),
  loader: ({ deps }) => getMonthBoard({ data: { month: deps.month } }),
  staleTime: 30_000,
  pendingComponent: PendingScreen,
  errorComponent: RouteError,
  head: () => socialMeta({
    title: "Pennsylvania sports calendar — Keystone Beat",
    description: "Browse Pennsylvania team schedules by month, day, sport, and followed club.",
    path: "/calendar",
  }),
  component: CalendarPage,
});

function CalendarPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const board = Route.useLoaderData();
  const month = search.month ?? board.month;
  const region = parseRegion(search.region);
  const sport = search.sport ?? "all";
  const selected = search.day?.startsWith(month) ? search.day : month === dateKeyNY().slice(0, 7) ? dateKeyNY() : `${month}-01`;
  const [agenda, setAgenda] = useState(false);
  const setSelected = (day: string) => patch({ day, month: day.slice(0, 7) });
  const events = useDesk((s) => s.events);
  const deskHydrated = useDesk((s) => s.hydrated);
  const followed = useFollows((s) => s.slugs);
  const followHydrated = useFollows((s) => s.hydrated);

  const games = useMemo(
    () => applyView(board.games, region, sport, followed, followHydrated),
    [board.games, region, sport, followed, followHydrated],
  );
  const dayGames = games.filter((g) => g.dateKey === selected);
  const dayEvents = deskHydrated ? events.filter((e) => e.date === selected) : [];

  function patch(next: Partial<Search>) {
    if (next.region || next.sport) {
      writePrefs({
        region: parseRegion(next.region ?? region),
        sport: next.sport ?? sport,
      });
    }
    void navigate({ search: { ...search, ...next } });
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">Calendar</h1>
          <div className="flex items-center gap-2">
            <Button aria-label="Previous month" variant="outline" size="sm" onClick={() => patch({ month: shiftMonth(month, -1) })}>
              <ChevronLeft aria-hidden className="h-4 w-4" />
            </Button>
            <p className="min-w-28 text-center font-display text-xl tracking-wide">
              {new Date(`${month}-02T12:00:00`).toLocaleString("en-US", { month: "long", year: "numeric" })}
            </p>
            <Button aria-label="Next month" variant="outline" size="sm" onClick={() => patch({ month: shiftMonth(month, 1) })}>
              <ChevronRight aria-hidden className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="mt-3 max-w-xl text-muted">
          Games for the selected month. Choose a day, or switch to the agenda.
        </p>

        <FeedStatus at={board.generatedAt} warnings={board.warnings} />
        <div className="my-4 flex gap-3" role="group" aria-label="Calendar view"><Button aria-pressed={!agenda} variant={agenda ? 'outline' : 'default'} onClick={() => setAgenda(false)}>Month</Button><Button aria-pressed={agenda} variant={agenda ? 'default' : 'outline'} onClick={() => setAgenda(true)}>Agenda</Button></div>
        {agenda ? <section className="my-6">{games.length ? <div className="rounded-md bg-surface px-4 shadow-[var(--shadow-border)]">{games.map(g => <GameRow key={g.id} game={g} />)}</div> : <DataEmptyState title="No games this month" description="There are no games in this calendar view yet. Try another month or remove the current filters." linkTo="/" linkLabel="Back to today" />}</section> : null}
        <div className="mt-6">
          <FilterChips
            region={region}
            sport={sport}
            onRegion={(id) => patch({ region: id })}
            onSport={(id) => patch({ sport: id })}
          />
        </div>

        <div className={agenda ? "hidden" : "mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.9fr)]"}>
          <MonthGrid month={month} games={games} selected={selected} onSelect={setSelected} />
          <FadeSwap id={`day-${selected}`}>
            <div>
              <h2 className="font-display text-2xl tracking-wide">{formatLongDate(selected)}</h2>
              <PublishedUpdates date={selected} />
              <p className="mt-1 text-sm text-muted">
                {dayGames.length + dayEvents.length
                  ? `${dayGames.length + dayEvents.length} listed`
                  : "Nothing listed"}
              </p>
              <div className="mt-4 space-y-3">
                {dayEvents.map((e) => (
                  <div key={e.id} className="rounded-md border border-dashed border-border-strong bg-surface p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-accent">{e.sport || "Editor"}</p>
                    <p className="font-display text-xl">
                      {e.time ? `${e.time} · ` : ""}
                      {e.title}
                    </p>
                    {e.notes ? <p className="mt-1 text-sm text-muted">{e.notes}</p> : null}
                  </div>
                ))}
                {dayGames.map((g) => (
                  <GameCard key={g.id} game={g} />
                ))}
                {!dayGames.length && !dayEvents.length ? (
                  <DataEmptyState title="Nothing listed" description="No games or desk updates are listed for this day. Choose another date or check the full agenda." linkTo="/calendar" linkLabel="View the agenda" />
                ) : null}
              </div>
            </div>
          </FadeSwap>
        </div>
      </div>
  );
}
