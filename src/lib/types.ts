/**
 * Core domain types.
 *
 * Every parser in `src/lib/formats` normalises its input into `SubtitleEntry`,
 * and every exporter consumes that same shape. Format-specific detail that must
 * survive a round trip lives in `style` (per entry) and `formatMeta`
 * (per document) rather than being discarded.
 */

export type FormatId =
  | "srt"
  | "ass"
  | "ssa"
  | "vtt"
  | "sub"
  | "sbv"
  | "ttml"
  | "dfxp"
  | "stl"
  | "smi"
  | "scc"
  | "mcc"
  | "txt";

export const TARGET_LANGUAGE_CODE = "ckb";
export const TARGET_LANGUAGE_NAME = "Kurdish Sorani (کوردیی سۆرانی)";

/** Canonical timestamp format used throughout the app: `00:00:01,000`. */
export type Timestamp = string;

export interface SubtitleStyle {
  /** Style/role name, e.g. an ASS `Style:` name or a TTML `style` id. */
  name?: string;
  /** Speaker or "actor", where the source format records one. */
  speaker?: string;
  /** Raw, unparsed style payload preserved verbatim for re-export. */
  raw?: string;
  /** Formatting tags carried inline in the text (ASS/SSA `{...}` blocks). */
  inlineTags?: string[];
  [key: string]: unknown;
}

export interface SubtitleEntry {
  /** Stable id used by React keys and by local storage. Never reused. */
  id: number;
  /** 1-based position in the file, matching the source subtitle numbering. */
  index: number;
  start_time: Timestamp;
  end_time: Timestamp;
  original_text: string;
  translated_text: string;
  style: SubtitleStyle;
  metadata: Record<string, unknown>;
}

/** Format-level data that has no place on an individual entry. */
export interface FormatMeta {
  /** ASS/SSA `[Script Info]` + `[V4+ Styles]` blocks, preserved verbatim. */
  scriptInfo?: string;
  stylesBlock?: string;
  /** WebVTT header text following the `WEBVTT` signature. */
  webvttHeader?: string;
  /** Default cue settings applied to cues that had none. */
  defaultCueSettings?: string;
  /** TTML/DFXP/SMI head markup (styling, layout, metadata). */
  headMarkup?: string;
  /** MicroDVD frame rate, needed because `.sub` times are frame counts. */
  fps?: number;
  /** Frames per second for frame/timecode-based formats (STL, SCC, MCC). */
  frameRate?: number;
  /** Drop-frame flag for 29.97 timecode formats. */
  dropFrame?: boolean;
  /** Raw header bytes/text retained so export can reproduce the original. */
  rawHeader?: string;
  /** Character code table for EBU STL. */
  characterCodeTable?: string;
  [key: string]: unknown;
}

export interface SubtitleDocument {
  id: string;
  fileName: string;
  format: FormatId;
  /** BCP-47 code of the source language, or `auto`. */
  sourceLanguage: string;
  /** Always Kurdish Sorani; the target is fixed by design. */
  targetLanguage: typeof TARGET_LANGUAGE_CODE;
  entries: SubtitleEntry[];
  formatMeta: FormatMeta;
  warnings: string[];
  createdAt: number;
  updatedAt: number;
  /** Highest id ever issued, so new entries never collide after a reload. */
  nextId: number;
}

export interface ProjectSummary {
  id: string;
  fileName: string;
  format: FormatId;
  total: number;
  translated: number;
  updatedAt: number;
}

export interface AppSettings {
  defaultSourceLanguage: string;
  defaultExportFormat: FormatId | "original";
  /** Direction applied to the original-text editor. */
  originalTextDirection: "auto" | "ltr" | "rtl";
  /** Direction applied to the translation editor (rtl is the default). */
  translationTextDirection: "ltr" | "rtl";
  fontSize: number;
  /** How line breaks are written when exporting. */
  lineBreakPreference: "original" | "single" | "double";
  /** Keep two-line cues as two lines on export. */
  maxLinesPerCue: number;
  autoSave: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultSourceLanguage: "auto",
  defaultExportFormat: "original",
  originalTextDirection: "auto",
  translationTextDirection: "rtl",
  fontSize: 15,
  lineBreakPreference: "original",
  maxLinesPerCue: 2,
  autoSave: true,
};

export function isTranslated(entry: SubtitleEntry): boolean {
  return entry.translated_text.trim().length > 0;
}

export function translationProgress(entries: SubtitleEntry[]): {
  total: number;
  translated: number;
  percent: number;
} {
  const total = entries.length;
  const translated = entries.filter(isTranslated).length;
  return {
    total,
    translated,
    percent: total === 0 ? 0 : Math.round((translated / total) * 100),
  };
}

export function createEntry(
  id: number,
  index: number,
  start_time: Timestamp,
  end_time: Timestamp,
  original_text = "",
): SubtitleEntry {
  return {
    id,
    index,
    start_time,
    end_time,
    original_text,
    translated_text: "",
    style: {},
    metadata: {},
  };
}
