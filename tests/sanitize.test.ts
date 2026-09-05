import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  extractAssTags,
  hasMarkup,
  sanitizeSubtitleHtml,
  stripAllMarkup,
  stripAssTags,
  stripHtmlTags,
} from "../src/lib/sanitize";

describe("sanitizeSubtitleHtml", () => {
  it("keeps the subtitle tags that are meaningful", () => {
    expect(sanitizeSubtitleHtml("<i>Hello</i>")).toBe("<i>Hello</i>");
    expect(sanitizeSubtitleHtml("<b>bold</b>")).toBe("<b>bold</b>");
    expect(sanitizeSubtitleHtml("line1\nline2")).toBe("line1<br />line2");
  });

  it("escapes script tags instead of emitting them", () => {
    const output = sanitizeSubtitleHtml("<script>alert(1)</script>");
    expect(output).not.toContain("<script");
    expect(output).toContain("&lt;script&gt;");
  });

  it("strips event handler attributes from allowed tags", () => {
    const output = sanitizeSubtitleHtml('<i onmouseover="steal()">hi</i>');
    expect(output).toBe("<i>hi</i>");
    expect(output).not.toContain("onmouseover");
  });

  it("drops javascript: URLs in font colours but keeps real colours", () => {
    expect(sanitizeSubtitleHtml('<font color="red">x</font>')).toBe(
      '<font color="red">x</font>',
    );
    const malicious = sanitizeSubtitleHtml('<font color="javascript:alert(1)">x</font>');
    expect(malicious).not.toContain("javascript:");
    expect(malicious).toBe("<font>x</font>");
  });

  it("rejects non-whitelisted attributes entirely", () => {
    expect(sanitizeSubtitleHtml('<i class="x" style="y">t</i>')).toBe("<i>t</i>");
  });

  it("escapes anything that is not a known tag as visible text", () => {
    const output = sanitizeSubtitleHtml("<img src=x onerror=alert(1)>");
    expect(output).not.toContain("<img");
    expect(output).toContain("&lt;img");
  });

  it("cannot be escaped from by an unclosed tag", () => {
    const output = sanitizeSubtitleHtml('a<b onload="x" c>');
    expect(output).not.toContain("onload");
  });

  it("handles malformed nesting without throwing", () => {
    expect(() => sanitizeSubtitleHtml("<<<>>>")).not.toThrow();
  });
});

describe("markup helpers", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("separates ASS and HTML markup", () => {
    const text = '{\\an8}<i>Hello</i>';
    expect(stripAssTags(text)).toBe("<i>Hello</i>");
    expect(stripHtmlTags(text)).toBe("{\\an8}Hello");
    expect(stripAllMarkup(text)).toBe("Hello");
  });

  it("lists ASS override tags", () => {
    expect(extractAssTags('{\\an8}A{\\b1}B')).toEqual(["\\an8", "\\b1"]);
    expect(extractAssTags("plain text")).toEqual([]);
  });

  it("detects the presence of any markup", () => {
    expect(hasMarkup("<i>x</i>")).toBe(true);
    expect(hasMarkup("{\\an8}")).toBe(true);
    expect(hasMarkup("plain")).toBe(false);
  });
});
