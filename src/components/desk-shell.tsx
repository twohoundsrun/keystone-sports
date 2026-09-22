import { useEffect, useMemo, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { CalendarDays, ListOrdered, MoreHorizontal, Newspaper, Shield, Table2, Trophy } from "lucide-react";
import { ScoreTicker } from "@/components/score-ticker";
import { ThemeSelector } from "@/components/theme-selector";
import { ResponsibleGamblingNote } from "@/components/responsible-gambling-note";
import { teamsByFollowed } from "@/data/teams";
import { useDesk } from "@/lib/sports/desk-store";
import { useFollows } from "@/lib/sports/follow-store";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Scores" },
  { to: "/calendar", label: "Calendar" },
  { to: "/odds", label: "Odds" },
  { to: "/news", label: "News" },
  { to: "/teams", label: "Teams" },
  { to: "/standings", label: "Standings" },
] as const;

const TABS = [
  { to: "/", label: "Scores", icon: Trophy },
  { to: "/news", label: "News", icon: Newspaper },
  { to: "/teams", label: "Teams", icon: Shield },
] as const;

const MORE_ITEMS = [
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/standings", label: "Standings", icon: ListOrdered },
  { to: "/odds", label: "Odds", icon: Table2 },
] as const;

function KeystoneMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="3" fill="currentColor" className="text-primary" />
      <path d="M8 8h16v7.2L16 24 8 15.2V8z" fill="currentColor" className="text-bg" />
      <path d="M11.2 10.2h9.6v4.4L16 20.4l-4.8-5.8v-4.4z" fill="currentColor" className="text-primary" />
    </svg>
  );
}

export function DeskShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hydrateDesk = useDesk((s) => s.hydrate);
  const hydrateFollows = useFollows((s) => s.hydrate);
  const followed = useFollows((s) => s.slugs);
  const footerTeams = useMemo(() => teamsByFollowed(followed), [followed]);

  useEffect(() => {
    hydrateDesk();
    hydrateFollows();
  }, [hydrateDesk, hydrateFollows]);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <div className="sticky top-0 z-20">
        <ScoreTicker />
        <header className="border-t-2 border-primary border-b border-border bg-bg/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 sm:gap-4 sm:px-6">
          <Link to="/" className="group flex h-11 shrink-0 items-center gap-2 sm:gap-2.5">
            <KeystoneMark className="h-8 w-8 transition-transform group-hover:scale-105 sm:h-9 sm:w-9" />
            <span className="leading-none">
              <span className="block font-display text-lg font-semibold tracking-widest sm:text-2xl">KEYSTONE BEAT</span>
              <span className="block text-[10px] font-semibold uppercase tracking-widest text-accent sm:text-xs">
                Pennsylvania Sports
              </span>
            </span>
          </Link>
          <span className="hidden border-l border-border pl-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-subtle lg:block">
            Philly · Pittsburgh · Colleges
          </span>
          <nav className="hidden min-w-0 flex-1 items-center justify-end gap-1 md:flex">
            {NAV.map((item) => {
              const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "inline-flex h-11 shrink-0 items-center px-3 text-sm font-semibold",
                    active
                      ? "border-b-2 border-accent bg-accent-soft text-fg"
                      : "text-muted hover:text-fg",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto md:ml-0">
            <ThemeSelector />
          </div>
        </div>
        </header>
      </div>
      <main className="pb-20 md:pb-0">{children}</main>
      <footer className="mt-12 border-t border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <div className="flex flex-col gap-8 lg:flex-row lg:justify-between">
            <div className="flex items-start gap-3">
              <KeystoneMark className="mt-0.5 h-8 w-8 shrink-0" />
              <div>
                <p className="font-display text-2xl tracking-widest">KEYSTONE BEAT</p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-accent">Pennsylvania Sports</p>
                <p className="mt-1 max-w-sm text-sm text-muted">
                  A small Pennsylvania desk — Philly, Pittsburgh, and the colleges. Scores, lines, and the beat, written
                  like the sports page, not a dashboard.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-10 gap-y-2 sm:grid-cols-3">
              {footerTeams.map((t) => (
                <Link
                  key={t.slug}
                  to="/teams/$slug"
                  params={{ slug: t.slug }}
                  className="text-sm text-muted hover:text-fg"
                >
                  {t.shortName}
                </Link>
              ))}
            </div>
          </div>
          <div className="mt-8 flex flex-col gap-3 border-t border-border pt-6 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <p>Keystone Beat · a small desk for a big state.</p>
              <a
                href="https://twohoundsrun.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-subtle hover:text-muted"
              >
                <img
                  src="/brand/two-hounds-mark.png"
                  alt=""
                  width={28}
                  height={28}
                  decoding="async"
                  className="h-7 w-7 rounded-full opacity-90"
                />
                <span>A Two Hounds Run site</span>
              </a>
            </div>
            <ResponsibleGamblingNote />
          </div>
        </div>
      </footer>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden">
        <div className="grid grid-cols-4">
          {TABS.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-[10px] font-semibold leading-tight sm:text-xs",
                  active ? "text-accent" : "text-muted",
                )}
              >
                <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.4 : 1.8} />
                {item.label}
              </Link>
            );
          })}
          <details className="relative flex min-h-14 flex-col items-center justify-center">
            <summary
              className={cn(
                "flex min-h-14 w-full list-none flex-col items-center justify-center gap-0.5 px-0.5 text-[10px] font-semibold leading-tight marker:hidden sm:text-xs",
                MORE_ITEMS.some((item) => pathname.startsWith(item.to)) ? "text-accent" : "text-muted",
              )}
            >
              <MoreHorizontal className="h-5 w-5 shrink-0" strokeWidth={1.8} />
              More
            </summary>
            <div className="absolute right-2 bottom-16 min-w-44 rounded-md border border-border bg-surface p-2 shadow-[var(--shadow-elevated)]">
              {MORE_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = pathname.startsWith(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-sm px-3 text-sm font-semibold",
                      active ? "bg-accent-soft text-accent" : "text-muted hover:bg-elevated hover:text-fg",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </details>
        </div>
      </nav>
    </div>
  );
}
