import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { TEAM_BY_SLUG } from "@/data/teams";
import { useFollows } from "@/lib/sports/follow-store";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "keystone-follow-onboarding-dismissed";

const QUICK_PICKS = [
  "eagles",
  "steelers",
  "phillies",
  "pirates",
  "sixers",
  "flyers",
  "penguins",
  "penn-state",
  "pitt",
  "union",
] as const;

export function FollowOnboarding() {
  const hydrated = useFollows((s) => s.hydrated);
  const followed = useFollows((s) => s.slugs);
  const toggle = useFollows((s) => s.toggle);
  const [dismissed, setDismissed] = useState(true);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  // Empty-state entry: only open when no follows. Stay open while picking until ~3 or Skip.
  const show =
    hydrated &&
    !dismissed &&
    (followed.length === 0 || (picking && followed.length < 3));

  if (!show) return null;

  function skip() {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
    setPicking(false);
  }

  function onToggle(slug: string) {
    setPicking(true);
    toggle(slug);
  }

  const count = followed.length;
  const hint =
    count === 0
      ? "Aim for about 3 — soft suggestion, not a hard limit."
      : count < 3
        ? `${count} selected · pick ${3 - count} more if you like.`
        : `${count} selected · looking good.`;

  return (
    <section
      className="mx-auto max-w-6xl px-4 py-4 sm:px-6"
      aria-label="Follow Pennsylvania teams"
    >
      <div className="rounded-md border border-border bg-surface p-5 shadow-[var(--shadow-border)] sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-accent">Make this desk yours</p>
            <h2 className="mt-1 font-display text-2xl tracking-wide sm:text-3xl">
              Follow the teams you care about
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
              Pick a few clubs so scores, headlines, and the ticker prioritize what matters to you. You can change this anytime.
            </p>
          </div>
          <button
            type="button"
            onClick={skip}
            className="shrink-0 self-start text-sm text-subtle underline-offset-2 hover:text-muted hover:underline"
          >
            Skip for now
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {QUICK_PICKS.map((slug) => {
            const team = TEAM_BY_SLUG[slug];
            if (!team) return null;
            const on = followed.includes(slug);
            return (
              <button
                key={slug}
                type="button"
                onClick={() => onToggle(slug)}
                aria-pressed={on}
                className={cn(
                  "inline-flex h-10 items-center rounded-full border px-3.5 text-sm font-semibold transition-colors",
                  on
                    ? "border-accent bg-accent/15 text-fg"
                    : "border-border bg-elevated text-muted hover:border-border-strong hover:text-fg",
                )}
              >
                {team.shortName}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">{hint}</p>
          <Link
            to="/teams"
            className="text-sm font-semibold text-accent underline-offset-2 hover:underline"
          >
            See all teams →
          </Link>
        </div>
      </div>
    </section>
  );
}
