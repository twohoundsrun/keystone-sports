import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Game, GameSide } from "@/lib/sports/types";
import { formatKick, formatTime } from "@/lib/sports/time";
import { isFollowedGame } from "@/lib/sports/filter";
import { useFollows } from "@/lib/sports/follow-store";
import { downloadGameCalendar } from "@/lib/sports/calendar";

function Logo({ side, size, priority }: { side: GameSide; size: "sm" | "lg"; priority?: boolean }) {
  const dim = size === "lg" ? 56 : 40;
  const img = (
    <img
      data-logo
      src={side.logo}
      alt={side.slug ? "" : side.name}
      width={dim}
      height={dim}
      decoding="async"
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "low"}
      className={cn("object-contain", size === "lg" ? "h-12 w-12 sm:h-14 sm:w-14" : "h-10 w-10")}
    />
  );
  if (!side.slug) return <div className="flex flex-col items-center gap-1">{img}</div>;
  return (
    <Link
      to="/teams/$slug"
      params={{ slug: side.slug }}
      className="flex min-w-0 flex-col items-center gap-1 rounded-sm hover:bg-elevated/70"
      aria-label={side.name}
    >
      {img}
    </Link>
  );
}

function TeamCol({ side, muted, align, priority }: { side: GameSide; muted?: boolean; align: "left" | "right"; priority?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col gap-1", align === "right" ? "items-end" : "items-start")}>
      <Logo side={side} size="sm" priority={priority} />
      <p
        className={cn(
          "max-w-full truncate font-display text-t2 tracking-display",
          muted ? "text-muted" : "text-fg",
        )}
      >
        {side.abbr}
      </p>
      <p className="hidden max-w-full truncate text-t1 text-subtle sm:block">{side.name}</p>
    </div>
  );
}

function CenterScore({ game, muted }: { game: Game; muted?: boolean }) {
  const live = game.status === "in";
  const done = game.status === "post";
  const away = game.away.score ?? "—";
  const home = game.home.score ?? "—";

  if (game.status === "pre") {
    return (
      <div className="flex min-w-0 flex-col items-center px-2 text-center">
        <p className="font-display text-t5 leading-[var(--ks-leading-5)] tracking-display tabular sm:text-t6">
          {formatTime(game.start)}
        </p>
        <p className="mt-0.5 text-t1 uppercase tracking-label text-subtle">ET</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col items-center px-2 text-center">
      <p
        className={cn(
          "font-display text-t5 leading-[var(--ks-leading-6)] tracking-display tabular sm:text-t6",
          muted && "text-muted",
        )}
      >
        <span className={cn(done && game.away.winner && "text-fg")}>{away}</span>
        <span className="mx-1.5 text-subtle">–</span>
        <span className={cn(done && game.home.winner && "text-fg")}>{home}</span>
      </p>
      <p className={cn("mt-0.5 text-t1 uppercase tracking-label", live ? "text-ok" : "text-subtle")}>
        {live ? game.statusText : done ? "Final" : formatKick(game.start)}
      </p>
    </div>
  );
}

function OddsRow({ game }: { game: Game }) {
  const spread = game.odds?.spread ?? game.odds?.details;
  const total = game.odds?.total ? game.odds.total.replace(/^o/i, "") : undefined;
  const ml =
    game.odds?.awayMl || game.odds?.homeMl
      ? `${game.odds.awayMl ?? "—"} / ${game.odds.homeMl ?? "—"}`
      : undefined;
  if (!spread && !total && !ml) return null;
  return (
    <p className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-t2 text-accent-muted">
      {spread ? <span>Spread {spread}</span> : null}
      {total ? <span>O/U {total}</span> : null}
      {ml ? <span>ML {ml}</span> : null}
    </p>
  );
}

export function GameCard({
  game,
  featured,
  nextUp,
}: {
  game: Game;
  featured?: boolean;
  nextUp?: boolean;
}) {
  const followedSlugs = useFollows((s) => s.slugs);
  const live = game.status === "in";
  const done = game.status === "post";
  const followed = isFollowedGame(game, followedSlugs);
  const highlightNext = Boolean(nextUp) && !live && !done;

  return (
    <article
      className={cn(
        "score-card bg-surface shadow-[var(--shadow-border)]",
        featured ? "rounded-lg p-4 sm:p-5" : "rounded-md p-4",
        done && "text-muted",
        live && "border-l-2 border-l-ok",
        followed && !live && "ring-1 ring-accent/40",
        highlightNext && "bg-accent-soft ring-1 ring-accent/50",
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-t1 font-semibold uppercase tracking-label text-subtle">
          {game.league}
          {game.broadcast ? ` · ${game.broadcast}` : ""}
        </p>
        {live ? (
          <span className="inline-flex shrink-0 items-center gap-1.5">
            <span className="live-dot inline-block h-2 w-2 rounded-full bg-ok" aria-hidden />
            <Badge variant="live">Live · {game.statusText}</Badge>
          </span>
        ) : done ? (
          <Badge variant="final">{game.statusText || "Final"}</Badge>
        ) : highlightNext ? (
          <Badge variant="watch">Next up</Badge>
        ) : (
          <Badge variant="outline">{formatKick(game.start)}</Badge>
        )}
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <TeamCol side={game.away} muted={done && !game.away.winner} align="left" priority={featured} />
        <CenterScore game={game} muted={done} />
        <TeamCol side={game.home} muted={done && !game.home.winner} align="right" priority={featured} />
      </div>

      <OddsRow game={game} />

      {game.venue ? (
        <p className="mt-2 truncate text-center text-t1 text-subtle">{game.venue}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap justify-center gap-4 border-t border-border pt-2 text-t2">
        <Link
          to="/game"
          search={{ date: game.dateKey, id: game.id }}
          className="inline-flex min-h-11 items-center font-semibold underline"
        >
          Game details
        </Link>
        {game.status === "pre" && !/postpon|cancel|tbd/i.test(game.statusText) ? (
          <button type="button" className="min-h-11 underline" onClick={() => downloadGameCalendar(game)}>
            Add to calendar
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function GameRow({ game }: { game: Game }) {
  const live = game.status === "in";
  const slug = game.paSlugs[0];
  const line = game.odds?.spread ?? game.odds?.details ?? game.odds?.total;
  const inner = (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 py-3 sm:grid-cols-[4.5rem_1fr_auto_auto]">
      <p className="hidden text-xs font-semibold uppercase tracking-wider text-muted sm:block">{game.league}</p>
      <p className="min-w-0 truncate text-sm">
        <span className="font-semibold">{game.away.abbr}</span>
        {game.status !== "pre" && game.away.score ? (
          <span className="ml-1 tabular-nums text-muted">{game.away.score}</span>
        ) : null}
        <span className="mx-1.5 text-subtle">@</span>
        <span className="font-semibold">{game.home.abbr}</span>
        {game.status !== "pre" && game.home.score ? (
          <span className="ml-1 tabular-nums text-muted">{game.home.score}</span>
        ) : null}
      </p>
      <p className="text-xs tabular-nums text-muted">
        {live ? game.statusText : game.status === "post" ? "Final" : formatKick(game.start)}
      </p>
      {line ? <p className="hidden text-xs text-muted sm:block">{line}</p> : <span className="hidden sm:block" />}
    </div>
  );
  if (slug) {
    return (
      <Link
        to="/game"
        search={{ date: game.dateKey, id: game.id }}
        className="block border-b border-border last:border-0 hover:bg-elevated/60"
      >
        {inner}
      </Link>
    );
  }
  return <div className="border-b border-border last:border-0">{inner}</div>;
}
