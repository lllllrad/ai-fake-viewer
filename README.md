# Mixed Chat Studio

A local broadcast chat reader and OBS overlay with automatically generated AI viewers. AI replies appear only in this app. Live mode uses **durable broadcast sessions, single-step viewer consent and a reviewed OpenAI service profile with configured broadcast inputs**. An incomplete operating profile blocks collection and external AI processing.

Start with [live setup](docs/operations/setup.md), [privacy implementation](docs/specifications/participation.md), [AI flow](docs/development/ai-pipeline.md) or the [documentation index](docs/README.md). Historical integration experiments are not current deployment approval.

## Quick start

Use Node from `mise.toml` and the [development command wrapper](docs/development/guide.md):

```sh
sh run-command.sh npm ci
sh run-command.sh npm run setup
sh run-command.sh npm run build
sh run-command.sh npm run demo
```

Setup creates private credentials/configuration. Open the local address printed by the process; authenticate with the independent admin token. Demo uses artificial input and no paid model. Live mode uses `sh run-command.sh npm start` and requires the configuration below; installing the repository does not inherit another operator's approval or consent records.

## Automatic personas and viewer consent

Starting AI composes six synthetic personas from research-informed participation patterns, with no operator authoring requirement and no real-viewer profiling. The current broadcast's cast survives restart and is deleted at broadcast end. See the [persona specification](docs/specifications/personas.md).

UI controls and viewer commands are described in English here; the app retains localized labels. Exact commands are defined in [participation.ts](packages/application/participation/service.ts).

The first exact consent command starts guidance; it does not grant participation. Each delivered notice requires a new explicit command: age 14+ self-declaration, collection/use, broadcast/recording/publication, overseas processing, and third-party provision if applicable. Until every required stage succeeds, ordinary text is discarded before display, storage or AI processing. Account identity is scoped to platform, broadcaster and this broadcast session. Uncertain command order requires verification of the actual observed live command; old commands cannot be invented or approved on the viewer's behalf.

The withdrawal command invalidates the consent generation immediately, removes original and identifiable derived context, cancels queued/in-flight AI work and retracts tracked dependent replies. Late results cannot be published. Previously approved fixed-category anonymous topic/mood context may remain only until the session ends. The participation-status command lets an operator confirm the account's current participation state. Commands are not chat or AI input.

The **Privacy and participation** panel shows one-step consent, age self-declaration, withdrawal and separate provider/VOD follow-up. A single short notice links the full notice. Confirmed delivery covers recently observed viewers in that room, but consent is individual. Broadcast accounts are excluded. Failed delivery never grants consent. See [participation behavior](docs/specifications/participation.md).

## Live configuration

Copy the structure in [config.example.yaml](config.example.yaml) into ignored `config.yaml`. Fill `privacy` with the real operator, contact, public policy/notice versions, actual API processing conditions, publication channels/periods and separately verified platform permissions. Empty defaults intentionally fail closed. YAML changes apply on restart. End the previous broadcast before changing its consent profile. Do not copy synthetic test approvals into production.

The inference interface is the **Responses API**. Choose `ai.provider: chatgpt_subscription` for **Sign in with ChatGPT** and eligible ChatGPT plan usage without an API key, or `openai_api` for an independently billed API key. Keep `ai.gate.enabled: false`. Admin provides the **Sign in with ChatGPT** flow, saved accounts and model selection; use the same ChatGPT account you use for Codex, with this app's own official sign-in. It does not read Codex CLI credential files or run Codex CLI tools.

