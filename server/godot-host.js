/**
 * Vite plugin that turns the dev/preview server into a tiny host for Godot web
 * exports.
 *
 *   POST   /api/godot/upload          raw zip body  -> { slug, entry, … }
 *   GET    /api/godot/builds          list uploaded builds
 *   DELETE /api/godot/builds/:slug    remove a build
 *   GET    /godot-host/:slug/*        the export itself
 *
 * Uploads live in `.godot-hosts/` (gitignored) and the newest MAX_BUILDS are
 * kept so a few experiments cannot fill the disk.
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzip, safePath, findEntry } from './zip.js';

export const MAX_BUILDS = 6;
const MAX_UPLOAD_BYTES = 320 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.pck': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
};

function slugify(value, fallback = 'build') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        reject(new Error('Upload too large (limit 320 MB)'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readBuilds(root) {
  let dirs = [];
  try {
    dirs = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const builds = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    try {
      const meta = JSON.parse(await readFile(path.join(root, dir.name, 'meta.json'), 'utf8'));
      builds.push(meta);
    } catch {
      // directory without metadata – ignore
    }
  }
  return builds.sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0));
}

async function prune(root) {
  const builds = await readBuilds(root);
  for (const build of builds.slice(MAX_BUILDS)) {
    await rm(path.join(root, build.slug), { recursive: true, force: true });
  }
}

async function serveStatic(res, filePath, method) {
  let info;
  try {
    info = await stat(filePath);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;

  const ext = path.extname(filePath).toLowerCase();
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
  res.setHeader('Content-Length', String(info.size));
  res.setHeader('Cache-Control', 'no-cache');
  // Web exports do not need cross-origin isolation, but these headers keep
  // threaded builds working if someone ships one.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (method === 'HEAD') {
    res.end();
    return true;
  }
  try {
    res.end(await readFile(filePath));
  } catch {
    res.statusCode = 500;
    res.end('read error');
  }
  return true;
}

function createHandler(root) {
  return async function godotHost(req, res, next) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const { pathname } = url;

    try {
      if (pathname === '/api/godot/builds' && req.method === 'GET') {
        return json(res, 200, { builds: await readBuilds(root), max: MAX_BUILDS });
      }

      if (pathname === '/api/godot/upload' && req.method === 'POST') {
        const body = await readBody(req);
        if (!body.length) return json(res, 400, { error: 'Empty upload' });

        let files;
        try {
          files = unzip(body);
        } catch (error) {
          return json(res, 400, { error: `Could not read the zip: ${error.message}` });
        }
        if (!files.length) return json(res, 400, { error: 'The zip contains no files' });

        const cleaned = files
          .map((file) => ({ name: safePath(file.name), data: file.data }))
          .filter((file) => file.name);
        const entry = findEntry(cleaned.map((file) => file.name));
        if (!entry) {
          return json(res, 400, {
            error: 'No .html entry file found — is this a Godot “Web” export zip?',
          });
        }
        const wasm = cleaned.find((file) => file.name.endsWith('.wasm'));
        if (!wasm) {
          return json(res, 400, {
            error: 'No .wasm binary found — export with preset “Web” in Godot, then zip the output folder.',
          });
        }

        const requested = decodeURIComponent(String(req.headers['x-godot-name'] ?? ''))
          || entry.split('/').pop();
        const base = slugify(requested);
        let slug = base;
        let counter = 2;
        for (;;) {
          try {
            await stat(path.join(root, slug));
            slug = `${base}-${counter}`;
            counter += 1;
          } catch {
            break;
          }
        }

        const target = path.join(root, slug);
        await mkdir(target, { recursive: true });
        let bytes = 0;
        for (const file of cleaned) {
          const destination = path.join(target, file.name);
          if (!destination.startsWith(target + path.sep)) continue;
          await mkdir(path.dirname(destination), { recursive: true });
          await writeFile(destination, file.data);
          bytes += file.data.length;
        }

        const meta = {
          slug,
          name: requested.replace(/\.zip$/i, ''),
          entry,
          files: cleaned.length,
          bytes,
          uploadedAt: Date.now(),
        };
        await writeFile(path.join(target, 'meta.json'), JSON.stringify(meta, null, 2));
        await prune(root);
        return json(res, 201, meta);
      }

      const deleteMatch = pathname.match(/^\/api\/godot\/builds\/([a-z0-9-]+)$/);
      if (deleteMatch && req.method === 'DELETE') {
        await rm(path.join(root, deleteMatch[1]), { recursive: true, force: true });
        return json(res, 200, { ok: true });
      }

      if (pathname.startsWith('/godot-host/')) {
        const rest = decodeURIComponent(pathname.slice('/godot-host/'.length));
        const [slug, ...tail] = rest.split('/');
        if (!slug) return json(res, 404, { error: 'Missing build slug' });
        const builds = await readBuilds(root);
        const build = builds.find((item) => item.slug === slug);
        if (!build) return json(res, 404, { error: 'Unknown build' });

        const relative = safePath(tail.join('/')) || build.entry;
        if (relative === 'meta.json') return json(res, 404, { error: 'Not found' });
        const filePath = path.join(root, slug, relative);
        const served = await serveStatic(res, filePath, req.method);
        if (served) return undefined;
        return json(res, 404, { error: 'Not found' });
      }
    } catch (error) {
      return json(res, 500, { error: error.message });
    }

    return next();
  };
}

/** Serve bundled exports from `public/` with correct MIME types for .pck/.wasm. */
export function bundledExports({ publicDir = 'public', prefixes = ['/godot/', '/unreal4/'] } = {}) {
  const absolute = path.resolve(process.cwd(), publicDir);
  const handler = async function serveBundledExports(req, res, next) {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (!prefixes.some((prefix) => pathname.startsWith(prefix))) return next();
    const relative = safePath(decodeURIComponent(pathname));
    const filePath = path.join(absolute, relative);
    if (!filePath.startsWith(absolute + path.sep)) return next();
    // Let the directory itself fall through to Vite's index.html handling.
    if (/\/index\.html?$/i.test(filePath) || pathname.endsWith('/')) {
      const shipped = await stat(filePath).catch(() => null);
      if (shipped?.isDirectory()) return next();
    }
    const served = await serveStatic(res, filePath, req.method);
    return served ? undefined : next();
  };
  return {
    name: 'godot-bundled-exports',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export function godotHost({ root = '.godot-hosts' } = {}) {
  const absolute = path.resolve(process.cwd(), root);
  return {
    name: 'godot-host',
    configureServer(server) {
      server.middlewares.use(createHandler(absolute));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createHandler(absolute));
    },
  };
}
