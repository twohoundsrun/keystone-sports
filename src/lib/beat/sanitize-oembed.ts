const ALLOWED_TAGS = new Set(["blockquote", "p", "a", "br"]);
const VOID_TAGS = new Set(["br"]);
const GLOBAL_ATTRIBUTES = new Set(["class", "dir", "lang"]);
const TAG_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(["href", "rel", "target"]),
  blockquote: new Set(["data-dnt"]),
};

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function safeUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeAttribute(tag: string, name: string, value: string): string | null {
  const lowerName = name.toLowerCase();
  if (lowerName.startsWith("on") || lowerName === "style" || lowerName === "srcdoc") return null;
  if (!GLOBAL_ATTRIBUTES.has(lowerName) && !TAG_ATTRIBUTES[tag]?.has(lowerName)) return null;

  if (lowerName === "class") {
    const classes = value.split(/\s+/).filter((className) => className === "twitter-tweet" || className === "twitter-tweet-rendered");
    return classes.length ? `class="${escapeAttribute(classes.join(" "))}"` : null;
  }
  if (lowerName === "dir") return value === "ltr" || value === "rtl" ? `dir="${value}"` : null;
  if (lowerName === "lang") return /^[a-z]{2,}(?:-[a-z]{2,})?$/i.test(value) ? `lang="${escapeAttribute(value)}"` : null;
  if (lowerName === "data-dnt") return /^(true|false)$/i.test(value) ? `data-dnt="${value.toLowerCase()}"` : null;
  if (lowerName === "target") return value === "_blank" ? 'target="_blank"' : null;
  if (lowerName === "rel") {
    const tokens = value.split(/\s+/).filter((token) => token === "noopener" || token === "noreferrer");
    return tokens.length ? `rel="${tokens.join(" ")}"` : null;
  }
  if (lowerName === "href") {
    const url = safeUrl(value);
    return url ? `href="${escapeAttribute(url)}"` : null;
  }
  return null;
}

/**
 * Keep only the small subset of X's blockquote oEmbed markup that Keystone
 * renders. This intentionally removes scripts, event handlers, styles,
 * iframes, and non-HTTPS links before using innerHTML.
 */
export function sanitizeXOembedHtml(input: string): string {
  return input.replace(/<!--[\s\S]*?-->|<\/?[^>]*>/g, (token) => {
    if (token.startsWith("<!--")) return "";
    const match = token.match(/^<\s*(\/?)\s*([a-z0-9]+)([^>]*)>$/i);
    if (!match) return "";
    const closing = Boolean(match[1]);
    const tag = match[2].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";
    if (closing) return `</${tag}>`;
    if (VOID_TAGS.has(tag)) return `<${tag}>`;

    const attrs: string[] = [];
    const rawAttributes = match[3];
    const attributePattern = /([a-z_:][a-z0-9:._-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
    let attribute: RegExpExecArray | null;
    while ((attribute = attributePattern.exec(rawAttributes))) {
      const rendered = safeAttribute(tag, attribute[1], attribute[2] ?? attribute[3] ?? attribute[4] ?? "");
      if (rendered) attrs.push(rendered);
    }
    return `<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`;
  });
}
