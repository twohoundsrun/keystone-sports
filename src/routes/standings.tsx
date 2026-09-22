import { createFileRoute, Link } from "@tanstack/react-router";
import { getStandings } from "@/lib/sports/api";
import { FeedStatus } from "@/components/feed-status";
import { ResponsibleGamblingNote } from "@/components/responsible-gambling-note";
import { DataEmptyState } from "@/components/data-empty-state";
import { TEAM_BY_SLUG } from "@/data/teams";
import { cn } from "@/lib/utils";
import type { StandingsLeague, StandingRow } from "@/lib/sports/types";

const LEAGUES: { key: StandingsLeague; label: string }[] = [
  { key: "nfl", label: "NFL" },
  { key: "nba", label: "NBA" },
  { key: "nhl", label: "NHL" },
  { key: "mlb", label: "MLB" },
  { key: "cfb", label: "College Football" },
  { key: "cbb", label: "College Basketball" },
];

const COLS: Record<StandingsLeague, string[]> = {
  nfl: ["W", "L", "T", "PCT"],
  nba: ["W", "L", "PCT"],
  mlb: ["W", "L", "PCT"],
  nhl: ["W", "L", "OT", "PTS"],
  cfb: ["W", "L", "PCT"],
  cbb: ["W", "L", "PCT"],
};

function cellValue(name: string, r: StandingRow): string {
  switch (name) {
    case "W":
      return String(r.wins);
    case "L":
      return String(r.losses);
    case "T":
      return String(r.ties ?? 0);
    case "OT":
      return String(r.otl ?? 0);
    case "PTS":
      return String(r.points ?? 0);
    case "PCT":
      return r.winPercent;
    default:
      return "";
  }
}

function groupAllZero(rows: StandingRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.wins === 0 && r.losses === 0 && !(r.ties ?? 0) && !(r.points ?? 0));
}

function isDivisionLeader(row: StandingRow, index: number, rows: StandingRow[], blank: boolean): boolean {
  if (blank || !rows.length) return false;
  if (index === 0) return true;
  const gb = (row.gamesBehind || "").trim();
  const leadGb = (rows[0]?.gamesBehind || "").trim();
  return Boolean(gb) && gb === leadGb && (gb === "0" || gb === "0.0" || gb === "—");
}

function parseStreak(raw: string): { kind: "W" | "L" | "T"; n: number } | null {
  const s = (raw || "").trim();
  if (!s || s === "—" || s === "-") return null;
  const short = s.match(/^([WLT])\s*(\d+)$/i);
  if (short) return { kind: short[1].toUpperCase() as "W" | "L" | "T", n: Number(short[2]) };
  const words = s.match(/^(won|lost|tied)\s+(\d+)$/i);
  if (words) {
    const kind = words[1].toLowerCase() === "won" ? "W" : words[1].toLowerCase() === "lost" ? "L" : "T";
    return { kind, n: Number(words[2]) };
  }
  const signed = s.match(/^([+-])(\d+)$/);
  if (signed) return { kind: signed[1] === "+" ? "W" : "L", n: Number(signed[2]) };
  return null;
}

function StreakMark({ raw }: { raw: string }) {
  const parsed = parseStreak(raw);
  if (!parsed) return <span className="text-subtle">—</span>;
  const label = `${parsed.kind}${parsed.n}`;
  return (
    <span
      className={cn(
        "inline-flex min-w-8 justify-center rounded-pill px-1.5 py-0.5 font-display text-t1 tracking-label",
        parsed.kind === "W" && "bg-ok/15 text-ok",
        parsed.kind === "L" && "bg-badge-breaking/15 text-badge-breaking",
        parsed.kind === "T" && "bg-elevated text-muted",
      )}
    >
      {label}
    </span>
  );
}

