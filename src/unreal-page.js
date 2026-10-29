/**
 * Standalone Pixel Streaming player page (`/unreal.html`).
 *
 * Usage:
 *   /unreal.html?ws=ws://localhost:8888
 *   /unreal.html?ws=wss://stream.example.com&autoconnect=1
 *
 * Handy for embedding a UE session full-screen or in an iframe on another page.
 */
import { normaliseSignallingUrl, isLikelyMixedContent, createUnrealLab } from './unreal.js';

const $ = (selector) => document.querySelector(selector);

const player = $('#player');
const urlInput = $('#unreal-url');
const connectBtn = $('#connect-btn');
const disconnectBtn = $('#disconnect-btn');
const status = $('#status');

const params = new URLSearchParams(location.search);
const requested = params.get('ws') ?? params.get('url') ?? '';
if (requested) urlInput.value = requested;

function setStatusText(text) {
  status.textContent = text;
}

const lab = createUnrealLab({
  container: player,
  urlInput,
  connectBtn,
  disconnectBtn,
  statusPill: status,
  standaloneLink: null,
  toast() {},
  setStatus: setStatusText,
});

$('#connect-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const url = normaliseSignallingUrl(urlInput.value);
  if (!url) {
    setStatusText('invalid url');
    return;
  }
  if (isLikelyMixedContent(url)) setStatusText('ws:// on https — use wss://');
  const next = new URL(location.href);
  next.searchParams.set('ws', url);
  history.replaceState(null, '', next);
  lab.connect(url);
});

disconnectBtn.addEventListener('click', () => {
  lab.disconnect();
  setStatusText('disconnected');
});

// Auto-connect when the URL was supplied by a link (e.g. from the main app).
if (requested && params.get('autoconnect') !== '0') {
  const url = normaliseSignallingUrl(requested);
  if (url) lab.connect(url);
}
