#!/usr/bin/env bash
set -euo pipefail
lan_ip="${1:?Usage: scripts/setup-rtmp.sh APP_PC_LAN_IP}"
if [[ ! "$lan_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo 'Provide a numeric IPv4 LAN address.' >&2
  exit 1
fi
if [[ -e data/mediamtx.yml || -e data/rtmp-urls.txt ]]; then
  echo 'RTMP configuration already exists; refusing to replace its credentials.' >&2
  exit 1
fi
mkdir -p data
chmod 700 data
publisher_password="$(openssl rand -hex 24)"
reader_password="$(openssl rand -hex 24)"
cat > data/mediamtx.yml <<YAML
logLevel: warn
rtsp: false
rtmp: true
hls: false
webrtc: false
srt: false
moq: false
authMethod: internal
authInternalUsers:
  - user: reader
    pass: ${reader_password}
    ips: []
    permissions:
      - action: read
        path: program
  - user: publisher
    pass: ${publisher_password}
    ips: []
    permissions:
      - action: publish
        path: program
paths:
  program:
    source: publisher
YAML
printf 'OBS_PUBLISH_URL=rtmp://%s:1935/program?user=publisher&pass=%s\nAPP_READ_URL=rtmp://127.0.0.1:1935/program?user=reader&pass=%s\n' "$lan_ip" "$publisher_password" "$reader_password" > data/rtmp-urls.txt
chmod 600 data/mediamtx.yml data/rtmp-urls.txt
echo 'Private RTMP credentials saved in data/rtmp-urls.txt.'
echo 'Review that file and data/mediamtx.yml before starting the server.'
echo 'No RTMP service has been started.'
