# Live setup for a separate Linux OBS PC

This runbook covers two Linux PCs on the same private LAN: one runs this application, and the other runs OBS Studio with its web overlay. Follow [README.md](README.md) for design details and [VERIFICATION_REPORT.md](VERIFICATION_REPORT.md) for tested behavior and remaining live checks.

The OBS Browser Source only **displays chat**. For AI to transcribe speech or inspect video, OBS must also send Program audio/video to the app PC's RTMP server. If OBS already streams to YouTube or CHZZK, keep that destination and arrange a second output or relay for this RTMP feed.

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

Verify the transmitted image and audio track are the intended Program output. An output that goes only to a public platform does not feed this app. If you use OBS Studio Mode, Preview changes must not enter the RTMP Program output until transition.

In the app PC's ignored `config.yaml`, set `capture.url` to the exact `APP_READ_URL` from the private file. Quote the value because it contains `&`. Configure capture like this, with masks adjusted to the **actual** scene:

```yaml
capture:
  enabled: true
  ffmpeg: scripts/ffmpeg-docker.sh
  backend: rtmp
  device: OBS Virtual Camera
  url: "PASTE_PRIVATE_APP_READ_URL_HERE"
  language: ko # Korean input; use "" for automatic detection
  intervalMs: 3000
  programConfirmed: true
  masks:
    - x: 0.70
      y: 0.0
      width: 0.30
      height: 1.0
```

The example blacks out the rightmost 30% of the source frame. In `ai.visualMode: on_request`, capture keeps only a short masked local frame buffer; the AI provider receives an image only after the model explicitly requests `inspect`. Change or add normalized rectangles to cover every on-screen chat area and private region in every scene; do not assume the example fits your layout. `programConfirmed: true` records your physical Program-source check, while **Confirm masked Program** in admin is a separate runtime preview approval. Stop AI and review the mask again after changing scenes or composition. Capture can be left disabled until OBS video is publishing. The RTMP server being online alone does not produce frames.

## 3. Enable automatic Groq Whisper transcription

Create a Groq API key in your own Groq account and put it in the ignored local `.env` as `GROQ_API_KEY=...`. This key is separate from ChatGPT or an OpenAI API key. Review Groq's handling of broadcast audio, then set `policy.groqAudioReviewed: true`. Configure the first audio track of the same private RTMP stream using the exact `APP_READ_URL` from `data/rtmp-urls.txt`:

```yaml
audio:
  enabled: true
  ffmpeg: scripts/ffmpeg-docker.sh
  url: "PASTE_PRIVATE_APP_READ_URL_HERE"
  language: ko # Korean input; use "" for automatic detection
  chunkSeconds: 10
  maxRequests: 360
policy:
  groqAudioReviewed: true
```

Merge these fields into the existing sections of `config.yaml`; do not replace the rest of the file. After restarting `npm start`, audio begins automatically. The admin **Groq speech transcription** card shows `listening` after audio arrives, the latest transcript, and request usage. Near-silent chunks are skipped locally. Spoken chunks are sent as 16 kHz mono WAV to Groq's [`whisper-large-v3-turbo` transcription endpoint](https://console.groq.com/docs/speech-to-text); recent transcripts remain in memory for AI context for up to two minutes, while successful transcripts are also saved in the app PC's private SQLite log for up to `retentionDays` (default seven days). They do not appear as viewer chat. The administrator can inspect recent entries and download the retained log as JSONL from the **Groq speech transcription** card; the export contains transcript ID, session ID, capture time and text. Raw audio is not saved. Keep downloaded copies private and delete them separately. A request in progress causes newer chunks to be dropped rather than queued. `maxRequests` is a per-process cap, so a restart resets it; inspect Groq usage for billing and account limits. Use **Stop audio** to halt uploads without stopping chat receivers or AI. Previously logged text remains until retention expires or **Delete all local data** is used. If `config_required`, check the key; if `review_required`, complete the audio review; if `provider_error`, inspect the Groq account/key and service status. Check the live transcript and request count after adding your key; the included fixture tests alone do not verify speech accuracy.

Set `audio.language` to the broadcast's input language using a lowercase two-letter ISO-639-1 code, such as `ko`, `en`, or `ja`, to reduce incorrect language detection. Omit it or set it to `""` for automatic detection. Restart the app after changing it. This guides transcription; it does not translate the audio or guarantee accuracy.

