#!/usr/bin/env bash
# Start Epic's Pixel Streaming signalling server on ws://0.0.0.0:8888
# Usage: ./start-signalling.sh [install-dir]
set -euo pipefail

DIR="${1:-${HOME}/PixelStreamingInfrastructure}"
BRANCH="${PS_BRANCH:-UE5.5}"

if [ ! -d "$DIR/.git" ]; then
  echo "→ cloning EpicGames/PixelStreamingInfrastructure ($BRANCH) into $DIR"
  git clone --depth 1 --branch "$BRANCH" https://github.com/EpicGames/PixelStreamingInfrastructure.git "$DIR"
fi

cd "$DIR/SignallingWebServer/platform_scripts/bash"
./setup.sh
echo "→ signalling server starting on ws://localhost:8888 (Ctrl+C to stop)"
exec ./start.sh -- --serve
