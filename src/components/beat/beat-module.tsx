import { useMemo, useState } from "react";
import type { BeatCategory, PublicBeatItem } from "@/lib/beat/types";
import { BEAT_CATEGORY_LABELS } from "@/lib/beat/types";
import { BeatCard } from "./beat-card";
import { BeatErrorBoundary } from "./beat-boundaries";
import { relativeWhen } from "@/lib/sports/time";

const FILTERS: Array<BeatCategory | "all"> = [
  "all",
  "breaking",
  "from_the_beat",
  "watch",
  "locker_room",
  "reaction",
];

type Props = {
  items: PublicBeatItem[];
  generatedAt?: string;
};

function ModuleFallback() {
  return (
    <section className="mt-8 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]" aria-label="Beat desk unavailable">
      <h2 className="font-display text-2xl tracking-wide">Beat desk</h2>
      <p className="mt-2 text-sm text-muted">
        Beat is temporarily unavailable. News RSS and Film Room hubs below still work.
      </p>
    </section>
  );
}

function BeatModuleInner({ items, generatedAt }: Props) {
  const [filter, setFilter] = useState<BeatCategory | "all">("all");
  const visible = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.category === filter)),
    [filter, items],
  );

  return (
    <section className="mt-8" aria-label="Beat desk">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl tracking-wide">Beat desk</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Curated PA sports desk — short Keystone context, original source always linked. Manual approval only.
          </p>
          {generatedAt ? <p className="mt-1 text-xs text-subtle">Desk updated {relativeWhen(generatedAt)} · Original reporting remains linked on every card.</p> : null}
        </div>
      </div>

      {!items.length ? (
        <p className="mt-4 text-sm text-muted">No Beat cards right now. News RSS and Film Room hubs below still work.</p>
      ) : (
        <>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {FILTERS.map((key) => {
              const label = key === "all" ? "All" : BEAT_CATEGORY_LABELS[key];
              const active = filter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={
                    active
                      ? "shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-fg"
                      : "shrink-0 rounded-full bg-elevated px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted hover:text-fg"
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>

          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {visible.map((item) => (
              <li key={item.id}>
                <BeatCard item={item} />
              </li>
            ))}
          </ul>
          {!visible.length ? (
            <p className="mt-4 text-sm text-muted">No cards in this category right now.</p>
          ) : null}
        </>
      )}
    </section>
  );
}

export function BeatModule(props: Props) {
  return (
    <BeatErrorBoundary label="module" fallback={<ModuleFallback />}>
      <BeatModuleInner {...props} />
    </BeatErrorBoundary>
  );
}
