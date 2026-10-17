import type { FeedDiscoveryReport, SourceObservation } from "./feed-discovery";

const attempted = (s: SourceObservation) => s.state !== "disabled" && s.state !== "backoff";
const healthy = (s: SourceObservation) => ["ok", "empty", "stale"].includes(s.state);
const count = (n: number | undefined) => (Number.isFinite(n) ? Math.min(9999, Math.max(0, n!)) : 0);

/** Bounded last-run evidence in the existing report row; no poller or history table. */
export function addDiscoveryHealth(
  report: FeedDiscoveryReport,
  previous: FeedDiscoveryReport | null,
): void {
  for (const source of report.sources) {
    const prior = previous?.sources.find((s) => s.id === source.id);
    const preserve = source.state === "backoff";
    source.consecutiveFailures = preserve
      ? count(prior?.consecutiveFailures)
      : source.state === "error"
        ? Math.min(9999, count(prior?.consecutiveFailures) + 1)
        : 0;
    source.consecutiveEmpty = preserve
      ? count(prior?.consecutiveEmpty)
      : source.state === "empty"
        ? Math.min(9999, count(prior?.consecutiveEmpty) + 1)
        : 0;
    source.lastSuccessAt = healthy(source) ? report.checkedAt : prior?.lastSuccessAt;
    if (source.consecutiveFailures >= 3)
      report.issues.push(
        `${source.label}: ${source.consecutiveFailures} consecutive failed attempts; inspect source access/format before retrying`,
      );
    if (source.consecutiveEmpty >= 3)
      report.issues.push(
        `${source.label}: ${source.consecutiveEmpty} consecutive empty reads; no article activity established`,
      );
  }
  if (!previous) {
    report.volume = "first_run";
    return;
  }
  const current = report.sources.filter(attempted);
  const prior = previous.sources.filter(attempted);
  // Compare only successful reads of the same source set: outages, backoff or
  // registry changes must not masquerade as missing sporting events.
  if (
    !current.length ||
    current.length !== prior.length ||
    !current.every((s) => healthy(s) && prior.some((p) => p.id === s.id && healthy(p)))
  ) {
    report.volume = "not_comparable";
    return;
  }
  const eligible = current.reduce((n, s) => n + s.eligible, 0);
  const baseline = prior.reduce((n, s) => n + s.eligible, 0);
  report.volume =
    eligible >= 20 && eligible >= 3 * Math.max(1, baseline)
      ? "increased"
      : baseline >= 20 && eligible <= baseline / 3
        ? "decreased"
        : "normal";
  if (report.volume === "increased" || report.volume === "decreased")
    report.issues.push(
      `Eligible volume ${report.volume}: ${eligible} versus ${baseline} in the previous comparable run; inspect source activity, not assumed missing events`,
    );
}
