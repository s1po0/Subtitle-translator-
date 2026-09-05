// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { ttmlFormat, dfxpFormat, parseTtmlTime, ensureNamespaces } from "../src/lib/formats/ttml";
import { smiFormat, decodeEntities } from "../src/lib/formats/smi";
import { makeDoc } from "./helpers";

const TTML_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<tt xml:lang="en" xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" ttp:frameRate="25">
  <head>
    <styling>
      <style xml:id="s1" tts:fontSize="24px" tts:color="white"/>
    </styling>
  </head>
  <body>
    <div>
      <p begin="00:00:01.000" end="00:00:04.000" style="s1" region="r1">Hello there</p>
      <p begin="00:00:05.000" end="00:00:08.000">Two<br/>lines</p>
      <p begin="00:00:09.000" dur="2s">Duration based</p>
    </div>
  </body>
</tt>
`;

describe("TTML time expressions", () => {
  const ctx = { frameRate: 25, tickRate: 270000, subFrameRate: 1 };

  it("reads clock time with milliseconds", () => {
    expect(parseTtmlTime("00:00:01.000", ctx)).toBe(1000);
    expect(parseTtmlTime("01:02:03.500", ctx)).toBe(3723500);
  });

  it("reads clock time with frames", () => {
    expect(parseTtmlTime("00:00:01:12", ctx)).toBe(1000 + Math.round((12 / 25) * 1000));
  });

  it("reads offset time in every metric", () => {
    expect(parseTtmlTime("1.5s", ctx)).toBe(1500);
    expect(parseTtmlTime("900ms", ctx)).toBe(900);
    expect(parseTtmlTime("2m", ctx)).toBe(120000);
    expect(parseTtmlTime("1h", ctx)).toBe(3600000);
    expect(parseTtmlTime("25f", ctx)).toBe(1000);
    expect(parseTtmlTime("270000t", ctx)).toBe(1000);
  });

  it("rejects nonsense", () => {
    expect(() => parseTtmlTime("soon", ctx)).toThrow();
  });
});

describe("TTML parsing", () => {
  it("reads paragraphs with their timing", () => {
    const parsed = ttmlFormat.parse(TTML_SAMPLE);
    expect(parsed.entries).toHaveLength(3);
    expect(parsed.entries[0]).toMatchObject({
      start_time: "00:00:01,000",
      end_time: "00:00:04,000",
      original_text: "Hello there",
    });
  });

  it("turns <br/> into a line break", () => {
    const parsed = ttmlFormat.parse(TTML_SAMPLE);
    expect(parsed.entries[1]?.original_text).toBe("Two\nlines");
  });

  it("resolves dur into an end time", () => {
    const parsed = ttmlFormat.parse(TTML_SAMPLE);
    expect(parsed.entries[2]?.start_time).toBe("00:00:09,000");
    expect(parsed.entries[2]?.end_time).toBe("00:00:11,000");
  });

  it("preserves the head styling block and per-paragraph attributes", () => {
    const parsed = ttmlFormat.parse(TTML_SAMPLE);
    expect(parsed.formatMeta.headMarkup).toContain('xml:id="s1"');
    const attrs = parsed.entries[0]?.metadata.ttmlAttrs as Record<string, string>;
    expect(attrs.style).toBe("s1");
    expect(attrs.region).toBe("r1");
  });

  it("reads the declared frame rate from the root element", () => {
    const parsed = ttmlFormat.parse(TTML_SAMPLE);
    expect(parsed.formatMeta.frameRate).toBe(25);
  });

  it("rejects malformed XML with a clear message", () => {
    expect(() => ttmlFormat.parse("<tt><p begin='0'")).toThrow(/well-formed|<tt>/i);
  });

  it("rejects XML that is not Timed Text", () => {
    expect(() => ttmlFormat.parse("<root><child/></root>")).toThrow(/<tt>/);
  });

  it("exports valid XML with the head intact", () => {
    const parsed = ttmlFormat.parse(TTML_SAMPLE);
    const doc = makeDoc(parsed.entries, "ttml", {
      formatMeta: parsed.formatMeta,
    });
    doc.entries[0].translated_text = "سڵاو";

    const out = String(ttmlFormat.serialize(doc));
    expect(out).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(out).toContain('xml:id="s1"');
    expect(out).toContain('begin="00:00:01.000" end="00:00:04.000"');
    expect(out).toContain("سڵاو");
    // The result must still be parseable XML.
    expect(new DOMParser().parseFromString(out, "application/xml").querySelector("parsererror")).toBeNull();
  });

  it("escapes text so the exported XML stays well-formed", () => {
    const parsed = ttmlFormat.parse(TTML_SAMPLE);
    const doc = makeDoc(parsed.entries, "ttml", { formatMeta: parsed.formatMeta });
    doc.entries[0].translated_text = "A & B <tag>";
    const out = String(ttmlFormat.serialize(doc));
    expect(out).toContain("A &amp; B &lt;tag&gt;");
    expect(new DOMParser().parseFromString(out, "application/xml").querySelector("parsererror")).toBeNull();
  });
});

describe("ensureNamespaces", () => {
  it("declares a prefix that is used but never bound", () => {
    const xml = '<tt xmlns="http://www.w3.org/ns/ttml" ttp:frameRate="25"><body/></tt>';
    const fixed = ensureNamespaces(xml);
    expect(fixed).toContain('xmlns:ttp="http://www.w3.org/ns/ttml#parameter"');
    expect(fixed).toContain('ttp:frameRate="25"');
  });

  it("declares prefixed element names too", () => {
    const xml =
      '<tt xmlns="http://www.w3.org/ns/ttml"><head><ttm:title>x</ttm:title></head></tt>';
    expect(ensureNamespaces(xml)).toContain(
      'xmlns:ttm="http://www.w3.org/ns/ttml#metadata"',
    );
  });

  it("leaves an already-declared prefix alone", () => {
    const xml =
      '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="urn:custom" ttp:frameRate="25"/>';
    expect(ensureNamespaces(xml)).toBe(xml);
  });

  it("never redeclares the built-in xml prefix", () => {
    const xml = '<tt xml:lang="en" xmlns="http://www.w3.org/ns/ttml"/>';
    expect(ensureNamespaces(xml)).toBe(xml);
  });

  it("returns non-TTML input untouched", () => {
    expect(ensureNamespaces("<root/>")).toBe("<root/>");
  });

  it("makes a previously unparseable document parse", () => {
    const broken =
      '<tt xmlns="http://www.w3.org/ns/ttml" ttp:frameRate="25"><body><div>' +
      '<p begin="00:00:01.000" end="00:00:02.000">Hi</p></div></body></tt>';
    const before = new DOMParser().parseFromString(broken, "application/xml");
    expect(before.querySelector("parsererror")).not.toBeNull();

    const after = new DOMParser().parseFromString(
      ensureNamespaces(broken),
      "application/xml",
    );
    expect(after.querySelector("parsererror")).toBeNull();
    expect(ttmlFormat.parse(broken).entries[0]?.original_text).toBe("Hi");
  });
});

describe("DFXP", () => {
  it("recognises the legacy ttaf1 namespace", () => {
    const legacy =
      '<?xml version="1.0"?><tt xmlns="http://www.w3.org/2006/04/ttaf1"><head/><body><div>' +
      '<p begin="00:00:01.000" end="00:00:02.000">Hi</p></div></body></tt>';
    expect(dfxpFormat.sniff(legacy)).toBe(1);
    expect(dfxpFormat.parse(legacy).entries[0]?.original_text).toBe("Hi");
  });
});

describe("SAMI", () => {
  const SMI_SAMPLE = `<SAMI>
