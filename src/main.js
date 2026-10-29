import { createBackdrop } from './scene.js';
import {
  parseSubtitles,
  toSRT,
  toVTT,
  formatLabel,
  charsPerSecond,
} from './subtitles.js';
import { LANGUAGES, PROVIDERS, translateCues } from './translate.js';
import { initGodotHost } from './godot-host.js';

const STORAGE_KEY = 'sublate.settings.v1';
const RTL_LANGS = new Set(['ku', 'ckb', 'ar', 'fa', 'he', 'ur']);
const CPS_LIMIT = 21;

const SAMPLE = `1
00:00:00,800 --> 00:00:03,400
Good evening, and welcome to the city.

2
00:00:03,600 --> 00:00:06,200
Everything you see here was built in a browser.

3
00:00:06,400 --> 00:00:09,000
No engine install. No render farm. No excuses.

4
00:00:09,300 --> 00:00:12,100
Drop a subtitle file and the timeline is already waiting.

5
00:00:12,400 --> 00:00:15,000
Choose the engine that fits your budget.

6
00:00:15,300 --> 00:00:18,200
A free API for short clips, or your own model for full seasons.

7
00:00:18,500 --> 00:00:21,400
Timings stay locked to the millisecond.

8
00:00:21,700 --> 00:00:24,600
Line breaks survive the journey.

9
00:00:24,900 --> 00:00:27,800
Then export SRT or WebVTT and go straight to the edit.

10
00:00:28,100 --> 00:00:30,600
Your keys never leave this tab.
`;

const $ = (selector) => document.querySelector(selector);

const els = {
  canvas: $('#backdrop'),
  fps: $('#fps-pill'),
  cuePill: $('#cue-pill'),
  status: $('#status-line'),
  settingsBtn: $('#settings-btn'),
  heroLoad: $('#hero-load'),
  sampleBtn: $('#sample-btn'),
  sourceLang: $('#source-lang'),
  targetLang: $('#target-lang'),
  provider: $('#provider'),
  providerHint: $('#provider-hint'),
  translateBtn: $('#translate-btn'),
  stopBtn: $('#stop-btn'),
  progress: $('#progress'),
  progressFill: $('#progress-fill'),
  progressLabel: $('#progress-label'),
  empty: $('#empty-state'),
  dropZone: $('#drop-zone'),
  pasteArea: $('#paste-area'),
  pasteBtn: $('#paste-btn'),
  editor: $('#editor'),
  fileName: $('#file-name'),
  fileStats: $('#file-stats'),
  loadBtn: $('#load-btn'),
  clearBtn: $('#clear-btn'),
  cueList: $('#cue-list'),
  footer: $('#footer-actions'),
  exportSrt: $('#export-srt'),
  exportVtt: $('#export-vtt'),
  copyBtn: $('#copy-btn'),
  counts: $('#counts'),
  fileInput: $('#file-input'),
  dialog: $('#settings-dialog'),
  saveSettings: $('#save-settings'),
  toasts: $('#toasts'),
};

const state = {
  cues: [],
  format: 'srt',
  filename: 'untitled.srt',
  provider: 'demo',
  settings: loadSettings(),
  translating: false,
  controller: null,
};

/* ------------------------------------------------------------------ setup */

createBackdrop(els.canvas, {
  onFpsChange(fps, quality) {
    els.fps.textContent = `GPU · ${fps} fps${quality < 1 ? ' · eco' : ''}`;
  },
});

function addOption(select, label, value) {
  const option = document.createElement('option');
  option.textContent = label;
  option.value = value;
  select.append(option);
}

for (const [code, name] of LANGUAGES) {
  addOption(els.sourceLang, `${name} (${code})`, code);
  addOption(els.targetLang, `${name} (${code})`, code);
}
els.sourceLang.value = 'en';
els.targetLang.value = 'ku';

for (const provider of PROVIDERS) {
  addOption(els.provider, provider.label, provider.id);
}
els.provider.value = state.provider;
updateProviderHint();

els.sourceLang.addEventListener('change', () => {
  if (els.sourceLang.value === els.targetLang.value) {
    const fallback = LANGUAGES.find(([code]) => code !== els.sourceLang.value)?.[0] ?? 'ku';
    els.targetLang.value = fallback;
  }
  setStatus('languages updated');
});

els.targetLang.addEventListener('change', () => {
  if (els.sourceLang.value === els.targetLang.value) {
    const fallback = LANGUAGES.find(([code]) => code !== els.targetLang.value)?.[0] ?? 'en';
    els.sourceLang.value = fallback;
  }
  applyDirection();
  refreshStats();
  setStatus('languages updated');
});

