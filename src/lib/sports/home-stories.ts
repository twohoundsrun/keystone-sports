import type { PublicBeatItem } from "../beat/types";
import type { NewsItem } from "./types";

export type HomeStory = {
  id: string;
  headline: string;
  context?: string;
  href: string;
  source: string;
  published: string;
  teamSlug?: string;
  league?: string;
  image?: string;
  approved: boolean;
};

/** The homepage is a current briefing, not an archive of old feed entries. */
export function homeStories(beat: PublicBeatItem[], wire: NewsItem[], now = new Date()): HomeStory[] {
  const fresh = (iso: string) => {
    const age = now.getTime() - Date.parse(iso);
    return Number.isFinite(age) && age >= -10 * 60_000 && age <= 72 * 60 * 60_000;
  };
  const seen = new Set<string>();
  const stories: HomeStory[] = [];
  const add = (story: HomeStory) => {
    let url: string;
    try {
      const parsed = new URL(story.href);
      url = `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname}`.replace(/\/$/, "").toLowerCase();
    } catch {
      url = story.href.toLowerCase();
    }
    const title = story.headline.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!title || seen.has(`url:${url}`) || seen.has(`title:${title}`)) return;
    seen.add(`url:${url}`);
    seen.add(`title:${title}`);
    stories.push(story);
  };
  for (const item of beat) {
    if (!fresh(item.timestamp)) continue;
    add({ id: `beat:${item.id}`, headline: item.headline, context: item.context,
      href: item.originalUrl, source: item.source, published: item.timestamp,
      teamSlug: item.teamSlug, league: item.league, approved: true });
  }
  for (const item of wire) {
    if (!fresh(item.published)) continue;
    add({ id: `wire:${item.id}`, headline: item.headline, context: item.description,
      href: item.href, source: item.source || "External coverage", published: item.published,
      teamSlug: item.teamSlug, league: item.league, image: item.image, approved: false });
  }
  return stories.slice(0, 5);
}
