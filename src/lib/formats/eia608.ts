/**
 * EIA-608 character coding, shared by the SCC and MCC caption formats.
 *
 * 608 caption data is a stream of 2-byte words carrying odd parity in bit 7 and
 * the "basic North American" character set: printable ASCII from 0x20 to 0x7F
 * with nine positions replaced by accented letters. Words whose first byte is
 * below 0x20 (after parity is removed) are control codes rather than text.
 *
 * Kurdish Sorani cannot be represented in 608 at all — the character set has
 * no Arabic script — so exporting Sorani to SCC or MCC is inherently lossy and
 * both exporters warn about it.
 */

/** 0x20..0x7F, ASCII with the 608 substitutions applied. */
const CHAR_TABLE: string[] = (() => {
  const table: string[] = [];
  for (let code = 0x20; code <= 0x7f; code += 1) {
    table.push(String.fromCharCode(code));
  }
  const overrides: Record<number, string> = {
    0x2a: "á",
    0x5c: "é",
    0x5e: "í",
    0x5f: "ó",
    0x60: "ú",
    0x7b: "ç",
    0x7c: "÷",
    0x7d: "Ñ",
    0x7e: "ñ",
    0x7f: "█",
  };
  for (const [hex, char] of Object.entries(overrides)) {
    table[Number(hex) - 0x20] = char;
  }
  return table;
})();

const REVERSE_TABLE: Map<string, number> = (() => {
  const map = new Map<string, number>();
  CHAR_TABLE.forEach((char, i) => {
    if (!map.has(char)) map.set(char, i + 0x20);
  });
  // Fold common look-alikes onto their 608 equivalents.
  const folds: Record<string, string> = {
    À: "A", Á: "A", Â: "A", Ä: "A", Ã: "A", Å: "A",
    È: "E", É: "E", Ê: "E", Ë: "E",
    Ì: "I", Í: "I", Î: "I", Ï: "I",
    Ò: "O", Ó: "O", Ô: "O", Ö: "O", Õ: "O",
    Ù: "U", Ú: "U", Û: "U", Ü: "U",
    Ç: "C", ß: "s",
  };
  for (const [from, to] of Object.entries(folds)) {
    if (!map.has(from)) map.set(from, map.get(to) ?? 0x3f);
    if (!map.has(from.toLowerCase())) {
      map.set(from.toLowerCase(), map.get(to.toLowerCase()) ?? map.get(to) ?? 0x3f);
    }
  }
  return map;
})();

/** Strip the odd-parity bit from a 608 byte. */
export function stripParity(byte: number): number {
  return byte & 0x7f;
}

/** True when a (parity-stripped) byte is a control code rather than a character. */
export function isControlByte(byte: number): boolean {
  return (byte & 0x60) === 0;
}

/** Map a single parity-stripped byte to its character, or "" for control codes. */
export function byteToChar(byte: number): string {
  const clean = stripParity(byte);
  if (isControlByte(clean)) return "";
  return CHAR_TABLE[clean - 0x20] ?? "";
}

export interface DecodeResult {
  text: string;
  /** Control words seen, so callers can report what was skipped. */
  controlWords: number;
}

/**
 * Decode a byte stream of 608 words into text.
 *
 * Control pairs are skipped, which is correct for extracting dialogue but means
 * positioning, colour and caption-mode instructions are not reconstructed.
 */
export function decode608(bytes: Uint8Array): DecodeResult {
  let text = "";
  let controlWords = 0;

  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const first = stripParity(bytes[i] ?? 0);
    const second = stripParity(bytes[i + 1] ?? 0);

    // Padding words (0x80 0x80, i.e. zeros once parity is stripped) carry no
    // information and must not be counted as control codes.
    if (first === 0 && second === 0) continue;

    if (isControlByte(first)) {
      controlWords += 1;
      continue;
    }
    text += byteToChar(first);
    if (!isControlByte(second)) text += byteToChar(second);
  }

  return { text: text.replace(/\s+$/g, ""), controlWords };
}

/**
 * Encode text into 608 bytes, padded to an even count with 0x80 0x80.
 * Characters outside the character set become "?"; callers should have
 * already warned the user.
 */
export function encode608(text: string): Uint8Array {
  const codes: number[] = [];
  for (const char of text) {
    if (char === "\n") {
      // A mid-row carriage return is not expressible; use a space.
      codes.push(0x20);
      continue;
    }
    codes.push(REVERSE_TABLE.get(char) ?? REVERSE_TABLE.get(char.toUpperCase()) ?? 0x3f);
  }
  if (codes.length % 2 !== 0) codes.push(0x20);

  const bytes = new Uint8Array(codes.length + 2);
  codes.forEach((code, i) => {
    bytes[i] = addParity(code);
  });
  // Trailing padding word, as real caption streams use.
  bytes[codes.length] = 0x80;
  bytes[codes.length + 1] = 0x80;
  return bytes;
}

/** Set bit 7 so the byte has odd parity, as the 608 wire format requires. */
export function addParity(byte: number): number {
  let value = byte & 0x7f;
  let ones = 0;
  for (let i = 0; i < 7; i += 1) {
    if (value & (1 << i)) ones += 1;
  }
  return ones % 2 === 0 ? value | 0x80 : value;
}

/** Render bytes as the space-separated hex words SCC and MCC use. */
export function bytesToHexWords(bytes: Uint8Array): string {
  const words: string[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    words.push(
      ((bytes[i] ?? 0) * 256 + (bytes[i + 1] ?? 0)).toString(16).padStart(4, "0"),
    );
  }
  return words.join(" ");
}

/** Parse space-separated hex words back into bytes. */
export function hexWordsToBytes(words: string): Uint8Array {
  const clean = words.trim().split(/\s+/).filter(Boolean);
  const bytes = new Uint8Array(clean.length * 2);
  clean.forEach((word, i) => {
    const value = Number.parseInt(word, 16);
    if (!Number.isFinite(value)) return;
    bytes[i * 2] = (value >> 8) & 0xff;
    bytes[i * 2 + 1] = value & 0xff;
  });
  return bytes;
}

export const CHAR_TABLE_SIZE = CHAR_TABLE.length;
