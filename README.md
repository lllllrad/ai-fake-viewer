# Mixed Chat Studio

A local, read-only broadcast chat aggregator with screen-aware AI characters. YouTube, CHZZK and optional experimental SOOP receivers feed one SQLite event stream. The reader and OBS overlay share that stream. AI messages are published only inside this application.

**For the separate Linux OBS PC and live credentials, follow [LIVE_SETUP.md](LIVE_SETUP.md) in order.** **Ready for a local demo. Live broadcasting requires your credentials, policy review, OBS setup and the live checks in [VERIFICATION_REPORT.md](VERIFICATION_REPORT.md).** The official SOOP OAuth/browser SDK path is implemented; account approval and live reception remain unverified. Historical fixture and limited live checks are recorded separately in the verification report.

See [AI_FLOW.md](AI_FLOW.md) for the full AI input, tool, review and publication flow, and editable prompt files under [prompts/](prompts/).

The administrator dashboard layout, system status and controls, viewer-consent notices, and required acceptance checks are specified in [the admin dashboard functional spec](docs/admin-dashboard-functional-spec.md). The first admin section is the operations dashboard: masked Program preview, per-platform chat reception, latest transcript, model readiness, AI on/off, emergency stop and explicit identity reveal. Healthy inputs show only “정상”; chat health is summarized across platforms. Preparation and failures show a brief next action. Transport states, counters and model stages are hidden under the initially collapsed “연결 및 AI 상세 설정” section; dashboard links open the relevant controls. Persona studio follows the dashboard. Its implementation-gap table records remaining work. See the [documentation index](docs/README.md) for document ownership and status.

For development and validation, use `sh run-command.sh npm run check`. The launcher also prepares the existing Linux browser environment; see the [development guide](docs/development.md).

## Quick start

Install Node.js **24.x** (including npm), then run from this repository:

```sh
npm ci
npm run setup
npm run build
npm run demo
```

Open **http://127.0.0.1:3210/admin**. Copy `ADMIN_TOKEN` from the generated local `.env` into the sign-in form. The server never prints your tokens. Keep `.env` private. Admin sign-in now uses an HttpOnly, SameSite=Strict local cookie valid for up to seven days across reloads and server restarts; **Sign out** clears it. Changing `ADMIN_TOKEN` invalidates existing cookies.

1. The demo starts artificial platform chat and artificial moving image frames. It makes no platform or model requests.
2. Inspect the preview and select **Confirm masked Program**. In demo mode this confirms a clearly labeled artificial input.
3. Select **Start AI**. The mock model publishes a short, explicitly marked demo response automatically.
4. Watch it appear in the shared conversation without approval. Set `ai.manualApproval: true` only if you want to review each message.
5. Select **Reader & OBS links**. Open the reader link and copy the overlay link to an OBS Browser Source.
6. **Stop AI now** cancels pending generation and approval without stopping chat receivers.
7. Press **Ctrl+C** to stop the foreground demo. The detached live server can be stopped with `mise exec -- just server-stop`. A still-running demo process keeps producing artificial messages even if you edit config.yaml.

Demo data uses `data/demo.sqlite`; live mode uses `database` from `config.yaml`. A new database starts with AI stopped. For an open session, the entry point starts configured inputs and may restore previously saved AI running intent or an armed persona session after fresh-frame confirmation and readiness checks. Use **Stop AI** before shutting down if you do not want automatic recovery. Use **New session** after a closed session. Start only one server process per database and port.

## Persona studio and viewer consent

[The persona implementation specification](docs/ai-viewer-persona-system-spec.md) covers the implemented P0 authoring flow: create a public/private brief, generate candidates, lock fields or regenerate, audition, score and approve, then freeze a cast with disclosure confirmation. Start the persona session and arm AI after inputs are ready. Live controls include mute, departure/re-entry, pause/resume, stop, end and explicit identity reveal. Resuming a paused persona session does not re-arm AI. Without an active live persona session, the scheduler uses `ai.personas` from YAML. Authoring calls and their limits are separate from live generation; the specification records current budgeting and UI limitations.

