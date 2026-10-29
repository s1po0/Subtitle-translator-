# 2D Dungeon Crawler Example — Godot web export

A real Godot 4 web export (wasm + pck + js), used here as the built-in demo of the
"Godot Web Export Host".

- Source project: https://github.com/zooperdan/2D-Dungeon-Crawler-Example-in-Godot
- License: **CC0-1.0** (public domain dedication) — redistribution is permitted.
- Engine: Godot 4.x, "Web" export preset, non-threaded build (no SharedArrayBuffer /
  COOP+COEP headers required, so it runs on any static host).
- Files were copied unchanged; the only edit is renaming the entry document to
  `index.html`.

To host your own game instead: in Godot choose *Project → Export → Web*, export to a
folder, zip that folder, then drop the zip into the Engine lab section of the app.
