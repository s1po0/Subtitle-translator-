import { describe, expect, it } from "vitest";

import { assFormat, ssaFormat, formatAssTime, parseAssTime } from "../src/lib/formats/ass";
import { makeDoc } from "./helpers";

const ASS_SAMPLE = `[Script Info]
; Generated for tests
Title: Sample
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,80,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1
Style: Sign,Impact,60,&H0000FFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,8,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,Hello, how are you?
Dialogue: 1,0:00:05.00,0:00:08.00,Sign,Narrator,20,20,10,karaoke,{\\an8}{\\i1}Two lines\\Nof dialogue
Comment: 0,0:00:09.00,0:00:10.00,Default,,0,0,0,,This is a comment
`;

describe("ASS timestamps", () => {
  it("parses centisecond clocks", () => {
    expect(parseAssTime("0:00:01.00")).toBe(1000);
    expect(parseAssTime("1:02:03.45")).toBe(3723450);
  });

  it("formats centisecond clocks", () => {
    expect(formatAssTime(1000)).toBe("00:00:01.00");
    expect(formatAssTime(3723450)).toBe("01:02:03.45");
  });
});

describe("ASS parsing", () => {
  it("preserves the Script Info and Styles blocks verbatim", () => {
    const parsed = assFormat.parse(ASS_SAMPLE);
    expect(parsed.formatMeta.scriptInfo).toContain("PlayResX: 1920");
    expect(parsed.formatMeta.scriptInfo).toContain("[Script Info]");
    expect(parsed.formatMeta.stylesBlock).toContain("Style: Sign,Impact,60");
  });

  it("records per-event styling on each entry", () => {
    const parsed = assFormat.parse(ASS_SAMPLE);
    const second = parsed.entries[1];
    expect(second?.style.name).toBe("Sign");
    expect(second?.style.speaker).toBe("Narrator");
    expect(second?.style.layer).toBe(1);
    expect(second?.style.marginL).toBe("20");
    expect(second?.style.effect).toBe("karaoke");
  });

  it("converts \\N hard breaks into real newlines and remembers the token", () => {
    const parsed = assFormat.parse(ASS_SAMPLE);
    const second = parsed.entries[1];
    expect(second?.original_text).toContain("Two lines\nof dialogue");
    expect(second?.original_text).not.toContain("\\N");
    expect(second?.metadata.lineBreakToken).toBeUndefined();
  });

  it("keeps ASS override tags inline in the text", () => {
    const parsed = assFormat.parse(ASS_SAMPLE);
    expect(parsed.entries[1]?.original_text).toContain("{\\an8}{\\i1}");
    expect(parsed.entries[1]?.style.inlineTags).toEqual(["\\an8", "\\i1"]);
  });

  it("keeps commas inside the Text field intact", () => {
    const parsed = assFormat.parse(ASS_SAMPLE);
    expect(parsed.entries[0]?.original_text).toBe("Hello, how are you?");
  });

  it("flags Comment events as comments", () => {
    const parsed = assFormat.parse(ASS_SAMPLE);
    expect(parsed.entries[2]?.metadata.comment).toBe(true);
  });

  it("detects ASS with high confidence and SSA less so", () => {
    expect(assFormat.sniff(ASS_SAMPLE)).toBe(1);
    expect(assFormat.sniff("[Script Info]\n[Events]\n")).toBe(0.95);
    expect(assFormat.sniff("nothing here")).toBe(0);
  });
});

describe("SSA parsing", () => {
  const SSA_SAMPLE = `[Script Info]
ScriptType: v4.00

[V4 Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding
Style: Default,Arial,24,16777215,16777215,16777215,0,0,0,1,2,2,2,20,20,20,0,0

[Events]
Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: Marked=0,0:00:01.00,0:00:04.00,Default,,0000,0000,0000,,Old style subtitle
`;

  it("handles the SSA field order, which differs from ASS", () => {
    const parsed = ssaFormat.parse(SSA_SAMPLE);
    expect(parsed.format).toBe("ssa");
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.original_text).toBe("Old style subtitle");
    expect(parsed.entries[0]?.start_time).toBe("00:00:01,000");
  });

  it("preserves the [V4 Styles] header", () => {
    const parsed = ssaFormat.parse(SSA_SAMPLE);
    expect(parsed.formatMeta.stylesBlock).toContain("[V4 Styles]");
  });
});

describe("ASS export", () => {
  it("writes the preserved blocks back and rebuilds dialogue lines", () => {
    const parsed = assFormat.parse(ASS_SAMPLE);
    const doc = makeDoc(parsed.entries, "ass", {
      formatMeta: parsed.formatMeta,
    });
    doc.entries[0].translated_text = "سڵاو، چۆنی؟";

    const out = String(assFormat.serialize(doc));

    expect(out).toContain("[Script Info]");
    expect(out).toContain("Style: Sign,Impact,60");
    expect(out).toContain("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text");
    expect(out).toContain("Dialogue: 0,00:00:01.00,00:00:04.00,Default,,0,0,0,,سڵاو، چۆنی؟");
    // Per-line styling survives the round trip.
    expect(out).toContain("Dialogue: 1,00:00:05.00,00:00:08.00,Sign,Narrator,20,20,10,karaoke,");
    expect(out).toContain("{\\an8}{\\i1}");
    // Real newlines go back to \N tokens.
    expect(out).toContain("Two lines\\Nof dialogue");
    expect(out).toContain("Comment: 0,");
  });

  it("re-parses its own output with the same timings", () => {
    const parsed = assFormat.parse(ASS_SAMPLE);
    const out = String(
      assFormat.serialize(makeDoc(parsed.entries, "ass", { formatMeta: parsed.formatMeta })),
    );
    const reparsed = assFormat.parse(out);
    expect(reparsed.entries.map((e) => [e.start_time, e.end_time])).toEqual(
      parsed.entries.map((e) => [e.start_time, e.end_time]),
    );
    expect(reparsed.entries[1]?.style.name).toBe("Sign");
  });
});
