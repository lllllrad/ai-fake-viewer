# Live setup for a separate Linux OBS PC

This runbook covers two Linux PCs on the same private LAN: one runs this application, and the other runs OBS Studio with its web overlay. Follow [README.md](README.md) for design details and [VERIFICATION_REPORT.md](VERIFICATION_REPORT.md) for tested behavior and remaining live checks.

The OBS Browser Source only **displays chat**. For AI to see the broadcast, OBS must also send its Program video to the app PC's RTMP server. If OBS already streams to YouTube or CHZZK, keep that destination and arrange a second output or relay for this RTMP feed.

## 1. Prepare the app PC

Install Node.js 24.x, npm and Docker. From the repository root:

```sh
npm ci
npm run setup
npm run build
```

`npm run setup` creates `.env` and `config.yaml` only if absent; it does not replace existing files. Keep `.env`, `config.yaml` and everything in `data/` private. Never commit or paste their token, password or full URL values. Edit them locally. The three generated values `ADMIN_TOKEN`, `READER_TOKEN` and `TOKEN_ENCRYPTION_KEY` must remain distinct and stable. Do not run `npm run demo` for a broadcast: demo mode deliberately creates artificial chat and frames.

On the app PC, run `ip -4 -brief address` and identify the IPv4 address of the network interface shared with the OBS PC. Ignore loopback, Docker and VPN interfaces. In the shell used for RTMP setup, enter that address with `read -rp "App PC LAN IPv4: " APP_PC_LAN_IP`. Replace the literal `APP_PC_LAN_IP` placeholder below with the address you chose; do not paste the placeholder into `config.yaml`. Set the network section of `config.yaml` to:

```yaml
network:
  bindHost: 0.0.0.0
  publicBaseUrl: http://APP_PC_LAN_IP:3210
```

The app PC's administrator page and OAuth callbacks are available only through `http://127.0.0.1:3210`; the remote OBS PC uses the LAN reader and overlay links. Permit TCP 3210 and 1935 between these two PCs in the host firewall. Keep these ports on the private LAN, not an Internet port forward. If the app PC address or port changes, update `publicBaseUrl`, the RTMP publish URL and the CHZZK callback registration before restarting.

## 2. Check the RTMP service and connect OBS video

Check whether this installation already has RTMP credentials and a container:

```sh
test -f data/rtmp-urls.txt && echo "RTMP credentials exist"
docker ps -a --filter name=mixed-chat-rtmp
```

If both credentials and a stopped container exist, run `docker start mixed-chat-rtmp`. If credentials exist but the container is absent, run `scripts/start-rtmp.sh "$APP_PC_LAN_IP"`. On a fresh installation with neither, run `scripts/setup-rtmp.sh "$APP_PC_LAN_IP"`, review the generated private files, then run `scripts/start-rtmp.sh "$APP_PC_LAN_IP"`. Do not run setup again to fix a stopped container: it deliberately refuses to overwrite credentials. The RTMP container uses Docker's `unless-stopped` restart policy; a manually stopped container remains stopped until you start it again. Its publisher and reader accounts have separate passwords. Only RTMP is exposed; no HLS, WebRTC or RTSP port is published.

Open `data/rtmp-urls.txt` **locally** and copy `OBS_PUBLISH_URL` privately to the OBS PC. The two lines have different permissions: `OBS_PUBLISH_URL` contains `user=publisher` and is the **only URL for sending video from OBS**; `APP_READ_URL` contains `user=reader` and is only for the app PC to read that video through FFmpeg. Using `APP_READ_URL` in OBS produces an authorization/stream-key error. Choose the output that matches your broadcast:

