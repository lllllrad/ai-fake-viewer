#!/usr/bin/env bash
set -euo pipefail
image='bluenviron/mediamtx:1.21.1-ffmpeg@sha256:00ef3d1a243f3769ca36769b47df241a0c269c83a7735005b817505c49adb651'
name="mixed-chat-ffmpeg-$$"
cleanup() {
  docker stop --time 1 "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 143' TERM INT
docker run --rm --network host --name "$name" --entrypoint /usr/bin/ffmpeg "$image" "$@" &
wait $!
