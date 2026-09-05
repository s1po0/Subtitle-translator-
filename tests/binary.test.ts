import { describe, expect, it } from "vitest";

import { stlFormat } from "../src/lib/formats/stl";
import { sccFormat } from "../src/lib/formats/scc";
import { mccFormat } from "../src/lib/formats/mcc";
import {
  addParity,
  bytesToHexWords,
  decode608,
  encode608,
  hexWordsToBytes,
  stripParity,
} from "../src/lib/formats/eia608";
import { makeDoc, entry } from "./helpers";

/* ------------------------------------------------------------------ *
 * EIA-608
 * ------------------------------------------------------------------ */

describe("EIA-608 character coding", () => {
  it("sets odd parity on bit 7", () => {
    // 0x48 (0b1001000) has two 1-bits, i.e. even, so the parity bit is added.
    expect(addParity(0x48)).toBe(0xc8);
    // 0x43 ('C', 0b1000011) already has three 1-bits, i.e. odd, so it is unchanged.
    expect(addParity(0x43)).toBe(0x43);
    // Both results must have an odd number of set bits.
    for (const value of [addParity(0x48), addParity(0x43)]) {
      expect(value.toString(2).split("1").length - 1).toBe(3);
    }
  });

  it("strips the parity bit", () => {
    expect(stripParity(0xc8)).toBe(0x48);
  });

  it("decodes the documented example word pair", () => {
    // c8e5 -> 0x48 0x65 -> "He"
    expect(decode608(Uint8Array.from([0xc8, 0xe5])).text).toBe("He");
  });

  it("ignores control words", () => {
    // 942c is "erase displayed memory": both bytes are below 0x20 after parity.
    const result = decode608(Uint8Array.from([0x94, 0x2c, 0xc8, 0xe5]));
    expect(result.text).toBe("He");
    expect(result.controlWords).toBe(1);
  });

  it("ignores padding words without counting them as control codes", () => {
    const result = decode608(Uint8Array.from([0x80, 0x80, 0xc8, 0xe5]));
    expect(result.text).toBe("He");
    expect(result.controlWords).toBe(0);
  });

  it("maps the accented substitutions rather than raw ASCII", () => {
    expect(decode608(Uint8Array.from([0x5c, 0x5c])).text).toBe("éé");
  });

  it("round-trips ASCII text through encode and decode", () => {
    const bytes = encode608("Hello there");
    expect(decode608(bytes).text).toBe("Hello there");
  });

  it("replaces characters outside the 608 set", () => {
    // Arabic script has no 608 equivalent, so it degrades to "?".
    const bytes = encode608("ک");
    expect(decode608(bytes).text).toBe("?");
  });

  it("converts between hex words and bytes", () => {
    const bytes = Uint8Array.from([0xc8, 0xe5, 0xec, 0x6c]);
    const words = bytesToHexWords(bytes);
    expect(words).toBe("c8e5 ec6c");
    expect(Array.from(hexWordsToBytes(words))).toEqual(Array.from(bytes));
  });
});

/* ------------------------------------------------------------------ *
 * EBU STL
 * ------------------------------------------------------------------ */

const GSI_SIZE = 1024;
const TTI_SIZE = 128;

function writeAscii(buffer: Uint8Array, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    buffer[offset + i] = value.charCodeAt(i);
  }
}

/** Build a hand-made, spec-shaped STL so the parser is tested independently. */
function buildStl(cues: Array<{ tci: number; tco: number; text: string }>): Uint8Array {
  const out = new Uint8Array(GSI_SIZE + cues.length * TTI_SIZE);

  writeAscii(out, 0, "850");
  writeAscii(out, 3, "STL25.01"); // DFC: 25 fps
  out[11] = 0x30; // DSC = '0' open subtitling
  writeAscii(out, 12, "00"); // CCT = Latin
  writeAscii(out, 46, "Sample Programme");
  writeAscii(out, 174, "Test Translator");

  cues.forEach((cue, i) => {
    const base = GSI_SIZE + i * TTI_SIZE;
    const view = new DataView(out.buffer);
    view.setUint16(base + 1, i, true); // subtitle number
    out[base + 3] = 0xff; // EBN: last block
    view.setUint32(base + 5, cue.tci, true);
    view.setUint32(base + 9, cue.tco, true);
    out[base + 13] = 2; // vertical position
    out[base + 14] = 2; // justification: centred
    writeAscii(out, base + 16, cue.text);
    out[base + 16 + cue.text.length] = 0x8a; // 0x8A line break then padding
    for (let j = base + 16 + cue.text.length + 1; j < base + TTI_SIZE; j += 1) {
      out[j] = 0x8f;
    }
  });

  return out;
}

