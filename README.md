# Mixed Chat Studio

A local, read-only broadcast chat aggregator with screen-aware AI characters. YouTube, CHZZK and optional experimental SOOP receivers feed one SQLite event stream. The reader and OBS overlay share that stream. AI messages are published only inside this application.

**Ready for a local demo. Live broadcasting requires your credentials, policy review, OBS setup and the live checks in [VERIFICATION_REPORT.md](VERIFICATION_REPORT.md).** SOOP's official SDK integration remains blocked pending its verified contract. No live platform or paid model call was used during development.

## Quick start

Install Node.js **24.x** (including npm), then run from this repository:

```sh
npm ci
npm run setup
npm run build
npm run demo
```

Open **http://127.0.0.1:3210/admin**. Copy `ADMIN_TOKEN` from the generated local `.env` into the sign-in form. The server never prints your tokens. Keep `.env` private.

1. The demo starts artificial platform chat and artificial moving image frames. It makes no platform or model requests.
2. Inspect the preview and select **Confirm masked Program**. In demo mode this confirms a clearly labeled artificial input.
3. Select **Start AI**. The mock model proposes a short, explicitly marked demo response.
4. Select **Publish locally** in the review panel. It appears in the shared conversation.
5. Select **Reader & OBS links**. Open the reader link and copy the overlay link to an OBS Browser Source.
6. **Stop AI now** cancels pending generation and approval without stopping chat receivers.
7. Press **Ctrl+C** in the terminal to stop the whole application.

Demo data uses `data/demo.sqlite`; live mode uses `database` from `config.yaml`. Starting either mode never automatically starts AI. Use **New session** after a closed session. Start only one server process per database and port.

## Live configuration

Edit the generated `config.yaml` and `.env`, then restart with:

```sh
npm start
```

Configuration is validated with a strict schema. Unknown keys, out-of-bounds masks and incomplete monetary budgets fail at startup. The provided `.local` handoff did not include its proposed YAML or environment example, so [config.example.yaml](config.example.yaml) defines the implemented schema. No config fields contain API secrets. Windows PowerShell supports the same npm commands.

### YouTube: official gRPC and REST

Set `YOUTUBE_API_KEY` to a key for a project with YouTube Data API access, or set `YOUTUBE_ACCESS_TOKEN` for an appropriately authorized account. OAuth access tokens are operator supplied; this version does not implement Google OAuth login or automatic refresh.

```yaml
youtube:
  enabled: true
  video: "https://www.youtube.com/watch?v=YOUR_VIDEO_ID"
  transport: grpc
  restFallback: true
```

Use an actual 11-character video ID or supported YouTube watch/live/short-link URL. The server extracts the ID and calls fixed Google hosts; it never fetches the submitted URL directly. The gRPC `StreamList` connection is preferred. Repeated unavailable/unimplemented transport failures can fall back to official REST. REST observes `pollingIntervalMillis`. Set `transport: rest` to test REST explicitly.

The complete official protocol sample, original hash, Apache license and one necessary import correction are in [vendor/youtube](vendor/youtube/NOTICE.md). gRPC and REST have separate checkpoints. Message ID deduplication protects reconnects and fallback overlap; missing messages during outages cannot be ruled out. Only ordinary text events are displayed. Native moderation, donation, sticker and membership events are not implemented.

### CHZZK: official OAuth and user session

Register an application with **chat message read** and **user information read** permissions. Register the exact callback `http://127.0.0.1:3210/oauth/chzzk/callback` (or the corresponding configured port). Set `CHZZK_CLIENT_ID` and `CHZZK_CLIENT_SECRET` in `.env`, enable `chzzk.enabled`, and restart.

Select **Authorize CHZZK**, sign in as the broadcaster and approve the requested read permissions. After the callback, return to admin and select **Start receivers**. Only the authenticated user's own channel is subscribed. Status becomes `subscribed` after the server confirms the CHAT subscription, not merely when the socket opens.

Socket.IO client **2.0.3** runs in a separate process. Compatible Engine.IO 3 and parser 3 security updates are pinned via npm overrides and tested with a local socket fixture. Three moderate dependency advisories remain; see [research/dependencies.md](research/dependencies.md). Real CHZZK compatibility still requires an approved app and live test.

Tokens rotate through a single-flight refresh and are atomically saved in AES-256-GCM encrypted `data/chzzk.tokens`. Keep `TOKEN_ENCRYPTION_KEY` in `.env`; losing it requires reauthorization. After revocation, select **Authorize CHZZK** again. A 401 marks authentication as requiring operator attention; restarting receivers can refresh an expired stored token. To remove local CHZZK credentials, stop the server and remove `data/chzzk.tokens`, or use the authenticated `POST /api/admin/chzzk/forget` endpoint. Revoke the app in CHZZK itself to remove upstream authorization.

