/**
 * Timestamp and timecode conversion.
 *
 * Internally every moment is a non-negative integer number of milliseconds.
 * The canonical *string* form used across the UI and in `SubtitleEntry` is the
 * SRT shape `HH:MM:SS,mmm`; each exporter converts to whatever its format
 * wants (dots instead of commas, unpadded hours, frame counts, SMPTE
 * timecode, ...).
 */

/** `HH:MM:SS,mmm` or `HH:MM:SS.mmm`; hours may exceed 99, minutes/seconds may not. */
const TIME_RE = /^(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{1,3})$/;

/** `MM:SS.mmm` — legal in WebVTT and SBV when hours are zero. */
const SHORT_TIME_RE = /^([0-5]?\d):([0-5]\d)[,.](\d{1,3})$/;

/** SMPTE `HH:MM:SS:FF`, with `;` before frames for drop-frame. */
const TIMECODE_RE = /^(\d{2,3}):([0-5]\d):([0-5]\d)[:;,.](\d{1,3})$/;

export function parseTimeToMs(value: string): number {
  const text = value.trim();

  const full = TIME_RE.exec(text);
  if (full) {
    const [, h, m, s, ms] = full;
    return (
      ((Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000) + padMillis(ms)
    );
  }

  const short = SHORT_TIME_RE.exec(text);
  if (short) {
    const [, m, s, ms] = short;
    return (Number(m) * 60 + Number(s)) * 1000 + padMillis(ms);
  }

  throw new Error(`Invalid timestamp: "${value}"`);
}

/** `"4"` -> 400ms, `"45"` -> 450ms: the field is a fraction of a second. */
function padMillis(ms: string): number {
  return Number(ms.padEnd(3, "0").slice(0, 3));
}

export function isValidTime(value: string): boolean {
  try {
    parseTimeToMs(value);
    return true;
  } catch {
    return false;
  }
}

export function msToTime(ms: number, separator: "," | "." = ","): string {
  const safe = Math.max(0, Math.round(ms));
  const millis = safe % 1000;
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return (
    `${String(hours).padStart(2, "0")}:` +
    `${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")}${separator}` +
    `${String(millis).padStart(3, "0")}`
  );
}

/** SRT / canonical: `00:00:01,000`. */
export function msToSrt(ms: number): string {
  return msToTime(ms, ",");
}

/** WebVTT / TTML: `00:00:01.000`. */
export function msToVtt(ms: number): string {
  return msToTime(ms, ".");
}

/** SBV / YouTube: `0:00:01.000` (hours unpadded). */
export function msToSbv(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const millis = safe % 1000;
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return (
    `${hours}:` +
    `${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`
  );
}

/** SubViewer: `00:00:01.00` (centiseconds). */
export function msToSubViewer(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const centis = Math.floor((safe % 1000) / 10);
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return (
    `${String(hours).padStart(2, "0")}:` +
    `${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")}.${String(centis).padStart(2, "0")}`
  );
}

export function parseSubViewerToMs(value: string): number {
  const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)[.](\d{1,2})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid SubViewer timestamp: "${value}"`);
  const [, h, m, s, cs] = match;
  return (
    (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000 + Number(cs) * 10
  );
}

/* ------------------------------------------------------------------ *
 * Frame counts (MicroDVD `.sub`, EBU STL)
 * ------------------------------------------------------------------ */

export const DEFAULT_FPS = 23.976;

export function msToFrames(ms: number, fps: number): number {
  const rate = fps > 0 ? fps : DEFAULT_FPS;
  return Math.round((ms / 1000) * rate);
}

export function framesToMs(frames: number, fps: number): number {
  const rate = fps > 0 ? fps : DEFAULT_FPS;
  return Math.round((frames / rate) * 1000);
}

/* ------------------------------------------------------------------ *
 * SMPTE timecode (SCC, MCC)
 * ------------------------------------------------------------------ */

/**
 * Convert milliseconds to `HH:MM:SS:FF` (or `HH:MM:SS;FF` when drop-frame).
 *
 * Drop-frame skips frame numbers 00 and 01 at the start of every minute except
 * every tenth minute, which is why the frame count is not simply `ms * fps`.
 */
export function msToTimecode(
  ms: number,
  fps: number,
  dropFrame = false,
): string {
  const rate = fps > 0 ? fps : DEFAULT_FPS;
  const roundedRate = Math.round(rate);
  let totalFrames = Math.max(0, Math.round((ms / 1000) * rate));

  let separator = ":";
  let frameNumber: number;
  let seconds: number;
  let minutes: number;
  let hours: number;

  if (dropFrame && roundedRate === 30) {
    separator = ";";
    const dropFrames = 2;
    const framesPer10Min = 17982;
    const framesPerMin = 1798;
    const d = Math.floor(totalFrames / framesPer10Min);
    const m = totalFrames % framesPer10Min;
    totalFrames += 18 * d;
    if (m > 1) totalFrames += dropFrames * Math.floor((m - 2) / framesPerMin);

    frameNumber = totalFrames % roundedRate;
    const totalSeconds = Math.floor(totalFrames / roundedRate);
    seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    minutes = totalMinutes % 60;
    hours = Math.floor(totalMinutes / 60);
  } else {
    frameNumber = totalFrames % roundedRate;
    const totalSeconds = Math.floor(totalFrames / roundedRate);
    seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    minutes = totalMinutes % 60;
    hours = Math.floor(totalMinutes / 60);
  }

  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(frameNumber)}`;
}

/** Parse `HH:MM:SS:FF` / `HH:MM:SS;FF` into milliseconds. */
export function timecodeToMs(
  value: string,
  fps: number,
  dropFrame = false,
): number {
  const match = TIMECODE_RE.exec(value.trim());
  if (!match) throw new Error(`Invalid timecode: "${value}"`);
  const [, h, m, s, f] = match;
  const rate = fps > 0 ? fps : DEFAULT_FPS;
  const roundedRate = Math.round(rate);

  let totalFrames =
    (Number(h) * 3600 + Number(m) * 60 + Number(s)) * roundedRate + Number(f);

  if (dropFrame && roundedRate === 30 && value.includes(";")) {
    const dropFrames = 2;
    const totalMinutes = Number(h) * 60 + Number(m);
    totalFrames -=
      dropFrames * (totalMinutes - Math.floor(totalMinutes / 10));
  }

  return Math.round((totalFrames / rate) * 1000);
}

/** Human-readable duration, used in the preview timeline. */
export function formatDuration(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const hoursPart = hours > 0 ? `${hours}:` : "";
  return `${hoursPart}${String(minutes).padStart(hours > 0 ? 2 : 1, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Split/merge helpers keep cues inside this window unless told otherwise. */
export function clampMs(ms: number, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Math.min(Math.max(ms, min), max);
}
