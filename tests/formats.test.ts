import { describe, expect, it } from "vitest";

import { srtFormat } from "../src/lib/formats/srt";
import { vttFormat } from "../src/lib/formats/vtt";
import { sbvFormat } from "../src/lib/formats/sbv";
import { subFormat } from "../src/lib/formats/sub";
import { txtFormat } from "../src/lib/formats/txt";
import { detectFormat, exportWarnings, openSubtitleFile } from "../src/lib/formats";
import { makeDoc, entry } from "./helpers";

const SRT_SAMPLE = `1
00:00:01,000 --> 00:00:04,000
Hello, how are you?

2
00:00:05,500 --> 00:00:08,000
<i>Very well,</i> thank you.
Second line here.
`;

describe("SRT", () => {
  it("parses indexes, timestamps and multi-line text", () => {
    const parsed = srtFormat.parse(SRT_SAMPLE);
    expect(parsed.entries).toHaveLength(2);

    const [first, second] = parsed.entries;
    expect(first).toMatchObject({
      index: 1,
      start_time: "00:00:01,000",
      end_time: "00:00:04,000",
      original_text: "Hello, how are you?",
    });
    expect(second?.original_text).toBe("<i>Very well,</i> thank you.\nSecond line here.");
    expect(second?.original_text).toContain("\n");
  });

  it("preserves cue settings that appear after the end timestamp", () => {
    const parsed = srtFormat.parse(
      "1\n00:00:01,000 --> 00:00:04,000 position:50%\nHi\n",
    );
    expect(parsed.entries[0]?.metadata.settings).toBe("position:50%");
  });

  it("records inline ASS tags found in SRT text", () => {
    const parsed = srtFormat.parse("1\n00:00:01,000 --> 00:00:02,000\n{\\an8}Hi\n");
    expect(parsed.entries[0]?.style.inlineTags).toEqual(["\\an8"]);
  });

  it("handles CRLF input", () => {
    const parsed = srtFormat.parse(SRT_SAMPLE.replace(/\n/g, "\r\n"));
    expect(parsed.entries).toHaveLength(2);
  });

  it("warns about blocks with no timing line instead of failing", () => {
    const parsed = srtFormat.parse("garbage block\n\n" + SRT_SAMPLE);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.warnings.join(" ")).toMatch(/no timing line/i);
  });

  it("throws when there is nothing to parse", () => {
    expect(() => srtFormat.parse("just some words\n")).toThrow();
  });

  it("serialises translated text with contiguous numbering", () => {
    const parsed = srtFormat.parse(SRT_SAMPLE);
    const doc = makeDoc(parsed.entries, "srt");
    doc.entries[0].translated_text = "سڵاو، چۆنی؟";

    const out = String(srtFormat.serialize(doc));
    expect(out).toContain("سڵاو، چۆنی؟");
    // Untouched cue falls back to the original so the file stays usable.
    expect(out).toContain("<i>Very well,</i> thank you.");
    expect(out.split("\n")[0]).toBe("1");
    expect(out).toContain("00:00:01,000 --> 00:00:04,000");
  });

  it("round-trips through parse without changing the timings", () => {
    const once = srtFormat.parse(SRT_SAMPLE);
    const twice = srtFormat.parse(String(srtFormat.serialize(makeDoc(once.entries, "srt"))));
    expect(twice.entries.map((e) => [e.start_time, e.end_time])).toEqual(
      once.entries.map((e) => [e.start_time, e.end_time]),
    );
  });
});

describe("WebVTT", () => {
  const VTT_SAMPLE = `WEBVTT - Test file

NOTE this is a comment

intro
00:00:01.000 --> 00:00:04.000 align:middle position:50%
Hello there
`;

  it("keeps the header and the cue settings", () => {
    const parsed = vttFormat.parse(VTT_SAMPLE);
    expect(parsed.formatMeta.webvttHeader).toBe("WEBVTT - Test file");
    expect(parsed.entries[0]?.metadata.settings).toBe("align:middle position:50%");
    expect(parsed.entries[0]?.metadata.cueId).toBe("intro");
  });

  it("converts dot milliseconds to the canonical comma form", () => {
    const parsed = vttFormat.parse(VTT_SAMPLE);
    expect(parsed.entries[0]?.start_time).toBe("00:00:01,000");
  });

  it("warns about NOTE blocks that cannot be carried over", () => {
    const parsed = vttFormat.parse(VTT_SAMPLE);
    expect(parsed.warnings.join(" ")).toMatch(/NOTE/);
  });

  it("writes dot milliseconds and cue settings back out", () => {
    const parsed = vttFormat.parse(VTT_SAMPLE);
    const out = String(
      vttFormat.serialize(makeDoc(parsed.entries, "vtt", { formatMeta: parsed.formatMeta })),
    );
    expect(out.startsWith("WEBVTT - Test file")).toBe(true);
    expect(out).toContain("00:00:01.000 --> 00:00:04.000 align:middle position:50%");
    expect(out).toContain("intro");
  });
});

describe("SBV", () => {
  const SBV_SAMPLE = `0:00:01.000,0:00:04.000
Hello there

0:00:05.000,0:00:08.000
Second line
`;

  it("parses unpadded-hour timestamps", () => {
    const parsed = sbvFormat.parse(SBV_SAMPLE);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]?.start_time).toBe("00:00:01,000");
  });

  it("writes unpadded hours back out", () => {
    const parsed = sbvFormat.parse(SBV_SAMPLE);
    const out = String(sbvFormat.serialize(makeDoc(parsed.entries, "sbv")));
    expect(out).toContain("0:00:01.000,0:00:04.000");
  });
});

