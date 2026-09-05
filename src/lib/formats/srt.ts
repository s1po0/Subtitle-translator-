/**
 * SubRip (`.srt`).
 *
 * The most common subtitle format: a numeric index, a `-->` timing line, and
 * one or more text lines. Cue settings after the end timestamp are
 * non-standard in SRT but occur in the wild (usually copied from WebVTT), so
 * they are preserved in metadata rather than dropped.
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
import { extractAssTags } from "../sanitize";
import { msToSrt, parseTimeToMs } from "../time";

const ARROW = "-->";
const TIMING_RE =
  /^(\S+)\s*-->\s*(\S+)(?:\s+(.*))?$/;

export const srtFormat: SubtitleFormat = {
  id: "srt",
  label: "SubRip",
  extensions: ["srt"],
  binary: false,
  supportsMarkup: true,
  supportsStyles: false,

  sniff(text: string): number {
    const blocks = splitBlocks(text);
    if (blocks.length === 0) return 0;

    // A strong signal: an early block whose first line is a bare integer and
    // whose second line contains a `-->` with comma milliseconds.
    const sample = blocks.slice(0, 3);
    const hits = sample.filter((block) => {
      const timingLine = /^\d+$/.test(block[0]?.trim() ?? "") ? block[1] : block[0];
      if (!timingLine) return false;
      const match = TIMING_RE.exec(timingLine.trim());
      return match !== null && /,\d{3}/.test(match[1] ?? "");
    }).length;

    return hits / sample.length;
  },

  parse(input) {
    const { text } = toText(input);
    const blocks = splitBlocks(text);
    const warnings: string[] = [];
    const partial: Array<Omit<SubtitleEntry, "id" | "index">> = [];

    blocks.forEach((block, position) => {
      let timingIndex = -1;
      let match: RegExpExecArray | null = null;

      for (let i = 0; i < Math.min(block.length, 2); i += 1) {
        const candidate = TIMING_RE.exec(block[i].trim());
        if (candidate) {
          timingIndex = i;
          match = candidate;
          break;
        }
      }

      if (timingIndex === -1 || match === null) {
        warnings.push(`Block ${position + 1}: no timing line found, skipped.`);
        return;
      }

      const startMs = tryParseTime(match[1] ?? "");
      const endMs = tryParseTime(match[2] ?? "");
      if (startMs === null || endMs === null) {
        warnings.push(`Block ${position + 1}: unreadable timestamps, skipped.`);
        return;
      }
      if (endMs <= startMs) {
        warnings.push(
          `Block ${position + 1}: end time is not after start time.`,
        );
      }

      const settings = (match[3] ?? "").trim();
      const cueIndex =
        timingIndex === 1 && /^\d+$/.test(block[0].trim())
          ? Number(block[0].trim())
          : undefined;

      const body = block.slice(timingIndex + 1).join("\n").replace(/\n+$/, "");
      const inlineTags = extractAssTags(body);

      partial.push(
        makeEntry(
          startMs,
          endMs,
          body,
          inlineTags.length ? { inlineTags } : {},
          {
            ...(settings ? { settings } : {}),
            ...(cueIndex !== undefined ? { originalIndex: cueIndex } : {}),
            ...(block.length > timingIndex + 1 ? {} : { empty: true }),
          },
        ),
      );
    });

    const { entries, nextId } = finalizeEntries(partial);
    if (entries.length === 0) {
      throw new Error("No SRT cues could be parsed from this file.");
    }
    return { format: "srt", entries, formatMeta: {}, warnings, nextId };
  },

  serialize(doc, options) {
    const lineBreak = options?.lineBreakPreference ?? "original";
    const lines: string[] = [];

    doc.entries.forEach((entry, i) => {
      const text = applyLineBreakPreference(exportText(entry), lineBreak);
      const settings = typeof entry.metadata.settings === "string" ? entry.metadata.settings : "";
      lines.push(String(i + 1));
      lines.push(
        `${entry.start_time} ${ARROW} ${entry.end_time}` +
          (settings ? ` ${settings}` : ""),
      );
      if (text.trim()) lines.push(text);
      lines.push("");
    });

    return lines.join("\n").replace(/\n+$/, "") + "\n";
  },
};

/** Exported for tests: confirm a timing line is understood. */
export function isSrtTimingLine(line: string): boolean {
  const match = TIMING_RE.exec(line.trim());
  if (!match) return false;
  return tryParseTime(match[1] ?? "") !== null && tryParseTime(match[2] ?? "") !== null;
}

