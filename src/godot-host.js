/**
 * Godot web-export host UI.
 *
 * - Runs the bundled CC0 Godot 4 export from /godot/dungeon-crawler/.
 * - Accepts a user's own export zip, uploads it to the dev/preview server
 *   (/api/godot/upload) and plays it back from /godot-host/<slug>/.
 *
 * The iframe is only pointed at a build when the visitor clicks, so the 14 MB
 * wasm never loads just because someone opened the subtitle tool.
 */

const BUNDLED = {
  slug: 'dungeon-crawler',
  name: '2D Dungeon Crawler Example (CC0)',
  entry: 'index.html',
  url: '/godot/dungeon-crawler/index.html',
  builtin: true,
};

const $ = (selector) => document.querySelector(selector);

function formatBytes(bytes) {
  if (!bytes) return '—';
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function buildUrl(build) {
  if (build.builtin) return build.url;
  const entry = (build.entry || 'index.html').split('/').map(encodeURIComponent).join('/');
  return `/godot-host/${build.slug}/${entry}`;
}

export function initGodotHost({ toast, setStatus } = {}) {
  const frame = $('#godot-frame');
  const idle = $('#godot-idle');
  const wrap = $('#godot-frame-wrap');
  const status = $('#godot-status');
  const urlLabel = $('#godot-url');
  const buildsList = $('#godot-builds');
  const buildCount = $('#godot-build-count');
  const note = $('#godot-note');
  const dropZone = $('#godot-drop');
  const reloadBtn = $('#godot-reload');
  const fullscreenBtn = $('#godot-fullscreen');
  const openLink = $('#godot-open');
  const filePicker = document.createElement('input');
  filePicker.type = 'file';
  filePicker.accept = '.zip,application/zip';
  filePicker.hidden = true;
  document.body.appendChild(filePicker);

  let builds = [];
  let current = null;
  let apiOnline = true;

  function setStatusPill(text) {
    if (status) status.textContent = text;
  }

  function play(build) {
    current = build;
    const url = buildUrl(build);
    if (frame.src.endsWith(url)) frame.src = `${url}?r=${Date.now()}`;
    else frame.src = url;
    frame.hidden = false;
    idle.hidden = true;
    reloadBtn.disabled = false;
    fullscreenBtn.disabled = false;
    openLink.href = url;
    openLink.removeAttribute('aria-disabled');
    urlLabel.textContent = build.builtin ? 'bundled export' : `/godot-host/${build.slug}`;
    setStatusPill(build.builtin ? 'godot 4 · running' : `godot 4 · ${build.slug}`);
    setStatus?.(`godot: ${build.name ?? build.slug}`);
    wrap.classList.add('active');
  }

  frame.addEventListener('load', () => {
    if (!frame.hidden) setStatusPill('godot 4 · loaded');
  });

  $('#godot-run').addEventListener('click', () => play(BUNDLED));

  reloadBtn.addEventListener('click', () => {
    if (current) play(current);
  });

  fullscreenBtn.addEventListener('click', () => {
    const target = wrap;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else target.requestFullscreen?.().catch(() => toast?.('Fullscreen was blocked.', 'warn'));
  });

  /* -------------------------------------------------------------- uploads */

  const pick = () => filePicker.click();
  $('#godot-browse').addEventListener('click', (event) => {
    event.stopPropagation();
    pick();
  });
  dropZone.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    pick();
  });
  dropZone.addEventListener('keydown', (event) => {
    if (event.target !== dropZone) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick();
    }
  });
  filePicker.addEventListener('change', () => {
    const [file] = filePicker.files ?? [];
    if (file) upload(file);
    filePicker.value = '';
  });

  dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropZone.classList.remove('dragging');
    const file = [...(event.dataTransfer?.files ?? [])].find((item) => /\.zip$/i.test(item.name));
    if (!file) {
      toast?.('Drop a .zip of your Godot web export.', 'warn');
      return;
    }
    upload(file);
  });

  async function upload(file) {
    if (!/\.zip$/i.test(file.name)) {
      toast?.('That is not a .zip — zip your Godot web export folder first.', 'warn');
      return;
    }
    setStatusPill('uploading…');
    note.textContent = `Uploading ${file.name} (${formatBytes(file.size)})…`;
    try {
      const response = await fetch('/api/godot/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/zip',
          'X-Godot-Name': encodeURIComponent(file.name),
        },
        body: file,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Upload failed (${response.status})`);
      toast?.(`Hosted ${data.name} · ${formatBytes(data.bytes)}`, 'success');
      note.textContent = `Hosted ${data.name} — ${data.files} files, ${formatBytes(data.bytes)}.`;
      await refresh();
      play(data);
    } catch (error) {
      apiOnline = false;
      setStatusPill('upload failed');
      note.textContent = error.message;
      toast?.(error.message, 'error', 9000);
    }
  }

  async function refresh() {
    try {
      const response = await fetch('/api/godot/builds', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      builds = data.builds ?? [];
      apiOnline = true;
      renderBuilds(data.max);
    } catch {
      apiOnline = false;
      builds = [];
      renderBuilds();
      note.textContent =
        'The upload API is not available on this deployment (static build). The bundled Godot demo still runs.';
    }
  }

  function renderBuilds(max = 6) {
    buildsList.innerHTML = '';
    const all = [BUNDLED, ...builds.map((build) => ({ ...build }))];

    for (const build of all) {
      const item = document.createElement('li');
      item.className = 'godot-build';
      if (current && current.slug === build.slug) item.classList.add('current');

      const meta = document.createElement('div');
      meta.className = 'godot-build-meta';
      const title = document.createElement('span');
      title.className = 'godot-build-name';
      title.textContent = build.name || build.slug;
      const sub = document.createElement('span');
      sub.className = 'godot-build-sub';
      sub.textContent = build.builtin
        ? `built-in · ${formatBytes(14800000)}`
        : `${build.files ?? '?'} files · ${formatBytes(build.bytes)}`;
      meta.append(title, sub);

      const actions = document.createElement('div');
      actions.className = 'godot-build-actions';

      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'ghost-btn tiny';
      playBtn.textContent = 'Run';
      playBtn.addEventListener('click', () => play(build));
      actions.append(playBtn);

      if (!build.builtin) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'ghost-btn tiny danger';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', async () => {
          try {
            const response = await fetch(`/api/godot/builds/${build.slug}`, { method: 'DELETE' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            if (current && current.slug === build.slug) {
              current = null;
              frame.hidden = true;
              idle.hidden = false;
              reloadBtn.disabled = true;
              fullscreenBtn.disabled = true;
              urlLabel.textContent = '—';
              setStatusPill('idle');
            }
            toast?.(`Removed ${build.slug}`, 'success');
            await refresh();
          } catch (error) {
            toast?.(`Could not delete: ${error.message}`, 'error');
          }
        });
        actions.append(delBtn);
      }

      item.append(meta, actions);
      buildsList.append(item);
    }

    buildCount.textContent = apiOnline ? `${builds.length} / ${max}` : 'offline';
    if (!builds.length && apiOnline) {
      note.textContent =
        'No uploads yet. Export your game with the Web preset, zip the output folder, then drop it here.';
    }
  }

  refresh();

  return { play, refresh };
}
