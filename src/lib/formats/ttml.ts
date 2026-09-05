/**
 * TTML (`.ttml`) and DFXP (`.dfxp`).
 *
 * Both are W3C Timed Text XML; DFXP is the older distribution profile and is
 * treated as the same document shape with a different default namespace and
 * root decoration. `<head>` (styling, layout, metadata) is serialised verbatim
 * into `formatMeta.headMarkup` so styles survive, while `<p>` elements become
 * entries carrying their `style`, `region` and `xml:lang` attributes.
 *
 * Timing accepts every TTML time expression: clock time with milliseconds or
 * frames (`00:00:01:12`), and offset time (`1.5s`, `900ms`, `2m`, `1h`, `10f`,
 * `1000t`).
 */

import type { SubtitleEntry } from "../types";
import type { SubtitleFormat } from "./types";
import { finalizeEntries, makeEntry, toText } from "./shared";
import { escapeHtml } from "../sanitize";

export const TTML_NS = "http://www.w3.org/ns/ttml";
export const TTS_NS = "http://www.w3.org/ns/ttml#styling";
export const TTP_NS = "http://www.w3.org/ns/ttml#parameter";
/** Namespace used by some pre-1.0 DFXP files. */
export const LEGACY_DFXP_NS = "http://www.w3.org/2006/04/ttaf1";

const CLOCK_RE =
  /^(\d{2,3}):([0-5]\d):([0-5]\d)(?:[:.]([0-9]{1,3}))?(?:[.]([0-9]{1,3}))?$/;
const OFFSET_RE = /^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/;

export interface TtmlTimingContext {
  frameRate: number;
  tickRate: number;
  subFrameRate: number;
}

export function parseTtmlTime(value: string, ctx: TtmlTimingContext): number {
  const text = value.trim();

  const clock = CLOCK_RE.exec(text);
  if (clock) {
    const [, h, m, s, framesOrMs, fraction] = clock;
    let ms =
      (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000;
    if (framesOrMs !== undefined) {
      // `:` separates frames, `.` separates a fraction of a second.
      if (text.includes(`:${framesOrMs}`) && fraction === undefined) {
        ms += Math.round((Number(framesOrMs) / ctx.frameRate) * 1000);
      } else {
        ms += Number(`${framesOrMs}`.padEnd(3, "0").slice(0, 3));
        if (fraction !== undefined) {
          ms += Math.round((Number(fraction) / ctx.frameRate) * 1000);
        }
      }
    }
    return ms;
  }

  const offset = OFFSET_RE.exec(text);
  if (offset) {
    const amount = Number(offset[1]);
    switch (offset[2]) {
      case "h":
        return Math.round(amount * 3600 * 1000);
      case "m":
        return Math.round(amount * 60 * 1000);
      case "s":
        return Math.round(amount * 1000);
      case "ms":
        return Math.round(amount);
      case "f":
        return Math.round((amount / ctx.frameRate) * 1000);
      case "t":
        return Math.round((amount / ctx.tickRate) * 1000);
    }
  }

  throw new Error(`Invalid TTML time expression: "${value}"`);
}

function collectText(node: Element): string {
  let out = "";
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3 /* TEXT_NODE */) {
      out += child.textContent ?? "";
      return;
    }
    if (child.nodeType !== 1 /* ELEMENT_NODE */) return;
    const el = child as Element;
    const local = el.localName.toLowerCase();
    if (local === "br") out += "\n";
    else out += collectText(el);
  });
  return out;
}

function descendants(root: Element, localName: string): Element[] {
  const found: Element[] = [];
  const walk = (node: Element) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType !== 1) return;
      const el = child as Element;
      if (el.localName.toLowerCase() === localName) found.push(el);
      walk(el);
    });
  };
  walk(root);
  return found;
}

function readTimingContext(root: Element): TtmlTimingContext {
  const get = (...names: string[]): string | null => {
    for (const name of names) {
      const value = root.getAttribute(name) ?? root.getAttributeNS(TTP_NS, name);
      if (value) return value;
    }
    return null;
  };

  const frameRate = Number(get("frameRate", "ttp:frameRate"));
  const tickRate = Number(get("tickRate", "ttp:tickRate"));
  const subFrameRate = Number(get("subFrameRate", "ttp:subFrameRate"));

  return {
    frameRate: Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30,
    tickRate: Number.isFinite(tickRate) && tickRate > 0 ? tickRate : 270000,
    subFrameRate: Number.isFinite(subFrameRate) && subFrameRate > 0 ? subFrameRate : 1,
  };
}