Platform viewers must send `!동의` before their ordinary messages enter the stored/displayed conversation. Consent is scoped to platform, channel, viewer ID and the current stream session. `!철회` revokes consent and hides that viewer's earlier messages from public display and future AI context. These commands are not displayed as chat. A new stream session requires fresh consent; hiding cannot undo a previous external model request.

Per-platform consent-notice toggles default off and persist in SQLite when changed in admin. They control notices in this application's reader/overlay, not native platform messages. Enabling notices does not bypass the consent gate or control model-context inclusion. Consented visible messages from all supported platforms are eligible for AI context; there are no per-platform AI-context approval flags in the current schema. The notice includes both commands, is throttled per platform/channel for at least 30 seconds, and is not repeated for a withdrawn viewer during that session.

In current live mode, **starting AI requires confirmed fresh masked video, running Groq audio input, and a ready model even with `on_request`**. Platform chat is optional. `on_request` controls whether images accompany a model request; it does not remove the server's start prerequisites.

## Live configuration

Install the pinned tools once, then run the live server detached from the terminal:

```sh
mise trust
mise install
mise exec -- just server-start
```

Use `mise exec -- just server-restart` after editing `config.yaml` or `.env`, `mise exec -- just server-status` to check it, `mise exec -- just server-logs` to follow its log, and `mise exec -- just server-stop` to stop it. The PID and log are stored in ignored `.local/server.pid` and `.local/server.log`.

The `justfile` uses the Node.js and just versions pinned in `mise.toml`. Configuration is validated with a strict schema. Unknown keys, out-of-bounds masks and incomplete monetary budgets fail at startup. [config.example.yaml](config.example.yaml) documents configuration examples; [packages/config.ts](packages/config.ts) defines the accepted schema and defaults. API keys belong in `.env`; private RTMP read URLs may appear only in ignored local `config.yaml`. Windows PowerShell supports the same npm commands.

### YouTube: official gRPC and REST

Set `YOUTUBE_API_KEY` to a key for a project with YouTube Data API access, or set `YOUTUBE_ACCESS_TOKEN` for an appropriately authorized account. OAuth access tokens are operator supplied; this version does not implement Google OAuth login or automatic refresh.

```yaml
youtube:
  enabled: true
  video: ""
  channelId: "UCxxxxxxxxxxxxxxxxxxxxxx" # replace with the real channel ID
  transport: grpc
  restFallback: true
```

Set either an actual 11-character video ID or supported YouTube watch/live/short-link URL, or set `channelId` (a 24-character YouTube channel ID beginning with `UC`) to discover that channel’s active public live broadcast automatically. The channel lookup uses YouTube `search.list`, which is limited to 100 calls per day, then reads `activeLiveChatId` from the selected live video. If the channel is not live when receivers start, status becomes `waiting_live`; use **Start receivers** after the broadcast begins. The server calls fixed Google hosts and never fetches a submitted URL directly. The gRPC `StreamList` connection is preferred. Repeated unavailable/unimplemented transport failures can fall back to official REST. REST observes `pollingIntervalMillis`. Set `transport: rest` to test REST explicitly.

The complete official protocol sample, original hash, Apache license and one necessary import correction are in [vendor/youtube](vendor/youtube/NOTICE.md). gRPC and REST have separate checkpoints. Message ID deduplication protects reconnects and fallback overlap; missing messages during outages cannot be ruled out. Only ordinary text events are displayed. Native moderation, donation, sticker and membership events are not implemented.

### CHZZK: official OAuth and user session

Register an application with **chat message read** and **user information read** permissions. Register the exact callback configured by `chzzk.redirectUri` in `config.yaml`; the local default is `http://127.0.0.1:3210/oauth/chzzk/callback` (use the configured app port). If login is opened on a different PC, configure a public HTTPS callback and route its host/path to the app, then register that exact URL. Set `CHZZK_CLIENT_ID` and `CHZZK_CLIENT_SECRET` in `.env`, enable `chzzk.enabled`, and restart.

Select **Authorize CHZZK**, sign in as the broadcaster and approve the requested read permissions. After the callback, return to admin and select **Start receivers**. Only the authenticated user's own channel is subscribed. Status becomes `subscribed` after the server confirms the CHAT subscription, not merely when the socket opens.

