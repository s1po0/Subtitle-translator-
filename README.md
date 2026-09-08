# Kurdish Sorani Subtitle Translator

A browser-only web application for translating subtitle files into **Kurdish
Sorani** (کوردیی سۆرانی, `ckb`).

Everything happens on your machine. There is **no backend, no API key, no
translation service, and no upload** — subtitle content never leaves the
browser. The app deliberately contains no translation engine: you copy the
original text out, translate it with whatever tool you prefer, and paste the
Sorani back in.

## Two ways to get a translation

**Manual (default).** Copy the original text out, translate it with whatever
tool you prefer, paste the Sorani back in. A human stays in control of the
wording, and the app makes no network requests at all.

**Neural engine (opt-in).** A local NLLB-200 model drafts the Sorani for you.
It runs on your device — no API key, no server — and is off until you enable
it in Settings. See below.

Either way, this project integrates no translation API and does no scraping of
any translation website.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

Production build and static hosting:

```bash
npm run build      # emits ./out (fully static)
npm run serve      # serves ./out on http://0.0.0.0:3000
```

Because the build is `output: "export"`, you can also drop the `out/`
directory onto any static host, or open it directly.

> `@huggingface/transformers` pulls in `onnxruntime-node`, whose postinstall
> fetches a prebuilt native binary. If your network blocks that host, install
> with `npm install --ignore-scripts` — the browser build only needs
> `onnxruntime-web`, so the app still builds and runs.

## Supported formats

Thirteen formats, each with its own browser-based parser *and* exporter.
Detection is content-first — the file extension is only used to break ties,
because `.sub` and `.stl` each cover two unrelated formats and misnamed files
are common.

| Format | Extension | Notes |
| --- | --- | --- |
| SubRip | `.srt` | Index, timings, cue settings |
| Advanced Sub Station Alpha | `.ass` | Preserves `[Script Info]` and `[V4+ Styles]` verbatim, plus per-line Layer/Margins/Effect/Name |
| Sub Station Alpha | `.ssa` | Handles the different `[V4 Styles]` field order |
| WebVTT | `.vtt` | Preserves header, cue ids and cue settings (`align:`, `position:`, `line:`) |
| MicroDVD / SubViewer | `.sub` | Both variants; frame rate handled for MicroDVD |
| SBV | `.sbv` | YouTube's format |
| TTML | `.ttml` | Preserves the `<head>` styling block; all TTML time expressions |
| DFXP | `.dfxp` | TTML distribution profile, including legacy `ttaf1` |
| EBU STL | `.stl` | Binary: 1024-byte GSI + 128-byte TTI blocks |
| SAMI | `.smi` | Preserves `<HEAD>`/`<STYLE>` and cue classes |
| Scenarist Closed Caption | `.scc` | EIA-608 hex words |
| MacCaption V1 | `.mcc` | Base64 EIA-608 rows |
| Plain text | `.txt` | No timing; synthetic timings are assigned and flagged |

### Character-set limits are stated, not hidden

Kurdish Sorani is Arabic script. EBU STL uses a Latin character table and
SCC/MCC use the EIA-608 ASCII set, so **neither can store Sorani**. The export
dialog says so before you download, rather than handing you a broken file.

## Neural engine (optional)

An embedded NLLB-200 (600M parameter) translation model, run locally through
transformers.js. It drafts Kurdish Sorani; you still review every line.

| | |
| --- | --- |
| Model | `Xenova/nllb-200-distilled-600M` |
| Size | ≈ 242 MB, downloaded once and cached by the browser |
| Target | `ckb_Arab` — Central Kurdish, Arabic script |
| Runtime | ONNX via WebAssembly; WebGPU when available, CPU otherwise |
| Default | **Off.** Nothing is imported or downloaded until you enable it |

Enable it in **Settings → Neural engine**, then use **Draft with AI** on a
subtitle or **Draft all untranslated** in the toolbar. Drafts land in the
translation field as editable text. The copy/paste buttons remain, so the
manual workflow is untouched.

The engine needs a concrete source language — NLLB cannot auto-detect — so the
draft buttons stay disabled while the source is set to "Auto-detect", with an
explanation shown rather than a silent no-op.

### Why not a larger model

Large models were evaluated and rejected on hard numbers, not preference:

- **Qwen 27B** (Q4_K_M) is a 16.8 GB download needing **~18.9 GB of memory**.
  A browser tab has far less than a whole machine, so it cannot run there.
- **Gemma 4 26B A4B** needs 14–18 GB; **Gemma 4 31B** needs ~20 GB.
- The practical ceiling for in-browser LLMs is **~8B parameters quantized**,
  against 4–6 GB of usable GPU memory.
- **Browsers do not run GGUF.** That is llama.cpp's container format; browser
  runtimes use MLC-compiled artifacts (WebLLM) or ONNX (transformers.js).