- If OBS has no other stream destination, set **Settings → Stream → Service: Custom** with `OBS_PUBLISH_URL` as the Server and an empty Stream Key, then select **Start Streaming**. This is the arrangement in [MediaMTX's OBS publishing instructions](https://mediamtx.org/docs/publish/obs-studio).
- If OBS already streams to a public platform, keep that primary Stream setting. One built-in secondary-output route is **Settings → Output → Output Mode: Advanced → Recording → Type: Custom Output (FFmpeg) → FFmpeg Output Type: Output to URL**. Set the full `OBS_PUBLISH_URL` as the URL, choose `flv` as container and compatible H.264 video/AAC audio encoders, then use **Start Recording** to start this secondary RTMP output. In this mode that button sends to a URL rather than saving a recording; it can use an extra encoder and prevents normal simultaneous file recording through the same Recording output. Verify these controls and CPU headroom in your installed OBS version before a live broadcast. The [OBS forum's second-stream guide](https://obsproject.com/forum/resources/stream-to-2-destinations-simultaneously-with-obs-without-nginx.788/) describes this route. A compatible multiple-RTMP-output plugin is another option, but plugin compatibility must be checked against your OBS version.

Verify the transmitted image is the intended Program scene. An output that goes only to a public platform does not feed this app. If you use OBS Studio Mode, Preview changes must not enter the RTMP Program output until transition.

In the app PC's ignored `config.yaml`, set `capture.url` to the exact `APP_READ_URL` from the private file. Quote the value because it contains `&`. Configure capture like this, with masks adjusted to the **actual** scene:

```yaml
capture:
  enabled: true
  ffmpeg: scripts/ffmpeg-docker.sh
  backend: rtmp
  device: OBS Virtual Camera
  url: "PASTE_PRIVATE_APP_READ_URL_HERE"
  intervalMs: 3000
  programConfirmed: true
  masks:
    - x: 0.70
      y: 0.0
      width: 0.30
      height: 1.0
```

The example blacks out the rightmost 30% of the source frame. Change or add normalized rectangles to cover every on-screen chat area and private region in every scene; do not assume the example fits your layout. `programConfirmed: true` records your physical Program-source check, while **Confirm masked Program** in admin is a separate runtime preview approval. Stop AI and review the mask again after changing scenes or composition. Capture can be left disabled until OBS video is publishing. The RTMP server being online alone does not produce frames.

## 3. Connect real chat sources

### CHZZK

Register a CHZZK developer application before pressing **Authorize CHZZK**. Request **chat message read** and **user information read**, and register this exact callback for the current app port:

```text
http://127.0.0.1:3210/oauth/chzzk/callback
```

Use the broadcaster's own CHZZK account for authorization. Put the issued `CHZZK_CLIENT_ID` and `CHZZK_CLIENT_SECRET` in `.env` on the app PC and set `chzzk.enabled: true` in `config.yaml`. Restart the app, open admin **on the app PC** through `127.0.0.1`, select **Authorize CHZZK**, complete consent, then select **Start receivers**. A healthy active connection reaches `subscribed`; a socket connection alone is not proof of chat subscription. Registration, scopes and callbacks follow the [official CHZZK authorization](https://chzzk.gitbook.io/chzzk/chzzk-api/authorization) and [session](https://chzzk.gitbook.io/chzzk/chzzk-api/session) documentation. Until the app is registered and credentials are supplied, the authorization button reports the missing setup instead of starting OAuth.

### YouTube, if used

Obtain a YouTube Data API key for your project, or an appropriately authorized access token, and put `YOUTUBE_API_KEY` or `YOUTUBE_ACCESS_TOKEN` in `.env`. In `config.yaml`, set `youtube.enabled: true` and `youtube.video` to the actual live watch URL or 11-character video ID. Restart and select **Start receivers**. `waiting_live` means the target is not currently providing live chat; check the broadcast and chat setting. Google OAuth login and access-token refresh are not implemented here, so operator-supplied OAuth tokens must be replaced when they expire.

SOOP's official integration is not ready for live acceptance. Leave `soop.mode: disabled` unless you separately review the experimental path described in [README.md](README.md).

## 4. Connect an image-capable AI model

Choose **one** provider in `config.yaml`:

- For `ai.provider: chatgpt_subscription` (the current default), open admin on the app PC and select **Continue with ChatGPT**. Complete account consent in that browser, return to admin, select **Load available models**, then choose an image-capable model that supports the required structured response. This uses the account's available [ChatGPT sign-in flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in); it does not reuse Codex login and does not require an OpenAI API key. Actual account eligibility and a real image response must be checked with your account.
- For `ai.provider: openai_api`, put `OPENAI_API_KEY` and `OPENAI_MODEL` in `.env`. Choose a model available to that API account with image input, structured Responses output and token counting. This path uses API billing; review its limits and pricing before paid calls.

Review what masked frames and permitted chat text may be sent to the provider, then set `policy.providerReviewed: true` in `config.yaml` and restart. Keep `ai.manualApproval: true` for the first live rehearsals. Platform chat is excluded from model context by default; set a platform's `*AiContextApproved` flag only after a separate applicable review and record `policy.reviewReference`. These flags do not grant platform permission. A working chat receiver does not require its AI-context flag.

## 5. Start and verify a live session

From the repository root on the app PC, start one server process:

```sh
npm start
```

Keep that process running. Verify `node --version` reports Node 24 before starting. For a manually supervised terminal that survives SSH logout, start `tmux new -s mixed-chat`, run the start command inside it, detach with Ctrl+B then D, and return with `tmux attach -t mixed-chat`. Unlike the RTMP container, the app process does not automatically restart after reboot; start it again or install a service manager before unattended use. If another instance holds port 3210, stop it rather than running demo and live together. Open `http://127.0.0.1:3210/admin` on the app PC and sign in once with `ADMIN_TOKEN` from local `.env`; the session survives page reloads for up to seven days. The **Live setup** card should show each configured prerequisite, and the admin page must not show the demo-mode notice. The authenticated `/api/admin/status` response has `demo: false` when checked separately.

Use this order for the first rehearsal:

1. Authorize CHZZK and ChatGPT on the app PC, if those sources/providers are selected. Start receivers and confirm real messages arrive under their real platform labels. No platform should show `demo_fixture`.
2. Start the OBS RTMP output. Select **Start capture** if needed, wait for fresh Program frames, inspect the **masked** admin preview, and select **Confirm masked Program**. Do not start AI if any chat or private region remains visible in the preview.
3. Select **Reader & OBS links**. On the OBS PC, create a Browser Source with the private `overlay` link including its `#` fragment; the initial suggested size is 600 × 900 with a transparent background. The `reader` link is for a separate read-only view. These links contain access tokens; copy them privately and update OBS after rotating the reader token.
4. Select **Start AI** only after capture is receiving fresh frames, the model is connected, policy review is recorded and the preview is confirmed. With manual approval on, inspect each pending response and select **Publish locally**. AI messages appear only in this app's reader/overlay, not as native CHZZK or YouTube chat posts.
5. Verify the OBS Browser Source shows the same real messages as the reader, Korean text displays correctly, a visual change in Program yields fresh masked frames, and **Stop AI now** halts AI while human chat continues.

If OBS says it cannot access the channel or stream key, first check that its Server field contains the full `OBS_PUBLISH_URL` with `user=publisher` and its Stream Key is empty. Check `docker logs --tail 30 mixed-chat-rtmp`: an authentication failure means the supplied role or password is wrong; no new connection suggests an address, port or firewall problem. If AI reports stale frames or capture fails, inspect OBS output, the RTMP container and the private read URL, then restart capture, review the preview and start AI manually. An unchanged but fresh still image is acceptable; a missing frame is not. An `Action unavailable` message after setup should be investigated from the **Live setup** card and the relevant status instead of switching to demo mode.

## 6. Stop, recover and protect access

In admin, use **Stop AI now**, **Stop receivers** and **Stop capture** for a controlled rehearsal end; then stop `npm start` with Ctrl+C. Stop the RTMP service with `docker stop mixed-chat-rtmp` when you do not need it; resume with `docker start mixed-chat-rtmp`. `docker logs --tail 50 mixed-chat-rtmp` shows recent RTMP service errors. If CHZZK authorization is revoked, reauthorize on the app PC. If the app-PC LAN IP changes, update both its public link origin and the RTMP container binding; the existing container cannot change its published bind address in place.

The reader/overlay fragment grants read access, and both RTMP URLs contain credentials. Keep them private, use **Rotate reader token** if a web link leaks, and replace RTMP credentials and the container if an RTMP URL leaks. Changing `ADMIN_TOKEN` invalidates administrator sessions. Losing `TOKEN_ENCRYPTION_KEY` makes saved OAuth tokens unreadable and requires reauthorization. [README.md](README.md) documents data deletion and token handling in more detail.

The repository's [verification report](VERIFICATION_REPORT.md) records fixture, browser and synthetic RTMP checks. Those checks do **not** prove that your OBS PC, CHZZK application, YouTube broadcast or AI account works until you complete the live rehearsal above.
