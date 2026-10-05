# Mixed Chat Studio

A local broadcast chat reader and OBS overlay with automatically generated AI viewers. AI replies appear only in this app. Live mode uses **session memory, staged viewer consent and a reviewed OpenAI service profile with optional broadcast transcription**. An incomplete operating profile blocks collection and external AI processing.

Start with [live setup](LIVE_SETUP.md), [privacy implementation](docs/privacy-implementation.md), [AI flow](AI_FLOW.md) or the [documentation index](docs/README.md). Historical integration experiments are not current deployment approval.

## Quick start

Use Node from `mise.toml` and the [development command wrapper](docs/development.md):

```sh
sh run-command.sh npm ci
sh run-command.sh npm run setup
sh run-command.sh npm run build
sh run-command.sh npm run demo
```

Setup creates private credentials/configuration. Open the local address printed by the process; authenticate with the independent admin token. Demo uses artificial input and no paid model. Live mode uses `sh run-command.sh npm start` and requires the configuration below; installing the repository does not inherit another operator's approval or consent records.

## Automatic personas and viewer consent

Starting AI composes six synthetic personas from research-informed participation patterns, with no operator authoring requirement and no real-viewer profiling. The current session's cast disappears on restart. See the [persona specification](docs/ai-viewer-persona-system-spec.md).

UI controls and viewer commands are described in English here; the app retains localized labels. Exact commands are defined in [participation.ts](packages/participation.ts).

The first exact consent command starts guidance; it does not grant participation. Each delivered notice requires a new explicit command: age 14+ self-declaration, collection/use, broadcast/recording/publication, overseas processing, and third-party provision if applicable. Until every required stage succeeds, ordinary text is discarded before display, storage or AI processing. Account identity is scoped to platform, broadcaster and this broadcast session. Uncertain command order requires verification of the actual observed live command; old commands cannot be invented or approved on the viewer's behalf.

The withdrawal command invalidates the consent generation immediately, removes original and identifiable derived context, cancels queued/in-flight AI work and retracts tracked dependent replies. Late results cannot be published. Previously approved fixed-category anonymous topic/mood context may remain only until the session ends. The participation-status command lets an operator confirm the account's current participation state. Commands are not chat or AI input.

The **Privacy and participation** panel exposes staged guidance, explicit age self-declaration (not age verification), age blocking and separate external/VOD follow-up work. The official SOOP SDK automatically sends a fixed non-display/participation notice after unconsented ordinary chat, and sends the next consent-stage notice when ready. Account/global limits apply before each attempt; the authenticated broadcaster’s matching MESSAGE echo confirms delivery. Keep the connected admin tab open. Failed or unconfirmed delivery never grants consent. Legacy overlay-notice switches are informational, not viewer consent.

## Live configuration

Copy the structure in [config.example.yaml](config.example.yaml) into ignored `config.yaml`. Fill `privacy` with the real operator, contact, public policy/notice versions, actual API processing conditions, publication channels/periods and separately verified platform permissions. Empty defaults intentionally fail closed. YAML changes apply on restart, which clears the session and requires new consent. Do not copy synthetic test approvals into production.

The inference interface is the **Responses API**. Choose `ai.provider: chatgpt_subscription` for **Sign in with ChatGPT** and eligible ChatGPT plan usage without an API key, or `openai_api` for an independently billed API key. Keep `ai.gate.enabled: false`. Admin provides the **Sign in with ChatGPT** flow, saved accounts and model selection; use the same ChatGPT account you use for Codex, with this app's own official sign-in. It does not read Codex CLI credential files or run Codex CLI tools.

