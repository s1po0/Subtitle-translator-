/**
 * The contract every subtitle format implements.
 *
 * A format is a triple: `sniff` (how confident are we this is the format),
 * `parse` (bytes/text in, normalised entries out), `serialize` (normalised
 * document back to that format's text or bytes). Keeping all three behind one
 * interface is what lets the UI offer "export in any format" without knowing
 * anything about any individual format.
 */

import type { FormatId, SubtitleDocument } from "../types";
import type { FormatInput, ParseContext, ParsedDocument } from "./shared";

export type { FormatInput, ParseContext, ParsedDocument };

export interface SerializeOptions {
  lineBreakPreference?: "original" | "single" | "double";
  /** Frames per second for frame-based formats (MicroDVD, STL, SCC, MCC). */
  fps?: number;
  /** Text to write when an entry has no translation yet. */
  useOriginalWhenUntranslated?: boolean;
}

export interface SubtitleFormat {
  id: FormatId;
  /** Human-readable name shown in format pickers. */
  label: string;
  /** Lowercase extensions, first one used as the default download extension. */
  extensions: string[];
  /** True when the format is byte-oriented rather than text. */
  binary: boolean;
  /** Whether inline markup (bold/italic) survives a round trip. */
  supportsMarkup: boolean;
  /** Whether named styles survive a round trip. */
  supportsStyles: boolean;
  /** 0 (definitely not) to 1 (definitely). Content beats extension. */
  sniff: (text: string, bytes?: Uint8Array) => number;
  parse: (input: FormatInput) => ParsedDocument;
  serialize: (doc: SubtitleDocument, options?: SerializeOptions) => string | Uint8Array;
}
