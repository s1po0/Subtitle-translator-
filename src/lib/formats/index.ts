/**
 * The format registry.
 *
 * Detection is content-first: every format sniffs the payload and the highest
 * confidence wins, with the file extension used only to break ties. That order
 * matters because `.sub` and `.stl` are both used for unrelated formats, and
 * because misnamed files are common.
 */

import type { FormatId, SubtitleDocument } from "../types";
import type { FormatInput, SerializeOptions, SubtitleFormat } from "./types";
import type { ParsedDocument } from "./shared";
import { toText } from "./shared";

import { srtFormat } from "./srt";
import { assFormat, ssaFormat } from "./ass";
import { vttFormat } from "./vtt";
import { subFormat } from "./sub";
import { sbvFormat } from "./sbv";
import { ttmlFormat, dfxpFormat } from "./ttml";
import { stlFormat } from "./stl";
import { smiFormat } from "./smi";
import { sccFormat } from "./scc";
import { mccFormat } from "./mcc";
import { txtFormat } from "./txt";

/**
 * What character repertoire a format can actually store. Kurdish Sorani is
 * Arabic script, so exporting to a `latin` or `eia608` format is lossy and the
 * UI must say so before the user downloads something unusable.
 */
export type Charset = "unicode" | "latin" | "eia608";

export interface FormatDescriptor extends SubtitleFormat {
  charset: Charset;
  /** Short sentence shown next to the format in the export picker. */
  note: string;
}

function describe(format: SubtitleFormat, charset: Charset, note: string): FormatDescriptor {
  return { ...format, charset, note };
}

export const FORMATS: Record<FormatId, FormatDescriptor> = {
  srt: describe(srtFormat, "unicode", "The safest choice: universally supported."),
  ass: describe(assFormat, "unicode", "Keeps styles, positioning and override tags."),
  ssa: describe(ssaFormat, "unicode", "Older style model; keeps style names."),
  vtt: describe(vttFormat, "unicode", "Keeps cue settings and positioning metadata."),
  sub: describe(subFormat, "unicode", "MicroDVD or SubViewer, whichever was imported."),
  sbv: describe(sbvFormat, "unicode", "YouTube format; no styling support."),
  ttml: describe(ttmlFormat, "unicode", "Keeps the <head> styling block."),
  dfxp: describe(dfxpFormat, "unicode", "TTML distribution profile."),
  stl: describe(
    stlFormat,
    "latin",
    "Broadcast binary. Its character tables cannot store Arabic script.",
  ),
  smi: describe(smiFormat, "unicode", "Keeps the SAMI <HEAD>/<STYLE> block."),
  scc: describe(
    sccFormat,
    "eia608",
    "EIA-608 captions: ASCII only, so Sorani will be lost.",
  ),
  mcc: describe(
    mccFormat,
    "eia608",
    "EIA-608 captions: ASCII only, so Sorani will be lost.",
  ),
  txt: describe(txtFormat, "unicode", "Plain lines with no timing."),
};

export const FORMAT_LIST: FormatDescriptor[] = Object.values(FORMATS);

/** Hard limit from the specification: 100 MB. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export class FileRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileRejectedError";
  }
}

export function extensionOf(fileName: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(fileName.trim());
  return match ? (match[1] ?? "").toLowerCase() : "";
}

export function isSupportedExtension(ext: string): boolean {
  return FORMAT_LIST.some((f) => f.extensions.includes(ext.toLowerCase()));
}

/**
 * Reject files before any parsing happens: oversize, empty, or binary payloads
 * that are not the one binary format we support.
 */
export function validateFile(
  fileName: string,
  input: FormatInput,
): { bytes: number; extension: string } {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input).length : input.length;

  if (bytes === 0) {
    throw new FileRejectedError("That file is empty.");
  }
  if (bytes > MAX_FILE_BYTES) {
    throw new FileRejectedError(
      `That file is ${(bytes / (1024 * 1024)).toFixed(1)} MB. The limit is 100 MB.`,
    );
  }

  const extension = extensionOf(fileName);
  if (typeof input !== "string" && extension !== "stl" && looksBinary(input)) {
    throw new FileRejectedError(
      "That file contains binary data. Only EBU STL (.stl) may be binary.",
    );
  }
  return { bytes, extension };
}

/** Heuristic: a high ratio of NULs or control bytes means this is not text. */
function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) suspicious += 1;
    else if (byte < 9 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.length > 0.1;
}

export interface DetectionResult {
  format: FormatId;
  confidence: number;
  /** Formats that also looked plausible, for a "did you mean" hint. */
  alternatives: Array<{ format: FormatId; confidence: number }>;
}

