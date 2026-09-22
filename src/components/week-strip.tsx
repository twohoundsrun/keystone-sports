import { addDays, weekdayShort } from "@/lib/sports/time";
import type { Game } from "@/lib/sports/types";
import { cn } from "@/lib/utils";

function hourNY(iso: string): number {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 18;
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  return Number(hour.find((p) => p.type === "hour")?.value ?? 18);
}

/** Four ET windows: morning / afternoon / prime / late. */
function densityBars(games: Game[], dateKey: string): [number, number, number, number] {
  const bars: [number, number, number, number] = [0, 0, 0, 0];
  for (const game of games) {
    if (game.dateKey !== dateKey) continue;
    const h = hourNY(game.start);
    if (h < 12) bars[0] += 1;
    else if (h < 16) bars[1] += 1;
    else if (h < 20) bars[2] += 1;
    else bars[3] += 1;
  }
  return bars;
}

function DensityChart({
  bars,
  active,
  live,
}: {
  bars: [number, number, number, number];
  active?: boolean;
  live?: boolean;
}) {
  const max = Math.max(1, ...bars);
  const fill = live ? "var(--ks-ok)" : active ? "currentColor" : "var(--ks-accent-muted)";
  return (
    <svg viewBox="0 0 20 14" width="20" height="14" aria-hidden className="mt-0.5">
      {bars.map((n, i) => {
        const h = n === 0 ? 1.25 : Math.max(2.5, (n / max) * 12);
        return <rect key={i} x={i * 5 + 0.5} y={14 - h} width="3.5" height={h} rx="0.6" fill={fill} opacity={n === 0 ? 0.35 : 1} />;
      })}
    </svg>
  );
}

export function WeekStrip({
  origin,
  selected,
  games,
  liveDays,
  onSelect,
}: {
  origin: string;
  selected: string;
  games: Game[];
  liveDays: Set<string>;
  onSelect: (date: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(origin, i));
  return (
    <div className="week-strip no-scrollbar -mx-1 mt-5 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {days.map((key, i) => {
        const active = key === selected;
        const bars = densityBars(games, key);
        const n = bars.reduce((sum, v) => sum + v, 0);
        const live = liveDays.has(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            aria-label={
              live
                ? `${i === 0 ? "Today" : weekdayShort(key)} ${Number(key.slice(8))}, live games`
                : `${i === 0 ? "Today" : weekdayShort(key)} ${Number(key.slice(8))}, ${n} game${n === 1 ? "" : "s"}`
            }
            aria-current={active ? "date" : undefined}
            className={cn(
              "flex min-h-16 min-w-16 shrink-0 flex-col items-center justify-center rounded-md border px-3 py-1.5",
              active ? "border-primary bg-primary text-primary-fg" : "border-border bg-surface text-fg hover:bg-elevated",
            )}
          >
            <span className={cn("text-t1 font-semibold uppercase tracking-label", active ? "text-primary-fg/80" : "text-muted")}>
              {i === 0 ? "Today" : weekdayShort(key)}
            </span>
            <span className="font-display text-t4 leading-none">{Number(key.slice(8))}</span>
            <DensityChart bars={bars} active={active} live={live} />
          </button>
        );
      })}
    </div>
  );
}