/** Standard TTML namespaces, keyed by their conventional prefix. */
const KNOWN_NAMESPACES: Record<string, string> = {
  tt: "http://www.w3.org/ns/ttml#metadata",
  ttm: "http://www.w3.org/ns/ttml#metadata",
  tts: "http://www.w3.org/ns/ttml#styling",
  ttp: "http://www.w3.org/ns/ttml#parameter",
  ittp: "http://www.w3.org/ns/ttml/profile/imsc1#parameter",
  itts: "http://www.w3.org/ns/ttml/profile/imsc1#styling",
  smpte: "http://www.smpte-ra.org/schemas/2052-1/2010/smpte-tt",
  ebuttm: "urn:ebu:tt:metadata",
  ebutts: "urn:ebu:tt:style",
};

/**
 * Add any missing `xmlns:<prefix>` declarations to the root element.
 *
 * A strict XML parser rejects a document that uses `ttp:frameRate="25"` without
 * declaring `ttp`, and hand-authored TTML files do this constantly. Since the
 * prefixes have conventional meanings, binding them here turns an unreadable
 * file into a readable one instead of failing the import.
 */
export function ensureNamespaces(xml: string): string {
  const rootMatch = /<tt\b[^>]*>/.exec(xml);
  if (!rootMatch) return xml;

  const rootTag = rootMatch[0];
  const declared = new Set<string>();
  const declaredRe = /xmlns:([A-Za-z_][-\w.]*)\s*=/g;
  let match: RegExpExecArray | null;
  while ((match = declaredRe.exec(rootTag)) !== null) declared.add(match[1] ?? "");

  const used = new Set<string>();
  const usedRe = /<\/?([A-Za-z_][-\w.]*):|([A-Za-z_][-\w.]*):[-\w.]+\s*=/g;
  while ((match = usedRe.exec(xml)) !== null) {
    const prefix = match[1] ?? match[2];
    if (prefix) used.add(prefix);
  }

  const missing = [...used].filter(
    (prefix) => prefix !== "xml" && !declared.has(prefix) && KNOWN_NAMESPACES[prefix],
  );
  if (missing.length === 0) return xml;

  const additions = missing
    .map((prefix) => ` xmlns:${prefix}="${KNOWN_NAMESPACES[prefix]}"`)
    .join("");
  const insertAt = rootMatch.index + rootTag.length - 1; // just before the final ">"
  return `${xml.slice(0, insertAt)}${additions}${xml.slice(insertAt)}`;
}

function parseDocument(rawXml: string, variant: "ttml" | "dfxp") {
  const xml = ensureNamespaces(rawXml);
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(
      `This ${variant.toUpperCase()} file is not well-formed XML: ${parseError.textContent?.slice(0, 200) ?? "unknown error"}`,
    );
  }

  const root = doc.documentElement;
  if (!root) throw new Error("Empty XML document.");
  if (root.localName.toLowerCase() !== "tt") {
    throw new Error(
      `Expected a <tt> root element but found <${root.localName}>; this is not a TTML/DFXP file.`,
    );
  }

  const warnings: string[] = [];
  const timingCtx = readTimingContext(root);

  const head = descendants(root, "head")[0];
  let headMarkup = "";
  if (head) {
    try {
      headMarkup = new XMLSerializer().serializeToString(head);
    } catch {
      warnings.push("The <head> section could not be preserved.");
    }
  }

  const paragraphs = descendants(root, "p");
  if (paragraphs.length === 0) {
    throw new Error("No <p> paragraphs found, so there is nothing to translate.");
  }

  const partial: Array<Omit<SubtitleEntry, "id" | "index">> = [];
  paragraphs.forEach((p) => {
    const begin = p.getAttribute("begin") ?? p.getAttribute("start");
    const end = p.getAttribute("end");
    const dur = p.getAttribute("dur");

    let startMs: number | null = null;
    let endMs: number | null = null;
    try {
      if (begin) startMs = parseTtmlTime(begin, timingCtx);
      if (end) endMs = parseTtmlTime(end, timingCtx);
      else if (dur && startMs !== null) endMs = startMs + parseTtmlTime(dur, timingCtx);
    } catch (err) {
      warnings.push(
        `Paragraph ignored: ${err instanceof Error ? err.message : "bad timing"}`,
      );
      return;
    }
    if (startMs === null) {
      warnings.push("Paragraph ignored: missing 'begin' attribute.");
      return;
    }
    if (endMs === null) endMs = startMs + 2000;

    const attrs: Record<string, unknown> = {};
    for (const attrName of ["style", "region", "xml:id", "xml:lang", "class", "tts:textAlign"]) {
      const value = p.getAttribute(attrName);
      if (value) attrs[attrName] = value;
    }

    partial.push(
      makeEntry(
        startMs,
        endMs,
        collectText(p).trim(),
        {
          name: p.getAttribute("style") ?? undefined,
          speaker: p.getAttribute("region") ?? undefined,
        },
        { ttmlAttrs: attrs },
      ),
    );
  });

  const { entries, nextId } = finalizeEntries(partial);
  if (entries.length === 0) throw new Error("No timed paragraphs could be parsed.");

  return {
    format: variant,
    entries,
    formatMeta: {
      headMarkup,
      rootAttributes: serializeRootAttributes(root),
      frameRate: timingCtx.frameRate,
      tickRate: timingCtx.tickRate,
    },
    warnings,
    nextId,
  };
}

