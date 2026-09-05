/**
 * Markup sanitisation.
 *
 * Subtitle text is untrusted input: a `.srt` from the internet can contain
 * `<script>`, `<img onerror=...>`, or `javascript:` URLs.  Previews render
 * markup (bold/italic tags are meaningful in subtitles), so we cannot simply
 * `dangerouslySetInnerHTML` the raw string.
 *
 * The strategy is *rebuild, never pass through*: the text is tokenised, every
 * text run is HTML-escaped, and every tag is reconstructed from its parsed
 * name and a whitelist-filtered attribute list.  Raw substrings from the input
 * never reach the output, which is what makes this resistant to the usual
 * allowlist bypasses (unclosed tags, nested comments, attribute smuggling).
 */

const ALLOWED_TAGS: ReadonlySet<string> = new Set(["i", "b", "u", "br"]);

/** Tags allowed with attributes, mapped to their permitted attribute names. */
const ALLOWED_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  font: new Set(["color"]),
};

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)(\/?)>/g;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/** ASS/SSA override blocks such as `{\an8}` or `{\pos(10,20)}`. */
const ASS_TAG_RE = /\{\\[^{}]*\}/g;

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

function sanitizeAttributeValue(name: string, value: string): string | null {
  const lower = name.toLowerCase();
  // Only a literal colour is acceptable; reject anything URL-ish.
  if (lower !== "color") return null;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
  if (/^[a-zA-Z]{1,32}$/.test(trimmed)) return trimmed;
  return null;
}

function rebuildTag(slash: string, rawName: string, attrs: string, selfClose: string): string {
  const name = rawName.toLowerCase();

  const isAllowed = ALLOWED_TAGS.has(name);
  const permittedAttrs = ALLOWED_ATTRIBUTES[name];
  if (!isAllowed && !permittedAttrs) return escapeHtml(`<${slash}${rawName}${attrs}${selfClose}>`);

  const outAttrs: string[] = [];
  if (permittedAttrs) {
    let match: RegExpExecArray | null;
    ATTR_RE.lastIndex = 0;
    while ((match = ATTR_RE.exec(attrs)) !== null) {
      const attrName = (match[1] ?? "").toLowerCase();
      if (!permittedAttrs.has(attrName)) continue;
      const value = match[2] ?? match[3] ?? match[4] ?? "";
      const safe = sanitizeAttributeValue(attrName, value);
      if (safe === null) continue;
      outAttrs.push(`${attrName}="${safe}"`);
    }
  }

  const closing = name === "br" || selfClose ? " /" : "";
  const attrPart = outAttrs.length ? ` ${outAttrs.join(" ")}` : "";
  return `<${slash}${name}${attrPart}${closing}>`;
}

/**
 * Convert subtitle text into HTML safe to inject into a preview.
 * Only `<i> <b> <u> <br> <font color>` survive; everything else is escaped.
 */
export function sanitizeSubtitleHtml(text: string): string {
  let out = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  TAG_RE.lastIndex = 0;
  while ((match = TAG_RE.exec(text)) !== null) {
    out += escapeHtml(text.slice(cursor, match.index));
    out += rebuildTag(match[1] ?? "", match[2] ?? "", match[3] ?? "", match[4] ?? "");
    cursor = match.index + match[0].length;
  }
  out += escapeHtml(text.slice(cursor));

  return out.replace(/\n/g, "<br />");
}

/** Remove HTML-ish tags but keep ASS/SSA override blocks intact. */
export function stripHtmlTags(text: string): string {
  return text.replace(/<\/?[a-zA-Z][^<>]*>/g, "");
}

/** Remove ASS/SSA override blocks but keep HTML-ish tags. */
export function stripAssTags(text: string): string {
  return text.replace(ASS_TAG_RE, "");
}

/** Remove every kind of markup, leaving plain readable text. */
export function stripAllMarkup(text: string): string {
  return stripHtmlTags(stripAssTags(text));
}

/** List the ASS override tags present in a string, e.g. `["\\an8", "\\b1"]`. */
export function extractAssTags(text: string): string[] {
  const found = text.match(ASS_TAG_RE);
  if (!found) return [];
  return found.map((block) => block.slice(1, -1));
}

/** True when the text contains markup an exporter may not be able to keep. */
export function hasMarkup(text: string): boolean {
  return /<\/?[a-zA-Z]/.test(text) || ASS_TAG_RE.test(text);
}
