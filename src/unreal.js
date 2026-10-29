/**
 * UNREAL // PIXEL STREAMING
 *
 * The only way real Unreal Engine pixels can reach a browser is Pixel Streaming:
 * UE renders on a machine with a GPU and streams H.264/VP9 video over WebRTC.
 * This module embeds Epic's official open-source frontend (the same player Epic
 * ships with the engine) so any UE 5.x session can be attached to this page.
 *
 * The player library is loaded lazily — roughly 1.5 MB of JavaScript that is
 * only fetched when someone actually presses Connect.
 */

/**
 * Accepts `wss://host:8888`, `host:8888`, `https://host`, `https://host/path`.
 * Returns a protocol-appropriate signalling URL, or null when unusable.
 */
export function normaliseSignallingUrl(raw) {
  let value = String(raw ?? '').trim();
  if (!value) return null;
  if (/^https:\/\//i.test(value)) value = value.replace(/^https:/i, 'wss:');
  else if (/^http:\/\//i.test(value)) value = value.replace(/^http:/i, 'ws:');
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    if (!/^wss?:\/\//i.test(value)) return null; // ftp://, file://, …
  } else value = `ws://${value}`;
  try {
    const url = new URL(value);
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null;
    if (!url.hostname) return null;
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** Browsers block insecure WebSockets from an HTTPS page except on loopback. */
export function isLikelyMixedContent(url, pageProtocol = globalThis.location?.protocol) {
  if (!url || pageProtocol !== 'https:') return false;
  if (!url.startsWith('ws://')) return false;
  const host = new URL(url).hostname;
  return !['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
}

let libs = null;
let stylesApplied = false;

async function loadEpicFrontend() {
  if (libs) return libs;
  // Literal specifiers so Vite bundles them into a lazy chunk.
  const [frontend, ui] = await Promise.all([
    import('@epicgames-ps/lib-pixelstreamingfrontend-ue5.5'),
    import('@epicgames-ps/lib-pixelstreamingfrontend-ui-ue5.5'),
  ]);
  libs = {
    Config: frontend.Config,
    PixelStreaming: frontend.PixelStreaming,
    Application: ui.Application,
    Style: ui.PixelStreamingApplicationStyle,
  };
  return libs;
}

export function createUnrealLab({
  container,
  urlInput,
  connectBtn,
  disconnectBtn,
  statusPill,
  logList,
  toast,
  setStatus,
  standaloneLink,
} = {}) {
  let stream = null;
  let application = null;
  let connecting = false;

  function log(message) {
    if (!logList) return;
    const item = document.createElement('li');
    const time = new Date().toLocaleTimeString([], { hour12: false });
    item.textContent = `${time}  ${message}`;
    logList.prepend(item);
    while (logList.children.length > 14) logList.lastElementChild.remove();
  }

  function setPill(text, tone = '') {
    if (!statusPill) return;
    statusPill.textContent = text;
    statusPill.dataset.tone = tone;
  }

  function reset() {
    stream?.disconnect?.();
    stream?.destroy?.();
    application = null;
    stream = null;
    if (container) container.replaceChildren();
    if (disconnectBtn) disconnectBtn.disabled = true;
    if (connectBtn) connectBtn.disabled = false;
  }

  async function connect(rawUrl = urlInput?.value) {
    if (connecting) return;
    const url = normaliseSignallingUrl(rawUrl);
    if (!url) {
      toast?.('Enter a signalling server URL such as ws://localhost:8888', 'warn');
      urlInput?.focus();
      return;
    }
    if (isLikelyMixedContent(url)) {
      log(`warning: ${url} is plain ws:// on an https page — use wss:// or a tunnel`);
      toast?.('This page is HTTPS: use a wss:// endpoint (or ws://localhost only).', 'warn', 8000);
    }

    if (typeof RTCPeerConnection === 'undefined') {
      log('this browser has no WebRTC support');
      setPill('WebRTC unavailable', 'error');
      toast?.('This browser does not expose WebRTC, so Pixel Streaming cannot run.', 'error', 8000);
      return;
    }

    connecting = true;
    setPill('loading player…');
    log(`loading Epic Pixel Streaming frontend…`);
    connectBtn && (connectBtn.disabled = true);

    try {
      const { Config, PixelStreaming, Application, Style } = await loadEpicFrontend();
      log('player library ready');

      if (!stylesApplied) {
        const style = new Style();
        style.applyStyleSheet();
        style.setColorMode?.(false);
        stylesApplied = true;
      }

      reset();
      container.replaceChildren();
      container.classList.remove('unreal-idle');

      const config = new Config({
        useUrlParams: false,
        initialSettings: {
          ss: url,
          AutoConnect: true,
          AutoPlayVideo: true,
          WaitForStreamer: true,
          HoveringMouse: false,
          MatchViewportRes: false,
          KeyboardInput: true,
          MouseInput: true,
          TouchInput: true,
          GamepadInput: true,
          SuppressBrowserKeys: false,
          StartVideoMuted: false,
        },
      });

      stream = new PixelStreaming(config, { videoElementParent: container });
      application = new Application({
        stream,
        settingsPanelConfig: { isEnabled: true },
        statsPanelConfig: { isEnabled: true },
        fullScreenControlsConfig: { isEnabled: true },
        videoQpIndicatorConfig: { disableIndicator: false, hideWhenGood: true },
      });
      container.appendChild(application.rootElement);

      const events = [
        ['streamConnect', 'websocket connected'],
        ['streamerListMessage', 'received streamer list'],
        ['webRtcConnecting', 'negotiating WebRTC'],
        ['webRtcSdpAnswer', 'SDP answer received'],
        ['webRtcConnected', 'peer connection established'],
        ['videoInitialized', 'video track initialised'],
        ['playStream', 'stream playing'],
        ['dataChannelOpen', 'input data channel open'],
        ['playerCount', 'player count updated'],
        ['webRtcFailed', 'WebRTC failed'],
        ['subscribeFailed', 'subscribe failed (a streamer must be online)'],
        ['streamDisconnect', 'websocket closed'],
        ['webRtcDisconnected', 'peer connection closed'],
      ];
      for (const [type, label] of events) {
        stream.addEventListener(type, () => {
          log(label);
          if (type === 'playStream') {
            setPill('● live', 'live');
            setStatus?.('unreal: streaming');
          } else if (type === 'webRtcConnected') setPill('connected · waiting for video');
          else if (type === 'webRtcFailed') setPill('WebRTC failed', 'error');
          else if (type === 'subscribeFailed') setPill('no streamer online', 'warn');
          else if (type === 'streamDisconnect') setPill('disconnected');
        });
      }

      stream.connect();
      if (disconnectBtn) disconnectBtn.disabled = false;
      if (standaloneLink) {
        standaloneLink.href = `${standaloneLink.dataset.base ?? '/unreal.html'}?ws=${encodeURIComponent(url)}`;
      }
      setPill('connecting…');
      setStatus?.(`unreal: connecting to ${url}`);
      log(`connecting to ${url}`);
      try {
        localStorage.setItem('sublate.unreal.url', url);
      } catch {
        /* storage may be blocked */
      }
    } catch (error) {
      console.error(error);
      log(`error: ${error.message}`);
      setPill('player failed to load', 'error');
      toast?.(`Could not load the Pixel Streaming player: ${error.message}`, 'error', 9000);
      connectBtn && (connectBtn.disabled = false);
    } finally {
      connecting = false;
    }
  }

  function disconnect() {
    if (!stream) return;
    log('disconnecting on request');
    reset();
    setPill('idle');
    setStatus?.('unreal: disconnected');
  }

  connectBtn?.addEventListener('click', () => connect());
  disconnectBtn?.addEventListener('click', disconnect);
  urlInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      connect();
    }
  });

  // Restore the last endpoint this browser used.
  try {
    const saved = localStorage.getItem('sublate.unreal.url');
    if (saved && urlInput && !urlInput.value) urlInput.value = saved;
  } catch {
    /* ignore */
  }

  return { connect, disconnect, log };
}