describe("SUB", () => {
  it("parses MicroDVD frame-based lines", () => {
    const parsed = subFormat.parse("{24}{120}First line\n{144}{240}Second line\n");
    expect(parsed.entries).toHaveLength(2);
    // 24 frames at the assumed 23.976 fps is about one second.
    expect(parsed.entries[0]?.start_time).toBe("00:00:01,001");
    expect(parsed.formatMeta.fps).toBe(23.976);
    expect(parsed.warnings.join(" ")).toMatch(/frame rate/i);
  });

  it("converts the MicroDVD pipe into a line break", () => {
    const parsed = subFormat.parse("{0}{48}Line one|Line two\n");
    expect(parsed.entries[0]?.original_text).toBe("Line one\nLine two");
  });

  it("parses SubViewer blocks and derives end times", () => {
    const sample =
      "[INFORMATION]\n[TITLE]Test\n[END INFORMATION]\n\n" +
      "[00:00:01.00]\nFirst cue[br]second line\n\n[00:00:05.00]\nSecond cue\n";
    const parsed = subFormat.parse(sample);

    expect(parsed.formatMeta.subVariant).toBe("subviewer");
    expect(parsed.entries[0]?.original_text).toBe("First cue\nsecond line");
    expect(parsed.entries[0]?.end_time).toBe("00:00:05,000");
    expect(parsed.entries[1]?.start_time).toBe("00:00:05,000");
  });

  it("writes MicroDVD frame numbers back out", () => {
    const parsed = subFormat.parse("{24}{120}Hello\n");
    const out = String(subFormat.serialize(makeDoc(parsed.entries, "sub")));
    expect(out).toMatch(/^\{24\}\{120\}Hello/);
  });
});

describe("TXT", () => {
  it("assigns synthetic timings to each line and says so", () => {
    const parsed = txtFormat.parse("Line one\n\nLine two\n");
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]?.start_time).toBe("00:00:00,000");
    expect(parsed.entries[1]?.start_time).toBe("00:00:03,300");
    expect(parsed.warnings.join(" ")).toMatch(/no timing/i);
  });

  it("exports one plain line per subtitle", () => {
    const parsed = txtFormat.parse("Line one\nLine two\n");
    const out = String(txtFormat.serialize(makeDoc(parsed.entries, "txt")));
    expect(out).toBe("Line one\nLine two\n");
  });
});

describe("format detection", () => {
  it("recognises SRT from content even when the extension lies", () => {
    expect(detectFormat("movie.txt", SRT_SAMPLE).format).toBe("srt");
  });

  it("recognises WebVTT from its signature", () => {
    expect(detectFormat("unknown.bin", "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n").format)
      .toBe("vtt");
  });

  it("recognises SBV from its timing shape", () => {
    expect(detectFormat("captions.unknown", "0:00:01.000,0:00:04.000\nHi\n").format).toBe("sbv");
  });

  it("falls back to plain text when nothing matches", () => {
    expect(detectFormat("notes.unknown", "just words\n").format).toBe("txt");
  });

  it("falls back to the file extension when the content says nothing", () => {
    expect(detectFormat("movie.vtt", "").format).toBe("vtt");
    expect(detectFormat("movie.srt", "\n\n").format).toBe("srt");
    expect(detectFormat("movie.srt", "").alternatives).toEqual([]);
  });

  it("ignores an unknown extension entirely", () => {
    expect(detectFormat("movie.unknown", "").format).toBe("txt");
  });
});

describe("openSubtitleFile", () => {
  it("rejects an empty file", () => {
    expect(() => openSubtitleFile("empty.srt", "")).toThrow(/empty/i);
  });

  it("rejects files over 100 MB", () => {
    const huge = new Uint8Array(100 * 1024 * 1024 + 1);
    expect(() => openSubtitleFile("huge.srt", huge)).toThrow(/100 MB/);
  });

  it("rejects binary payloads that are not STL", () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x04]);
    expect(() => openSubtitleFile("weird.srt", bytes)).toThrow(/binary/i);
  });

  it("reports which format it chose", () => {
    const result = openSubtitleFile("clip.srt", SRT_SAMPLE);
    expect(result.detection.format).toBe("srt");
    expect(result.entries.length).toBe(2);
  });
});

describe("export warnings", () => {
  it("warns when Sorani text targets an ASCII-only format", () => {
    const doc = makeDoc(
      [entry(1, "00:00:01,000", "00:00:02,000", "Hello", "سڵاو")],
      "srt",
    );
    const warnings = exportWarnings(doc, "scc");
    expect(warnings.join(" ")).toMatch(/Arabic script/i);
  });

  it("does not warn for a Unicode-capable target", () => {
    const doc = makeDoc(
      [entry(1, "00:00:01,000", "00:00:02,000", "Hello", "سڵاو")],
      "srt",
    );
    expect(exportWarnings(doc, "vtt").join(" ")).not.toMatch(/Arabic script/i);
  });

  it("mentions dropped markup for formats without styling", () => {
    const doc = makeDoc(
      [entry(1, "00:00:01,000", "00:00:02,000", "Hello", "<i>سڵاو</i>")],
      "srt",
    );
    expect(exportWarnings(doc, "sbv").join(" ")).toMatch(/inline formatting/i);
  });
});