Gemma 4's **E2B** tier (~3 GB at 4-bit) would fit on a good machine, but NLLB
is the better fit here: it is a dedicated translation model rather than a chat
model prompted to translate, it is eight times smaller, it needs no WebGPU, and
it was trained on Kurdish.

## Features

**Import** — drag and drop or file picker; automatic format detection; 100 MB
limit; binary payloads rejected unless they are STL.

**Editing** — original and Sorani columns side by side; editable timestamps
with live validation; add, delete, split and merge subtitles; search and
replace across originals, translations or both; multi-select for bulk
operations; undo and redo.

**Translation workflow** — per-subtitle **Copy original** and **Paste
translation** buttons, plus "copy all originals" as a numbered list so you can
line translations back up.

**RTL** — the translation field is right-to-left with an Arabic-script font.
The original field auto-detects direction by counting script ranges, so mixed
text like `OK — باشە` resolves correctly.

**Preview** — a mock player frame with a scrubbable timeline, play/pause, and a
Sorani / original / both toggle.

**Export** — original format or any other; download via a Blob URL; copy the
output as text; lossy-conversion warnings shown first.

**Persistence** — auto-save to `localStorage`, saved-project list, and a
"clear all saved projects" control that only touches this app's own keys.

## Normalised data model

Every parser converts to this shape, and every exporter consumes it:

```json
{
  "id": 1,
  "index": 1,
  "start_time": "00:00:01,000",
  "end_time": "00:00:04,000",
  "original_text": "Hello, how are you?",
  "translated_text": "سڵاو، چۆنی؟",
  "style": {},
  "metadata": {}
}
```

Timestamps are stored canonically as `HH:MM:SS,mmm` and converted per format on
export. Format-specific detail lives in `style` (per entry) and `formatMeta`
(per document) instead of being discarded.

## Security and privacy

- Files are read with the File API and parsed in-browser. **Subtitle content is
  never sent anywhere.** There are no `fetch`, XHR, WebSocket or `sendBeacon`
  calls anywhere in `src/`.
- The only network-capable code is a single lazy
  `await import("@huggingface/transformers")` in `src/lib/neural/engine.ts`.
  It runs **only** if you enable the neural engine, and the only thing it
  retrieves is model weights — never subtitle text. With the engine off (the
  default), the app makes no network requests at all.
- No API keys, no environment secrets, no analytics.
- Previews render markup through an allowlist sanitiser (`src/lib/sanitize.ts`)
  that **rebuilds** tags from parsed names and filtered attributes rather than
  passing raw substrings through. Only `<i> <b> <u> <br> <font color>` survive;
  `<script>`, event handlers and `javascript:` URLs are escaped or dropped.
- Uploaded files are size-checked (100 MB) and screened for binary content.
- `localStorage` writes are guarded for quota and private-browsing failures,
  which surface as readable messages instead of silent data loss.
- The static server guards against path traversal.

## Project layout

```
src/
  app/               Next.js app router: home, translator, settings
  components/        Navbar, Dropzone, SubtitleRow, PreviewPanel, ExportDialog, …
  hooks/             useFileImport
  lib/
    formats/         one parser+exporter per format, plus the registry
      eia608.ts      EIA-608 character coding shared by SCC and MCC
    clipboard.ts     copy/paste with a non-secure-context fallback
    history.ts       snapshot-based undo/redo
    neural/          opt-in local NLLB engine (lazy-loaded, testable loader)
    languages.ts     source-language list, script-direction detection
    project-context.tsx
    sanitize.ts      markup allowlist
    settings-context.tsx
    storage.ts       localStorage persistence
    time.ts          timestamp / frame / SMPTE timecode conversion
    types.ts         the normalised subtitle model
tests/               159 tests across the parsers, sanitiser and time helpers
scripts/serve.mjs    tiny static server for out/
```

## Tests

```bash
npm test           # vitest, 159 tests
npm run typecheck  # tsc --noEmit
```

The suite covers each parser and exporter (including round trips), format
detection, the sanitiser's XSS handling, timestamp and timecode conversion,
EIA-608 coding, a hand-constructed binary STL file so the STL parser is tested
independently of its own exporter, and the neural engine's lifecycle, language
mapping and error paths.

The neural engine is tested through an injected model loader, so its state
machine, language mapping, markup stripping and error handling are all covered
**without downloading weights**. Actual inference is not covered by the suite
and has not been verified in the development sandbox, where `huggingface.co` is
unreachable.

## Known limitations

- STL, SCC and MCC cannot represent Arabic script (see above).
- SCC/MCC caption positioning, colour and caption-mode control codes are read
  but not reconstructed on export; this is reported as a warning.
- SAMI, SubViewer and MCC record only a start time, so end times are derived
  from the next cue.
- Plain text import assigns synthetic 3-second cues that must be reviewed.
- Very large files (tens of thousands of cues) render all rows at once; CSS
  `content-visibility` keeps this usable but it is not windowed.
