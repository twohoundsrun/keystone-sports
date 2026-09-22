import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { relativeWhen } from "@/lib/sports/time";
import { cn } from "@/lib/utils";

export function FeedStatus({ at, warnings = [] }: { at: string; warnings?: string[] }) {
  const [spin, setSpin] = useState(false);
  useEffect(() => {
    setSpin(true);
    const t = window.setTimeout(() => setSpin(false), 720);
    return () => window.clearTimeout(t);
  }, [at]);

  const age = Date.now() - Date.parse(at);
  const fresh = Number.isFinite(age) && age < 20_000;
  const when = fresh ? "just now" : relativeWhen(at);
  const delayedWarning = "Updates delayed — showing last available scores.";
  const feedWarnings = warnings.filter((warning) => warning !== delayedWarning);
  const delayed = age > 90_000 || warnings.includes(delayedWarning);

  return (
    <div className={cn("my-4 rounded-md border px-3 py-2.5 text-sm", delayed ? "border-warn/40 bg-warn/5" : "border-border bg-surface")} role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
        <span className={cn("inline-flex items-center gap-1.5 font-semibold", delayed ? "text-warn" : "text-fg")}>
          <RefreshCw className={cn("h-3.5 w-3.5 shrink-0", spin && "animate-spin")} aria-hidden />
          {delayed ? "Updates delayed" : fresh ? "Fresh feed" : "Last checked"}
        </span>
        <span>Data checked {when} · Times Eastern</span>
      </div>
      {feedWarnings.length ? (
        <p className="mt-1 text-warn">
          Some feeds unavailable: {feedWarnings.join(" · ")}. Empty results may be incomplete.
        </p>
      ) : null}
      {delayed ? (
        <p className="mt-1 text-warn">Showing the last available scores. Refresh shortly for the latest board.</p>
      ) : null}
    </div>
  );
}
