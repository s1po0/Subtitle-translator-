/**
 * Integrity checks for the bundled Unreal Engine 4 HTML5 demo.
 *
 * The engine files themselves are downloaded on demand (`npm run unreal:demo`)
 * and are never committed, so these tests skip cleanly when the demo has not
 * been fetched yet — but they always verify the shell page and the fetcher.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DEMO = path.join(ROOT, 'public/unreal4/janken');
const SHELL = path.join(ROOT, 'scripts/unreal4-demo.html');
const FETCHER = path.join(ROOT, 'scripts/fetch-unreal4-demo.mjs');

test('the shell page references only local assets and keeps UE4 hooks', async () => {
  const html = await readFile(SHELL, 'utf8');
  assert.doesNotMatch(html, /https?:\/\//i, 'no CDN dependencies — the page must work offline');
  assert.match(html, /id="canvas"/, 'UE4 writes its WebGL surface into #canvas');
  assert.match(html, /id="mainarea"/);
  assert.match(html, /id="compilingmessage"/);
  assert.match(html, /id="loadTasks"/);
  assert.match(html, /id="logwindow"/);
  assert.match(html, /vendor\/jquery\.min\.js/, 'UE4’s bootstrap needs jQuery before it runs');
  assert.match(html, /JankenGame-HTML5-Shipping\.UE4\.js/);
});

test('the fetcher targets the web export, hardens against partial downloads', async () => {
  const source = await readFile(FETCHER, 'utf8');
  assert.match(source, /yhikishima\/Unreal-Engine-dev/);
  assert.match(source, /11\.mini-game\/JankenGame\/HTML5/);
  assert.match(source, /\\0asm/, 'it must verify the wasm magic bytes');
  assert.match(source, /git\/blobs\//, 'it downloads through the GitHub blob API');
  assert.match(source, /gitignore|public\/unreal4/i);
});

test('downloaded demo is served with web-safe file sizes', async (t) => {
  if (!existsSync(path.join(DEMO, 'index.html'))) {
    t.skip('run `npm run unreal:demo` to fetch the UE4 HTML5 build');
    return;
  }
  const wasmPath = path.join(DEMO, 'UE4Game-HTML5-Shipping.wasm');
  const dataPath = path.join(DEMO, 'JankenGame-HTML5-Shipping.data');
  const wasm = await readFile(wasmPath);
  const data = await readFile(dataPath);

  assert.equal(wasm.subarray(0, 4).toString('latin1'), '\0asm', 'wasm magic');
  assert.ok((await stat(wasmPath)).size > 20 * 1024 * 1024, 'engine wasm is present');
  assert.ok((await stat(dataPath)).size > 5 * 1024 * 1024, 'game content pack is present');

  const html = await readFile(path.join(DEMO, 'index.html'), 'utf8');
  for (const [, src] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (src.startsWith('#') || src.startsWith('/') || src.startsWith('data:')) continue;
    assert.ok(existsSync(path.join(DEMO, src)), `referenced asset exists: ${src}`);
  }
  assert.ok(data.length > 0);
});
