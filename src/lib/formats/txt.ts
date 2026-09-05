/**
 * Plain text (`.txt`).
 *
 * A transcript has no timing at all, so importing one means inventing timings.
 * Each non-empty line becomes a cue of `DEFAULT_CUE_MS` starting where the
 * previous one ended, and the user is told loudly that the timings are
 * synthetic and must be reviewed. Everything else is preserved: line order and
 * the exact text.
 */

import type { SubtitleFormat } from "./types";
import {
  applyLineBreakPreference,
  exportText,
  finalizeEntries,
  makeEntry,
  normalizeNewlines,
  toText,
} from "./shared";

export const DEFAULT_CUE_MS = 3000;
/** Small gap so consecutive cues do not visually collide. */
export const DEFAULT_GAP_MS = 300;

export const txtFormat: SubtitleFormat = {
  id: "txt",
  label: "Plain text",
  extensions: ["txt", "text"],
  binary: false,
  supportsMarkup: false,
  supportsStyles: false,

  sniff(): number {
    // Always the last resort; the registry only reaches here when nothing
    // else matched.
    return 0.05;
  },

  parse(input) {
    const { text } = toText(input);
    const lines = normalizeNewlines(text)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) throw new Error("The file is empty.");

    const warnings = [
      "Plain text carries no timing. Each line was given a " +
        `${DEFAULT_CUE_MS / 1000}-second cue; review the timestamps before exporting.`,
    ];

    let cursor = 0;
    const partial = lines.map((line) => {
      const entry = makeEntry(cursor, cursor + DEFAULT_CUE_MS, line, {}, {
        syntheticTiming: true,
      });
      cursor += DEFAULT_CUE_MS + DEFAULT_GAP_MS;
      return entry;
    });

    const { entries, nextId } = finalizeEntries(partial);
    return { format: "txt", entries, formatMeta: {}, warnings, nextId };
  },

  serialize(doc, options) {
    const lineBreak = options?.lineBreakPreference ?? "original";
    return (
      doc.entries
        .map((entry) =>
          applyLineBreakPreference(exportText(entry), lineBreak).replace(/\n/g, " "),
        )
        .join("\n")
        .replace(/\n+$/, "") + "\n"
    );
  },
};