Socket.IO client **2.0.3** runs in a separate process. Compatible Engine.IO 3 and parser 3 security updates are pinned via npm overrides and tested with a local socket fixture. The 2026-10-02 dependency review recorded three moderate advisories; see [research/dependencies.md](research/dependencies.md). Real CHZZK compatibility still requires an approved app and live test.

Tokens rotate through a single-flight refresh and are atomically saved in AES-256-GCM encrypted `data/chzzk.tokens`. Keep `TOKEN_ENCRYPTION_KEY` in `.env`; losing it requires reauthorization. After revocation, select **Authorize CHZZK** again. A 401 marks authentication as requiring operator attention; restarting receivers can refresh an expired stored token. To remove local CHZZK credentials, stop the server and remove `data/chzzk.tokens`, or use the authenticated `POST /api/admin/chzzk/forget` endpoint. Revoke the app in CHZZK itself to remove upstream authorization.

### SOOP: separate official and experimental paths

See [SOOP official chat](#soop-official-chat) for the browser SDK setup and app approval requirements.

The optional unofficial adapter uses the installed and type-checked `soop-extension@1.3.3` receive/disconnect API. It does not request a password, expose chat writing or bypass restricted broadcasts. After independently reviewing the library, platform terms and your intended public broadcast:

```yaml
soop:
  mode: experimental_library
  experimentalConsent: true
  streamerId: "YOUR_PUBLIC_STREAMER_ID"
```

Both the mode and consent are required. It runs in a child process with no model or other platform secrets. A successful experimental connection is **not** an official integration. Package/repository provenance limitations and live-test blockers are recorded in [research/soop-official-verification.md](research/soop-official-verification.md).

## OBS Program capture and privacy masks

Install an FFmpeg binary appropriate for your OS, independently of this repository. Its redistribution license depends on that build; no FFmpeg binary is bundled. On Windows, list DirectShow devices:

```powershell
ffmpeg -list_devices true -f dshow -i dummy
```

In OBS, start **Virtual Camera** and select **Program** output. Confirm in Studio Mode that changing Preview alone does not change the camera output. This application cannot prove that OBS's camera is configured correctly.

```yaml
capture:
  ffmpeg: ffmpeg
  backend: dshow
  device: OBS Virtual Camera
  intervalMs: 3000
  masks:
    - x: 0.70
      y: 0.0
      width: 0.30
      height: 1.0
```

The example masks the rightmost 30% of the image. Change it for your actual composition. Coordinates are normalized to the entire original image. Include **every** chat overlay (including this application's overlay), credentials and private regions in every scene. Masks are applied before resizing, administrator preview and model upload. Masked images are held only in memory: up to 10 frames / 30 seconds; each request uses at most 3 fresh frames. Images are resized to fit 1280 × 1280.

Capture starts from the configured camera or RTMP source without a separate `programConfirmed` setting; legacy values are accepted and ignored. Open admin, inspect the masked preview and select **Confirm masked Program**. Image upload is blocked without a configured mask and runtime confirmation. This prevents accidental unmasked defaults, but does not automatically locate chat. You must check the rectangles. Layout/scene changes at the same resolution are not automatically detected: stop AI, verify masks and re-confirm before resuming. Source resolution changes invalidate confirmation. In `ai.visualMode: continuous`, ten seconds without a fresh frame pauses AI and requires a manual start. In `on_request` mode, text-only decisions can continue while unavailable video requests are skipped. Repeated identical fresh frames are healthy. A device that continuously outputs a frozen picture cannot reliably be detected.

Capture failures are isolated and retried up to five times with backoff. Confirmation is cleared on failure. For a camera on the same Linux PC, select `backend: v4l2` and a device such as `/dev/video2`; for macOS select `avfoundation` and the correct camera index. These physical-device paths have not been live-tested here.

### OBS on a separate Linux PC: optional RTMP input

The app reads an RTMP or RTMPS stream through the same FFmpeg worker and privacy-mask pipeline. On a Linux app PC with Docker, `scripts/setup-rtmp.sh APP_PC_LAN_IP` generates private MediaMTX publish/read credentials in ignored `data/`; review `data/mediamtx.yml` and `data/rtmp-urls.txt`, then run `scripts/start-rtmp.sh APP_PC_LAN_IP` to start an authenticated RTMP service bound to that LAN IP and loopback. The container uses a pinned [MediaMTX](https://mediamtx.org/docs/kickoff/install) image. `scripts/ffmpeg-docker.sh` uses its FFmpeg binary for capture, so a host FFmpeg installation is not required. Stop the service with `docker stop mixed-chat-rtmp`; remove its container with `docker rm mixed-chat-rtmp`. The service has a persistent restart policy once explicitly started.

On the separate Linux OBS PC, set a Custom stream service Server URL to `OBS_PUBLISH_URL` from the private credential file and leave Stream Key empty. [MediaMTX documents this OBS arrangement](https://mediamtx.org/docs/publish/obs-studio). If OBS already streams to a public platform, configure a separate output or relay; do not replace the public destination. On the app PC, use `APP_READ_URL` from the same private file in ignored `config.yaml` and set:

```yaml
capture:
  ffmpeg: scripts/ffmpeg-docker.sh
  backend: rtmp
  url: "APP_READ_URL_FROM_PRIVATE_FILE"
  intervalMs: 3000
  masks:
    - x: 0.70
      y: 0.0
      width: 0.30
      height: 1.0
```

Use the exact private read URL in your ignored local config; never commit that URL or share it in screenshots. Replace the masks for your actual scene. [FFmpeg can read RTMP](https://mediamtx.org/docs/read/ffmpeg). Confirm a fresh masked preview before allowing AI to inspect video. The setup script prepares credentials but does not start the RTMP service. Physical remote OBS/RTMP operation still needs a live test.

## Groq speech and AI model data review

Set `GROQ_API_KEY` in private `.env`, review audio sharing and configure `audio.url` to the private RTMP read URL. Audio starts when a URL and key are configured; there is no separate audio-enable or review flag. The first RTMP audio track is converted to 10-second, 16 kHz mono WAV chunks and sent to [Groq Whisper transcription](https://console.groq.com/docs/speech-to-text). Near-silent chunks are skipped locally. Recent transcripts enter AI context automatically; each successful transcript is also saved in the private SQLite log for later review, without being posted as public chat. `audio.maxRequests` caps calls per app process; a restart resets that cap. A live transcription response was observed on the app PC, but the physical audio source and speech accuracy were not independently verified. See [LIVE_SETUP.md](LIVE_SETUP.md) for the exact two-PC setup.

Set `audio.language: ko` for a Korean broadcast (`en` for English, `ja` for Japanese). Groq accepts an ISO-639-1 input language hint to improve transcription accuracy. Omit the setting or use `audio.language: ""` to keep automatic detection. Restart after changing the setting; this affects transcription, not AI reply language.

With `ai.visualMode: on_request`, the AI first receives transcript/permitted chat text without images. It can request `inspect`, which causes one additional call with a fresh confirmed masked frame; unavailable frames are skipped. Both calls count against `ai.maxCalls`. `continuous` retains the earlier image-first path.

### Optional Jev filter before answer generation

[Jev's System One API](https://docs.typesafe.ai/api) can decide whether recent text warrants a reaction before spending an answer-model call. It is disabled by default. Set `TYPESAFE_API_KEY` in `.env`, review sharing transcripts and permitted chat with TypeSafe, and merge this into `config.yaml`:

```yaml
ai:
  visualMode: on_request
  gate:
    enabled: true
    model: jev-latest
    threshold: 0.8
    maxRequests: 360
    timeoutMs: 3000
```

Restart the app, then start AI. The filter sends bounded recent transcripts, permitted pseudonymous chat, the broadcast description and selected persona to TypeSafe. It never sends images or audio. Jev answers only whether this is **clearly a bad time** to speak. A probability at or above `threshold` suppresses the response; uncertain or neutral results pass to the answer model. The default `0.8` is intentionally conservative. Existing cooldowns, chat activity limits and input deduplication run first. An allowed reaction may still be skipped by the answer model, or request a masked image using the existing inspection flow; inspection is not filtered a second time.

The admin AI card displays filter state, checks, filtered inputs, errors and the latest probability. A timeout, HTTP error or invalid response skips that reaction without an answer-model call; later new input may be evaluated. Reaching `maxRequests` stops AI with `gate_budget_exhausted`. Missing credentials raise an error and stop the scheduler. This filter cap counts attempts per process and resets on app restart; its usage and billing are separate from `ai.maxCalls` and `ai.maxUsd`. Stopping AI cancels an in-flight check. Demo mode bypasses the filter without making requests.

The filter requires `on_request` mode because [Jev accepts text only](https://docs.typesafe.ai/models). Use continuous mode with the filter disabled for image-driven reactions. Korean decision quality and the best threshold need evaluation with real broadcast samples; fixture tests verify integration behavior, not model judgment.

## Image model and data review

The default `ai.provider: chatgpt_subscription` uses OpenAI's [Sign in with ChatGPT for local open-source apps](https://developers.openai.com/siwc/token-sharing-open-source). In live mode, open the admin page, select **Continue with ChatGPT**, authorize this app in your system browser, return to admin, select **Load available models**, and choose an image-capable model from your account's catalog. The app stores the issued account/client mapping and rotating tokens in encrypted, owner-only `data/chatgpt.tokens`. It never reads the Codex CLI or browser's existing credentials. Multiple saved accounts can be selected or reauthorized. **Disconnect active account** attempts remote session revocation and clears local tokens; if revocation cannot be confirmed, remove access in [ChatGPT Settings → Usage](https://chatgpt.com/settings/usage).

This flow requires a ChatGPT plan and feature availability for your account. A live text-only decision reached manual approval on this app PC; each new account still needs its own authorization and verification. It is distinct from ordinary API-key billing. ChatGPT subscription requests use account-specific model slugs, `store: false`, `stream: true`, and accept output only after the completion event. The app enforces a persisted call limit and local request/output bounds; exact pre-call input token counting and USD budgets are unavailable for this provider. `ai.maxInputTokens` and `ai.maxOutputTokens` reject a completed response that reports usage above those values but cannot prevent that call. Review usage and app limits in ChatGPT Settings. The selected model must support images and structured output. Structured text output succeeded in a live call; image comprehension remains unverified.

For an independently billed API key, set `ai.provider: openai_api`, `OPENAI_API_KEY` and `OPENAI_MODEL` in `.env`. Choose a model available to your API account that supports image input, Responses structured output and input token counting. The API-key path uses pre-call token counting and can use `ai.maxUsd` when verified prices are configured. Review the provider handling of uploaded images and chat before use; the current schema has no `policy.providerReviewed` flag. `store: false` does not mean all provider logs are disabled.
Platform messages are blocked until viewer consent. Once consented and visible, messages from all three supported platforms are eligible for model context. The old `policy.*` settings, including platform AI-context approvals, are no longer accepted by the strict schema. Consent and a working receiver do not establish platform permission; applicable processing review remains an operator responsibility. Image masks remain required before image upload.

The AI checks new transcript chunks and newly received permitted messages against a rolling `ai.contextWindowSeconds` of surrounding transcripts and chat. Each distinct input is evaluated once; skipped or answered chunks are not replayed as new events. After each decision, the next decision waits a newly randomized interval between `ai.pacing.minSeconds` and `ai.pacing.maxSeconds`, independently of audio chunk length. Defaults are a 35–95 second interval and a 120 second context window. The model receives bounded recent transcripts and permitted text, recent spectator replies and one character's style; it receives masked JPEGs only in continuous mode or after an on-request inspection. It has no tools, private account IDs or access to the origin table. Output is validated for schema, length, reply/evidence references and several obvious unsafe patterns. With `ai.reviewDraft: true` (default), the same selected model receives a second call to reject or lightly edit the draft; this is not an independent review or a safety guarantee. Messages publish automatically by default (`ai.manualApproval: false`) after AI review. Set it to `true` to add a human approval queue. Legacy pending approvals expire after 30 seconds; persona candidates use their configured reaction TTL (12 seconds by default) and are invalidated by stopping, hiding evidence or stale input. See [AI_FLOW.md](AI_FLOW.md) for the stage-by-stage inputs.

Calls are limited per session, persisted across restarts, with one generation at a time, configurable randomized pacing (35–95 seconds by default), per-character cooldown based on the minimum pacing interval, and at most three messages per minute. Persona sessions add their own limits. Busy human chat suppresses generation. Synthetic message arrival alone does not trigger another response. Unchanged frames can skip inference.

`ai.maxCalls` always applies. For the ChatGPT subscription provider, monetary estimates are unavailable and `ai.maxUsd` must stay null. On the API-key provider, without verified prices the UI displays **Cost estimate unavailable**. To enable `ai.maxUsd`, provide both per-million token prices and `priceCheckedAt`. Maximum input/output cost is reserved before requests; successful usage is settled afterward. Failed requests retain the conservative reservation. For the API-key provider, input token counting must succeed and fit the configured limit before paid generation begins. Prices and provider charges remain your responsibility; this is an estimate, not a billing guarantee.

## Reader, overlay and operations

Reader and overlay tokens are placed in URL fragments and sent in the first WebSocket authentication message. They do not grant administrator access. Treat OBS links as private. **Rotate reader token** immediately disconnects readers and atomically updates `.env`; fetch new links and update OBS. If environment variables are supplied externally, update `READER_TOKEN` there too before restarting. Admin credentials are exchanged for a seven-day HttpOnly local session cookie; use **Sign out** to clear it. To rotate admin credentials, stop the server, replace `ADMIN_TOKEN` with a fresh random value of at least 32 characters, and restart.

Use the exact overlay link shown in admin for an OBS **Browser Source**, typically **600 × 900**. The page has a transparent background and shows the latest 12 messages. The reader keeps a 300-message window, supports following and jumping to new messages, and has no message input. The source's refresh/visibility settings do not control receivers or AI. A general mixed-chat notice remains visible. Until **Stop AI & reveal origins** is selected, every participant uses the same session-stable pseudonym format, and message source badges and original names are hidden. Reader, overlay, reconnect snapshots and the admin conversation use the same blinded messages. Use Reader while watching to avoid the admin generation counters. Revealing origins restores names and source badges; use **New session** to begin another blind session.

Both pages order by the original committed message sequence. Updates replace the same item in place. Reconnection intentionally refreshes the current 300-message snapshot rather than replaying unbounded history. Snapshot creation and listener registration occur in one synchronous boundary. Slow sockets are disconnected at a 1 MiB output backlog and resynchronize. Public events never contain hidden text, credentials, origin internals, usage or prompts.

**Hide** removes a message locally and erases its stored body. **Stop AI & reveal origins** stops generation before publishing a limited origin disclosure. Platform reception does not prove that the author did not use an external AI. **Close session** stops receivers and AI. **New session** starts a fresh history and budget; AI still requires a manual start.

The browser UI bundles the OFL-licensed Noto Sans KR variable font for Korean messages. By default the server binds to `127.0.0.1`. For an OBS PC on the same private LAN, set `network.bindHost: 0.0.0.0` and `network.publicBaseUrl: http://APP_PC_LAN_IP:3210` in ignored `config.yaml`, then restart. The admin page and API remain loopback-only on the app PC. The CHZZK callback may use the exact configured HTTPS host for OAuth return; it does not expose admin routes. Copy the reader or overlay link from admin to OBS. Allow TCP 3210 between those two PCs in the host firewall if needed. Host and Origin checks, distinct role tokens, CSP and bounded inputs are enabled. Internet-facing access, HTTPS and proxy deployment are not supported in this release. Plain text rendering intentionally does not fetch arbitrary avatar/emote URLs. Custom platform badges and image emotes are not yet rendered.

## Storage and deletion

SQLite uses WAL and secure deletion. Default retention for chat and transcript logs is seven days, checked on startup and hourly. Hidden message bodies are erased immediately, including historical public replay. Expiration also removes orphan identities and origin-disclosure caches. The periodic interval can add up to one hour to nominal retention. Prompts, images and raw audio are not saved. The local administrator can inspect recent transcripts and download retained transcripts as JSONL; this export contains transcript ID, session ID, capture time and text. Protect and delete downloaded copies separately.

Use **Delete all local data** to stop receivers and AI, clear chat, transcripts, identity, history and usage, truncate the WAL and vacuum the active database. OAuth credentials and `.env` remain for reuse. Disconnect ChatGPT in admin before deleting its encrypted file, or remove `data/chatgpt.tokens` while the server is stopped if local credentials should also be erased. Delete both `data/chat.sqlite` and `data/demo.sqlite` (plus associated `-wal`/`-shm` files) while the server is stopped if you want to remove both modes. Remove any copies/backups you made separately. Filesystem/SSD forensic erasure is outside SQLite's guarantee. Platform deletion and upstream provider retention are separate processes.

## Troubleshooting and verification

- Startup failure: use Node 24, run setup, check independent tokens, strict YAML fields, a writable database and a free port.
- Receiver `config_required` / `auth_required`: check the relevant `.env` variables and app approval, then restart receivers. Do not substitute demo input for a failed live connection.
- YouTube `waiting_live`: verify the broadcast is live, chat is enabled and your credentials can access it. `quota_blocked` requires quota review; `ended` requires a new live video.
- CHZZK authorization cannot start in demo mode or before `chzzk.enabled: true` and both Client ID/Secret are set. Register an app with chat-read and user-info scopes and the exact `chzzk.redirectUri` callback; use HTTPS if the login browser is remote, then restart in live mode. `permission_blocked`: verify own-channel login and scopes, then reauthorize. Silence during an active subscription is normal.
- Capture: verify FFmpeg/device name, OBS camera startup, Program selection and masks. The preview is already masked. Capture stderr is not exposed because it may contain local paths.
- AI: check the selected visual mode, Groq transcript status, preview confirmation when video is requested, ChatGPT sign-in and model selection (or API-key credentials and input-token-count support), review settings and remaining budget. It must be restarted manually after a pause/error.

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

Linux browser tests may also require the system libraries listed by Playwright. The browser check writes only artificial-data screenshots and timing results into ignored `test-results/`. It uses a fixed test port 33219. See [VERIFICATION_REPORT.md](VERIFICATION_REPORT.md) for actual results and [TASKS.md](TASKS.md) for implementation and remaining acceptance status.

Code layout: `apps/server` hosts HTTP/WS, `apps/web` contains React views, `packages` contains shared contracts/storage/connectors/model logic, and `workers` isolates legacy clients and capture. Run `npm run build` after web edits; `npm run dev` watches server code only. FFmpeg, OBS, platform apps and model credentials are installed/configured independently.

### SOOP official chat

The official SOOP chat connector has an OAuth/browser SDK implementation, but successful live reception has not been established by the recorded checks. It uses SOOP's browser-only Chat SDK, so the signed-in administrator page must stay open during chat reception, and the SDK can connect only to the authenticated account's own live broadcast. The app checks that the connected broadcaster ID matches `soop.streamerId`. This integration receives chat only; it does not send messages.

1. Register the exact callback URL from `soop.redirectUri` in the SOOP developer console. The local default is `http://127.0.0.1:3210/oauth/soop/callback`; use the configured port. If login is done from a different machine, use a public HTTPS callback routed to the server.
2. Ensure the app approval includes the official Chat SDK and `broad_access_chatinfo` consent scope.
3. Set `SOOP_CLIENT_ID` and `SOOP_CLIENT_SECRET` in `.env`, set `soop.mode: official` and your account ID in `soop.streamerId` in `config.yaml`, then restart the server.
4. Sign in to `/admin`, select **Authorize SOOP**, approve the requested access, return to the admin page and select **Connect SOOP chat** while your own broadcast is live.

The access and refresh tokens are encrypted with `TOKEN_ENCRYPTION_KEY` and never sent to the browser except for the short-lived access token needed by the official SDK. The SOOP SDK itself is loaded from SOOP only when the administrator presses Connect.

Official references: [Chat SDK overview](https://developers.sooplive.com/docs/chatsdk/overview), [OAuth](https://developers.sooplive.com/docs/chatsdk/oauth), [connection and room info](https://developers.sooplive.com/docs/chatsdk/connection), [message retrieval](https://developers.sooplive.com/docs/chatsdk/get-message), [OpenAPI token exchange](https://developers.sooplive.com/docs/api/auth-token).

The separately consent-gated `experimental_library` adapter remains available for evaluation; it is not used by the official mode.