/** Work out which format a file is, from its content first and name second. */
export function detectFormat(fileName: string, input: FormatInput): DetectionResult {
  const extension = extensionOf(fileName);
  const bytes = typeof input === "string" ? undefined : input;
  // Binary formats cannot be sniffed from a decoded string.
  const text = bytes ? safeTextPreview(bytes) : String(input);

  const scored = FORMAT_LIST.map((format) => {
    let confidence = 0;
    try {
      confidence = format.sniff(text, bytes);
    } catch {
      confidence = 0;
    }
    // A matching extension nudges, but never overrides a confident content match.
    if (format.extensions.includes(extension)) confidence += 0.15;
    return { format: format.id, confidence: Math.min(confidence, 1) };
  })
    .filter((entry) => entry.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);

  if (scored.length === 0) {
    // Nothing matched at all: fall back to the extension, then to plain text.
    const byExtension = FORMAT_LIST.find((f) => f.extensions.includes(extension));
    if (byExtension) {
      return { format: byExtension.id, confidence: 0.2, alternatives: [] };
    }
    return { format: "txt", confidence: 0.1, alternatives: [] };
  }

  const [best, ...rest] = scored;
  return {
    format: best.format,
    confidence: best.confidence,
    alternatives: rest.filter((r) => r.confidence > 0.3).slice(0, 3),
  };
}

/** Decode only the head of a binary file, enough for text sniffing. */
function safeTextPreview(bytes: Uint8Array): string {
  const head = bytes.subarray(0, Math.min(bytes.length, 8192));
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(head);
  } catch {
    return "";
  }
}

export interface OpenResult extends ParsedDocument {
  fileName: string;
  detection: DetectionResult;
}

/** Validate, detect and parse a file in one step. */
export function openSubtitleFile(fileName: string, input: FormatInput): OpenResult {
  validateFile(fileName, input);
  const detection = detectFormat(fileName, input);
  const format = FORMATS[detection.format];

  const parsed = format.parse(input);
  return { ...parsed, fileName, detection };
}

/** Parse with an explicit format, ignoring detection. */
export function parseWithFormat(
  format: FormatId,
  input: FormatInput,
): ParsedDocument {
  return FORMATS[format].parse(input);
}

export function exportSubtitle(
  doc: SubtitleDocument,
  format: FormatId,
  options?: SerializeOptions,
): string | Uint8Array {
  const descriptor = FORMATS[format];
  if (!descriptor) throw new Error(`Unknown subtitle format: ${format}`);

  const lineBreakPreference = options?.lineBreakPreference ?? "original";
  const result = descriptor.serialize(doc, { ...options, lineBreakPreference });

  return typeof result === "string" ? result.replace(/\r\n/g, "\n") : result;
}

/** Warnings to show *before* the user picks a format, e.g. charset loss. */
export function exportWarnings(doc: SubtitleDocument, format: FormatId): string[] {
  const descriptor = FORMATS[format];
  const warnings: string[] = [];

  const hasSorani = doc.entries.some((e) => /[\u0600-\u06FF]/.test(e.translated_text));
  if (hasSorani && descriptor.charset !== "unicode") {
    warnings.push(
      `${descriptor.label} uses a ${descriptor.charset === "latin" ? "Latin character table" : "the EIA-608 ASCII character set"} ` +
        "and cannot store Arabic script. Kurdish Sorani text will be replaced or lost.",
    );
  }

  const usesMarkup = doc.entries.some(
    (e) => /<\/?[a-zA-Z]/.test(e.translated_text) || /\{\\/.test(e.translated_text),
  );
  if (usesMarkup && !descriptor.supportsMarkup) {
    warnings.push(
      `${descriptor.label} does not support inline formatting; markup tags will be written as plain text.`,
    );
  }

  const usesStyles = doc.entries.some((e) => Object.keys(e.style).length > 0);
  if (usesStyles && !descriptor.supportsStyles && doc.format !== format) {
    warnings.push(
      `Style information from the ${FORMATS[doc.format].label} source cannot be carried into ${descriptor.label}.`,
    );
  }

  if (format !== doc.format) {
    warnings.push(
      `Converting ${FORMATS[doc.format].label} → ${descriptor.label}. ${descriptor.note}`,
    );
  }

  return warnings;
}

export function suggestFileName(doc: SubtitleDocument, format: FormatId, translated: boolean): string {
  const base = doc.fileName.replace(/\.[A-Za-z0-9]+$/, "");
  const suffix = translated ? ".ckb" : "";
  return `${base}${suffix}.${FORMATS[format].extensions[0]}`;
}

/** Decode a text file uploaded through the file picker. */
export function decodeUploadedFile(buffer: ArrayBuffer): { text: string; encoding: string } {
  return toText(new Uint8Array(buffer));
}
