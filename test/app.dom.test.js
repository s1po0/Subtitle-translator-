/**
 * Smoke test for the browser wiring: boots src/main.js inside jsdom, loads the
 * sample subtitles and runs a demo translation pass end to end.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''), {
  url: 'http://localhost:5173/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
});

const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.localStorage = window.localStorage;
globalThis.HTMLElement = window.HTMLElement;
globalThis.DOMException = window.DOMException;
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};

// three.js needs a real WebGL context; main.js falls back gracefully without one.
window.HTMLCanvasElement.prototype.getContext = () => null;

await import('../src/main.js');

test.after(() => dom.window.close());

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('sample subtitles load into the cue list', async () => {
  window.document.querySelector('#sample-btn').click();
  await wait(50);
  const rows = window.document.querySelectorAll('#cue-list .cue-row');
  assert.equal(rows.length, 10);
  assert.equal(window.document.querySelector('#editor').hidden, false);
  assert.equal(window.document.querySelector('#translate-btn').disabled, false);
  assert.equal(window.document.querySelector('#cue-pill').textContent, '10 cues');
});

test('demo translation fills every cue', async () => {
  window.document.querySelector('#translate-btn').click();
  await wait(1200);
  const targets = [...window.document.querySelectorAll('#cue-list .cue-row .cue-cell:nth-child(3) textarea')];
  assert.equal(targets.length, 10);
  assert.ok(targets.every((area) => area.value.trim().length > 0));
  assert.equal(window.document.querySelector('#counts').textContent, '10/10 translated');
});

test('editing a cue clears the automatic badge', async () => {
  const area = window.document.querySelector('#cue-list .cue-row .cue-cell:nth-child(3) textarea');
  area.value = 'دەقی دەستکاریکراو';
  area.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(20);
  const badges = area.parentElement.querySelector('.cue-badges').textContent;
  assert.match(badges, /edited/);
});

test('engine lab launches the bundled Unreal 4 build on demand', async () => {
  const frame = window.document.querySelector('#godot-frame');
  const idle = window.document.querySelector('#godot-idle');
  assert.equal(frame.hidden, true, 'nothing loads before a click');

  window.document.querySelector('#godot-run').click();
  await wait(50);

  assert.equal(frame.hidden, false);
  assert.equal(idle.hidden, true);
  assert.match(frame.src, /\/unreal4\/janken\/index\.html/);
  assert.equal(window.document.querySelector('#godot-reload').disabled, false);
  assert.equal(window.document.querySelector('#godot-open').getAttribute('aria-disabled'), null);
  assert.match(window.document.querySelector('#godot-status').textContent, /unreal 4/);
});

test('engine list renders both bundled engines and can switch to Godot', async () => {
  await wait(150);
  const items = [...window.document.querySelectorAll('#godot-builds .godot-build')];
  assert.ok(items.length >= 2);
  assert.match(items[0].textContent, /Unreal Engine 4/);
  assert.match(items[1].textContent, /Godot 4/);
  assert.match(items[1].textContent, /Dungeon Crawler/);

  items[1].querySelector('button').click();
  await wait(80);
  const frame = window.document.querySelector('#godot-frame');
  assert.match(frame.src, /\/godot\/dungeon-crawler\/index\.html/);
  assert.match(window.document.querySelector('#godot-status').textContent, /godot 4/);
});

test('unreal lab validates the URL and fails gracefully without WebRTC', async () => {
  const input = window.document.querySelector('#unreal-url');
  const button = window.document.querySelector('#unreal-connect');
  const pill = window.document.querySelector('#unreal-status');

  input.value = 'ftp://nope';
  button.click();
  await wait(20);
  assert.equal(pill.textContent, 'idle', 'invalid input never starts a connection');

  input.value = 'localhost:8888';
  button.click();
  await wait(400);
  // jsdom exposes no WebRTC: the lab must report that and not crash the page.
  assert.match(window.document.querySelector('#unreal-log').textContent, /no WebRTC|error/i);
  assert.equal(pill.textContent, 'WebRTC unavailable');
});

test('clearing returns to the drop zone', async () => {
  window.document.querySelector('#clear-btn').click();
  await wait(20);
  assert.equal(window.document.querySelector('#cue-list').children.length, 0);
  assert.equal(window.document.querySelector('#empty-state').hidden, false);
  assert.equal(window.document.querySelector('#translate-btn').disabled, true);
});