els.provider.addEventListener('change', () => {
  state.provider = els.provider.value;
  updateProviderHint();
  setStatus(`engine: ${els.provider.selectedOptions[0]?.textContent ?? state.provider}`);
});

function updateProviderHint() {
  const provider = PROVIDERS.find((entry) => entry.id === state.provider);
  els.providerHint.textContent = provider?.hint ?? '';
}

/* ------------------------------------------------------------- file input */

els.heroLoad.addEventListener('click', () => els.fileInput.click());
els.loadBtn.addEventListener('click', () => els.fileInput.click());
els.dropZone.addEventListener('click', (event) => {
  if (event.target.closest('textarea, button')) return;
  els.fileInput.click();
});
els.dropZone.addEventListener('keydown', (event) => {
  if (event.target !== els.dropZone) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    els.fileInput.click();
  }
});

els.fileInput.addEventListener('change', async () => {
  const [file] = els.fileInput.files ?? [];
  if (!file) return;
  try {
    const text = await file.text();
    loadSubtitleText(text, file.name);
  } catch (error) {
    toast(`Could not read the file: ${error.message}`, 'error');
  } finally {
    els.fileInput.value = '';
  }
});

els.pasteBtn.addEventListener('click', () => {
  const text = els.pasteArea.value.trim();
  if (!text) {
    toast('Paste some subtitle text first (or drop a file).', 'warn');
    return;
  }
  loadSubtitleText(text, 'pasted.srt');
});

els.sampleBtn.addEventListener('click', () => loadSubtitleText(SAMPLE, 'demo-scene.srt'));

for (const type of ['dragenter', 'dragover']) {
  document.addEventListener(type, (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    els.dropZone.classList.add('dragging');
  });
}
for (const type of ['dragleave', 'drop']) {
  document.addEventListener(type, (event) => {
    if (type === 'drop') {
      const file = event.dataTransfer?.files?.[0];
      if (file) {
        event.preventDefault();
        file.text().then((text) => loadSubtitleText(text, file.name)).catch((error) => {
          toast(`Could not read the file: ${error.message}`, 'error');
        });
      }
    }
    if (type === 'dragleave' && event.relatedTarget) return;
    els.dropZone.classList.remove('dragging');
  });
}

function loadSubtitleText(text, filename) {
  try {
    const { cues, format } = parseSubtitles(text);
    state.cues = cues;
    state.format = format;
    state.filename = filename || `untitled.${format}`;
    els.fileName.textContent = state.filename;
    els.empty.hidden = true;
    els.editor.hidden = false;
    els.footer.hidden = false;
    els.translateBtn.disabled = false;
    renderCues();
    els.pasteArea.value = '';
    toast(`Loaded ${cues.length} cues · ${format.toUpperCase()}`, 'success');
    setStatus(`loaded ${filename}`);
    els.editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    toast(error.message, 'error', 8000);
    setStatus('parse failed');
  }
}

els.clearBtn.addEventListener('click', () => {
  state.cues = [];
  els.cueList.innerHTML = '';
  els.editor.hidden = true;
  els.footer.hidden = true;
  els.empty.hidden = false;
  els.translateBtn.disabled = true;
  els.cuePill.textContent = '0 cues';
  els.counts.textContent = '';
  setStatus('ready');
});

/* ------------------------------------------------------------------ rows */

function renderCues() {
  els.cueList.innerHTML = '';
  const fragment = document.createDocumentFragment();
  state.cues.forEach((cue, index) => fragment.appendChild(buildRow(cue, index)));
  els.cueList.appendChild(fragment);
  applyDirection();
  refreshStats();
}

function buildRow(cue, index) {
  const row = document.createElement('div');
  row.className = 'cue-row';
  row.setAttribute('role', 'listitem');

  const time = document.createElement('div');
  time.className = 'cue-time';
  const idx = document.createElement('span');
  idx.className = 'idx';
  idx.textContent = `#${String(index + 1).padStart(2, '0')}`;
  const range = document.createElement('span');
  range.textContent = `${formatLabel(cue.start)} → ${formatLabel(cue.end)}`;
  time.append(idx, range);

  const sourceCell = document.createElement('div');
  sourceCell.className = 'cue-cell';
  const sourceArea = document.createElement('textarea');
  sourceArea.value = cue.text;
  sourceArea.rows = 2;
  sourceArea.spellcheck = false;
  sourceArea.setAttribute('aria-label', `Source text for cue ${index + 1}`);
  const sourceBadges = document.createElement('div');
  sourceBadges.className = 'cue-badges';
  sourceCell.append(sourceArea, sourceBadges);

  const targetCell = document.createElement('div');
  targetCell.className = 'cue-cell';
  const targetArea = document.createElement('textarea');
  targetArea.value = cue.translated ?? '';
  targetArea.rows = 2;
  targetArea.spellcheck = false;
  targetArea.placeholder = 'Translation appears here…';
  targetArea.setAttribute('aria-label', `Translation for cue ${index + 1}`);
  const targetBadges = document.createElement('div');
  targetBadges.className = 'cue-badges';
  targetCell.append(targetArea, targetBadges);

  sourceArea.addEventListener('input', () => {
    cue.text = sourceArea.value;
    autosize(sourceArea);
    paintBadges(cue, sourceBadges, targetBadges, targetArea);
    refreshStats();
  });
  targetArea.addEventListener('input', () => {
    cue.translated = targetArea.value;
    cue.auto = false;
    autosize(targetArea);
    paintBadges(cue, sourceBadges, targetBadges, targetArea);
    refreshStats();
  });

  row.append(time, sourceCell, targetCell);
  requestAnimationFrame(() => {
    autosize(sourceArea);
    autosize(targetArea);
    paintBadges(cue, sourceBadges, targetBadges, targetArea);
  });
  return row;
}

