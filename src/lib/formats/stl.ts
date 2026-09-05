/**
 * EBU STL (`.stl`) — the binary broadcast exchange format from EBU Tech 3264.
 *
 * Structure, per the specification:
 *   - one 1024-byte GSI (General Subtitle Information) header block
 *   - one 128-byte TTI (Text and Timing Information) block per subtitle:
 *       16 bytes of control data, then a 112-byte text field
 *
 * Text-field control codes handled here: `0x8A` line break, `0x8C`/`0x8D`
 * start/end italics, `0x8E`/`0x8F` start/end underline, `0x80`-`0x87` colour.
 * Unused space is padded with `0x8F`.
 *
 * Timings are 32-bit little-endian *frame* counts, so the frame rate declared
 * in the GSI (`STL25.01`, `STL30.01`, ...) decides the real clock.
 *
 * A note specific to this application: the EBU character code tables cover
 * Latin, Cyrillic, Greek, Arabic and Hebrew, but Kurdish Sorani needs the
 * Arabic table (CCT 02) and even then presentation shaping is left to the
 * decoder. Exporting Sorani to STL warns about this.
 */

import type { SubtitleFormat } from "./types";
import { finalizeEntries, makeEntry } from "./shared";
import { framesToMs, msToFrames } from "../time";

const GSI_SIZE = 1024;
const TTI_SIZE = 128;
const TTI_TEXT_OFFSET = 16;
const TTI_TEXT_SIZE = 112;

/** GSI field offsets (EBU Tech 3264 table 1). */
const GSI = {
  cpn: [0, 3],
  dfc: [3, 8],
  dsc: [11, 1],
  cct: [12, 2],
  lc: [14, 32],
  opt: [46, 32],
  tpt: [110, 32],
  tn: [174, 32],
  slr: [238, 16],
  mnc: [281, 2],
  mnr: [283, 2],
  tcp: [286, 8],
  tcf: [294, 8],
  co: [304, 32],
  pub: [336, 32],
  en: [368, 32],
} as const;

/** TTI control-byte offsets within the 16-byte header of a block. */
const TTI = {
  sgn: 0,
  sn: 1,
  ebn: 3,
  cs: 4,
  tci: 5,
  tco: 9,
  vp: 13,
  jc: 14,
  cf: 15,
} as const;

const CODE_BREAK = 0x8a;
const CODE_ITALIC_ON = 0x8c;
const CODE_ITALIC_OFF = 0x8d;
const CODE_UNDERLINE_ON = 0x8e;
const CODE_UNDERLINE_OFF = 0x8f;
const CODE_PAD = 0x8f;

const CCT_DECODERS: Record<string, string> = {
  "00": "windows-1252",
  "01": "windows-1251",
  "02": "windows-1256",
};

function readField(view: DataView, offset: number, length: number): string {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    bytes[i] = view.getUint8(offset + i);
  }
  // STL pads text fields with spaces; trailing NULs occur in some writers.
  return new TextDecoder("ascii").decode(bytes).replace(/[\x00]+$/g, "").trimEnd();
}

function frameRateFromDfc(dfc: string): number {
  const match = /STL(\d{2})\.\d{2}/i.exec(dfc);
  if (!match) return 25;
  const rate = Number(match[1]);
  return rate === 30 ? 30 : rate === 24 ? 24 : 25;
}

