import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSubtitles,
  toSRT,
  toVTT,
  parseTimestamp,
  formatTimestamp,
} from '../src/subtitles.js';

const SRT = `1
00:00:01,000 --> 00:00:04,250
Hello there.

2
00:00:05,000 --> 00:00:07,500
<i>This is</i> a second
line.
`;

test('parses SRT cues and timings', () => {
  const { cues, format } = parseSubtitles(SRT);
  assert.equal(format, 'srt');
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 1000);
  assert.equal(cues[0].end, 4250);
  assert.equal(cues[1].text, 'This is a second\nline.');
});

test('parses WebVTT with header, settings and NOTE blocks', () => {
  const vtt = `WEBVTT

NOTE this is a comment

cue-1
00:00:01.000 --> 00:00:03.000 align:middle
Hi.

00:00:04.000 --> 00:00:06.000
Bye.
`;
  const { cues, format } = parseSubtitles(vtt);
  assert.equal(format, 'vtt');
  assert.equal(cues.length, 2);
  assert.equal(cues[1].end, 6000);
  assert.equal(cues[1].text, 'Bye.');
});

test('round-trips SRT serialisation', () => {
  const { cues } = parseSubtitles(SRT);
  const out = parseSubtitles(toSRT(cues));
  assert.equal(out.cues.length, 2);
  assert.equal(out.cues[0].text, 'Hello there.');
  assert.equal(out.cues[1].start, 5000);
});

test('serialises WebVTT with dot separator and header', () => {
  const { cues } = parseSubtitles(SRT);
  const vtt = toVTT(cues);
  assert.ok(vtt.startsWith('WEBVTT\n\n'));
  assert.ok(vtt.includes('00:00:01.000 --> 00:00:04.250'));
});

test('uses translated text when available', () => {
  const { cues } = parseSubtitles(SRT);
  cues[0].translated = 'سڵاو';
  assert.ok(toSRT(cues).includes('سڵاو'));
});

test('timestamp helpers cope with short forms and long files', () => {
  assert.equal(parseTimestamp('01:02,5'), 62500);
  assert.equal(formatTimestamp(3723004), '01:02:03,004');
  assert.throws(() => parseSubtitles('nothing useful here'), /No subtitle cues/);
});
