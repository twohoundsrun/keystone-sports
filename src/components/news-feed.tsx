import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { TEAM_BY_SLUG } from "@/data/teams";
import { BEAT_CATEGORY_LABELS, type PublicBeatItem } from "@/lib/beat/types";
import { formatAttribution } from "@/lib/beat/attribution";
import type { NewsItem } from "@/lib/sports/types";
import { relativeWhen } from "@/lib/sports/time";
import { cn } from "@/lib/utils";

export function BreakingAlert({ item }: { item: PublicBeatItem }) {
  const team = item.teamSlug ? TEAM_BY_SLUG[item.teamSlug] : undefined;
  return (
    <article className="border-l-4 border-l-badge-breaking bg-surface px-4 py-5 shadow-[var(--shadow-border)] sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        {item.category === "breaking" ? <Badge variant="breaking">Breaking</Badge> : null}
        {item.pinned ? <Badge variant="breaking">Pinned</Badge> : null}
        {item.category !== "breaking" ? (
          <span className="text-t1 font-semibold uppercase tracking-label text-subtle">
            {BEAT_CATEGORY_LABELS[item.category]}
          </span>
        ) : null}
      </div>
      <a href={item.originalUrl} target="_blank" rel="noreferrer" className="mt-3 block hover:text-accent">
        <h2 className="font-display text-t5 leading-[var(--ks-leading-5)] tracking-display sm:text-t6">
          {item.headline}
        </h2>
      </a>
      {item.context ? <p className="mt-3 max-w-3xl text-t3 text-muted">{item.context}</p> : null}
      <p className="mt-3 text-t1 text-subtle">
        {formatAttribution(item.source, item.authorAccount, team?.shortName ?? item.league, item.timestamp ? relativeWhen(item.timestamp) : undefined)}
      </p>
    </article>
  );
}

export function DeskArticle({ item }: { item: NewsItem }) {
  const team = item.teamSlug ? TEAM_BY_SLUG[item.teamSlug] : undefined;
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-md bg-surface shadow-[var(--shadow-border)]">
      {item.image ? (
        <a href={item.href} target="_blank" rel="noreferrer" className="block">
          <img src={item.image} alt="" width={640} height={160} loading="lazy" decoding="async" className="h-40 w-full object-cover" />
        </a>
      ) : null}
      <div className="flex flex-1 flex-col p-4">
        <p className="text-t1 font-semibold uppercase tracking-label text-subtle">
          {item.source ? `${item.source} · ` : ""}
          {team?.shortName ?? item.league}
          {item.published ? ` · ${relativeWhen(item.published)}` : ""}
        </p>
        <a href={item.href} target="_blank" rel="noreferrer" className="mt-2 hover:text-accent">
          <h3 className="font-display text-t4 leading-[var(--ks-leading-4)] tracking-display">{item.headline}</h3>
        </a>
        {item.description ? (
          <p className="mt-2 line-clamp-3 text-t2 leading-relaxed text-muted">{item.description}</p>
        ) : null}
      </div>
    </article>
  );
}

export function LeadArticle({ item }: { item: NewsItem }) {
  const team = item.teamSlug ? TEAM_BY_SLUG[item.teamSlug] : undefined;
  return (
    <article className="overflow-hidden rounded-lg border border-accent/35 bg-surface shadow-[var(--shadow-elevated)]">
      {item.image ? (
        <a href={item.href} target="_blank" rel="noreferrer" className="block">
          <img src={item.image} alt="" width={960} height={360} loading="eager" decoding="async" className="h-48 w-full object-cover sm:h-64" />
        </a>
      ) : null}
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-t1 font-semibold uppercase tracking-label text-accent">
          <span>Lead story</span>
          <span className="text-subtle">·</span>
          <span>{item.source || "External coverage"}</span>
          {team?.shortName || item.league ? <><span className="text-subtle">·</span><span>{team?.shortName ?? item.league}</span></> : null}
          {item.published ? <><span className="text-subtle">·</span><span>{relativeWhen(item.published)}</span></> : null}
        </div>
        <a href={item.href} target="_blank" rel="noreferrer" className="mt-2 block hover:text-accent">
          <h2 className="font-display text-3xl leading-tight tracking-wide sm:text-4xl">{item.headline}</h2>
        </a>
        {item.description ? (
          <div className="mt-4 border-l-2 border-accent/50 pl-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Why it matters</p>
            <p className="mt-1 max-w-3xl text-base leading-relaxed text-muted">{item.description}</p>
          </div>
        ) : null}
        <p className="mt-4 text-xs text-subtle">Keystone Beat links to the original reporting; coverage opens on {item.source || "the source site"}.</p>
      </div>
    </article>
  );
}

export function WireList({ articles }: { articles: NewsItem[] }) {
  if (!articles.length) return null;
  return (
    <section className="mt-10" aria-label="Wire headlines">
      <h2 className="font-display text-t4 tracking-display text-muted">Wire</h2>
      <p className="mt-1 text-t2 text-subtle">Automated headlines. Lower priority than the desk.</p>
      <ul className="mt-3 divide-y divide-border border-y border-border">
        {articles.map((a) => {
          const team = a.teamSlug ? TEAM_BY_SLUG[a.teamSlug] : undefined;
          return (
            <li key={a.id}>
              <a
                href={a.href}
                target="_blank"
                rel="noreferrer"
                className="flex items-baseline justify-between gap-4 py-2.5 hover:text-accent"
              >
                <span className="min-w-0 text-t2 leading-snug text-muted">{a.headline}</span>
                <span className={cn("shrink-0 text-t1 uppercase tracking-label text-subtle")}>
                  {team?.shortName ?? a.source ?? a.league}
                  {a.published ? ` · ${relativeWhen(a.published)}` : ""}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function LockerRoom({ items }: { items: { id: string; title: string; href: string; updated: string; sub: string; teamSlug: string }[] }) {
  if (!items.length) return null;
  return (
    <aside>
      <h2 className="font-display text-t4 tracking-display">Locker room</h2>
      <p className="mt-1 text-t2 text-muted">Public fan threads, newest first.</p>
      <ul className="mt-4 space-y-3">
        {items.map((b) => (
          <li key={b.id} className="rounded-md bg-surface p-3 shadow-[var(--shadow-border)]">
            <p className="text-t1 uppercase tracking-label text-subtle">
              r/{b.sub}
              {b.updated ? ` · ${relativeWhen(b.updated)}` : ""}
            </p>
            <a href={b.href} target="_blank" rel="noreferrer" className="mt-1 block text-t2 leading-snug hover:text-accent">
              {b.title}
            </a>
            {TEAM_BY_SLUG[b.teamSlug] ? (
              <Link to="/teams/$slug" params={{ slug: b.teamSlug }} className="mt-2 inline-block text-t1 text-muted hover:text-fg">
                {TEAM_BY_SLUG[b.teamSlug].shortName}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </aside>
  );
}