<HEAD>
<TITLE>Test</TITLE>
<STYLE TYPE="text/css">
<!--
P {font-family: Arial;}
.ENCC {Name: English; lang: en-US; SAMIType: CC;}
-->
</STYLE>
</HEAD>
<BODY>
<SYNC Start=1000><P Class=ENCC>Hello there
<SYNC Start=4000><P Class=ENCC>Second &amp; cue<br>with a break
<SYNC Start=7000><P Class=ENCC>&nbsp;
</BODY>
</SAMI>
`;

  it("derives end times from the following SYNC", () => {
    const parsed = smiFormat.parse(SMI_SAMPLE);
    expect(parsed.entries[0]?.start_time).toBe("00:00:01,000");
    expect(parsed.entries[0]?.end_time).toBe("00:00:04,000");
    expect(parsed.entries[1]?.start_time).toBe("00:00:04,000");
  });

  it("drops the trailing empty cue", () => {
    const parsed = smiFormat.parse(SMI_SAMPLE);
    expect(parsed.entries).toHaveLength(2);
  });

  it("decodes entities and converts <br> to a line break", () => {
    const parsed = smiFormat.parse(SMI_SAMPLE);
    expect(parsed.entries[1]?.original_text).toBe("Second & cue\nwith a break");
  });

  it("keeps the head style block and the cue class", () => {
    const parsed = smiFormat.parse(SMI_SAMPLE);
    expect(parsed.formatMeta.headMarkup).toContain(".ENCC");
    expect(parsed.entries[0]?.metadata.smiClass).toBe("ENCC");
  });

  it("decodes numeric and named entities", () => {
    expect(decodeEntities("&#65;&#x42;&amp;&nbsp;")).toBe("AB& ");
  });

  it("exports SAMI with the preserved head", () => {
    const parsed = smiFormat.parse(SMI_SAMPLE);
    const doc = makeDoc(parsed.entries, "smi", { formatMeta: parsed.formatMeta });
    doc.entries[0].translated_text = "سڵاو";
    const out = String(smiFormat.serialize(doc));
    expect(out).toContain("<SAMI>");
    expect(out).toContain(".ENCC");
    expect(out).toContain("<SYNC Start=1000>");
    expect(out).toContain("سڵاو");
  });
});
