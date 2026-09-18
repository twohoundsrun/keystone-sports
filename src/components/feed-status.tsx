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

  return (
    <div className="my-3 text-sm text-muted" role="status">
      <p className="inline-flex items-center gap-1.5">
        <RefreshCw className={cn("h-3.5 w-3.5 shrink-0", spin && "animate-spin")} aria-hidden />
        <span>Data checked {when} · Times Eastern</span>
      </p>
      {warnings.length ? (
        <p className="mt-1 text-warn">
          Some feeds unavailable: {warnings.join(" · ")}. Empty results may be incomplete.
        </p>
      ) : age > 90_000 ? (
        <p className="mt-1 text-warn">Updates delayed — showing the last available scores.</p>
      ) : null}
    </div>
  );
}
