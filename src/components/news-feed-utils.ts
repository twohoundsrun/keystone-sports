import type { PublicBeatItem } from "@/lib/beat/types";

export function isPremiumBeat(item: PublicBeatItem): boolean {
  return Boolean(item.pinned) || item.category === "breaking";
}