export const Route = createFileRoute("/standings")({
  validateSearch: (s: Record<string, unknown>) => ({ league: typeof s.league === "string" ? s.league : "nfl" }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => getStandings({ data: { league: deps.league } }),
  staleTime: 60_000,
  head: () => ({ meta: [{ title: "Pennsylvania standings — Keystone Beat" }] }),
  component: StandingsPage,
});

function pageHeading(league: StandingsLeague): string {
  switch (league) {
    case "cfb":
      return "Pennsylvania CFB";
    case "cbb":
      return "Pennsylvania college basketball";
    case "nfl":
      return "NFL — Pennsylvania";
    case "mlb":
      return "MLB — Pennsylvania";
    case "nba":
      return "NBA — Pennsylvania";
    case "nhl":
      return "NHL — Pennsylvania";
    default:
      return "Pennsylvania standings";
  }
}

function StandingsPage() {
  const board = Route.useLoaderData();
  const cols = COLS[board.league] ?? COLS.nfl;
  const blankBoard = board.groups.length > 0 && board.groups.every((g) => groupAllZero(g.rows));
  const resetNote = blankBoard ? "Records reset for 2026" : board.seasonNote;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">{pageHeading(board.league)}</h1>
      <p className="mt-3 max-w-xl text-muted">
        Division and conference tables around the Keystone clubs — not a full national board. Ours are marked and linked.
      </p>
      <p className="mt-2 max-w-xl text-sm text-subtle">
        We only show the divisions your PA teams play in.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        {LEAGUES.map((l) => (
          <Link
            key={l.key}
            to="/standings"
            search={{ league: l.key }}
            className={cn(
              "inline-flex h-10 items-center rounded-sm border px-3 text-sm font-semibold",
              l.key === board.league ? "border-primary bg-surface text-fg" : "border-border text-muted hover:text-fg",
            )}
          >
            {l.label}
          </Link>
        ))}
      </div>
      <FeedStatus at={board.generatedAt} warnings={board.warnings ?? []} />
      {board.seasonLabel ? <p className="mt-4 text-sm text-muted">Season: {board.seasonLabel}</p> : null}
      {resetNote ? <p className="mt-2 text-sm font-semibold text-accent">{resetNote}</p> : null}
      {board.groups.length ? (
        <div className="mt-6 space-y-8">
          {board.groups.map((g) => {
            const blank = groupAllZero(g.rows);
            return (
              <section key={g.id}>
                <h2 className="font-display text-2xl tracking-wide">{g.name}</h2>
                <div className="mt-3 overflow-x-auto rounded-md border border-border bg-surface">
                  <table className="w-full min-w-[32rem] text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-wider text-muted">
                        <th className="p-2 font-semibold">Team</th>
                        {cols.map((c) => (
                          <th key={c} className="p-2 font-semibold">
                            {c}
                          </th>
                        ))}
                        <th className="p-2 font-semibold">GB</th>
                        <th className="p-2 font-semibold">Streak</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r, i) => {
                        const leader = isDivisionLeader(r, i, g.rows, blank);
                        return (
                          <tr
                            key={`${g.id}-${r.teamId}`}
                            className={cn(
                              "border-t border-border",
                              r.slug && "border-l-2 border-l-accent",
                              leader && "bg-accent-soft",
                            )}
                          >
                            <td className="p-2">
                              {r.slug && TEAM_BY_SLUG[r.slug] ? (
                                <Link to="/teams/$slug" params={{ slug: r.slug }} className="font-semibold hover:text-accent">
                                  {r.name}
                                </Link>
                              ) : (
                                r.name
                              )}
                            </td>
                            {cols.map((c) => (
                              <td key={c} className="p-2 tabular-nums">
                                {cellValue(c, r)}
                              </td>
                            ))}
                            <td className="p-2 tabular-nums">{r.gamesBehind}</td>
                            <td className="p-2">
                              <StreakMark raw={r.streak} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="mt-6">
          <DataEmptyState
            title="Standings unavailable"
            description="The standings feed did not return a table for this league. Try another league or check back after the next update."
            linkTo="/"
            linkLabel="Back to scores"
          />
        </div>
      )}
      <p className="mt-8 text-xs text-subtle">Showing PA regional team divisions. Records reset for 2026 season.</p>
      <ResponsibleGamblingNote className="mt-2" />
    </div>
  );
}