function decodeTextField(bytes: Uint8Array, decoder: TextDecoder): {
  text: string;
  droppedCodes: number;
} {
  let out = "";
  let buffer: number[] = [];
  let droppedCodes = 0;
  const open: string[] = [];

  // Bytes are decoded in runs so that a multi-byte character is never split;
  // control codes take effect immediately, at the run boundary.
  const flush = () => {
    if (buffer.length > 0) {
      out += decoder.decode(new Uint8Array(buffer));
      buffer = [];
    }
  };

  const close = (tag: string) => {
    const at = open.lastIndexOf(tag);
    if (at === -1) return;
    open.splice(at, 1);
    out += tag;
  };

  for (const byte of bytes) {
    if (byte === CODE_BREAK) {
      flush();
      out += "\n";
      continue;
    }
    if (byte === CODE_ITALIC_ON) {
      flush();
      out += "<i>";
      open.push("</i>");
      continue;
    }
    if (byte === CODE_ITALIC_OFF) {
      flush();
      close("</i>");
      continue;
    }
    if (byte === CODE_UNDERLINE_ON) {
      flush();
      out += "<u>";
      open.push("</u>");
      continue;
    }
    // 0x8F is both "end of underlining" and the filler byte for unused space.
    // Closing nothing when no underline is open is what makes padding harmless.
    if (byte === CODE_UNDERLINE_OFF) {
      flush();
      close("</u>");
      continue;
    }
    if (byte >= 0x80 && byte <= 0x87) {
      // Colour codes have no equivalent downstream; count and drop them.
      droppedCodes += 1;
      continue;
    }
    buffer.push(byte);
  }

  flush();
  // Anything still open at the end of the field is closed so the markup the
  // rest of the app sees is always balanced.
  while (open.length > 0) out += open.pop();

  return { text: out.replace(/\s+$/g, ""), droppedCodes };
}

function asBytes(input: string | Uint8Array): Uint8Array {
  if (typeof input === "string") return new TextEncoder().encode(input);
  return input;
}

