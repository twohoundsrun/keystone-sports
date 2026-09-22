import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CalendarDays, ExternalLink } from "lucide-react";
import { DataEmptyState } from "@/components/data-empty-state";
import { FeedStatus } from "@/components/feed-status";
import { GameCard } from "@/components/game-card";
import { getGameDetail } from "@/lib/sports/api";
import { socialMeta } from "@/lib/seo";

export const Route = createFileRoute("/game")({
  validateSearch: (s: Record<string, unknown>) => ({
    date: typeof s.date === "string" ? s.date : "",
    id: typeof s.id === "string" ? s.id : "",
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getGameDetail({ data: deps }),
  head: ({ loaderData }) => {
    const game = loaderData?.game;
    const title = game ? `${game.away.abbr} at ${game.home.abbr} — Keystone Beat` : "Game details — Keystone Beat";
    const description = game
      ? `${game.name}: ${game.status === "pre" ? `scheduled for ${game.start}` : game.statusText || "score and game details"}. Pennsylvania sports coverage from Keystone Beat.`
      : "Pennsylvania game scores, schedules, and source-linked details from Keystone Beat.";
    const path = game ? `/game?date=${encodeURIComponent(game.dateKey)}&id=${encodeURIComponent(game.id)}` : "/game";
    return socialMeta({ title, description, path });
  },
  component: GamePage,
});

function GamePage() {
  const { game, lines, players, warning, generatedAt } = Route.useLoaderData();

  if (!game) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <DataEmptyState
          title="Game unavailable"
          description="This game was not returned by the latest feed. It may have moved or expired; return to Scores and refresh the board."
          linkTo="/"
          linkLabel="Back to scores"
        />
      </div>
    );
  }

  const pregame = game.status === "pre";
  const live = game.status === "in";
  const statsTitle = pregame ? "Season averages" : "Game statistics";
  const statsHint = pregame
    ? "These are season averages until tip-off or kickoff — not live box-score lines for this game."
    : null;
  const contextMessage = pregame
    ? "Pregame view: use the time, broadcast, venue, and public line to plan ahead."
    : live
      ? "Live view: scores and status update as the feed refreshes."
      : "Final view: review the score, available statistics, and official coverage.";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <Link to="/" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to scores
      </Link>

      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Game desk · {game.league}</p>
        <h1 className="mt-1 font-display text-3xl tracking-wide sm:text-4xl">{game.name}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{contextMessage}</p>
      </header>

      <FeedStatus at={generatedAt} warnings={warning ? [warning] : []} />
      <GameCard game={game} featured />

      {lines.length ? (
        <section className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
          <h2 className="font-display text-2xl tracking-wide">{statsTitle}</h2>
          {statsHint ? <p className="mt-1 text-sm text-muted">{statsHint}</p> : null}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wider text-muted">
                  <th className="p-2">{pregame ? "Statistic (avg)" : "Statistic / period"}</th>
                  <th className="p-2">{game.away.abbr}</th>
                  <th className="p-2">{game.home.abbr}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={`${line.label}-${i}`} className="border-t border-border">
                    <th className="p-2 font-normal">{line.label}</th>
                    <td className="p-2 tabular-nums">{line.away}</td>
                    <td className="p-2 tabular-nums">{line.home}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <DataEmptyState
          title={pregame ? "Stats arrive at game time" : "No detailed stats yet"}
          description={pregame ? "Season averages will appear when the feed provides them. The schedule, venue, broadcast, and line are still available above." : "The feed did not return detailed statistics for this game. Check the official coverage for the complete box score."}
        />
      )}

      {players.length ? (
        <section className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
          <h2 className="font-display text-2xl tracking-wide">{pregame ? "Season leaders" : "Key performers"}</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {players.map((player, i) => <li key={i} className="border-t border-border pt-2 first:border-0 first:pt-0">{player}</li>)}
          </ul>
        </section>
      ) : null}

      <section className="rounded-md border border-border bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
        <h2 className="font-display text-2xl tracking-wide">Game info</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex"><dt className="w-24 shrink-0 text-muted">League</dt><dd>{game.league}</dd></div>
          {game.venue ? <div className="flex"><dt className="w-24 shrink-0 text-muted">Venue</dt><dd>{game.venue}</dd></div> : null}
          {game.broadcast ? <div className="flex"><dt className="w-24 shrink-0 text-muted">TV</dt><dd>{game.broadcast}</dd></div> : null}
          {game.odds?.details || game.odds?.spread ? <div className="flex"><dt className="w-24 shrink-0 text-muted">Public line</dt><dd>{game.odds.details ?? game.odds.spread}</dd></div> : null}
        </dl>
        <div className="mt-4 flex flex-wrap gap-3">
          {game.status === "pre" ? (
            <span className="inline-flex min-h-11 items-center gap-2 rounded-sm bg-accent-soft px-3 text-sm font-semibold text-accent">
              <CalendarDays className="h-4 w-4" aria-hidden />
              Add to calendar from the game card above
            </span>
          ) : null}
          {game.sourceUrl ? (
            <a href={game.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-sm bg-primary px-3 text-sm font-semibold text-primary-fg">
              <ExternalLink className="h-4 w-4" aria-hidden />
              Open official {game.league} coverage
            </a>
          ) : null}
        </div>
      </section>
    </div>
  );
}