### SOOP: separate official and experimental paths

`soop.mode: official` reports `official_spec_pending`. No SDK methods or endpoints were invented. Provide verified official SDK documentation, distribution and applicable approvals before that path can be completed.

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
  enabled: true
  ffmpeg: ffmpeg
  backend: dshow
  device: OBS Virtual Camera
  intervalMs: 3000
  programConfirmed: true
  masks:
    - x: 0.70
      y: 0.0
      width: 0.30
      height: 1.0
```

The example masks the rightmost 30% of the image. Change it for your actual composition. Coordinates are normalized to the entire original image. Include **every** chat overlay (including this application's overlay), credentials and private regions in every scene. Masks are applied before resizing, administrator preview and model upload. Masked images are held only in memory: up to 10 frames / 30 seconds; each request uses at most 3 fresh frames. Images are resized to fit 1280 × 1280.

Open admin, inspect the masked preview and select **Confirm masked Program**. Non-demo AI is blocked without a configured mask and runtime confirmation. This prevents accidental unmasked defaults, but does not automatically locate chat. You must check the rectangles. Layout/scene changes at the same resolution are not automatically detected: stop AI, verify masks and re-confirm before resuming. Source resolution changes invalidate confirmation. Ten seconds without a fresh frame pauses AI and requires a manual start. Repeated identical fresh frames are healthy. A device that continuously outputs a frozen picture cannot reliably be detected.

Capture failures are isolated and retried up to five times with backoff. Confirmation is cleared on failure. For Linux select `backend: v4l2` and a device such as `/dev/video2`; for macOS select `avfoundation` and the correct camera index. These physical-device paths have not been live-tested here.

## Image model and data review

The default `ai.provider: chatgpt_subscription` uses OpenAI's [Sign in with ChatGPT for local open-source apps](https://developers.openai.com/siwc/token-sharing-open-source). In live mode, open the admin page, select **Continue with ChatGPT**, authorize this app in your system browser, return to admin, select **Load available models**, and choose an image-capable model from your account's catalog. The app stores the issued account/client mapping and rotating tokens in encrypted, owner-only `data/chatgpt.tokens`. It never reads the Codex CLI or browser's existing credentials. Multiple saved accounts can be selected or reauthorized. **Disconnect active account** attempts remote session revocation and clears local tokens; if revocation cannot be confirmed, remove access in [ChatGPT Settings → Usage](https://chatgpt.com/settings/usage).

This flow requires a ChatGPT plan and feature availability for your account; authorization and live inference still need your interaction. It is distinct from ordinary API-key billing. ChatGPT subscription requests use account-specific model slugs, `store: false`, `stream: true`, and accept output only after the completion event. The app enforces a persisted call limit and local request/output bounds; exact pre-call input token counting and USD budgets are unavailable for this provider. `ai.maxInputTokens` and `ai.maxOutputTokens` reject a completed response that reports usage above those values but cannot prevent that call. Review usage and app limits in ChatGPT Settings. The selected model must support images and structured output; this remains unverified until a real authorized call succeeds.

For an independently billed API key, set `ai.provider: openai_api`, `OPENAI_API_KEY` and `OPENAI_MODEL` in `.env`. Choose a model available to your API account that supports image input, Responses structured output and input token counting. The API-key path uses pre-call token counting and can use `ai.maxUsd` when verified prices are configured. Both providers require `policy.providerReviewed: true` after reviewing their handling of uploaded images and chat. `store: false` does not mean all provider logs are disabled.
Platform text is excluded from model context by default. Enabling any of `youtubeAiContextApproved`, `chzzkAiContextApproved` or `soopAiContextApproved` requires a nonempty `policy.reviewReference` pointing to your substantive review record. These settings record a decision; they do not grant platform permission. Image masks remain required, including when YouTube text processing is disabled. Do not enable a data path the applicable terms do not permit. R03 is only partially available with the conservative defaults.

The model receives masked JPEGs, bounded recent permitted text, session pseudonyms and one character's style. It has no tools, private account IDs or access to the origin table. Output is validated for schema, length, reply/evidence references and several obvious unsafe patterns. This is not a complete moderation or factuality guarantee. Keep `ai.manualApproval: true` for initial rehearsals. Pending approvals expire after 30 seconds and are invalidated by stopping, hiding evidence or stale input.

Calls are limited per session, persisted across restarts, with one generation at a time, at least 20 seconds between attempts and messages, at least 45 seconds per character, and at most three messages per minute. Busy human chat suppresses generation. Synthetic message arrival alone does not trigger another response. Unchanged frames can skip inference.

`ai.maxCalls` always applies. For the ChatGPT subscription provider, monetary estimates are unavailable and `ai.maxUsd` must stay null. On the API-key provider, without verified prices the UI displays **Cost estimate unavailable**. To enable `ai.maxUsd`, provide both per-million token prices and `priceCheckedAt`. Maximum input/output cost is reserved before requests; successful usage is settled afterward. Failed requests retain the conservative reservation. For the API-key provider, input token counting must succeed and fit the configured limit before paid generation begins. Prices and provider charges remain your responsibility; this is an estimate, not a billing guarantee.

## Reader, overlay and operations

Reader and overlay tokens are placed in URL fragments and sent in the first WebSocket authentication message. They do not grant administrator access. Treat OBS links as private. **Rotate reader token** immediately disconnects readers and atomically updates `.env`; fetch new links and update OBS. If environment variables are supplied externally, update `READER_TOKEN` there too before restarting. Admin credentials stay only in the current page's memory; reload to sign out. To rotate admin credentials, stop the server, replace `ADMIN_TOKEN` with a fresh random value of at least 32 characters, and restart.

Use the exact overlay link shown in admin for an OBS **Browser Source**, typically **600 × 900**. The page has a transparent background and shows the latest 12 messages. The reader keeps a 300-message window, supports following and jumping to new messages, and has no message input. The source's refresh/visibility settings do not control receivers or AI. The required mixed-chat disclosure and platform attribution stay visible; synthetic messages are labeled **Experiment**.

Both pages order by the original committed message sequence. Updates replace the same item in place. Reconnection intentionally refreshes the current 300-message snapshot rather than replaying unbounded history. Snapshot creation and listener registration occur in one synchronous boundary. Slow sockets are disconnected at a 1 MiB output backlog and resynchronize. Public events never contain hidden text, credentials, origin internals, usage or prompts.

**Hide** removes a message locally and erases its stored body. **Stop AI & reveal origins** stops generation before publishing a limited origin disclosure. Platform reception does not prove that the author did not use an external AI. **Close session** stops receivers and AI. **New session** starts a fresh history and budget; AI still requires a manual start.

The server binds only to `127.0.0.1`. Host and Origin checks, distinct role tokens, CSP and bounded inputs are enabled. Remote access/HTTPS/proxy deployment is not supported in this release. Plain text rendering intentionally does not fetch arbitrary avatar/emote URLs. Custom platform badges and image emotes are not yet rendered.

## Storage and deletion

SQLite uses WAL and secure deletion. Default retention is seven days, checked on startup and hourly. Hidden message bodies are erased immediately, including historical public replay. Expiration also removes orphan identities and origin-disclosure caches. The periodic interval can add up to one hour to nominal retention. Prompts and images are not saved; no export/backup feature is provided.

Use **Delete all local data** to stop receivers and AI, clear chat, identity, history and usage, truncate the WAL and vacuum the active database. OAuth credentials and `.env` remain for reuse. Disconnect ChatGPT in admin before deleting its encrypted file, or remove `data/chatgpt.tokens` while the server is stopped if local credentials should also be erased. Delete both `data/chat.sqlite` and `data/demo.sqlite` (plus associated `-wal`/`-shm` files) while the server is stopped if you want to remove both modes. Remove any copies/backups you made separately. Filesystem/SSD forensic erasure is outside SQLite's guarantee. Platform deletion and upstream provider retention are separate processes.

## Troubleshooting and verification

- Startup failure: use Node 24, run setup, check independent tokens, strict YAML fields, a writable database and a free port.
- Receiver `config_required` / `auth_required`: check the relevant `.env` variables and app approval, then restart receivers. Do not substitute demo input for a failed live connection.
- YouTube `waiting_live`: verify the broadcast is live, chat is enabled and your credentials can access it. `quota_blocked` requires quota review; `ended` requires a new live video.
- CHZZK `permission_blocked`: verify own-channel login and read scopes, then reauthorize. Silence during an active subscription is normal.
- Capture: verify FFmpeg/device name, OBS camera startup, Program selection and masks. The preview is already masked. Capture stderr is not exposed because it may contain local paths.
- AI: check preview confirmation, frame freshness, ChatGPT sign-in and model selection (or API-key credentials and input-token-count support), review settings and remaining budget. It must be restarted manually after a pause/error.

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

Linux browser tests may also require the system libraries listed by Playwright. The browser check writes only artificial-data screenshots and timing results into ignored `test-results/`. It uses a fixed test port 33219. See [VERIFICATION_REPORT.md](VERIFICATION_REPORT.md) for actual results and [TASKS.md](TASKS.md) for T01–T12 status.

Code layout: `apps/server` hosts HTTP/WS, `apps/web` contains React views, `packages` contains shared contracts/storage/connectors/model logic, and `workers` isolates legacy clients and capture. Run `npm run build` after web edits; `npm run dev` watches server code only. FFmpeg, OBS, platform apps and model credentials are installed/configured independently.
