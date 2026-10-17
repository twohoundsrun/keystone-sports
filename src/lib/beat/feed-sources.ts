import { BEAT_FEEDS } from "../sports/beat";
import type { SourceTier } from "./types";
import type { CoverageArea } from "./coverage";

export type DiscoveryFeedSource = {
  id: string;
  label: string;
  url: string;
  teamSlug?: string;
  sourceTier: SourceTier;
  area?: CoverageArea;
  /** Existing public-wire feeds retained; this does not assert runtime health. */
  verification: "retained" | "pending";
  enabled: boolean;
  disabledReason?: string;
};

/** Reuse existing destinations; no unverified new endpoint is activated. */
export const DISCOVERY_FEED_SOURCES: DiscoveryFeedSource[] = BEAT_FEEDS.map((feed) => ({
  id: feed.id,
  label: feed.label,
  // Canonical redirect destination independently verified during release audit.
  url: feed.id === "crossingbroad" ? "https://www.crossingbroad.com/feed/" : feed.url,
  teamSlug: feed.teamSlug,
  sourceTier: ["eagles-site", "steelers-site", "phillies-mlb", "pirates-mlb", "gopsu"].includes(
    feed.id,
  )
    ? "official_team_league"
    : "broadcaster_publication",
  area: feed.teamSlug === "penn-state" ? "college" : feed.teamSlug ? "professional" : undefined,
  verification: "retained",
  // Feed-linked terms prohibit automated collection without prior written consent.
  enabled: !["inquirer", "nbcphilly"].includes(feed.id),
  disabledReason:
    feed.id === "inquirer"
      ? "Publisher permission required for automated collection; disabled pending review"
      : feed.id === "nbcphilly"
        ? "Publisher permission required; advertised alternate feed also lacks publication timezones"
        : undefined,
}));
