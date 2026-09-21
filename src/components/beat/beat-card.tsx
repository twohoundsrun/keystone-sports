import { lazy, Suspense } from "react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { TEAM_BY_SLUG } from "@/data/teams";
import { SOURCE_TIER_LABELS, type BeatCategory, type PublicBeatItem } from "@/lib/beat/types";
import { formatAttribution } from "@/lib/beat/attribution";
import { relativeWhen } from "@/lib/sports/time";
import { BeatErrorBoundary } from "./beat-boundaries";

const BeatEmbed = lazy(() => import("./beat-embed").then((m) => ({ default: m.BeatEmbed })));

function categoryVariant(category: BeatCategory): "breaking" | "reaction" | "watch" | "default" {
  if (category === "breaking") return "breaking";
  if (category === "reaction") return "reaction";
  if (category === "watch") return "watch";
  return "default";
}

function CardFallback({ item }: { item: PublicBeatItem }) {
  return (
    <div className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
      <Badge variant={categoryVariant(item.category)}>{item.category === "from_the_beat" ? "From the beat" : item.category}</Badge>
      <p className="mt-2 text-sm leading-relaxed text-muted">{item.context ?? item.headline}</p>
      <a
        href={item.originalUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-block text-sm font-semibold text-accent hover:underline"
      >
        Open original · {formatAttribution(item.source)}
      </a>
    </div>
  );
}

function BeatCardInner({ item }: { item: PublicBeatItem }) {
  const team = item.teamSlug ? TEAM_BY_SLUG[item.teamSlug] : undefined;
  const label =
    item.category === "from_the_beat"
      ? "From the beat"
      : item.category === "locker_room"
        ? "Locker room"
        : item.category === "breaking"
          ? "Breaking"
          : item.category === "reaction"
            ? "Reaction"
            : "Watch";

  return (
    <article className="flex h-full flex-col rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={categoryVariant(item.category)}>{label}</Badge>
        {item.verifiedOfficial || item.sourceTier === "official_team_league" ? (
          <Badge variant="final">Official</Badge>
        ) : null}
        {item.pinned ? <Badge variant="breaking">Pinned</Badge> : null}
        <span className="text-t1 uppercase tracking-label text-subtle">{SOURCE_TIER_LABELS[item.sourceTier]}</span>
      </div>

      <p className="mt-3 font-display text-xl leading-tight tracking-wide">{item.headline}</p>
      {item.context ? <p className="mt-2 text-sm leading-relaxed text-muted">{item.context}</p> : null}

      <p className="mt-3 text-xs text-subtle">
        {formatAttribution(item.source, item.authorAccount, team?.shortName ?? item.league, item.timestamp ? relativeWhen(item.timestamp) : undefined)}
      </p>

      <Suspense fallback={<p className="mt-3 text-sm text-muted">Preparing media…</p>}>
        <BeatEmbed item={item} />
      </Suspense>

      <div className="mt-auto flex flex-wrap items-center gap-3 pt-4 text-sm">
        <a href={item.originalUrl} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">
          Open original
        </a>
        {item.teamSlug && TEAM_BY_SLUG[item.teamSlug] ? (
          <Link to="/teams/$slug" params={{ slug: item.teamSlug }} className="text-muted hover:text-fg">
            {TEAM_BY_SLUG[item.teamSlug].shortName} hub
          </Link>
        ) : null}
      </div>
    </article>
  );
}

export function BeatCard({ item }: { item: PublicBeatItem }) {
  return (
    <BeatErrorBoundary label={`card:${item.id}`} fallback={<CardFallback item={item} />}>
      <BeatCardInner item={item} />
    </BeatErrorBoundary>
  );
}
