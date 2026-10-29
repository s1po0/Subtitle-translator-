#!/usr/bin/env bash
# Launch an Unreal Engine project straight into a Pixel Streaming session.
#
# Usage:
#   ./launch-unreal.sh /path/to/MyGame.uproject [ws://127.0.0.1:8888] [1920x1080]
#
# Notes:
#   * UE 5.0–5.2: the old "-PixelStreamingURL" flow works as-is.
#   * UE 5.3+: keep the Pixel Streaming plugin enabled and pass the same URL;
#     the streamer connects to the signalling server and announces itself.
#   * -RenderOffScreen needs a real GPU (or a virtual display with Vulkan/D3D).
set -euo pipefail

UPROJECT="${1:?usage: launch-unreal.sh <project.uproject> [ws url] [WxH]}"
URL="${2:-ws://127.0.0.1:8888}"
RES="${3:-1920x1080}"
W="${RES%x*}"
H="${RES#*x}"

UE_ROOT="${UE_ROOT:-}"
if [ -z "$UE_ROOT" ]; then
  for candidate in \
    "$HOME/UnrealEngine" \
    "/opt/UnrealEngine" \
    "/Applications/Epic Games/UE_5.5" \
    "/Applications/Epic Games/UE_5.4" \
    "C:/Program Files/Epic Games/UE_5.5"
  do
    [ -d "$candidate" ] && UE_ROOT="$candidate" && break
  done
fi

if [ -z "$UE_ROOT" ]; then
  echo "Set UE_ROOT to your engine install, e.g. UE_ROOT=~/UnrealEngine ./launch-unreal.sh $UPROJECT" >&2
  exit 1
fi

EDITOR="$UE_ROOT/Engine/Binaries/Linux/UnrealEditor"
[ -x "$EDITOR" ] || EDITOR="$UE_ROOT/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor"
[ -x "$EDITOR" ] || EDITOR="$UE_ROOT/Engine/Binaries/Win64/UnrealEditor.exe"

echo "→ engine: $EDITOR"
echo "→ signalling: $URL"
"$EDITOR" "$UPROJECT" -game \
  -PixelStreamingURL="$URL" \
  -RenderOffScreen -ForceRes -ResX="$W" -ResY="$H" \
  -Windowed -log
