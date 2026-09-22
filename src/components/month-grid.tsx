import { cn } from "@/lib/utils";
import type { Game } from "@/lib/sports/types";
import { monthBounds } from "@/lib/sports/time";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function cellsFor(month: string): Array<{ key: string; inMonth: boolean }> {
  const { start, end } = monthBounds(month);
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const startPad = first.getUTCDay();
  const lastDay = Number(end.slice(8));
  const cells: Array<{ key: string; inMonth: boolean }> = [];
  for (let i = 0; i < startPad; i++) {
    const d = new Date(Date.UTC(y, m - 1, 1 - (startPad - i)));
    cells.push({ key: d.toISOString().slice(0, 10), inMonth: false });
  }
  for (let d = 1; d <= lastDay; d++) {
    cells.push({ key: `${start.slice(0, 8)}${String(d).padStart(2, "0")}`, inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const extra = cells.length - (startPad + lastDay) + 1;
    const d = new Date(Date.UTC(y, m, extra));
    cells.push({ key: d.toISOString().slice(0, 10), inMonth: false });
  }
  return cells;
}

export function MonthGrid({
  month,
  games,
  selected,
  onSelect,
}: {
  month: string;
  games: Game[];
  selected: string;
  onSelect: (date: string) => void;
}) {
  const byDay = new Map<string, Game[]>();
  for (const g of games) {
    const list = byDay.get(g.dateKey) ?? [];
    list.push(g);
    byDay.set(g.dateKey, list);
  }
  const cells = cellsFor(month);

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 pb-1">
        {DOW.map((d) => (
          <p key={d} className="px-1 text-center text-xs font-semibold uppercase tracking-wider text-subtle">
            {d}
          </p>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell) => {
          const list = byDay.get(cell.key) ?? [];
          const isSel = cell.key === selected;
          return (
            <button
              key={cell.key}
              type="button"
              onClick={() => onSelect(cell.key)}
              aria-label={`${cell.key}: ${list.length ? list.map((g) => g.shortName).join(", ") : "no games"}`}
              aria-pressed={isSel}
              className={cn(
                "flex min-h-16 flex-col items-start rounded-sm border px-1.5 py-1.5 text-left transition-colors sm:min-h-20",
                cell.inMonth ? "border-border bg-surface" : "border-transparent bg-transparent text-subtle",
                isSel && "border-primary bg-elevated",
              )}
            >
              <span className={cn("text-xs tabular-nums", isSel ? "font-semibold text-primary" : "text-muted")}>
                {Number(cell.key.slice(8))}
              </span>
              <span className="hidden truncate text-xs sm:block">{list.slice(0, 2).map(g => g.home.slug ? g.home.abbr : g.away.abbr).join(" · ")}</span>
              <span className="mt-auto flex flex-wrap gap-0.5">
                {list.slice(0, 4).map((g) => (
                  <span
                    key={g.id}
                    className={cn("h-1.5 w-1.5 rounded-full", g.status === "in" ? "bg-accent" : "bg-primary/50")}
                    title={g.shortName}
                    aria-hidden
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
