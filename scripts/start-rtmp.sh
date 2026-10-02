#!/usr/bin/env bash
set -euo pipefail
lan_ip="${1:?Usage: scripts/start-rtmp.sh APP_PC_LAN_IP}"
if [[ ! "$lan_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo 'Provide a numeric IPv4 LAN address.' >&2
  exit 1
fi
if [[ ! -f data/mediamtx.yml || ! -f data/rtmp-urls.txt ]]; then
  echo 'Run scripts/setup-rtmp.sh first.' >&2
  exit 1
fi
docker run -d --restart unless-stopped --name mixed-chat-rtmp \
  -p "${lan_ip}:1935:1935" -p '127.0.0.1:1935:1935' \
  -v "${PWD}/data/mediamtx.yml:/mediamtx.yml:ro" \
  --entrypoint /mediamtx \
  'bluenviron/mediamtx:1.21.1-ffmpeg@sha256:00ef3d1a243f3769ca36769b47df241a0c269c83a7735005b817505c49adb651' \
  /mediamtx.yml