function autosize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.max(textarea.scrollHeight, 62)}px`;
}

function badge(text, kind = '') {
  const node = document.createElement('span');
  node.className = `badge ${kind}`.trim();
  node.textContent = text;
  return node;
}

function paintBadges(cue, sourceBadges, targetBadges, targetArea) {
  sourceBadges.innerHTML = '';
  const sourceCps = charsPerSecond(cue, cue.text);
  sourceBadges.append(badge(`${sourceCps.toFixed(0)} cps`, sourceCps > CPS_LIMIT + 3 ? 'warn' : ''));

  targetBadges.innerHTML = '';
  if (cue.translated) {
    const cps = charsPerSecond(cue);
    targetBadges.append(badge(`${cps.toFixed(0)} cps`, cps > CPS_LIMIT ? 'warn' : 'ok'));
    targetBadges.append(badge(cue.auto ? 'auto' : 'edited', cue.auto ? 'pending' : ''));
  }
  if (targetArea) {
    targetArea.dir = RTL_LANGS.has(els.targetLang.value) ? 'rtl' : 'ltr';
  }
}

function applyDirection() {
  const rtl = RTL_LANGS.has(els.targetLang.value);
  els.cueList.querySelectorAll('.cue-cell:nth-child(3) textarea').forEach((area) => {
    area.dir = rtl ? 'rtl' : 'ltr';
  });
}

function refreshStats() {
  const total = state.cues.length;
  if (!total) {
    els.cuePill.textContent = '0 cues';
    els.counts.textContent = '';
    return;
  }
  const translated = state.cues.filter((cue) => cue.translated?.trim()).length;
  const duration = state.cues[total - 1].end - state.cues[0].start;
  const minutes = Math.floor(duration / 60000);
  const seconds = Math.round((duration % 60000) / 1000);
  els.cuePill.textContent = `${total} cues`;
  els.fileStats.textContent = `${total} cues · ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  els.counts.textContent = translated
    ? `${translated}/${total} translated`
    : `${total} cues ready`;
}

/* ------------------------------------------------------------ translation */

els.translateBtn.addEventListener('click', () => translateAll());

els.stopBtn.addEventListener('click', () => {
  state.controller?.abort();
  setStatus('cancelled');
});

async function translateAll() {
  if (!state.cues.length || state.translating) return;

  if (els.sourceLang.value === els.targetLang.value) {
    toast('Source and target languages are the same — pick two different languages.', 'warn');
    return;
  }

  setTranslating(true);
  const controller = new AbortController();
  state.controller = controller;
  setProgress(0, state.cues.length);
  setStatus('translating…');
  const started = performance.now();

  try {
    const { translations, errors } = await translateCues(state.cues, {
      provider: state.provider,
      source: els.sourceLang.value,
      target: els.targetLang.value,
      config: state.settings,
      glossary: state.settings.glossary ?? '',
      onProgress: (done, total) => setProgress(done, total),
      signal: controller.signal,
    });

    translations.forEach((value, index) => {
      if (!state.cues[index]) return;
      state.cues[index].translated = value;
      state.cues[index].auto = true;
    });

    const areas = els.cueList.querySelectorAll('.cue-cell:nth-child(3) textarea');
    areas.forEach((area, index) => {
      area.value = state.cues[index]?.translated ?? '';
      autosize(area);
    });
    applyDirection();
    refreshStats();

    const elapsed = ((performance.now() - started) / 1000).toFixed(1);
    if (errors.length) {
      toast(`Translated with ${errors.length} warning(s). First: ${errors[0]}`, 'warn', 9000);
      setStatus(`done · ${errors.length} warnings`);
    } else if (state.provider === 'demo') {
      toast(`Demo pass finished in ${elapsed}s — placeholder text only. Pick a real engine for actual translation.`, 'warn', 8000);
      setStatus(`demo · ${elapsed}s`);
    } else {
      toast(`Translated ${translations.length} cues in ${elapsed}s.`, 'success');
      setStatus(`done · ${elapsed}s`);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      toast('Translation stopped.', 'warn');
      setStatus('cancelled');
    } else {
      console.error(error);
      toast(error.message || 'Translation failed.', 'error', 9000);
      setStatus('error');
    }
  } finally {
    setTranslating(false);
    state.controller = null;
    setProgress(null);
  }
}

