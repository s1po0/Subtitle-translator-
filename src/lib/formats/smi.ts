/**
 * SAMI (`.smi` / `.sami`) — Microsoft's Synchronized Accessible Media Interchange.
 *
 * SAMI is HTML-ish rather than XML: attributes are unquoted, tags are often
 * unclosed, and a cue runs from one `<SYNC Start=ms>` until the next. A strict
 * XML parser therefore rejects most real-world files, so this parser scans the
 * raw text instead and keeps the `<HEAD>` (including its `<STYLE>` block)
 * verbatim for re-export.
 *
 * SAMI records only a start time in milliseconds; the end time of each cue is
 * the start of the next one, which is how players actually behave.
 */

import type { SubtitleEntry } from "../types";
import type { SubtitleFormat } from "./types";
import { finalizeEntries, makeEntry, toText, applyLineBreakPreference, exportText } from "./shared";
import { escapeHtml } from "../sanitize";

const SYNC_RE = /<SYNC\s+Start\s*=\s*["']?(\d+)["']?[^>]*>/gi;
const BODY_END_RE = /<\/BODY>/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  hellip: "…",
  mdash: "—",
  ndash: "–",
};

/** Decode the small entity set SAMI actually uses. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Strip tags but keep `<BR>` as a line break. */
function sammiTextToPlain(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const smiFormat: SubtitleFormat = {
  id: "smi",
  label: "SAMI",
  extensions: ["smi", "sami"],
  binary: false,
  supportsMarkup: false,
  supportsStyles: true,

  sniff(text: string): number {
    const head = text.slice(0, 2000).toUpperCase();
    if (head.includes("<SAMI")) return 1;
    if (head.includes("<SYNC") && head.includes("START=")) return 0.9;
    return 0;
  },

  parse(input) {
    const { text } = toText(input);
    const warnings: string[] = [];

    const bodyStart = text.search(/<BODY[^>]*>/i);
    const headMarkup = bodyStart >= 0 ? text.slice(0, bodyStart) : "";
    const bodyMatch = /<BODY[^>]*>/i.exec(text);
    const bodyFrom = bodyMatch ? bodyMatch.index + bodyMatch[0].length : 0;
    const bodyEndMatch = BODY_END_RE.exec(text);
    const bodyText = text.slice(bodyFrom, bodyEndMatch ? bodyEndMatch.index : text.length);

    const syncs: Array<{ startMs: number; tagStart: number; contentStart: number }> = [];
    let match: RegExpExecArray | null;
    SYNC_RE.lastIndex = 0;
    while ((match = SYNC_RE.exec(bodyText)) !== null) {
      syncs.push({
        startMs: Number(match[1]),
        tagStart: match.index,
        contentStart: match.index + match[0].length,
      });
    }

    if (syncs.length === 0) {
      throw new Error("No <SYNC> elements found; this does not look like a SAMI file.");
    }

    const partial: Array<Omit<SubtitleEntry, "id" | "index">> = [];
    for (let i = 0; i < syncs.length; i += 1) {
      const cue = syncs[i];
      const next = syncs[i + 1];
      // Text runs from the end of this <SYNC> tag to the start of the next one.
      const raw = bodyText.slice(
        cue.contentStart,
        next ? next.tagStart : bodyText.length,
      );

      const classMatch = /<P\s+Class\s*=\s*["']?([\w-]+)["']?/i.exec(raw);
      const plain = sammiTextToPlain(raw);

      if (plain === "") continue;

      const startMs = cue.startMs;
      const endMs = next ? next.startMs : startMs + 3000;

      partial.push(
        makeEntry(
          startMs,
          endMs,
          plain,
          classMatch ? { name: classMatch[1] } : {},
          { smiClass: classMatch?.[1] },
        ),
      );
    }

    const { entries, nextId } = finalizeEntries(partial);
    if (entries.length === 0) {
      throw new Error("Every <SYNC> block in this SAMI file was empty.");
    }

    warnings.push(
      "SAMI stores only a start time; each end time was set to the next subtitle's start.",
    );
    if (/<(?!br|p)[a-z]/i.test(bodyText)) {
      warnings.push(
        "SAMI markup inside cues was flattened to plain text.",
      );
    }

    return {
      format: "smi",
      entries,
      formatMeta: { headMarkup: headMarkup.trim(), rawHeader: headMarkup.trim() },
      warnings,
      nextId,
    };
  },

  serialize(doc, options) {
    const lineBreak = options?.lineBreakPreference ?? "original";
    const head =
      (doc.formatMeta.headMarkup as string | undefined) ||
      "<SAMI>\n<HEAD>\n<STYLE TYPE=\"text/css\">\n<!--\nP {font-family: Arial; font-weight: normal; color: white; background: black;}\n.KurdishCC {Name: Kurdish Sorani; lang: ckb; SAMIType: CC;}\n-->\n</STYLE>\n</HEAD>\n<BODY>";

    const out: string[] = [head];
    for (const entry of doc.entries) {
      const text = applyLineBreakPreference(exportText(entry), lineBreak);
      const cls = typeof entry.metadata.smiClass === "string" ? entry.metadata.smiClass : "KurdishCC";
      const startMs = parseMs(entry.start_time);
      out.push(
        `<SYNC Start=${startMs}><P Class=${cls}>` +
          escapeHtml(text).replace(/\n/g, "<BR>"),
      );
    }
    // A trailing empty SYNC clears the last cue.
    const last = doc.entries[doc.entries.length - 1];
    if (last) out.push(`<SYNC Start=${parseMs(last.end_time)}><P Class=KurdishCC>&nbsp;`);
    out.push("</BODY>", "</SAMI>");
    return out.join("\n") + "\n";
  },
};

function parseMs(value: string): number {
  const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{1,3})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid timestamp: "${value}"`);
  const [, h, m, s, ms] = match;
  return (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000 + Number(ms);
}
