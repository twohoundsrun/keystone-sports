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
    <div className="my-3 text-sm text-muted" role="status">
      <p className="inline-flex items-center gap-1.5">
        <RefreshCw className={cn("h-3.5 w-3.5 shrink-0", spin && "animate-spin")} aria-hidden />
        <span>Data checked {when} · Times Eastern</span>
      </p>
      {feedWarnings.length ? (
        <p className="mt-1 text-warn">
          Some feeds unavailable: {feedWarnings.join(" · ")}. Empty results may be incomplete.
        </p>
      ) : null}
      {delayed ? (
        <p className="mt-1 text-warn">{delayedWarning}</p>
      ) : null}
    </div>
  );
}
