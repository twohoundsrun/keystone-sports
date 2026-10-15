import { XMLParser, XMLValidator } from "fast-xml-parser";

export type FeedArticle = { title: string; href: string; published: string; updated?: string };
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  parseTagValue: false,
  ignoreDeclaration: true,
});
function text(value: unknown): string {
  if (typeof value === "string")
    return value
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  if (value && typeof value === "object") return text((value as Record<string, unknown>)["#text"]);
  return "";
}
function iso(value: unknown): string {
  const valueText = text(value);
  // Avoid engine-dependent relative/numeric date coercion.
  if (
    !/\d{4}/.test(valueText) ||
    !/(?:Z|GMT|UTC|[+-]\d{2}:?\d{2})$/i.test(valueText) ||
    !/\d{2}:\d{2}/.test(valueText)
  )
    return "";
  const calendar = valueText.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (calendar) {
    const [, year, month, day] = calendar.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    )
      return "";
  }
  const ms = Date.parse(valueText);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}
function list(value: unknown): unknown[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Feed metadata only. Never import article bodies, embedded HTML or external entities. */
export function parseDiscoveryFeed(xml: string): FeedArticle[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new Error("Malformed or unsupported XML");
  const root = parser.parse(xml) as Record<string, unknown>;
  if (root.rss && !("channel" in record(root.rss))) throw new Error("RSS channel missing");
  const rss = record(record(root.rss).channel);
  const atom = record(root.feed);
  if (!root.rss && !root.feed) throw new Error("Response is not RSS or Atom");
  return list(root.rss ? rss.item : atom.entry)
    .slice(0, 100)
    .flatMap((value) => {
      const item = record(value);
      const title = text(item.title);
      const atomLink = list(item.link)
        .map(record)
        .find((link) => !link["@rel"] || link["@rel"] === "alternate");
      const href = root.rss ? text(item.link) : text(atomLink?.["@href"]);
      try {
        const url = new URL(href);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          !title ||
          title.length > 1000 ||
          url.toString().length > 2048
        )
          return [];
        url.hash = "";
        return [
          {
            title,
            href: url.toString(),
            published: iso(item.pubDate ?? item.published ?? item.date),
            updated: iso(item.updated ?? item.modified) || undefined,
          },
        ];
      } catch {
        return [];
      }
    });
}
