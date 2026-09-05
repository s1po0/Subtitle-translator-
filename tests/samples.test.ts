import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { detectFormat, exportSubtitle, openSubtitleFile } from "../src/lib/formats";
import { makeDoc } from "./helpers";
import type { FormatId } from "../src/lib/types";

/**
 * End-to-end check against the committed sample files: detection, parsing,
 * translation entry and re-export through the real registry.
 */
function sample(name: string): { fileName: string; text: string } {
  const path = fileURLToPath(new URL(`../samples/${name}`, import.meta.url));
  return { fileName: name, text: readFileSync(path, "utf8") };
}

describe("sample files", () => {
  it("parses samples/sample.srt end to end", () => {
    const { fileName, text } = sample("sample.srt");
    const result = openSubtitleFile(fileName, text);

    expect(result.detection.format).toBe("srt");
    expect(result.entries).toHaveLength(5);
    expect(result.entries[0]?.original_text).toBe("Hello, how are you?");
    // Multi-line cues keep their line break.
    expect(result.entries[3]?.original_text).toBe(
      "Come, let us drink tea\nand talk for a while.",
    );

    const doc = { ...makeDoc(result.entries, result.format), formatMeta: result.formatMeta };
    doc.entries[0].translated_text = "سڵاو، چۆنی؟";

    const out = String(exportSubtitle(doc, "srt"));
    expect(out).toContain("سڵاو، چۆنی؟");
    expect(out.split("\n")[0]).toBe("1");
  });

  it("parses samples/sample.ass and preserves its styles", () => {
    const { fileName, text } = sample("sample.ass");
    const result = openSubtitleFile(fileName, text);

    expect(result.detection.format).toBe("ass");
    expect(result.entries).toHaveLength(4);
    expect(result.formatMeta.stylesBlock).toContain("Style: Sign,Impact,64");
    expect(result.entries[1]?.original_text).toContain("{\\an8}");
    expect(result.entries[2]?.original_text).toContain("two lines\nof Kurdish text");

    const doc = { ...makeDoc(result.entries, result.format), formatMeta: result.formatMeta };
    doc.entries[0].translated_text = "بەخێربێیت بۆ هەولێر.";

    const out = String(exportSubtitle(doc, "ass"));
    expect(out).toContain("Style: Sign,Impact,64");
    expect(out).toContain("بەخێربێیت بۆ هەولێر.");
    expect(out).toContain("Comment: 0,");
  });

  it("parses samples/sample.vtt and preserves cue settings", () => {
    const { fileName, text } = sample("sample.vtt");
    const result = openSubtitleFile(fileName, text);

    expect(result.detection.format).toBe("vtt");
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]?.metadata.settings).toBe("align:middle position:50%");
    expect(result.entries[0]?.metadata.cueId).toBe("intro");
    expect(result.formatMeta.webvttHeader).toBe(
      "WEBVTT - Sample for the Kurdish Sorani Subtitle Translator",
    );

    const doc = { ...makeDoc(result.entries, result.format), formatMeta: result.formatMeta };
    doc.entries[2].translated_text = "سوپاس بۆ هاتنتان.";

    const out = String(exportSubtitle(doc, "vtt"));
    expect(out).toContain("00:00:09.000 --> 00:00:12.500 align:start");
    expect(out).toContain("سوپاس بۆ هاتنتان.");
  });

  it("converts a sample between every Unicode-capable format", () => {
    const { fileName, text } = sample("sample.srt");
    const result = openSubtitleFile(fileName, text);
    const doc = { ...makeDoc(result.entries, result.format), formatMeta: result.formatMeta };
    doc.entries[0].translated_text = "سڵاو، چۆنی؟";

    const targets: FormatId[] = ["srt", "vtt", "sbv", "ass", "ssa", "sub", "ttml", "dfxp", "smi", "txt"];
    for (const target of targets) {
      const out = exportSubtitle(doc, target);
      expect(typeof out).toBe("string");
      expect((out as string).length).toBeGreaterThan(0);
      // The Sorani text must survive every Unicode-capable target.
      expect(out as string).toContain("سڵاو");
    }
  });

  it("warns before exporting a sample to an ASCII-only format", () => {
    const { fileName, text } = sample("sample.srt");
    const result = openSubtitleFile(fileName, text);
    const doc = { ...makeDoc(result.entries, result.format), formatMeta: result.formatMeta };
    doc.entries[0].translated_text = "سڵاو";

    // SCC/MCC are EIA-608: the text will be mangled, and the UI must say so.
    expect(detectFormat("clip.scc", "Scenarist_SCC V1.0\n").format).toBe("scc");
    const out = String(exportSubtitle(doc, "scc"));
    expect(out.startsWith("Scenarist_SCC V1.0")).toBe(true);
  });
});