For subscription mode set `privacy.processing.provider: chatgpt_subscription`, `contract: ChatGPT subscription`, `endpoint: https://api.openai.com/v1` and the exact selected model slug. `OPENAI_API_KEY` and `OPENAI_MODEL` are not required. For API mode use `provider: openai_api`, `contract: API`, private `OPENAI_API_KEY` and matching `OPENAI_MODEL`. Both modes require reviewed actual processing conditions and retain consent/withdrawal guards. API region/retention claims must not be copied to a subscription profile without verification. Speech transcription is opt-in; Jev and unofficial SOOP remain unavailable. The [official Sign in with ChatGPT integration](https://developers.openai.com/siwc/token-sharing-open-source) is subject to account eligibility and available models.

### YouTube: official OAuth, gRPC/REST and fixed notices

Set private `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`, enable `youtube`, and register the exact `youtube.redirectUri` (default `http://127.0.0.1:3210/oauth/youtube/callback`). Use **Connect YouTube account** in the admin connection details, select the broadcasting channel, then start receivers. Saved OAuth authorizes receipt and fixed notice sending without an API key. Existing API-key/access-token receipt still works, but automatic sending requires the app OAuth account. Configure the enabled receiver, broadcast/channel and required credentials. The receiver must also match a `privacy.approvals` entry for the actual broadcaster. Platform permission, viewer consent and API credentials are independent prerequisites. Automatic fixed introductions are sent once per confirmed recipient/session; each consent stage is sent and confirmed before accepting its next command. Only fixed server-generated notices are sent, never AI replies or copied viewer text. Long notices are split under a conservative 200-character cap and all parts must succeed; each attempt obeys the configured account/global limit. Unlike SOOP, the YouTube sender runs on the server and does not need the admin tab to remain open. See [YouTube setup](docs/operations/setup.md#youtube-oauth-and-automatic-notices) and historical [contract research](docs/reference/platform-contracts.md).

### CHZZK: official OAuth and user session

Configure `chzzk.enabled`, the exact registered `redirectUri` and private client credentials. Authorize the broadcaster's own channel. Receiver startup additionally requires matching reviewed permissions. OAuth alone is not viewer consent or permission for external AI. The server automatically sends a short fixed participation notice using the official Chat API. Enable chat-message sending and user-info lookup permissions as well as chat receipt, then reauthorize the broadcaster account. A notice must fit one message of at most 100 characters and return a message ID before a fresh consent command enables participation. No open administrator tab or manual delivery confirmation is required. See the [platform behavior matrix](docs/specifications/behavior.md#platform-execution-and-notice-delivery).

### SOOP: separate official and experimental paths

Live mode permits only the official browser SDK receiver after configured broadcaster approval. The experimental library remains a legacy fixture/evaluation component and is blocked by the live participation profile.

### SOOP official chat

Set `soop.mode: official`, `soop.streamerId`, registered callback and private `SOOP_CLIENT_ID` / `SOOP_CLIENT_SECRET`. After actual platform approval, authorize from admin and connect the SDK while the broadcaster's own stream is live. Keep the administrator page open for this browser SDK receiver. Its short-lived access token is supplied only when connecting; server token files are encrypted. Real account/SDK acceptance remains unverified by automated fixtures.

## OBS Program capture

The current live profile disables capture at the processing boundary: other on-screen chat cannot reliably be consent-filtered. The status card shows **Unused**. Neither `programConfirmed` nor a mask-confirmation button is required. Existing capture/mask utilities remain for synthetic tests and future separately reviewed input profiles; changing `capture` configuration does not enable them in live mode.

### OBS on a separate Linux PC: legacy RTMP input (disabled live)

Use the app's OBS Browser Source overlay for publication. OBS Program capture and broadcast transcription run from their configured sources without separate privacy enable switches. See [live setup](docs/operations/setup.md) for LAN reader/overlay access.

## Speech and AI model data review

Configure `audio.url`, `audio.provider: openai` and `OPENAI_API_KEY` (or `audio.provider: groq` and `GROQ_API_KEY`) for broadcast transcription, recent speech as AI context and authenticated transcript export. Transcripts survive restart and are cleared on withdrawal, context invalidation or broadcast end/reset. Downloaded exports are operator-managed copies. See [live audio setup](docs/operations/setup.md#broadcast-audio-and-transcription).

### Legacy Jev filter (disabled live)

Jev is a legacy/demo component, not an optional live provider. Enabling `ai.gate` makes live AI unavailable; there is no automatic provider fallback.

## Image model and data review

Live requests contain current permitted text, configured recent broadcast inputs, synthetic persona style and approved anonymous categories. Each API stage rechecks consent revision/profile and current messages immediately before sending. Requests use `store:false`, no provider tools, no persistent conversation/file upload and no response chaining. Image inspection uses current frames from the configured capture source.

`store:false` does not mean every provider log is deleted; regional and retention options require actual account eligibility and matching notices. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data). In API-key mode, token counting and generation use the same configured endpoint with no global fallback. Sign in with ChatGPT uses its supported Responses API endpoint without that token-counting preflight. Optional draft review uses the same approved API provider. Manual approval can be enabled with `ai.manualApproval`.

Call/input/output limits and optional verified-price USD estimates still apply. Counters survive restart for the current broadcast; use provider account limits for cross-broadcast spending controls. Cost estimates are not billing guarantees.

## Reader, overlay and operations

The first admin section shows screen, real chat and transcript availability, AI use and emergency stop. Healthy sources show concise status; details stay collapsed. **Label AI-generated chat** stops generation and reveals origins after confirmation; it cannot be undone within that session. Viewer nicknames and synthetic persona names remain visible throughout; the publication notice must describe that display and the disclosure of origin labels.

Reader and overlay share permitted-message filtering and bounded reconnection snapshots. Reader holds up to 300 messages; the transparent OBS overlay shows the latest 12. Viewer nicknames and synthetic persona names are visible from the start; disclosure adds origin/AI labels without renaming anyone. **Hide** removes local text and invalidates dependent context. **Close session** stops processing and clears session information; **New session** starts without consent or automatic AI resumption. If broadcast-end detection is uncertain, use the explicit close control instead of leaving a session open.

Reader tokens are URL fragments, not admin credentials. Admin uses a local HttpOnly session cookie. Rotate reader tokens from admin and update OBS links. Default bind is loopback. For a private LAN OBS PC use `network.bindHost: 0.0.0.0` and `network.publicBaseUrl: http://APP_PC_LAN_IP:3210`; admin remains loopback-only. Restrict host firewall access to the OBS PC. Internet-facing/reverse-proxy deployment is not supported.

## Storage and deletion

Live broadcasts use the private SQLite file selected by `database`. Chat, consent, notice delivery, transcripts, personas, counters and the AI enabled setting survive server restarts. Broadcast end purges session data; a closed session remains closed after restart. Raw audio/video remain transient. Active broadcasts are not purged by `retentionDays`. Demo instances use memory. See [restart and end](docs/operations/setup.md#broadcast-restart-and-end).

`privacy.rightsDatabase` is a separate owner-only file for exceptional rights requests and video inventory. It contains minimum account/session/video/request identifiers and handling status, not ordinary chat, consent lists or AI context. App data reset does not erase unresolved requests. After each external/video/copy action and result notice, remove unnecessary resolved request records from admin. Credentials remain separate.

**Migration:** the default broadcast file is `data/broadcast.sqlite`, separate from historical chat/demo databases. An existing `database` setting explicitly selects its file; point it at the intended broadcast store before deployment. The old memory-only runtime cannot recover data it never saved. Do not delete unrelated old files automatically. Review exports, backups and OS dump/swap behavior using the [development guide](docs/development/guide.md). Local deletion does not delete platform VODs, provider records or third-party copies.

## Troubleshooting and verification

Check the admin operating-profile issues first, then actual platform authorization, model/environment match and API budgets. Video and audio follow `capture` and `audio` configuration; missing sources or credentials are shown as configuration problems. After profile changes, start a new consent flow. Temporary disconnection is not proof of broadcast end; manual-live consent is invalidated on reconnect because event freshness is uncertain.

```sh
sh run-command.sh npm run check
sh run-command.sh npm run test:browser
```

Browser tests use synthetic fixtures on ports 33219/33220 and ignored `test-results/`. See [verification](docs/specifications/behavior.md) and [remaining acceptance](docs/specifications/behavior.md). Code lives in `apps/server`, `apps/web`, `packages` and `workers`; build after web changes.
