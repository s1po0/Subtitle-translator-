#!/usr/bin/env node
/**
 * Fetch a REAL Unreal Engine 4 HTML5 (Emscripten/WebAssembly) build and host it
 * at /unreal4/janken/.
 *
 * UE 5.x has no web target and the editor needs a GPU, so the only way to run
 * actual Unreal Engine code inside a browser tab is a UE4 HTML5 export — that
 * platform existed until 4.24 and its output is Emscripten + WebAssembly, which
 * every modern browser runs. This script pulls a public UE4 HTML5 sample build
 * file-by-file through the GitHub API (release assets are not required) and
 * writes it next to the app.
 *
 * Nothing Epic-owned is committed to this repository: the folder is gitignored
 * and produced on demand.
 *
 * Usage:
 *   node scripts/fetch-unreal4-demo.mjs               # download + write shell
 *   node scripts/fetch-unreal4-demo.mjs --offline     # only write the shell page
 *   GH_TOKEN=… node scripts/fetch-unreal4-demo.mjs    # avoids rate limits
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPO = 'yhikishima/Unreal-Engine-dev';
const REF = 'master';
const SOURCE = '11.mini-game/JankenGame/HTML5';
const TARGET = path.resolve('public/unreal4/janken');
const SHELL = path.resolve('scripts/unreal4-demo.html');
// The UE4 HTML5 bootstrap needs jQuery; ship the vendored copy from node_modules.
const JQUERY = path.resolve('node_modules/jquery/dist/jquery.min.js');

const SKIP = /(HTML5LaunchHelper|RunMacHTML5LaunchHelper|\.htaccess$|Readme\.txt$)/i;

const api = (url) =>
  fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
    },
  });

function human(bytes) {
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

async function fetchTree() {
  const response = await api(`https://api.github.com/repos/${REPO}/git/trees/${REF}?recursive=1`);
  if (!response.ok) {
    throw new Error(
      `GitHub API ${response.status}. Rate limited? Re-run with GH_TOKEN set (a plain token needs no scopes).`,
    );
  }
  const data = await response.json();
  const prefix = `${SOURCE}/`;
  return data.tree.filter((entry) => entry.type === 'blob' && entry.path.startsWith(prefix));
}

async function downloadBlob(sha, destination) {
  const response = await api(`https://api.github.com/repos/${REPO}/git/blobs/${sha}`);
  if (!response.ok) throw new Error(`blob ${sha.slice(0, 8)} failed (${response.status})`);
  const data = await response.json();
  const buffer = Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf8');
  await writeFile(destination, buffer);
  return buffer.length;
}

async function main() {
  const offline = process.argv.includes('--offline');
  await mkdir(TARGET, { recursive: true });

  if (!offline) {
    console.log(`→ reading export manifest from ${REPO} (${SOURCE})`);
    const files = await fetchTree();
    if (!files.length) throw new Error('Export folder not found upstream — check SOURCE');
    for (const file of files) {
      const name = file.path.slice(SOURCE.length + 1);
      if (!name || SKIP.test(name)) continue;
      const destination = path.join(TARGET, name);
      await mkdir(path.dirname(destination), { recursive: true });
      const size = await downloadBlob(file.sha, destination);
      console.log(`  ${String(human(size)).padStart(8)}  ${name}`);
    }
  } else {
    console.log('→ offline mode: keeping existing engine files, rewriting the shell only');
  }

  // Vendor jQuery (UE4's bootstrap calls `$(…)` before it defines anything).
  if (existsSync(JQUERY)) {
    await mkdir(path.join(TARGET, 'vendor'), { recursive: true });
    await copyFile(JQUERY, path.join(TARGET, 'vendor/jquery.min.js'));
  } else {
    console.warn('! node_modules/jquery missing — run `npm install` so the vendored jQuery is copied');
  }

  // Drop the original starter page; our shell replaces it.
  await rm(path.join(TARGET, 'JankenGame-HTML5-Shipping.html'), { force: true });
  const shell = await readFile(SHELL, 'utf8');
  await writeFile(path.join(TARGET, 'index.html'), shell);

  const wasm = path.join(TARGET, 'UE4Game-HTML5-Shipping.wasm');
  const data = path.join(TARGET, 'JankenGame-HTML5-Shipping.data');
  for (const required of [wasm, data]) {
    const info = await stat(required).catch(() => null);
    if (!info) console.warn(`! missing ${path.basename(required)} — the demo will not start`);
  }
  if (existsSync(wasm)) {
    const head = await readFile(wasm).then((buffer) => buffer.subarray(0, 8));
    const magic = head.toString('latin1');
    if (!magic.startsWith('\0asm')) throw new Error('Downloaded file is not a WebAssembly module');
    const digest = createHash('sha256').update(await readFile(wasm)).digest('hex').slice(0, 16);
    console.log(`✓ wasm verified (\0asm, sha256 ${digest}…)`);
  }

  console.log(`\n✓ Unreal Engine 4 HTML5 demo ready at ${path.relative(process.cwd(), TARGET)}`);
  console.log('  open http://localhost:5173/unreal4/janken/index.html  (or the Engine lab in the app)');
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
});
