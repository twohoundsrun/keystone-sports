import { createFileRoute, Link } from "@tanstack/react-router";
import { FollowButton } from "@/components/follow-button";
import { TEAMS, TEAM_BY_SLUG, teamLogo } from "@/data/teams";
import { useFollows } from "@/lib/sports/follow-store";

export const Route = createFileRoute("/teams/")({
  head: () => ({
    meta: [{ title: "Teams — Keystone Beat" }],
  }),
  component: TeamsPage,
});

function TeamCard({ slug }: { slug: string }) {
  const t = TEAM_BY_SLUG[slug];
  if (!t) return null;
  return (
    <div
      className="relative flex items-center gap-3 overflow-hidden rounded-md border-t-2 bg-surface p-3 shadow-[var(--shadow-border)] transition-shadow hover:shadow-[var(--shadow-border-hover)]"
      style={{ borderTopColor: t.color }}
    >
      <Link
        to="/teams/$slug"
        params={{ slug: t.slug }}
        className="flex min-w-0 flex-1 items-center gap-4"
      >
        <img data-logo src={teamLogo(t)} alt="" width={48} height={48} loading="lazy" decoding="async" className="h-12 w-12 object-contain" />
        <div className="min-w-0">
          <p className="font-display text-xl tracking-wide">{t.shortName}</p>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">{t.league} · {t.sport}</p>
          <p className="mt-0.5 truncate text-sm text-muted">{t.city} · {t.nick}</p>
        </div>
      </Link>
      <FollowButton slug={t.slug} name={t.shortName} variant="icon" />
    </div>
  );
}

function TeamsPage() {
  const followed = useFollows((s) => s.slugs);
  const groups = [
    { label: "Philadelphia", items: TEAMS.filter((t) => t.region === "philly") },
    { label: "Pittsburgh", items: TEAMS.filter((t) => t.region === "pittsburgh") },
    { label: "College", items: TEAMS.filter((t) => t.region === "college") },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Pennsylvania sports desk</p>
        <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight sm:text-5xl">Teams</h1>
        <p className="mt-3 max-w-xl text-muted">
          Fifteen Pennsylvania clubs. Star the ones you follow — they lead the ticker and the slate. Open a club for
          the schedule, the beat, and the team's own feed.
        </p>
        {followed.length ? (
          <section className="mt-10">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-2xl tracking-wide">Your clubs</h2>
              <span className="text-xs font-semibold uppercase tracking-wider text-accent">{followed.length} followed</span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {followed.map((slug) => (
                <TeamCard key={slug} slug={slug} />
              ))}
            </div>
          </section>
        ) : null}
        <div className="mt-10 space-y-10">
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className="font-display text-2xl tracking-wide">{g.label}</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.map((t) => (
                  <TeamCard key={t.slug} slug={t.slug} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
  );
}