To suppress reactions only when timing is clearly bad, optionally enable the [Jev filter](README.md#optional-jev-filter-before-answer-generation) after configuring a TypeSafe key and reviewing text sharing. Uncertain scores pass; provider errors or request-cap exhaustion stop the entire AI scheduler. Its per-process request cap is separate from transcription and answer-model limits.

## 4. Connect real chat sources

### CHZZK

Register a CHZZK developer application before pressing **Authorize CHZZK**. Request **chat message read** and **user information read**. For an app PC where the browser doing login is running on the same PC, register this exact callback (change the port if your config uses another one):

```text
http://127.0.0.1:3210/oauth/chzzk/callback
```

The exact callback is configurable as `chzzk.redirectUri` in `config.yaml`. If CHZZK's authorization page is opened on another PC, use a callback reachable by that browser instead: configure a public HTTPS origin such as `https://chat.example.com/oauth/chzzk/callback`, register that exact URL in the developer console, and route HTTPS requests for that host/path to this app's port. The callback host must be explicitly configured; this does not open the admin page or API to remote clients. The local app must remain reachable at that callback during login. Restart after changing `config.yaml`; the URL sent by **Authorize CHZZK** will then match the configured registration exactly.

Use the broadcaster's own CHZZK account for authorization. Put the issued `CHZZK_CLIENT_ID` and `CHZZK_CLIENT_SECRET` in `.env` on the app PC and set `chzzk.enabled: true` in `config.yaml`. Restart the app, open admin **on the app PC** through `127.0.0.1`, select **Authorize CHZZK**, complete consent, then select **Start receivers**. A healthy active connection reaches `subscribed`; a socket connection alone is not proof of chat subscription. On success, the callback page confirms authorization and tells you to return to admin; an expired state, denied consent or exchange failure displays an error page so you can retry from **Authorize CHZZK**. Registration, scopes and callbacks follow the [official CHZZK authorization](https://chzzk.gitbook.io/chzzk/chzzk-api/authorization) and [session](https://chzzk.gitbook.io/chzzk/chzzk-api/session) documentation. Until the app is registered and credentials are supplied, the authorization button reports the missing setup instead of starting OAuth.

### YouTube, if used

Obtain a YouTube Data API key for your project, or an appropriately authorized access token, and put `YOUTUBE_API_KEY` or `YOUTUBE_ACCESS_TOKEN` in `.env`. In `config.yaml`, set `youtube.enabled: true` and `youtube.video` to the actual live watch URL or 11-character video ID. Restart and select **Start receivers**. `waiting_live` means the target is not currently providing live chat; check the broadcast and chat setting. Google OAuth login and access-token refresh are not implemented here, so operator-supplied OAuth tokens must be replaced when they expire.

SOOP's official integration is not ready for live acceptance. Leave `soop.mode: disabled` unless you separately review the experimental path described in [README.md](README.md).

## 5. Connect an AI model

Choose **one** provider in `config.yaml`:

- For `ai.provider: chatgpt_subscription` (the current default), open admin on the app PC and select **Continue with ChatGPT**. Complete account consent in that browser, return to admin, select **Load available models**, then choose an image-capable model that supports the required structured response. This uses the account's available [ChatGPT sign-in flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in); it does not reuse Codex login and does not require an OpenAI API key. Actual account eligibility and a real image response must be checked with your account.
- For `ai.provider: openai_api`, put `OPENAI_API_KEY` and `OPENAI_MODEL` in `.env`. Choose a model available to that API account with image input, structured Responses output and token counting. This path uses API billing; review its limits and pricing before paid calls.

Review what transcription text, masked frames and permitted chat text may be sent to the AI provider, then set `policy.providerReviewed: true` in `config.yaml` and restart. Groq's `groqAudioReviewed` setting is separate: it records review of sending audio to Groq, while `providerReviewed` gates starting the AI model. Start AI now reports the specific missing requirement instead of a generic configuration error. By default, `ai.reviewDraft: true` sends each proposed response through a second call to the same selected model for rejection or a constrained edit. This is not independent moderation. `ai.manualApproval: false` then publishes locally automatically; set it to `true` to add human approval before publication. Platform chat is excluded from model context by default; set a platform's `*AiContextApproved` flag only after a separate applicable review and record `policy.reviewReference`. These flags do not grant platform permission. A working chat receiver does not require its AI-context flag.

## 6. Start and verify a live session

From the repository root on the app PC, start one server process:

```sh
npm start
```

Keep that process running. Verify `node --version` reports Node 24 before starting. For a manually supervised terminal that survives SSH logout, start `tmux new -s mixed-chat`, run the start command inside it, detach with Ctrl+B then D, and return with `tmux attach -t mixed-chat`. Unlike the RTMP container, the app process does not automatically restart after reboot; start it again or install a service manager before unattended use. If another instance holds port 3210, stop it rather than running demo and live together. Open `http://127.0.0.1:3210/admin` on the app PC and sign in once with `ADMIN_TOKEN` from local `.env`; the session survives page reloads for up to seven days. The **Live setup** card should show each configured prerequisite, and the admin page must not show the demo-mode notice. The authenticated `/api/admin/status` response has `demo: false` when checked separately.

Set `ai.visualMode: on_request` in `config.yaml` for text-first operation. A transcript or permitted human chat can trigger an AI decision. The admin AI card exposes the latest input counts, timing phase and available tools (none). See [AI_FLOW.md](AI_FLOW.md) for the complete stages and exact inputs sent to Groq, TypeSafe and the selected answer provider. The first model call has **no image**; the model may answer from text, skip, or ask to `inspect`. Only that request starts a second model call containing a fresh confirmed masked frame. If a frame is unavailable, the inspection is skipped; speech-only replies can still work. An inspection consumes a second AI call and counts twice against `ai.maxCalls`. `continuous` retains the original image-first behavior.

Use this order for the first rehearsal:

1. Authorize CHZZK and ChatGPT on the app PC, if those sources/providers are selected. Start receivers and confirm real messages arrive under their real platform labels. No platform should show `demo_fixture`.
2. Start the OBS RTMP output with an audio track. Confirm **Groq speech transcription** shows fresh words after speech. If AI should be allowed to inspect video, select **Start capture** if needed, wait for fresh Program frames, inspect the **masked** preview, and select **Confirm masked Program**. Without a confirmed preview, visual requests are skipped; speech-only decisions continue.
3. Select **Reader & OBS links**. On the OBS PC, create a Browser Source with the private `overlay` link including its `#` fragment; the initial suggested size is 600 × 900 with a transparent background. The `reader` link is for a separate read-only view. These links contain access tokens; copy them privately and update OBS after rotating the reader token.
4. Select **Start AI** after transcription or permitted chat is available, the model is connected and provider review is recorded. For visual inspection, capture must also receive fresh masked frames and the preview must be confirmed. With the default `ai.manualApproval: false`, responses publish automatically. If you enable manual approval, inspect each pending response and select **Publish locally**. Open Reader to watch with uniform participant pseudonyms and hidden source labels; **Stop AI & reveal origins** ends the blind session. AI messages appear only in this app's reader/overlay, not as native CHZZK or YouTube chat posts.
5. Verify the OBS Browser Source shows the same real messages as the reader, Korean text displays correctly, a visual change in Program yields fresh masked frames, and **Stop AI now** halts AI while human chat continues.

If OBS says it cannot access the channel or stream key, first check that its Server field contains the full `OBS_PUBLISH_URL` with `user=publisher` and its Stream Key is empty. Check `docker logs --tail 30 mixed-chat-rtmp`: an authentication failure means the supplied role or password is wrong; no new connection suggests an address, port or firewall problem. If audio has no transcripts, check that OBS sends its intended audio track and that the RTMP server receives it. If a visual request has no fresh frame, inspect OBS output, capture status and the private read URL, then restart capture and review the preview. An unchanged but fresh still image is acceptable; a missing frame only prevents visual inspection in on-request mode. An `Action unavailable` message after setup should be investigated from the **Live setup** card and the relevant status instead of switching to demo mode.

## 7. Stop, recover and protect access

In admin, use **Stop AI now**, **Stop receivers** and **Stop capture** for a controlled rehearsal end; then stop `npm start` with Ctrl+C. Stop the RTMP service with `docker stop mixed-chat-rtmp` when you do not need it; resume with `docker start mixed-chat-rtmp`. `docker logs --tail 50 mixed-chat-rtmp` shows recent RTMP service errors. If CHZZK authorization is revoked, reauthorize on the app PC. If the app-PC LAN IP changes, update both its public link origin and the RTMP container binding; the existing container cannot change its published bind address in place.

The reader/overlay fragment grants read access, and both RTMP URLs contain credentials. Keep them private, use **Rotate reader token** if a web link leaks, and replace RTMP credentials and the container if an RTMP URL leaks. Changing `ADMIN_TOKEN` invalidates administrator sessions. Losing `TOKEN_ENCRYPTION_KEY` makes saved OAuth tokens unreadable and requires reauthorization. [README.md](README.md) documents data deletion and token handling in more detail.

The repository's [verification report](VERIFICATION_REPORT.md) records fixture, browser and synthetic RTMP checks. Those checks do **not** prove that your OBS PC, CHZZK application, YouTube broadcast or AI account works until you complete the live rehearsal above.