function setTranslating(active) {
  state.translating = active;
  els.translateBtn.disabled = active || !state.cues.length;
  els.translateBtn.textContent = active ? 'Working…' : 'Translate';
  els.stopBtn.hidden = !active;
  els.translateBtn.setAttribute('aria-busy', String(active));
}

function setProgress(done, total) {
  if (done === null) {
    els.progress.hidden = true;
    els.progressFill.style.width = '0%';
    return;
  }
  els.progress.hidden = false;
  const percent = total ? Math.round((done / total) * 100) : 0;
  els.progressFill.style.width = `${percent}%`;
  els.progressLabel.textContent = `${done} / ${total}`;
}

/* ---------------------------------------------------------------- exports */

els.exportSrt.addEventListener('click', () => exportFile('srt'));
els.exportVtt.addEventListener('click', () => exportFile('vtt'));

function exportFile(kind) {
  if (!state.cues.length) return;
  const hasTranslation = state.cues.some((cue) => cue.translated?.trim());
  if (!hasTranslation) toast('No translation yet — exporting the original timing with source text.', 'warn');
  const body = kind === 'vtt' ? toVTT(state.cues) : toSRT(state.cues);
  const base = state.filename.replace(/\.(srt|vtt|txt)$/i, '') || 'subtitles';
  download(`${base}.${els.targetLang.value}.${kind}`, body, kind === 'vtt' ? 'text/vtt' : 'application/x-subrip');
  setStatus(`exported ${kind.toUpperCase()}`);
  toast(`Saved ${base}.${els.targetLang.value}.${kind}`, 'success');
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

els.copyBtn.addEventListener('click', async () => {
  const text = state.cues.map((cue) => cue.translated || cue.text).join('\n\n');
  if (!text.trim()) {
    toast('Nothing to copy yet.', 'warn');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Translation copied to the clipboard.', 'success');
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      toast('Translation copied to the clipboard.', 'success');
    } catch {
      toast('Clipboard blocked by the browser.', 'error');
    }
    area.remove();
  }
});

/* --------------------------------------------------------------- settings */

els.settingsBtn.addEventListener('click', () => {
  fillSettingsForm();
  if (typeof els.dialog.showModal === 'function') els.dialog.showModal();
  else els.dialog.setAttribute('open', '');
});

els.saveSettings.addEventListener('click', () => {
  state.settings = {
    llmUrl: $('#llm-url').value.trim(),
    llmModel: $('#llm-model').value.trim(),
    llmKey: $('#llm-key').value.trim(),
    libretranslateUrl: $('#lt-url').value.trim(),
    libretranslateKey: $('#lt-key').value.trim(),
    glossary: $('#glossary').value,
  };
  saveSettings(state.settings);
  els.dialog.close();
  toast('Settings saved in this browser.', 'success');
  setStatus('settings saved');
});

function fillSettingsForm() {
  $('#llm-url').value = state.settings.llmUrl ?? '';
  $('#llm-model').value = state.settings.llmModel ?? '';
  $('#llm-key').value = state.settings.llmKey ?? '';
  $('#lt-url').value = state.settings.libretranslateUrl ?? '';
  $('#lt-key').value = state.settings.libretranslateKey ?? '';
  $('#glossary').value = state.settings.glossary ?? '';
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function saveSettings(value) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    toast('Could not save settings — storage is blocked in this browser.', 'warn');
  }
}

/* ------------------------------------------------------------ shortcuts */

document.addEventListener('keydown', (event) => {
  const mod = event.metaKey || event.ctrlKey;
  if (!mod) return;
  if (event.key.toLowerCase() === 'o') {
    event.preventDefault();
    els.fileInput.click();
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    translateAll();
  }
});

/* ---------------------------------------------------------------- toasts */

function toast(message, kind = 'info', timeout = 6000) {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  els.toasts.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 220);
  }, timeout);
}

function setStatus(message) {
  els.status.textContent = message;
}

initGodotHost({ toast, setStatus });

window.addEventListener('beforeunload', (event) => {
  if (state.translating) {
    event.preventDefault();
    event.returnValue = '';
  }
});
