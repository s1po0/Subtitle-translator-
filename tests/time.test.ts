import { describe, expect, it } from "vitest";

import {
  framesToMs,
  formatDuration,
  isValidTime,
  msToFrames,
  msToSbv,
  msToSrt,
  msToSubViewer,
  msToTime,
  msToTimecode,
  msToVtt,
  parseSubViewerToMs,
  parseTimeToMs,
  timecodeToMs,
} from "../src/lib/time";

describe("parseTimeToMs", () => {
  it("reads SRT comma timestamps", () => {
    expect(parseTimeToMs("00:00:01,000")).toBe(1000);
    expect(parseTimeToMs("01:02:03,456")).toBe(3723456);
  });

  it("reads WebVTT dot timestamps", () => {
    expect(parseTimeToMs("00:00:01.000")).toBe(1000);
  });

  it("treats the fraction field as a fraction of a second", () => {
    expect(parseTimeToMs("00:00:00,4")).toBe(400);
    expect(parseTimeToMs("00:00:00,45")).toBe(450);
  });

  it("accepts timestamps without an hour field", () => {
    expect(parseTimeToMs("02:03.500")).toBe(123500);
  });

  it("tolerates hours above 99", () => {
    expect(parseTimeToMs("120:00:00,000")).toBe(432000000);
  });

  it("rejects out-of-range minutes and seconds", () => {
    expect(() => parseTimeToMs("00:60:00,000")).toThrow();
    expect(() => parseTimeToMs("00:00:60,000")).toThrow();
    expect(() => parseTimeToMs("nonsense")).toThrow();
  });

  it("reports validity without throwing", () => {
    expect(isValidTime("00:00:01,000")).toBe(true);
    expect(isValidTime("00:00:1,00")).toBe(false);
  });
});

describe("formatting", () => {
  it("formats SRT with a comma", () => {
    expect(msToSrt(3723456)).toBe("01:02:03,456");
    expect(msToTime(0)).toBe("00:00:00,000");
  });

  it("formats WebVTT with a dot", () => {
    expect(msToVtt(1500)).toBe("00:00:01.500");
  });

  it("formats SBV without padding the hours", () => {
    expect(msToSbv(1000)).toBe("0:00:01.000");
    expect(msToSbv(3661123)).toBe("1:01:01.123");
  });

  it("formats SubViewer with centiseconds", () => {
    expect(msToSubViewer(1234)).toBe("00:00:01.23");
  });

  it("clamps negative input rather than producing a broken string", () => {
    expect(msToSrt(-500)).toBe("00:00:00,000");
  });
});

describe("SubViewer timestamps", () => {
  it("round-trips centisecond values", () => {
    expect(parseSubViewerToMs("00:00:01.23")).toBe(1230);
    expect(msToSubViewer(parseSubViewerToMs("00:01:02.34"))).toBe("00:01:02.34");
  });
});

describe("frame counts", () => {
  it("converts between milliseconds and frames", () => {
    expect(msToFrames(1000, 25)).toBe(25);
    expect(framesToMs(25, 25)).toBe(1000);
    expect(framesToMs(24, 23.976)).toBeCloseTo(1001, 0);
  });
});

describe("SMPTE timecode", () => {
  it("round-trips non-drop-frame timecode", () => {
    const tc = msToTimecode(3723000, 30);
    expect(tc).toBe("01:02:03:00");
    expect(timecodeToMs(tc, 30)).toBe(3723000);
  });

  it("uses a semicolon separator for drop-frame", () => {
    expect(msToTimecode(60000, 29.97, true)).toContain(";");
  });

  it("skips frame numbers 00 and 01 in drop-frame minutes", () => {
    // At the one-minute mark drop-frame jumps from :59;29 to :01;02.
    const tc = msToTimecode(60000, 29.97, true);
    expect(tc.endsWith(";00") || tc.endsWith(";01")).toBe(false);
    expect(timecodeToMs(tc, 29.97, true)).toBeCloseTo(60000, -2);
  });
});

describe("formatDuration", () => {
  it("omits hours when under an hour", () => {
    expect(formatDuration(65000)).toBe("1:05");
    expect(formatDuration(3661000)).toBe("1:01:01");
  });
});
