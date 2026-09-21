export function distinctAttributionParts(...values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const value of values) {
    const text = value?.trim();
    if (!text) continue;
    const key = text.replace(/\s+/g, " ").toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(text.replace(/\s+/g, " "));
  }
  return parts;
}

export function formatAttribution(...values: Array<string | undefined | null>): string {
  return distinctAttributionParts(...values).join(" · ");
}