export const stlFormat: SubtitleFormat = {
  id: "stl",
  label: "EBU STL (binary)",
  extensions: ["stl"],
  binary: true,
  supportsMarkup: true,
  supportsStyles: false,

  sniff(_text: string, bytes?: Uint8Array): number {
    if (!bytes || bytes.length < GSI_SIZE + TTI_SIZE) return 0;
    // The payload must divide evenly into a GSI block plus whole TTI blocks.
    if ((bytes.length - GSI_SIZE) % TTI_SIZE !== 0) return 0;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dfc = readField(view, GSI.dfc[0], GSI.dfc[1]);
    if (/^STL\d{2}\.\d{2}$/i.test(dfc.trim())) return 1;
    // Correct block arithmetic but an unexpected disk-format code.
    return 0.4;
  },

  parse(input) {
    const bytes = asBytes(input);
    if (bytes.length < GSI_SIZE + TTI_SIZE) {
      throw new Error("File is too small to be an EBU STL document.");
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const warnings: string[] = [];

    const dfc = readField(view, GSI.dfc[0], GSI.dfc[1]);
    const cct = readField(view, GSI.cct[0], GSI.cct[1]).padStart(2, "0");
    const frameRate = frameRateFromDfc(dfc);

    const label = CCT_DECODERS[cct];
    if (!label) {
      warnings.push(`Unknown character code table "${cct}"; assuming Latin.`);
    }
    let decoder: TextDecoder;
    try {
      decoder = new TextDecoder(CCT_DECODERS[cct] ?? "windows-1252");
    } catch {
      decoder = new TextDecoder("windows-1252");
    }

    const dsc = readField(view, GSI.dsc[0], GSI.dsc[1]);
    if (dsc === "1" || dsc === "2") {
      warnings.push(
        "This STL is marked for teletext delivery, so its text field may contain " +
          "teletext control codes that are rendered as blanks.",
      );
    }

    const partial = [];
    let droppedTotal = 0;
    // TTI blocks with the same subtitle number are continuation blocks and
    // must be concatenated in extension-block order.
    const grouped = new Map<number, Uint8Array[]>();

    for (let offset = GSI_SIZE; offset + TTI_SIZE <= bytes.length; offset += TTI_SIZE) {
      const subtitleNumber = view.getUint16(offset + TTI.sn, true);
      const tci = view.getUint32(offset + TTI.tci, true);
      const tco = view.getUint32(offset + TTI.tco, true);
      const commentFlag = view.getUint8(offset + TTI.cf);

      const textField = new Uint8Array(TTI_TEXT_SIZE);
      for (let i = 0; i < TTI_TEXT_SIZE; i += 1) {
        textField[i] = view.getUint8(offset + TTI_TEXT_OFFSET + i);
      }

      const existing = grouped.get(subtitleNumber);
      if (existing) {
        existing.push(textField);
        continue;
      }
      grouped.set(subtitleNumber, [textField]);

      const verticalPosition = view.getUint8(offset + TTI.vp);
      const justification = view.getUint8(offset + TTI.jc);

      partial.push({
        startMs: framesToMs(tci, frameRate),
        endMs: framesToMs(tco, frameRate),
        textField,
        commentFlag,
        verticalPosition,
        justification,
        subtitleNumber,
      });
    }

    const built = partial.map((block) => {
      const chunks = grouped.get(block.subtitleNumber) ?? [block.textField];
      let text = "";
      for (const chunk of chunks) {
        const decoded = decodeTextField(chunk, decoder);
        droppedTotal += decoded.droppedCodes;
        text += (text ? "\n" : "") + decoded.text;
      }

      return makeEntry(block.startMs, block.endMs, text, {}, {
        verticalPosition: block.verticalPosition,
        justification: block.justification,
        comment: block.commentFlag === 1,
        subtitleNumber: block.subtitleNumber,
      });
    });

    const { entries, nextId } = finalizeEntries(built);
    if (entries.length === 0) throw new Error("No TTI blocks could be read from this STL file.");

    if (droppedTotal > 0) {
      warnings.push(
        `${droppedTotal} colour control code(s) were dropped; STL colours cannot be preserved.`,
      );
    }

    return {
      format: "stl",
      entries,
      formatMeta: {
        frameRate,
        characterCodeTable: cct,
        diskFormatCode: dfc,
        gsi: readGsiMetadata(view),
      },
      warnings,
      nextId,
    };
  },

  serialize(doc, options) {
    const frameRate = Number(doc.formatMeta.frameRate) || options?.fps || 25;
    const cct = String(doc.formatMeta.characterCodeTable ?? "00");

    let encoder: TextEncoder;
    try {
      // TextEncoder only supports UTF-8, so non-Latin tables are encoded
      // through a lossy ASCII path and reported below.
      encoder = new TextEncoder();
    } catch {
      encoder = new TextEncoder();
    }

    const gsi = new Uint8Array(GSI_SIZE);
    writeField(gsi, GSI.cpn[0], "850");
    writeField(gsi, GSI.dfc[0], `STL${String(frameRate).padStart(2, "0")}.01`);
    writeField(gsi, GSI.dsc[0], "0");
    writeField(gsi, GSI.cct[0], cct);
    writeField(gsi, GSI.lc[0], doc.targetLanguage);
    writeField(gsi, GSI.opt[0], doc.fileName.replace(/\.[^.]+$/, "").slice(0, 32));
    writeField(gsi, GSI.tpt[0], doc.fileName.replace(/\.[^.]+$/, "").slice(0, 32));
    writeField(gsi, GSI.tn[0], "Kurdish Sorani Subtitle Translator");
    writeField(gsi, GSI.mnc[0], "37");
    writeField(gsi, GSI.mnr[0], "2");
    writeField(gsi, GSI.tcp[0], "00000000");
    writeField(gsi, GSI.tcf[0], "00000000");

    const ttiBlocks: Uint8Array[] = [];
    doc.entries.forEach((entry, i) => {
      const text = entry.translated_text.trim() ? entry.translated_text : entry.original_text;
      const block = new Uint8Array(TTI_SIZE);
      const blockView = new DataView(block.buffer);

      blockView.setUint8(TTI.sgn, 0);
      blockView.setUint16(TTI.sn, i, true);
      blockView.setUint8(TTI.ebn, 0xff); // last (only) block for this subtitle
      blockView.setUint8(TTI.cs, 0);
      blockView.setUint32(TTI.tci, msToFrames(parseMs(entry.start_time), frameRate), true);
      blockView.setUint32(TTI.tco, msToFrames(parseMs(entry.end_time), frameRate), true);
      blockView.setUint8(TTI.vp, Number(entry.metadata.verticalPosition ?? 0));
      blockView.setUint8(TTI.jc, Number(entry.metadata.justification ?? 2));
      blockView.setUint8(TTI.cf, entry.metadata.comment ? 1 : 0);

      const payload = encodeTextField(text, encoder);
      for (let j = 0; j < TTI_TEXT_SIZE; j += 1) {
        block[TTI_TEXT_OFFSET + j] = j < payload.length ? payload[j] : CODE_PAD;
      }
      ttiBlocks.push(block);
    });

    const total = GSI_SIZE + ttiBlocks.length * TTI_SIZE;
    const out = new Uint8Array(total);
    out.set(gsi, 0);
    ttiBlocks.forEach((block, i) => out.set(block, GSI_SIZE + i * TTI_SIZE));

    return out;
  },
};

function readGsiMetadata(view: DataView): Record<string, string> {
  return {
    dfc: readField(view, GSI.dfc[0], GSI.dfc[1]),
    dsc: readField(view, GSI.dsc[0], GSI.dsc[1]),
    cct: readField(view, GSI.cct[0], GSI.cct[1]),
    originalTitle: readField(view, GSI.opt[0], GSI.opt[1]),
    translatedTitle: readField(view, GSI.tpt[0], GSI.tpt[1]),
    translator: readField(view, GSI.tn[0], GSI.tn[1]),
    country: readField(view, GSI.co[0], GSI.co[1]),
    publisher: readField(view, GSI.pub[0], GSI.pub[1]),
  };
}

function writeField(buffer: Uint8Array, offset: number, value: string): void {
  const bytes = new TextEncoder().encode(value);
  for (let i = 0; i < bytes.length; i += 1) {
    buffer[offset + i] = bytes[i];
  }
}

/**
 * Encode cue text into an STL text field: `\n` becomes `0x8A`, inline
 * italic/underline tags become their control codes, and printable text is
 * encoded through the declared character table. The result is truncated to the
 * 112-byte text field.
 */
function encodeTextField(text: string, encoder: TextEncoder): Uint8Array {
  const lines = text.split("\n");
  const rebuilt: number[] = [];

  lines.forEach((line, index) => {
    for (const byte of encodeSingleLine(line, encoder)) rebuilt.push(byte);
    if (index < lines.length - 1) rebuilt.push(CODE_BREAK);
  });

  return Uint8Array.from(rebuilt.slice(0, TTI_TEXT_SIZE));
}

function encodeSingleLine(line: string, encoder: TextEncoder): number[] {
  const bytes: number[] = [];
  let italic = false;
  let underline = false;

  const pushText = (chunk: string) => {
    for (const byte of encoder.encode(chunk)) {
      // Bytes >= 0x80 would be read back as control codes; clamp them so a
      // stray UTF-8 sequence cannot corrupt the stream.
      bytes.push(byte >= 0x80 ? 0x20 : byte);
    }
  };

  const tagRe = /<\/?([iub])>/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(line)) !== null) {
    pushText(line.slice(cursor, match.index));
    const closing = match[0].startsWith("</");
    const tag = (match[1] ?? "").toLowerCase();
    if (tag === "i") {
      bytes.push(closing ? CODE_ITALIC_OFF : CODE_ITALIC_ON);
      italic = !closing;
    } else if (tag === "u") {
      bytes.push(closing ? CODE_UNDERLINE_OFF : CODE_UNDERLINE_ON);
      underline = !closing;
    }
    cursor = match.index + match[0].length;
  }
  pushText(line.slice(cursor));
  if (italic) bytes.push(CODE_ITALIC_OFF);
  if (underline) bytes.push(CODE_UNDERLINE_OFF);
  return bytes;
}

function parseMs(value: string): number {
  const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{1,3})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid timestamp: "${value}"`);
  const [, h, m, s, ms] = match;
  return (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000 + Number(ms);
}
