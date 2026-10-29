/**
 * Subtitle parsing / serialising for SRT and WebVTT.
 * Pure functions only – no DOM – so they can be unit tested in Node.
 */

const TIMING = /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/;

export function parseTimestamp(value) {
  const clean = String(value).trim().replace(',', '.');
  const parts = clean.split(':').map(Number);
  let h = 0;
  let m = 0;
  let s = 0;
  if (parts.length === 3) [h, m, s] = parts;
  else if (parts.length === 2) [m, s] = parts;
  else s = parts[0];
  const secs = Math.floor(s);
  const ms = Math.round((s - secs) * 1000);
  return ((h * 60 + m) * 60 + secs) * 1000 + ms;
}

export function formatTimestamp(ms, { comma = true, withHours = true } = {}) {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const milli = total % 1000;
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  const sep = comma ? ',' : '.';
  const core = `${pad(m)}:${pad(s)}${sep}${pad(milli, 3)}`;
  return withHours ? `${pad(h)}:${core}` : core;
}

/** Human friendly label used in the cue list. */
export function formatLabel(ms) {
  return formatTimestamp(ms, { comma: false, withHours: false });
}

/**
 * Parse SRT or WebVTT text into cues.
 * @returns {{cues: Array<{id:number,start:number,end:number,text:string}>, format: 'srt'|'vtt'}}
 */
export function parseSubtitles(input) {
  const text = String(input ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) return { cues: [], format: 'srt' };

  const isVTT = /^WEBVTT/i.test(text);
  const blocks = text.split(/\n{2,}/);
  const cues = [];

  for (const rawBlock of blocks) {
    const block = rawBlock.trim();
    if (!block) continue;
    if (isVTT && /^WEBVTT/i.test(block)) continue;
    if (/^(NOTE|STYLE|REGION)\b/i.test(block)) continue;

    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => TIMING.test(line));
    if (timingIndex === -1) continue;

    const match = lines[timingIndex].match(TIMING);
    const start = parseTimestamp(match[1]);
    const end = parseTimestamp(match[2]);
    let body = lines.slice(timingIndex + 1);

    // Drop a stray cue-number line that some encoders put above the timing.
    if (body.length && /^\d+$/.test(body[0].trim())) body = body.slice(1);

    // Strip simple inline tags but keep line breaks.
    const plain = body
      .join('\n')
      .replace(/<\/?[^>]+>/g, '')
      .replace(/\{\\[^}]*\}/g, '')
      .trim();

    if (!plain) continue;
    cues.push({ id: cues.length + 1, start, end, text: plain });
  }

  if (!cues.length) throw new Error('No subtitle cues found. Expected SRT (00:00:01,000 --> ...) or WebVTT timing lines.');
  return { cues, format: isVTT ? 'vtt' : 'srt' };
}

export function toSRT(cues, pick = (cue) => cue.translated || cue.text) {
  return cues
    .map((cue, index) => {
      const body = String(pick(cue)).trim();
      return `${index + 1}\n${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}\n${body}`;
    })
    .join('\n\n')
    .concat('\n');
}

export function toVTT(cues, pick = (cue) => cue.translated || cue.text) {
  const body = cues
    .map((cue, index) => {
      const text = String(pick(cue)).trim();
      return `${index + 1}\n${formatTimestamp(cue.start, { comma: false })} --> ${formatTimestamp(cue.end, { comma: false })}\n${text}`;
    })
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

/** Rough CPS (characters per second) helper for QA badges. */
export function charsPerSecond(cue, value = cue.translated || cue.text) {
  const seconds = Math.max(0.2, (cue.end - cue.start) / 1000);
  return String(value).replace(/\s+/g, '').length / seconds;
}
