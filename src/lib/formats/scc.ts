/**
 * Scenarist Closed Caption (`.scc`) — EIA-608 captions as hex words.
 *
 *   Scenarist_SCC V1.0
 *
 *   01:02:53:11\t94ad 9470 9474 c8e5 ec6c cfe1
 *   01:02:55:11\t942c 8080
 *
 * Each line is a timecode plus the 608 words sent at that instant. Captions are
 * displayed with "end of caption" (`942f`) and erased with "erase displayed
 * memory" (`942c`), so a cue's *start* is the line carrying its text and its
 * *end* is the next event.
 *
 * This implementation extracts dialogue text and rebuilds a valid pop-on
 * caption stream on export. Preamble addressing, mid-row colour and positioning
 * codes are read but not reconstructed — SCC has no equivalent in the normalised
 * model — so those are reported as warnings.
 */

import type { SubtitleFormat } from "./types";
import { finalizeEntries, makeEntry } from "./shared";
import { msToTimecode, timecodeToMs } from "../time";
import {
  bytesToHexWords,
  decode608,
  encode608,
  hexWordsToBytes,
} from "./eia608";

const HEADER = "Scenarist_SCC V1.0";
const LINE_RE = /^(\d{2}:\d{2}:\d{2}[:;]\d{2})\t(.+)$/;

/** Pop-on control words. */
const EOC = "942f"; // end of caption: display the buffered caption
const EDM = "942c"; // erase displayed memory
/** Preamble address code placing text on row 15 (the usual subtitle row). */
const PAC_ROW_15 = "9470";

export const sccFormat: SubtitleFormat = {
  id: "scc",
  label: "Scenarist Closed Caption",
  extensions: ["scc"],
  binary: false,
  supportsMarkup: false,
  supportsStyles: false,

  sniff(text: string): number {
    const head = text.slice(0, 200);
    if (/^Scenarist_SCC\s*V1\.0/i.test(head.trim())) return 1;
    return LINE_RE.test(head.split("\n").find((l) => LINE_RE.test(l)) ?? "") ? 0.8 : 0;
  },

  parse(input) {
    const text = typeof input === "string" ? input : new TextDecoder().decode(input);
    const warnings: string[] = [];
    const dropFrame = text.includes(";");

    if (!/Scenarist_SCC/i.test(text)) {
      warnings.push("Missing 'Scenarist_SCC V1.0' header.");
    }

    interface Event {
      startMs: number;
      text: string;
      controlWords: number;
    }
    const events: Event[] = [];

    for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
      const match = LINE_RE.exec(line.trim());
      if (!match) continue;

      let startMs: number;
      try {
        startMs = timecodeToMs(match[1] ?? "", dropFrame ? 29.97 : 30, dropFrame);
      } catch {
        warnings.push(`Unreadable timecode: ${match[1]}`);
        continue;
      }

      const decoded = decode608(hexWordsToBytes(match[2] ?? ""));
      if (decoded.text.trim() === "") continue;
      events.push({ startMs, text: decoded.text, controlWords: decoded.controlWords });
    }

    if (events.length === 0) {
      throw new Error("No caption text could be decoded from this SCC file.");
    }

    const partial = events.map((event, i) => {
      const next = events[i + 1];
      return makeEntry(
        event.startMs,
        next ? next.startMs : event.startMs + 2000,
        event.text,
        {},
        { captionType: "pop-on" },
      );
    });

    const { entries, nextId } = finalizeEntries(partial);

    const totalControl = events.reduce((sum, e) => sum + e.controlWords, 0);
    if (totalControl > 0) {
      warnings.push(
        `${totalControl} caption control code(s) (positioning, colour, caption mode) ` +
          "were read but cannot be preserved.",
      );
    }
    warnings.push(
      "SCC uses the EIA-608 character set, which has no Arabic script. " +
        "Kurdish Sorani text cannot be exported to this format faithfully.",
    );

    return {
      format: "scc",
      entries,
      formatMeta: { frameRate: dropFrame ? 29.97 : 30, dropFrame },
      warnings,
      nextId,
    };
  },

  serialize(doc, options) {
    const fps = Number(doc.formatMeta.frameRate) || options?.fps || 30;
    const dropFrame = Boolean(doc.formatMeta.dropFrame);
    const out: string[] = [HEADER, ""];

    interface Line {
      ms: number;
      words: string;
    }
    const lines: Line[] = [];

    for (const entry of doc.entries) {
      const text = (entry.translated_text.trim() ? entry.translated_text : entry.original_text)
        .replace(/\n/g, " ")
        .trim();
      if (!text) continue;

      const words = bytesToHexWords(encode608(text));
      lines.push({ ms: parseMs(entry.start_time), words: `${PAC_ROW_15} ${words} ${EOC}` });
      lines.push({ ms: parseMs(entry.end_time), words: EDM });
    }

    lines.sort((a, b) => a.ms - b.ms);
    for (const line of lines) {
      out.push(`${msToTimecode(line.ms, fps, dropFrame)}\t${line.words}`);
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
