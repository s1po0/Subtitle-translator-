/**
 * `.sub` — which is two unrelated formats sharing one extension.
 *
 * 1. **MicroDVD**: `{start}{end}text` with *frame* numbers, not time. Without
 *    a frame rate the timings are meaningless, so one is recorded in
 *    `formatMeta.fps` and applied on export.
 * 2. **SubViewer 2.0**: an `[INFORMATION]` header, then `[00:00:01.00]` blocks
 *    with centisecond precision and `[br]` line breaks.
 *
 * Both are sniffed from content so the extension alone is never trusted.
 */

import type { SubtitleEntry } from "../types";
import type { SubtitleFormat } from "./types";
import {
  applyLineBreakPreference,
  exportText,
  finalizeEntries,
  makeEntry,
  normalizeNewlines,
  toText,
} from "./shared";
import {
  DEFAULT_FPS,
  framesToMs,
  msToFrames,
  msToSubViewer,
  parseSubViewerToMs,
} from "../time";

const MICRODVD_RE = /^\{(\d+)\}\{(\d+)\}(.*)$/;
const SUBVIEWER_TIME_RE = /^\[(\d{1,3}:[0-5]\d:[0-5]\d\.\d{1,2})\]\s*$/;

export const subFormat: SubtitleFormat = {
  id: "sub",
  label: "Sub (MicroDVD / SubViewer)",
  extensions: ["sub"],
  binary: false,
  supportsMarkup: true,
  supportsStyles: false,

  sniff(text: string): number {
    const lines = normalizeNewlines(text).split("\n").filter((l) => l.trim());
    if (lines.length === 0) return 0;
    const sample = lines.slice(0, 20);
    const micro = sample.filter((l) => MICRODVD_RE.test(l.trim())).length;
    if (micro / sample.length > 0.5) return 0.9;
    const subviewer = sample.filter((l) => SUBVIEWER_TIME_RE.test(l.trim())).length;
    if (subviewer / sample.length > 0.3) return 0.9;
    return 0;
  },

  parse(input) {
    const { text } = toText(input);
    return MICRODVD_RE.test(normalizeNewlines(text).split("\n").find((l) => l.trim()) ?? "")
      ? parseMicroDvd(text)
      : parseSubViewer(text);
  },

  serialize(doc, options) {
    const lineBreak = options?.lineBreakPreference ?? "original";
    const isMicroDvd = doc.formatMeta.subVariant !== "subviewer";
    const fps = Number(doc.formatMeta.fps) || options?.fps || DEFAULT_FPS;
    const out: string[] = [];

    if (!isMicroDvd && typeof doc.formatMeta.rawHeader === "string") {
      out.push(doc.formatMeta.rawHeader.trim(), "");
    }

    for (const entry of doc.entries) {
      const text = applyLineBreakPreference(exportText(entry), lineBreak);
      if (isMicroDvd) {
        const startFrame = msToFrames(parseMs(entry.start_time), fps);
        const endFrame = msToFrames(parseMs(entry.end_time), fps);
        out.push(`{${startFrame}}{${endFrame}}${text.replace(/\n/g, "|")}`);
      } else {
        out.push(`[${msToSubViewer(parseMs(entry.start_time))}]`);
        out.push(text.replace(/\n/g, "[br]"));
        out.push("");
      }
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

function parseMicroDvd(text: string) {
  const warnings: string[] = [];
  const partial: Array<Omit<SubtitleEntry, "id" | "index">> = [];
  let fps: number | null = null;

  for (const line of normalizeNewlines(text).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = MICRODVD_RE.exec(trimmed);
    if (!match) {
      warnings.push(`Ignored non-MicroDVD line: ${trimmed.slice(0, 60)}`);
      continue;
    }

    const startFrame = Number(match[1]);
    const endFrame = Number(match[2]);

    // MicroDVD files sometimes smuggle the frame rate into the first line as
    // `{1}{1}23.976`.
    if (fps === null) {
      const asRate = Number((match[3] ?? "").trim());
      if (Number.isFinite(asRate) && asRate > 10 && asRate < 100) {
        fps = asRate;
        continue;
      }
    }

    const rate = fps ?? DEFAULT_FPS;
    const body = (match[3] ?? "").replace(/\|/g, "\n");
    partial.push(
      makeEntry(framesToMs(startFrame, rate), framesToMs(endFrame, rate), body, {}, {
        subVariant: "microdvd",
        startFrame,
        endFrame,
      }),
    );
  }

  const { entries, nextId } = finalizeEntries(partial);
  if (entries.length === 0) throw new Error("No MicroDVD lines could be parsed.");
  if (fps === null) {
    warnings.push(
      `No frame rate found in the file; assumed ${DEFAULT_FPS} fps. ` +
        "Set the correct rate in Settings if timings look wrong.",
    );
  }

  return {
    format: "sub" as const,
    entries,
    formatMeta: { fps: fps ?? DEFAULT_FPS, subVariant: "microdvd" },
    warnings,
    nextId,
  };
}

function parseSubViewer(text: string) {
  const warnings: string[] = [];
  const partial: Array<Omit<SubtitleEntry, "id" | "index">> = [];
  const lines = normalizeNewlines(text).split("\n");
  const headerLines: string[] = [];

  let inInformation = false;
  let current: { startMs: number; body: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const body = current.body.join("\n").replace(/\[br\]/gi, "\n").trim();
    // SubViewer records only a start time; the cue ends when the next begins.
    partial.push(
      makeEntry(current.startMs, current.startMs + 2000, body, {}, {
        subVariant: "subviewer",
      }),
    );
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^\[INFORMATION\]$/i.test(line)) {
      inInformation = true;
      headerLines.push(rawLine);
      continue;
    }
    if (/^\[END INFORMATION\]$/i.test(line)) {
      inInformation = false;
      headerLines.push(rawLine);
      continue;
    }
    if (inInformation) {
      headerLines.push(rawLine);
      continue;
    }

    const timing = SUBVIEWER_TIME_RE.exec(line);
    if (timing) {
      flush();
      try {
        current = { startMs: parseSubViewerToMs(timing[1] ?? ""), body: [] };
      } catch {
        warnings.push(`Unreadable SubViewer timestamp: ${line}`);
      }
      continue;
    }

    if (current) current.body.push(line);
  }
  flush();

  const { entries, nextId } = finalizeEntries(partial);
  if (entries.length === 0) throw new Error("No SubViewer cues could be parsed.");

  // Give every cue a real end time based on the next cue's start.
  for (let i = 0; i < entries.length - 1; i += 1) {
    const nextStart = parseMs(entries[i + 1].start_time);
    const thisStart = parseMs(entries[i].start_time);
    entries[i].end_time = entries[i + 1].start_time;
    if (nextStart <= thisStart) {
      warnings.push(`Subtitle ${i + 1} overlaps the following subtitle.`);
    }
  }

  warnings.push(
    "SubViewer stores only a start time; end times were derived from the next subtitle.",
  );

  return {
    format: "sub" as const,
    entries,
    formatMeta: { subVariant: "subviewer", rawHeader: headerLines.join("\n") },
    warnings,
    nextId,
  };
}
