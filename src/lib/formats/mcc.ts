/**
 * MacCaption V1 (`.mcc`).
 *
 * An INI-style wrapper around caption data:
 *
 *   [MCC_File_Version]
 *   1.8b
 *   ...
 *   [Code_Table_Start] ... [Code_Table_End]
 *   ...
 *   00:00:00:00\t608\t<base64 of 608 words>\t<flag words>
 *
 * The `608` data type is base64-encoded EIA-608 words, so decoding reuses the
 * shared 608 module. `ASCII` and `ASCII_EX` rows carry plain text and are
 * decoded as UTF-8. Everything between the header markers is preserved verbatim
 * so re-export keeps the file's own code table and description.
 */

import type { SubtitleFormat } from "./types";
import { finalizeEntries, makeEntry } from "./shared";
import { msToTimecode, timecodeToMs } from "../time";
import { bytesToHexWords, decode608, encode608, hexWordsToBytes } from "./eia608";

const DATA_LINE_RE = /^(\d{2}:\d{2}:\d{2}[:;]\d{2})\t([A-Za-z0-9_]+)\t([^\t]+)(?:\t([\s\S]*))?$/;

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export const mccFormat: SubtitleFormat = {
  id: "mcc",
  label: "MacCaption V1",
  extensions: ["mcc"],
  binary: false,
  supportsMarkup: false,
  supportsStyles: false,

  sniff(text: string): number {
    const head = text.slice(0, 500);
    if (/\[MCC_File_Version\]/i.test(head)) return 1;
    if (/\[Code_Table_Start\]/i.test(text)) return 0.9;
    return 0;
  },

  parse(input) {
    const text = typeof input === "string" ? input : new TextDecoder().decode(input);
    const warnings: string[] = [];

    const firstDataLine = text.split("\n").find((line) => DATA_LINE_RE.test(line.trim()));
    const headerEnd = firstDataLine ? text.indexOf(firstDataLine) : text.length;
    const header = text.slice(0, headerEnd).trimEnd();
    const dropFrame = /;/.test(firstDataLine ?? "");

    const partial = [];
    let unknownTypes = 0;
    let controlTotal = 0;

    for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
      const match = DATA_LINE_RE.exec(rawLine.trim());
      if (!match) continue;

      const [, timecode, type, data] = match as unknown as [
        string,
        string,
        string,
        string,
        string,
      ];

      let startMs: number;
      try {
        startMs = timecodeToMs(timecode, dropFrame ? 29.97 : 30, dropFrame);
      } catch {
        warnings.push(`Unreadable MCC timecode: ${timecode}`);
        continue;
      }

      const kind = type.toUpperCase();
      let cueText = "";

      if (kind === "608" || kind === "708") {
        try {
          const decoded = decode608(base64ToBytes(data));
          cueText = decoded.text;
          controlTotal += decoded.controlWords;
        } catch {
          warnings.push(`Could not decode 608 data at ${timecode}.`);
          continue;
        }
      } else if (kind === "ASCII" || kind === "ASCII_EX") {
        try {
          cueText = new TextDecoder().decode(base64ToBytes(data));
        } catch {
          cueText = data;
        }
      } else {
        unknownTypes += 1;
        continue;
      }

      cueText = cueText.trim();
      if (!cueText) continue;

      partial.push(makeEntry(startMs, startMs + 2000, cueText, {}, { mccType: kind }));
    }

    const { entries, nextId } = finalizeEntries(partial);
    if (entries.length === 0) {
      throw new Error("No caption rows could be decoded from this MCC file.");
    }

    // MCC rows carry only an in-point, like SAMI and SubViewer.
    for (let i = 0; i < entries.length - 1; i += 1) {
      entries[i].end_time = entries[i + 1].start_time;
    }

    if (unknownTypes > 0) {
      warnings.push(`${unknownTypes} row(s) with an unsupported data type were skipped.`);
    }
    if (controlTotal > 0) {
      warnings.push(
        `${controlTotal} caption control code(s) were read but cannot be preserved.`,
      );
    }
    warnings.push(
      "MCC rows carry only a start time; end times were taken from the next row.",
    );
    warnings.push(
      "The EIA-608 character set has no Arabic script, so Kurdish Sorani " +
        "cannot be exported to this format faithfully.",
    );

    return {
      format: "mcc",
      entries,
      formatMeta: { rawHeader: header, frameRate: dropFrame ? 29.97 : 30, dropFrame },
      warnings,
      nextId,
    };
  },

  serialize(doc, options) {
    const fps = Number(doc.formatMeta.frameRate) || options?.fps || 30;
    const dropFrame = Boolean(doc.formatMeta.dropFrame);
    const header =
      (doc.formatMeta.rawHeader as string | undefined) ||
      [
        "[MCC_File_Version]",
        "1.8b",
        "",
        "[File_Description]",
        "Created by Kurdish Sorani Subtitle Translator",
        "",
        "[Code_Table_Start]",
        "CODE=1",
        "00=PopOn",
        "[Code_Table_End]",
        "",
        "[ULAT_List]",
        "",
        "[OverLay_Data]",
        "",
      ].join("\n");

    const out: string[] = [header.trimEnd(), ""];

    for (const entry of doc.entries) {
      const text = (entry.translated_text.trim() ? entry.translated_text : entry.original_text)
        .replace(/\n/g, " ")
        .trim();
      if (!text) continue;

      const words = bytesToHexWords(encode608(text));
      const payload = bytesToBase64(hexWordsToBytes(words));
      out.push(
        `${msToTimecode(parseMs(entry.start_time), fps, dropFrame)}\t608\t${payload}\t00000000`,
      );
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
