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

test('clearing returns to the drop zone', async () => {
  window.document.querySelector('#clear-btn').click();
  await wait(20);
  assert.equal(window.document.querySelector('#cue-list').children.length, 0);
  assert.equal(window.document.querySelector('#empty-state').hidden, false);
  assert.equal(window.document.querySelector('#translate-btn').disabled, true);
});