For subscription mode set `privacy.processing.provider: chatgpt_subscription`, `contract: ChatGPT subscription`, `endpoint: https://api.openai.com/v1` and the exact selected model slug. `OPENAI_API_KEY` and `OPENAI_MODEL` are not required. For API mode use `provider: openai_api`, `contract: API`, private `OPENAI_API_KEY` and matching `OPENAI_MODEL`. Both modes require reviewed actual processing conditions and retain consent/withdrawal guards. API region/retention claims must not be copied to a subscription profile without verification. Groq STT is opt-in; Jev and unofficial SOOP remain unavailable. The [official Sign in with ChatGPT integration](https://developers.openai.com/siwc/token-sharing-open-source) is subject to account eligibility and available models.

### YouTube: official OAuth, gRPC/REST and fixed notices

Set private `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`, enable `youtube`, and register the exact `youtube.redirectUri` (default `http://127.0.0.1:3210/oauth/youtube/callback`). Use **Connect YouTube account** in the admin connection details, select the broadcasting channel, then start receivers. Saved OAuth authorizes receipt and fixed notice sending without an API key. Existing API-key/access-token receipt still works, but automatic sending requires the app OAuth account. Configure the enabled receiver, broadcast/channel and required credentials. The receiver must also match a `privacy.approvals` entry for the actual broadcaster. Platform permission, viewer consent and API credentials are independent prerequisites. Automatic fixed introductions are sent once per confirmed recipient/session; each consent stage is sent and confirmed before accepting its next command. Only fixed server-generated notices are sent, never AI replies or copied viewer text. Long notices are split under a conservative 200-character cap and all parts must succeed; each attempt obeys the configured account/global limit. Unlike SOOP, the YouTube sender runs on the server and does not need the admin tab to remain open. See [YouTube setup](LIVE_SETUP.md#youtube-oauth-and-automatic-notices) and historical [contract research](research/platform-contracts.md).

### CHZZK: official OAuth and user session

Configure `chzzk.enabled`, the exact registered `redirectUri` and private client credentials. Authorize the broadcaster's own channel. Receiver startup additionally requires matching reviewed permissions. OAuth alone is not viewer consent or permission for external AI. The server automatically sends fixed participation introductions and stage notices using the official Chat API. Enable chat-message sending and user-info lookup permissions as well as chat receipt, then reauthorize the broadcaster account. Notices are split into messages of at most 100 characters; all parts must return a message ID before a fresh consent command can advance participation. No open administrator tab or manual delivery confirmation is required. See the [platform behavior matrix](docs/behavior-requirements.md#platform-execution-and-notice-delivery).

### SOOP: separate official and experimental paths

Live mode permits only the official browser SDK receiver after configured broadcaster approval. The experimental library remains a legacy fixture/evaluation component and is blocked by the live participation profile.

### SOOP official chat

Set `soop.mode: official`, `soop.streamerId`, registered callback and private `SOOP_CLIENT_ID` / `SOOP_CLIENT_SECRET`. After actual platform approval, authorize from admin and connect the SDK while the broadcaster's own stream is live. Keep the administrator page open for this browser SDK receiver. Its short-lived access token is supplied only when connecting; server token files are encrypted. Real account/SDK acceptance remains unverified by automated fixtures.

## OBS Program capture

The current live profile disables capture at the processing boundary: other on-screen chat cannot reliably be consent-filtered. The status card shows **Unused**. Neither `programConfirmed` nor a mask-confirmation button is required. Existing capture/mask utilities remain for synthetic tests and future separately reviewed input profiles; changing `capture` configuration does not enable them in live mode.

### OBS on a separate Linux PC: legacy RTMP input (disabled live)

Use the app's OBS Browser Source overlay for publication. Video capture remains blocked; broadcast audio can be enabled separately with `privacy.audioEnabled`. See [live setup](LIVE_SETUP.md) for LAN reader/overlay access.

## Groq speech and AI model data review

Set `privacy.audioEnabled: true` to enable the configured broadcast audio source, Groq transcription, recent speech as AI context and authenticated transcript export. Transcripts stay in session memory and are cleared on withdrawal, context invalidation, session reset/end and restart. Downloaded exports are operator-managed copies. See [live audio setup](LIVE_SETUP.md#broadcast-audio-and-transcription).

### Legacy Jev filter (disabled live)

Jev is a legacy/demo component, not an optional live provider. Enabling `ai.gate` makes live AI unavailable; there is no automatic provider fallback.

## Image model and data review

Live requests contain only the current permitted text, synthetic persona style and approved anonymous categories. Each API stage rechecks consent revision/profile and current messages immediately before sending. Requests use `store:false`, no provider tools, no persistent conversation/file upload and no response chaining. An image inspection request has no available live frames and cannot enable capture.

`store:false` does not mean every provider log is deleted; regional and retention options require actual account eligibility and matching notices. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data). In API-key mode, token counting and generation use the same configured endpoint with no global fallback. Sign in with ChatGPT uses its supported Responses API endpoint without that token-counting preflight. Optional draft review uses the same approved API provider. Manual approval can be enabled with `ai.manualApproval`.

Call/input/output limits and optional verified-price USD estimates still apply. Counters are session memory, so restart resets local limits; use provider account limits for cross-restart spending controls. Cost estimates are not billing guarantees.

## Reader, overlay and operations

The first admin section shows screen, real chat and transcript availability, AI use and emergency stop. Healthy sources show concise status; details stay collapsed. **Label AI-generated chat** stops generation and reveals origins after confirmation; it cannot be undone within that session. Viewer nicknames and synthetic persona names remain visible throughout; the publication notice must describe that display and the disclosure of origin labels.

Reader and overlay share permitted-message filtering and bounded reconnection snapshots. Reader holds up to 300 messages; the transparent OBS overlay shows the latest 12. Viewer nicknames and synthetic persona names are visible from the start; disclosure adds origin/AI labels without renaming anyone. **Hide** removes local text and invalidates dependent context. **Close session** stops processing and clears session information; **New session** starts without consent or automatic AI resumption. If broadcast-end detection is uncertain, use the explicit close control instead of leaving a session open.

Reader tokens are URL fragments, not admin credentials. Admin uses a local HttpOnly session cookie. Rotate reader tokens from admin and update OBS links. Default bind is loopback. For a private LAN OBS PC use `network.bindHost: 0.0.0.0` and `network.publicBaseUrl: http://APP_PC_LAN_IP:3210`; admin remains loopback-only. Restrict host firewall access to the OBS PC. Internet-facing/reverse-proxy deployment is not supported.

## Storage and deletion

Every app instance uses SQLite **in memory** for chat, identities, consent, persona state, summaries, budgets and pending work. Session close and restart discard these; `database` and `retentionDays` no longer select a live chat file or promise a seven-day log. Standalone legacy Store fixtures still test old storage behavior, not the app's live persistence policy. Chat export remains unavailable; reviewed audio permits authenticated session transcript export.

`privacy.rightsDatabase` is a separate owner-only file for exceptional rights requests and video inventory. It contains minimum account/session/video/request identifiers and handling status, not ordinary chat, consent lists or AI context. App data reset does not erase unresolved requests. After each external/video/copy action and result notice, remove unnecessary resolved request records from admin. Credentials remain separate.

**Migration:** the new runtime never opens old chat databases. Stop the old server and remove its old `data/chat.sqlite`, `data/demo.sqlite`, associated `-wal`/`-shm`, exports and backups under your control after identifying them; custom old `database` paths need the same review. The app does not silently delete arbitrary pre-existing files. Review OS dump/swap/backup behavior using the [development guide](docs/development.md). Memory reference removal is not a forensic-erasure guarantee. Platform VODs, provider records and third-party captures require separate handling.

## Troubleshooting and verification

Check the admin operating-profile issues first, then actual platform authorization, model/environment match and API budgets. Video stays disabled; audio is disabled unless explicitly enabled in the privacy profile. After profile changes, start a new consent flow. Temporary disconnection is not proof of broadcast end; manual-live consent is invalidated on reconnect because event freshness is uncertain.

```sh
sh run-command.sh npm run check
sh run-command.sh npm run test:browser
```

Browser tests use synthetic fixtures on ports 33219/33220 and ignored `test-results/`. See [verification](VERIFICATION_REPORT.md) and [remaining acceptance](TASKS.md). Code lives in `apps/server`, `apps/web`, `packages` and `workers`; build after web changes.
