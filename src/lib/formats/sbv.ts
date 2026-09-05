/**
 * SBV — YouTube's SubViewer-like format.
 *
 * `H:MM:SS.mmm,H:MM:SS.mmm` (hours unpadded, dot milliseconds, comma between
 * the two timestamps) followed by the cue text. There are no indexes and no
 * styling, so round-tripping is lossless for everything SBV can express.
 */

import type { SubtitleEntry } from "../types";
import type { SubtitleFormat } from "./types";
import {
  applyLineBreakPreference,
  exportText,
  finalizeEntries,
  makeEntry,
  splitBlocks,
  toText,
  tryParseTime,
} from "./shared";
import { msToSbv } from "../time";

const TIMING_RE = /^(\d{1,3}:[0-5]\d:[0-5]\d\.\d{1,3})\s*,\s*(\d{1,3}:[0-5]\d:[0-5]\d\.\d{1,3})$/;

export const sbvFormat: SubtitleFormat = {
  id: "sbv",
  label: "SBV (YouTube)",
  extensions: ["sbv"],
  binary: false,
  supportsMarkup: false,
  supportsStyles: false,

  sniff(text: string): number {
    const blocks = splitBlocks(text).slice(0, 3);
    if (blocks.length === 0) return 0;
    const hits = blocks.filter((b) => TIMING_RE.test(b[0]?.trim() ?? "")).length;
    return hits / blocks.length;
  },

  parse(input) {
    const { text } = toText(input);
    const warnings: string[] = [];
    const partial: Array<Omit<SubtitleEntry, "id" | "index">> = [];

    splitBlocks(text).forEach((block, position) => {
      const match = TIMING_RE.exec(block[0]?.trim() ?? "");
      if (!match) {
        warnings.push(`Block ${position + 1}: no SBV timing line, skipped.`);
        return;
      }
      const startMs = tryParseTime(match[1] ?? "");
      const endMs = tryParseTime(match[2] ?? "");
      if (startMs === null || endMs === null) {
        warnings.push(`Block ${position + 1}: unreadable timestamps, skipped.`);
        return;
      }
      const body = block.slice(1).join("\n").trim();
      if (/<|>|\{\\/.test(body)) {
        warnings.push(
          `Block ${position + 1}: markup removed because SBV cannot express styling.`,
        );
      }
      partial.push(makeEntry(startMs, endMs, body.replace(/<br\s*\/?>/gi, "\n")));
    });

    const { entries, nextId } = finalizeEntries(partial);
    if (entries.length === 0) throw new Error("No SBV cues could be parsed.");
    return { format: "sbv", entries, formatMeta: {}, warnings, nextId };
  },

  serialize(doc, options) {
    const lineBreak = options?.lineBreakPreference ?? "original";
    const out: string[] = [];
    for (const entry of doc.entries) {
      const text = applyLineBreakPreference(exportText(entry), lineBreak);
      out.push(
        `${msToSbv(parseMs(entry.start_time))},${msToSbv(parseMs(entry.end_time))}`,
      );
      if (text.trim()) out.push(text);
      out.push("");
    }
    return out.join("\n").replace(/\n+$/, "") + "\n";
  },
};

function parseMs(value: string): number {
  const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{1,3})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid timestamp: "${value}"`);
  const [, h, m, s, ms] = match;
  return (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000 + Number(ms);
}
