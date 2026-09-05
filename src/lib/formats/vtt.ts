/**
 * WebVTT (`.vtt`).
 *
 * Differs from SRT in three ways that matter here: dot milliseconds, an
 * optional numeric index, and *cue settings* after the end timestamp
 * (`align:middle position:50% line:90%`). Cue settings carry positioning
 * metadata, so they are preserved verbatim on each entry.
 */

import type { SubtitleEntry } from "../types";
import type { SubtitleFormat } from "./types";
import {
  applyLineBreakPreference,
  exportText,
  finalizeEntries,
  makeEntry,
  splitBlocks,
  stripBom,
  toText,
  tryParseTime,
} from "./shared";
import { msToVtt, parseTimeToMs } from "../time";
import { extractAssTags } from "../sanitize";

const TIMING_RE = /^(\S+)\s*-->\s*(\S+)(?:\s+(.*))?$/;

function headerLine(text: string): string | null {
  const first = stripBom(text).split("\n", 1)[0] ?? "";
  return /^WEBVTT(\s.*)?$/.test(first.trim()) ? first.trim() : null;
}

export const vttFormat: SubtitleFormat = {
  id: "vtt",
  label: "WebVTT",
  extensions: ["vtt", "webvtt"],
  binary: false,
  supportsMarkup: true,
  supportsStyles: false,

  sniff(text: string): number {
    return headerLine(text) !== null ? 1 : 0;
  },

  parse(input) {
    const { text } = toText(input);
    const warnings: string[] = [];
    const header = headerLine(text);
    if (header === null) {
      warnings.push("Missing 'WEBVTT' signature; parsing as WebVTT anyway.");
    }

    const blocks = splitBlocks(text);
    const partial: Array<Omit<SubtitleEntry, "id" | "index">> = [];
    let webvttHeader = header ?? "WEBVTT";

    blocks.forEach((block, position) => {
      const first = block[0].trim();

      if (position === 0 && header !== null) {
        // The header block: `WEBVTT` plus any free text on following lines.
        webvttHeader = block.join("\n");
        if (!TIMING_RE.test(first)) return;
      }

      if (/^NOTE\b/i.test(first)) {
        warnings.push(`NOTE block at position ${position + 1} was not carried over.`);
        return;
      }
      if (/^STYLE\b/i.test(first)) {
        warnings.push(
          `STYLE block at position ${position + 1} contains CSS that cannot be preserved.`,
        );
        return;
      }
      if (/^REGION\b/i.test(first)) {
        warnings.push(
          `REGION block at position ${position + 1} contains layout that cannot be preserved.`,
        );
        return;
      }

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

      const settings = (match[3] ?? "").trim();
      const cueId = timingIndex === 1 ? block[0].trim() : undefined;
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
            ...(cueId ? { cueId } : {}),
          },
        ),
      );
    });

    const { entries, nextId } = finalizeEntries(partial);
    if (entries.length === 0) {
      throw new Error("No WebVTT cues could be parsed from this file.");
    }

    return {
      format: "vtt",
      entries,
      formatMeta: { webvttHeader },
      warnings,
      nextId,
    };
  },

  serialize(doc, options) {
    const lineBreak = options?.lineBreakPreference ?? "original";
    const header = doc.formatMeta.webvttHeader ?? "WEBVTT";
    const lines: string[] = [header, ""];

    doc.entries.forEach((entry) => {
      const text = applyLineBreakPreference(exportText(entry), lineBreak);
      const cueId = typeof entry.metadata.cueId === "string" ? entry.metadata.cueId : "";
      const settings =
        typeof entry.metadata.settings === "string" ? entry.metadata.settings : "";

      if (cueId) lines.push(cueId);
      lines.push(
        `${msToVtt(parseTimeToMs(entry.start_time))} --> ` +
          `${msToVtt(parseTimeToMs(entry.end_time))}` +
          (settings ? ` ${settings}` : ""),
      );
      if (text.trim()) lines.push(text);
      lines.push("");
    });

    return lines.join("\n").replace(/\n+$/, "") + "\n";
  },
};