function serializeRootAttributes(root: Element): string {
  const parts: string[] = [];
  for (let i = 0; i < root.attributes.length; i += 1) {
    const attr = root.attributes[i];
    if (!attr) continue;
    parts.push(`${attr.name}="${escapeHtml(attr.value)}"`);
  }
  return parts.join(" ");
}

function build(variant: "ttml" | "dfxp"): SubtitleFormat {
  const extension = variant;
  return {
    id: variant,
    label: variant === "ttml" ? "TTML Timed Text" : "DFXP Distribution Format",
    extensions: [extension],
    binary: false,
    supportsMarkup: true,
    supportsStyles: true,

    sniff(text: string, bytes?: Uint8Array): number {
      const head = text.slice(0, 2000).toLowerCase();
      if (!head.includes("<tt")) return 0;
      if (variant === "dfxp" && head.includes(LEGACY_DFXP_NS)) return 1;
      if (head.includes("dfxp") || head.includes("ttaf1")) return variant === "dfxp" ? 0.9 : 0.3;
      return variant === "ttml" ? 0.85 : 0.2;
    },

    parse(input) {
      const { text } = toText(input);
      return parseDocument(text, variant);
    },

    serialize(doc, options) {
      const lineBreak = options?.lineBreakPreference ?? "original";
      const rootAttrs =
        (doc.formatMeta.rootAttributes as string | undefined) ||
        `xml:lang="${doc.sourceLanguage === "auto" ? "en" : doc.sourceLanguage}" xmlns="${TTML_NS}" xmlns:tts="${TTS_NS}"`;
      const head =
        (doc.formatMeta.headMarkup as string | undefined) ||
        "<head><styling /></head>";

      const out: string[] = [];
      out.push('<?xml version="1.0" encoding="UTF-8"?>');
      out.push(`<tt ${rootAttrs}>`);
      out.push(`  ${head}`);
      out.push("  <body>");
      out.push("    <div>");

      for (const entry of doc.entries) {
        const text = exportTtml(entry, lineBreak);
        const attrs = (entry.metadata.ttmlAttrs as Record<string, string> | undefined) ?? {};
        const kept = Object.entries(attrs)
          .filter(([key]) => key !== "begin" && key !== "end" && key !== "dur")
          .map(([key, value]) => ` ${key}="${escapeHtml(String(value))}"`)
          .join("");

        out.push(
          `      <p begin="${toClock(entry.start_time)}" end="${toClock(entry.end_time)}"${kept}>${text}</p>`,
        );
      }

      out.push("    </div>");
      out.push("  </body>");
      out.push("</tt>");
      return out.join("\n") + "\n";
    },
  };
}

function exportTtml(
  entry: import("../types").SubtitleEntry,
  lineBreak: "original" | "single" | "double",
): string {
  const raw = entry.translated_text.trim() ? entry.translated_text : entry.original_text;
  const text =
    lineBreak === "original" ? raw : raw.replace(/\s*\n\s*/g, " ").trim();
  // Text nodes must be escaped, but the `\n` -> `<br/>` conversion is ours.
  return text
    .split("\n")
    .map((line) => escapeHtml(line))
    .join("<br/>");
}

function toClock(value: string): string {
  const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{1,3})$/.exec(value.trim());
  if (!match) return value;
  const [, h, m, s, ms] = match;
  return `${h.padStart(2, "0")}:${m}:${s}.${ms}`;
}

export const ttmlFormat = build("ttml");
export const dfxpFormat = build("dfxp");
