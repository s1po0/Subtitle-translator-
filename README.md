# SUB//LATE — Subtitle Translator + Godot Engine Lab

وەرگێڕی ژێرنووس (SRT / WebVTT) کە **تەواو لە وێبگەڕدا** کار دەکات، لەگەڵ ڕووکارێکی
ڕیال-تایمی سینەمایی، و **Godot 4 ڕاستەقینە کە لێرە هۆست کراوە** (wasm + pck).

A cinematic, browser-only subtitle translator, plus a working **Godot 4 web-export host**:
drop your exported game zip and it plays inside this preview.

---

## Unreal Engine یان Godot؟ (why Unreal cannot run here, and Godot can)

| | Unreal Engine | Godot 4 |
| --- | --- | --- |
| Official web export | ✗ removed after 4.24 | ✓ **Web** preset (WASM + WebGL2) |
| Runs in this container | ✗ needs GPU + ~100 GB install | ✓ static files, no GPU needed on the server |
| How it can reach a browser | Pixel Streaming from a GPU server | the browser *is* the runtime |

ئەم ژینگەیە کۆنتەینەرێکی Linuxـی بێ GPUـە، و ئەدیسەر/export templatesـی Unreal لە ڕێگای
ئینتەرنێتەوە بەردەست نییە. Godot بە پێچەوانەوە دەتوانێت بۆ وێب export بکرێت و تەنها پێویستی بە
فایلە ستاتیکەکان هەیە — بۆیە لێرە هۆست کراوە.

## Godot Engine Lab

The app ships an **Engine lab** section:

- **Bundled demo** — a real, unchanged Godot 4 web export (CC0) at
  [`public/godot/dungeon-crawler/`](public/godot/dungeon-crawler/) with `index.html`,
  `.wasm` (13.8 MB), `.pck`, `.js` and the audio worklet. It is loaded **only when you click
  “Run the Godot demo”**.
- **Bring your own export** — in Godot: *Project → Export → Web*, export to a folder, zip the
  folder, then drop the zip on the Engine lab drop zone. The dev/preview server unzips it into
  `.godot-hosts/<slug>/` (gitignored, newest 6 kept) and serves it at `/godot-host/<slug>/`.
- Fullscreen, reload, “open in new tab”, and delete per build.

### Local API used by the upload flow

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/godot/upload` | raw zip body + `X-Godot-Name` header → `{ slug, entry, … }` |
| `GET` | `/api/godot/builds` | list hosted builds |
| `DELETE` | `/api/godot/builds/:slug` | remove a build |
| `GET` | `/godot-host/:slug/*` | the uploaded export itself |

Served with `application/wasm` for `.wasm`, `application/octet-stream` for `.pck`, and zip
paths normalised (`..`, absolute paths and Windows separators clamped) so an upload cannot
write outside its own folder.

> Uploads need the Node server (`npm run dev` / `npm run preview`). A purely static deploy
> still hosts whatever you put in `public/godot/` — that is how the bundled demo works.

### Adding a permanent build

```bash
# export from Godot → Web, then:
cp -r /path/to/export/. public/godot/my-game/
# it is now served at /godot/my-game/index.html (no API needed)
```

---

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # parser, zip reader, and end-to-end DOM tests
npm run build    # static bundle in dist/ (includes public/godot)
npm run preview  # serve the production build + upload API
```

## Subtitle features

- **SRT + WebVTT** parsing and export, millisecond-accurate, multi-line cues preserved.
- **Drop, click or paste** — no subtitle file ever leaves the browser.
- **Four engines**: `Demo` (offline), `MyMemory` (free, no key), `LibreTranslate` (self-host,
  good Sorani coverage), and any **OpenAI-compatible** endpoint (OpenAI, Groq, OpenRouter,
  Ollama).
- **Glossary** (`term = translation`) injected into the LLM prompt.
- **Per-cue QA badges** — characters-per-second warnings so lines stay readable.
- **RTL-aware** editing for Kurdish, Arabic, Persian, Hebrew and Urdu.
- Cinematic three.js backdrop with adaptive quality + `prefers-reduced-motion` support.
- Shortcuts: <kbd>⌘/Ctrl</kbd>+<kbd>O</kbd> open file, <kbd>⌘/Ctrl</kbd>+<kbd>Enter</kbd> translate.

## Privacy

There is no backend for subtitles. Files are read with the File API and translated by calling
the provider directly from your tab; API keys stay in `localStorage`. The only server-side
feature is the optional Godot upload host.

## Deploy

`npm run build` then upload `dist/` to Vercel, Netlify, Cloudflare Pages, GitHub Pages, S3…
`vite.config.js` binds to `0.0.0.0` and allows the sandbox preview host (`*.e2b.app`).

## Project layout

```
index.html                hero, subtitle workspace, editor, Godot engine lab, settings
src/main.js               UI state, cue editor, translation + export wiring
src/subtitles.js          SRT/VTT parse, serialise, timestamps, CPS (pure, tested)
src/translate.js          providers (demo / MyMemory / LibreTranslate / LLM) + batching
src/scene.js              three.js cinematic backdrop with bloom + adaptive quality
src/godot-host.js         Godot lab: run bundled build, upload/list/delete exports
server/zip.js             dependency-free zip reader + path hardening (tested)
server/godot-host.js      Vite plugin: upload API + /godot-host static serving
public/godot/…            bundled Godot 4 web export (CC0, see ATTRIBUTION.md)
test/                     node:test suites (parser, zip, jsdom end-to-end)
```

## Notes & limits

- MyMemory's free tier is limited (~5k characters/day per IP); per-cue failures are reported
  instead of silently dropping lines.
- Godot uploads live in `.godot-hosts/` on this workspace's disk — they survive page reloads and
  server restarts, but not a fresh sandbox.
- Hosting a *threaded* Godot web export would need COOP/COEP headers; the bundled CC0 demo is a
  non-threaded build, so it runs on plain HTTP.
