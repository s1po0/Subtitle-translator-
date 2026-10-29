# SUB//LATE — Subtitle Translator

وەرگێڕی ژێرنووس (SRT / WebVTT) کە **تەواو لە وێبگەڕدا** کار دەکات، لەگەڵ ڕووکارێکی
ڕیال-تایمی سینەمایی بە [three.js](https://threejs.org/) — بەبێ سێرڤەر، بەبێ دامەزراندن.

A cinematic, browser-only subtitle translator. Drop an `.srt` or `.vtt` file, translate it with a
provider **you** control, edit the lines, and export timing-perfect SRT/VTT.

---

## بۆچی Unreal Engine لێرە نییە؟

ئەم پڕۆژەیە لە کۆنتەینەرێکی Linuxـی بێ GPUـدا هۆست دەکرێت، و ئەمەش سنوورێکی تەکنیکییە:

| پێداویستی Unreal | ئەم ژینگەیە |
| --- | --- |
| Windows/Linux + GPU (Vulkan/D3D) | کۆنتەینەری بێ GPU |
| نزیکەی ١٠٠ گێگابایت دامەزراندن | چەند سەد مێگابایت |
| HTML5/WebGL export | لە 4.24ـەوە لابردراوە |

بۆیە ڕووکاری ٣D بە **three.js** دروستکراوە: ماددەی PBR، خەوتی exponential، بڵێسەی
`UnrealBloomPass`، کامێرای سینەمایی و تەنۆلکەی مەیدانی. هەمان هەست دەدات، بەڵام لە هەر
وێبگەڕێکدا دەکرێت هۆست بکرێت. ئەگەر بیزانی چۆن پڕۆژەیەکی ڕاستەقینەی UE بەکار بهێنیت،
پێویستت بە کۆمپیوتەرێکی خۆت یان سێرڤەرێکی GPU هەیە (Pixel Streaming).

---

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # parser + end-to-end DOM smoke tests
npm run build    # static bundle in dist/
npm run preview  # serve the production build
```

## Features

- **SRT + WebVTT** parsing and export, millisecond-accurate, multi-line cues preserved.
- **Drop, click or paste** — no upload leaves the browser.
- **Four engines**
  - `Demo` — offline placeholder pass to rehearse the workflow.
  - `MyMemory` — free public API, no key (daily character limit per IP).
  - `LibreTranslate` — point it at a self-hosted instance (good Sorani coverage).
  - `OpenAI-compatible` — any `/chat/completions` endpoint (OpenAI, Groq, OpenRouter, Ollama).
- **Glossary** support (`term = translation`) injected into the LLM prompt.
- **Per-cue QA badges** — characters-per-second warnings so lines stay readable.
- **RTL-aware** editing for Kurdish, Arabic, Persian, Hebrew and Urdu.
- **Cinematic backdrop** with adaptive quality (bloom turns off on slow GPUs) and
  `prefers-reduced-motion` support.
- Shortcuts: <kbd>⌘/Ctrl</kbd>+<kbd>O</kbd> open file, <kbd>⌘/Ctrl</kbd>+<kbd>Enter</kbd> translate.

## Privacy

There is no backend. Files are read with the File API and translated by calling the provider
directly from your tab. API keys are stored in this browser's `localStorage` only.

## Deploy

The build is a plain static site — any host works:

```bash
npm run build
# upload dist/ to Vercel, Netlify, Cloudflare Pages, GitHub Pages, S3…
```

`vite.config.js` already allows the sandbox preview host (`*.e2b.app`) and binds to `0.0.0.0`.

## Project layout

```
index.html            markup: hero, workspace, editor, settings dialog
src/main.js           UI state, cue editor, translation + export wiring
src/subtitles.js      SRT/VTT parse, serialise, timestamps, CPS (pure, tested)
src/translate.js      providers (demo / MyMemory / LibreTranslate / LLM) + batching
src/scene.js          three.js cinematic backdrop with bloom + adaptive quality
src/styles.css        dark glass UI, responsive, reduced-motion aware
test/                 node:test suites (parser + jsdom smoke test)
```

## Notes & limits

- MyMemory's free tier is limited (~5k characters/day per IP) and occasionally rate-limits; the
  app reports per-cue failures instead of silently losing lines.
- Long LLM runs are batched (25 cues per request, 2 in flight) and stop cleanly with **Stop**.
- The WebGL scene falls back to a static gradient when no GPU context is available.