describe("EBU STL", () => {
  it("reads the frame rate from the disk format code", () => {
    const bytes = buildStl([{ tci: 25, tco: 100, text: "Hello" }]);
    const parsed = stlFormat.parse(bytes);
    expect(parsed.formatMeta.frameRate).toBe(25);
    expect(parsed.formatMeta.diskFormatCode).toBe("STL25.01");
  });

  it("converts frame counts into milliseconds", () => {
    const bytes = buildStl([{ tci: 25, tco: 100, text: "Hello" }]);
    const parsed = stlFormat.parse(bytes);
    expect(parsed.entries[0]?.start_time).toBe("00:00:01,000");
    expect(parsed.entries[0]?.end_time).toBe("00:00:04,000");
  });

  it("treats 0x8A as a line break and ignores 0x8F padding", () => {
    const bytes = buildStl([{ tci: 0, tco: 50, text: "First" }]);
    // Overwrite the text field with two lines separated by 0x8A.
    writeAscii(bytes, GSI_SIZE + 16, "First");
    bytes[GSI_SIZE + 21] = 0x8a;
    writeAscii(bytes, GSI_SIZE + 22, "Second");
    const parsed = stlFormat.parse(bytes);
    expect(parsed.entries[0]?.original_text).toBe("First\nSecond");
  });

  it("maps italic control codes to tags", () => {
    const bytes = buildStl([{ tci: 0, tco: 50, text: "" }]);
    const textField = GSI_SIZE + 16;
    bytes[textField] = 0x8c; // start italics
    writeAscii(bytes, textField + 1, "hi");
    bytes[textField + 3] = 0x8d; // end italics
    const parsed = stlFormat.parse(bytes);
    expect(parsed.entries[0]?.original_text).toBe("<i>hi</i>");
  });

  it("warns about colour codes it cannot preserve", () => {
    const bytes = buildStl([{ tci: 0, tco: 50, text: "" }]);
    bytes[GSI_SIZE + 16] = 0x83; // alpha yellow
    writeAscii(bytes, GSI_SIZE + 17, "hi");
    const parsed = stlFormat.parse(bytes);
    expect(parsed.warnings.join(" ")).toMatch(/colour/i);
  });

  it("reads GSI programme metadata", () => {
    const bytes = buildStl([{ tci: 0, tco: 25, text: "x" }]);
    const parsed = stlFormat.parse(bytes);
    const gsi = parsed.formatMeta.gsi as Record<string, string>;
    expect(gsi.originalTitle).toBe("Sample Programme");
    expect(gsi.translator).toBe("Test Translator");
  });

  it("sniffs by block arithmetic and disk format code", () => {
    const bytes = buildStl([{ tci: 0, tco: 25, text: "x" }]);
    expect(stlFormat.sniff("", bytes)).toBe(1);
    expect(stlFormat.sniff("", new Uint8Array(10))).toBe(0);
  });

  it("rejects a file too small to hold a GSI block", () => {
    expect(() => stlFormat.parse(new Uint8Array(100))).toThrow(/too small/i);
  });

  it("exports a file whose block arithmetic is valid and re-parses", () => {
    const bytes = buildStl([{ tci: 25, tco: 100, text: "Hello" }]);
    const parsed = stlFormat.parse(bytes);
    const doc = makeDoc(parsed.entries, "stl", { formatMeta: parsed.formatMeta });

    const out = stlFormat.serialize(doc) as Uint8Array;
    expect(out).toBeInstanceOf(Uint8Array);
    expect((out.length - GSI_SIZE) % TTI_SIZE).toBe(0);

    const reparsed = stlFormat.parse(out);
    expect(reparsed.entries[0]?.start_time).toBe("00:00:01,000");
    expect(reparsed.entries[0]?.end_time).toBe("00:00:04,000");
    expect(reparsed.entries[0]?.original_text).toBe("Hello");
  });

  it("encodes newlines as 0x8A on export", () => {
    const doc = makeDoc(
      [entry(1, "00:00:01,000", "00:00:02,000", "One\nTwo")],
      "stl",
      { formatMeta: { frameRate: 25, characterCodeTable: "00" } },
    );
    const out = stlFormat.serialize(doc) as Uint8Array;
    const textField = Array.from(out.subarray(GSI_SIZE + 16, GSI_SIZE + 16 + 8));
    expect(textField).toEqual([
      0x4f, 0x6e, 0x65, 0x8a, 0x54, 0x77, 0x6f, 0x8f,
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * SCC
 * ------------------------------------------------------------------ */

describe("SCC", () => {
  it("decodes caption text from hex words", () => {
    const words = bytesToHexWords(encode608("Hello there"));
    const parsed = sccFormat.parse(`Scenarist_SCC V1.0\n\n00:00:01:00\t${words}\n\n00:00:05:00\t942c\n`);
    expect(parsed.entries[0]?.original_text).toBe("Hello there");
    expect(parsed.entries[0]?.start_time).toBe("00:00:01,000");
  });

  it("takes the end time from the next caption event", () => {
    const words = bytesToHexWords(encode608("Hi"));
    const parsed = sccFormat.parse(
      `Scenarist_SCC V1.0\n\n00:00:01:00\t${words}\n\n00:00:04:00\t${words}\n`,
    );
    expect(parsed.entries[0]?.end_time).toBe("00:00:04,000");
  });

  it("warns that 608 cannot hold Arabic script", () => {
    const words = bytesToHexWords(encode608("Hi"));
    const parsed = sccFormat.parse(`Scenarist_SCC V1.0\n\n00:00:01:00\t${words}\n`);
    expect(parsed.warnings.join(" ")).toMatch(/Arabic script/i);
  });

  it("exports a valid pop-on caption stream that re-parses", () => {
    const words = bytesToHexWords(encode608("Hello there"));
    const parsed = sccFormat.parse(`Scenarist_SCC V1.0\n\n00:00:01:00\t${words}\n\n00:00:05:00\t942c\n`);
    const out = String(sccFormat.serialize(makeDoc(parsed.entries, "scc", {
      formatMeta: parsed.formatMeta,
    })));

    expect(out.startsWith("Scenarist_SCC V1.0")).toBe(true);
    expect(out).toContain("942f"); // end of caption
    expect(out).toContain("942c"); // erase displayed memory

    const reparsed = sccFormat.parse(out);
    expect(reparsed.entries[0]?.original_text).toBe("Hello there");
  });

  it("throws when there is no decodable text", () => {
    expect(() => sccFormat.parse("Scenarist_SCC V1.0\n\n00:00:01:00\t942c\n")).toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * MCC
 * ------------------------------------------------------------------ */

describe("MCC", () => {
  const toBase64 = (text: string) =>
    Buffer.from(text, "binary").toString("base64");

  it("decodes base64 608 rows", () => {
    const payload = toBase64(
      String.fromCharCode(...bytesToHexWords(encode608("Hello")).replace(/\s/g, "")
        .match(/../g)!
        .map((b) => Number.parseInt(b, 16))),
    );
    const sample = `[MCC_File_Version]\n1.8b\n\n[Code_Table_Start]\nCODE=1\n[Code_Table_End]\n\n00:00:01:00\t608\t${payload}\t00000000\n`;

    const parsed = mccFormat.parse(sample);
    expect(parsed.entries[0]?.original_text).toBe("Hello");
    expect(parsed.entries[0]?.start_time).toBe("00:00:01,000");
    expect(parsed.formatMeta.rawHeader).toContain("[MCC_File_Version]");
  });

  it("derives end times from the following row", () => {
    const p1 = toBase64("AAAA");
    const sample =
      `[MCC_File_Version]\n1.8b\n\n00:00:01:00\tASCII\t${p1}\t0\n00:00:06:00\tASCII\t${p1}\t0\n`;
    const parsed = mccFormat.parse(sample);
    expect(parsed.entries[0]?.end_time).toBe("00:00:06,000");
  });

  it("skips rows with an unsupported data type and says so", () => {
    const sample =
      `[MCC_File_Version]\n1.8b\n\n00:00:01:00\tWEIRD\tzzzz\t0\n00:00:02:00\tASCII\t${toBase64("AAAA")}\t0\n`;
    const parsed = mccFormat.parse(sample);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.warnings.join(" ")).toMatch(/unsupported data type/i);
  });

  it("exports rows that re-parse", () => {
    const sample =
      `[MCC_File_Version]\n1.8b\n\n00:00:01:00\tASCII\t${toBase64("Hello")}\t0\n`;
    const parsed = mccFormat.parse(sample);
    const out = String(
      mccFormat.serialize(makeDoc(parsed.entries, "mcc", { formatMeta: parsed.formatMeta })),
    );
    expect(out).toContain("[MCC_File_Version]");
    expect(out).toContain("\t608\t");

    const reparsed = mccFormat.parse(out);
    expect(reparsed.entries[0]?.original_text).toBe("Hello");
  });

  it("sniffs on its version marker", () => {
    expect(mccFormat.sniff("[MCC_File_Version]\n1.8b\n")).toBe(1);
    expect(mccFormat.sniff("nothing")).toBe(0);
  });
});
