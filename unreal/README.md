# Running Unreal Engine for this player

The player in this repo (`/#unreal` and `/unreal.html`) is Epic's official Pixel
Streaming frontend. It shows a **real Unreal Engine session** — but the engine has to
render somewhere that has a GPU. Three routes, cheapest first.

---

## 0. Why the engine cannot run inside the app itself

- The editor + a project needs **60–150 GB** and a **GPU** with D3D12/Vulkan.
- Unreal's **HTML5 export was removed in 4.24**; UE 5.x has no official web build at all.
- Pixel Streaming is Epic's supported answer: the engine runs on a GPU machine and the
  browser receives H.264/VP9 over WebRTC. That is exactly what this player consumes.

---

## 1. Your own PC (simplest, free)

**a. Start the signalling server** (Node 18+; clones Epic's repo on first run):

```bash
./unreal/start-signalling.sh          # macOS / Linux
.\unreal\start-signalling.ps1         # Windows PowerShell
```

It listens on `ws://localhost:8888` (HTTP on `:80`, stream viewer on `:80`/`:8080`).

**b. Launch the project in game mode:**

```bash
./unreal/launch-unreal.sh /path/to/MyGame.uproject ws://127.0.0.1:8888 1920x1080
```

```powershell
.\unreal\launch-unreal.ps1 -Project C:\Games\MyGame.uproject -Url ws://127.0.0.1:8888
```

By hand it is just:

```bash
UnrealEditor.exe MyGame.uproject -game -PixelStreamingURL=ws://127.0.0.1:8888 \
  -RenderOffScreen -ForceRes -ResX=1920 -ResY=1080 -log
```

**c. Connect**: open the app → *Unreal Engine · Pixel Streaming* → keep
`ws://localhost:8888` → **Connect**. Chrome/Edge allow plain `ws://localhost` from an
HTTPS page (loopback is treated as secure). Firefox may block it — use the tunnel in §3.

> UE 5.0–5.2: the workflow above is unchanged. UE 5.3+: keep the **Pixel Streaming**
> plugin enabled; the streamer connects and announces itself, the player waits for it
> (`WaitForStreamer` is on by default in this app).

---

## 2. A cloud GPU box (no local GPU needed)

Any provider that gives you a Windows/Linux GPU instance works (AWS G4/G5, GCP L4,
Azure NV, Lambda, Paperspace, Runpod, Vast…). Minimum about **4 GB VRAM** for a simple
scene at 1080p30.

```bash
# on the GPU box
git clone --depth 1 --branch UE5.5 https://github.com/EpicGames/PixelStreamingInfrastructure.git
cd PixelStreamingInfrastructure/SignallingWebServer/platform_scripts/bash
./setup.sh && ./start.sh -- --serve          # ws://<public-ip>:8888

# second shell
/path/to/UnrealEditor MyGame.uproject -game \
  -PixelStreamingURL=ws://127.0.0.1:8888 -RenderOffScreen -ResX=1920 -ResY=1080
```

Open **port 8888** (WebSocket) and, for the fallback, **80/443**. Then point the player at
`ws://<public-ip>:8888` — or better, see the next section so the page (HTTPS) can reach it.

**Docker option:** Epic publishes `ghcr.io/epicgames/unreal-engine:runtime` (you must
accept the EULA and authenticate to ghcr). It is useful for CI, but for a live stream the
straight binary install above is far less friction.

---

## 3. Making it work from an HTTPS page (`wss://`)

The app is served over HTTPS from the preview host. Browsers block `ws://` (insecure)
WebSocket connections from HTTPS pages, so a *remote* signalling server needs TLS.

Quickest path — tunnel the local signalling server:

```bash
# cloudflared: free, no account needed for quick tunnels
cloudflared tunnel --url http://localhost:8888
# → https://random-words.trycloudflare.com   (WebSocket-capable)

# or ngrok
ngrok http 8888
```

Paste the resulting host into the player and switch it to `wss://`:

```
wss://random-words.trycloudflare.com
```

For production, terminate TLS with Nginx/Caddy in front of the signalling server and add a
**TURN server** if players sit behind strict NATs (Epic ships `turnserver` configs in
`Extras/`).

---

## 4. What the player supports

Everything in Epic's stock frontend, because it *is* Epic's frontend:

- Mouse, keyboard, touch and gamepad input forwarded to the engine
- Quality/bitrate settings panel, live stats panel, video QP indicator
- Fullscreen, AFK detection, reconnect, player-count and latency events
- `?ws=…` deep link on `/unreal.html` for embeddings/one-click sessions

Config flags this app sets by default (`src/unreal.js`):

| Flag | Value | Why |
| --- | --- | --- |
| `AutoConnect` / `AutoPlayVideo` | on | one click to a live session |
| `WaitForStreamer` | on | safe to connect before the game is running |
| `HoveringMouse` | off | real cursor positioning for UI-heavy games |
| `MatchViewportRes` | off | avoids resolution churn when the tab is resized |

---

## 5. Troubleshooting

| Symptom | Cause |
| --- | --- |
| `subscribe failed` / “no streamer online” | the signalling server is up but no UE instance connected — start the game |
| `WebRTC failed` | ICE cannot traverse NAT — add TURN, or check UDP/TCP 3478 & 49152-65535 |
| endless “connecting…” | wrong port (default **8888**, not 8889) or TLS mismatch (`ws` vs `wss`) |
| black video but no errors | the GPU box has no hardware encoder — UE falls back to a slow software path; check `-log` output |
| works locally, not remotely | mixed content: use the `wss://` tunnel from §3 |
