/**
 * Utilities shared by every format parser and exporter.
 */

import type { FormatId, FormatMeta, SubtitleEntry } from "../types";
import { msToSrt, parseTimeToMs } from "../time";

export type FormatInput = string | Uint8Array;

export interface ParseContext {
  fileName: string;
  extension: string;
}

export interface ParsedDocument {
  format: FormatId;
  entries: SubtitleEntry[];
  formatMeta: FormatMeta;
  warnings: string[];
  nextId: number;
}

/* ------------------------------------------------------------------ *
 * Input decoding
 * ------------------------------------------------------------------ */

export function toText(input: FormatInput): { text: string; encoding: string } {
  if (typeof input === "string") {
    return { text: stripBom(input), encoding: "utf-8" };
  }

  const utf8 = new TextDecoder("utf-8", { fatal: true });
  try {
    return { text: stripBom(utf8.decode(input)), encoding: "utf-8" };
  } catch {
    // Not valid UTF-8. Subtitles from older tooling are often Windows-1252
    // (Western European) or Windows-1256 (Arabic).
    for (const label of ["windows-1256", "windows-1252", "iso-8859-1"]) {
      try {
        return {
          text: stripBom(new TextDecoder(label).decode(input)),
          encoding: label,
        };
      } catch {
        /* try the next candidate */
      }
    }
  }

  return {
    text: stripBom(new TextDecoder("utf-8").decode(input)),
    encoding: "utf-8 (lossy)",
  };
}

export function stripBom(text: string): string {
  return text.startsWith("\ufeff") ? text.slice(1) : text;
}

/** Collapse CRLF/CR onto LF so every parser can split on "\n". */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Split on one or more blank lines, discarding empty blocks. */
export function splitBlocks(text: string): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of normalizeNewlines(text).split("\n")) {
    if (line.trim() === "") {
      if (current.length) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length) blocks.push(current);
  return blocks;
}

/* ------------------------------------------------------------------ *
 * Entry construction
 * ------------------------------------------------------------------ */

let idCounter = 0;

/** Fresh id generator; ids only need to be unique within a document. */
export function nextEntryId(): number {
  idCounter += 1;
  return idCounter;
}

export function resetEntryIds(): void {
  idCounter = 0;
}

/** Give a list of entries sequential ids and 1-based indexes. */
export function finalizeEntries(
  partial: Array<Omit<SubtitleEntry, "id" | "index">>,
): { entries: SubtitleEntry[]; nextId: number } {
  const entries = partial.map((entry, i) => ({
    ...entry,
    id: i + 1,
    index: i + 1,
  }));
  idCounter = Math.max(idCounter, entries.length);
  return { entries, nextId: entries.length + 1 };
}

/** Build the id/index-free part of an entry, as consumed by `finalizeEntries`. */
export function makeEntry(
  startMs: number,
  endMs: number,
  text: string,
  style: SubtitleEntry["style"] = {},
  metadata: Record<string, unknown> = {},
): Omit<SubtitleEntry, "id" | "index"> {
  return {
    start_time: msToSrt(startMs),
    end_time: msToSrt(endMs),
    original_text: text,
    translated_text: "",
    style,
    metadata,
  };
}

/** Safe timestamp read: returns null instead of throwing on bad input. */
export function tryParseTime(value: string): number | null {
  try {
    return parseTimeToMs(value);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Export helpers
 * ------------------------------------------------------------------ */

/** Reindex entries 1..n so numbering stays contiguous after add/delete. */
export function reindex(entries: SubtitleEntry[]): SubtitleEntry[] {
  return entries.map((entry, i) => ({ ...entry, index: i + 1 }));
}

/** Sort by start time, which is what every player expects. */
export function sortEntries(entries: SubtitleEntry[]): SubtitleEntry[] {
  return [...entries].sort((a, b) => {
    const diff = parseTimeToMs(a.start_time) - parseTimeToMs(b.start_time);
    return diff !== 0 ? diff : parseTimeToMs(a.end_time) - parseTimeToMs(b.end_time);
  });
}

/**
 * Apply the user's line-break preference.
 * `original` keeps the parsed lines, `single` collapses to one line,
 * `double` guarantees two lines by splitting at the midpoint word boundary.
 */
export function applyLineBreakPreference(
  text: string,
  preference: "original" | "single" | "double",
): string {
  if (preference === "original") return text;
  const flat = text.replace(/\s*\n\s*/g, " ").trim();
  if (preference === "single") return flat;
  return wrapIntoTwoLines(flat);
}

function wrapIntoTwoLines(text: string): string {
  const words = text.split(/\s+/);
  if (words.length < 2) return text;

  let best = -1;
  let bestDiff = Number.POSITIVE_INFINITY;
  let left = "";
  for (let i = 0; i < words.length - 1; i += 1) {
    left = i === 0 ? words[0] : `${left} ${words[i]}`;
    const right = words.slice(i + 1).join(" ");
    const diff = Math.abs(left.length - right.length);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  if (best < 0) return text;
  return `${words.slice(0, best + 1).join(" ")}\n${words.slice(best + 1).join(" ")}`;
}

/**
 * Choose the text to write out: the translation when present, otherwise the
 * original. A partially translated file still exports as a usable whole.
 */
export function exportText(entry: SubtitleEntry): string {
  return entry.translated_text.trim() ? entry.translated_text : entry.original_text;
}
