import type {
  FormatId,
  FormatMeta,
  SubtitleDocument,
  SubtitleEntry,
} from "../src/lib/types";
import { TARGET_LANGUAGE_CODE } from "../src/lib/types";

/** Minimal document builder for exporter tests. */
export function makeDoc(
  entries: SubtitleEntry[],
  format: FormatId,
  options: { fileName?: string; formatMeta?: FormatMeta } = {},
): SubtitleDocument {
  return {
    id: "test-doc",
    fileName: options.fileName ?? `sample.${format}`,
    format,
    sourceLanguage: "en",
    targetLanguage: TARGET_LANGUAGE_CODE,
    entries,
    formatMeta: options.formatMeta ?? {},
    warnings: [],
    createdAt: 0,
    updatedAt: 0,
    nextId: entries.length + 1,
  };
}

export function entry(
  index: number,
  start: string,
  end: string,
  original: string,
  translated = "",
  extra: Partial<SubtitleEntry> = {},
): SubtitleEntry {
  return {
    id: index,
    index,
    start_time: start,
    end_time: end,
    original_text: original,
    translated_text: translated,
    style: {},
    metadata: {},
    ...extra,
  };
}
