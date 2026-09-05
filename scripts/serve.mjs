#!/usr/bin/env node
/**
 * Minimal static server for the exported `out/` directory.
 *
 * The application is a fully static bundle, so serving it needs nothing more
 * than a file reader. Binds to 0.0.0.0 so it is reachable through the sandbox
 * preview proxy, and resolves `/translator/` to `translator/index.html`.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../out", import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

async function resolvePath(pathname) {
  // Guard against path traversal before touching the filesystem.
  const decoded = decodeURIComponent(pathname);
  const relative = normalize(decoded).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const direct = join(ROOT, relative);
  if (!direct.startsWith(ROOT)) return null;

  for (const candidate of [direct, join(direct, "index.html"), `${direct}.html`]) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const file = await resolvePath(url.pathname === "/" ? "/index.html" : url.pathname);

    if (file === null) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }

    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`500 ${err instanceof Error ? err.message : "Internal error"}`);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Serving ${ROOT} on http://0.0.0.0:${PORT}`);
});
