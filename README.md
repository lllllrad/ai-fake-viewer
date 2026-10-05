# Mixed Chat Studio

A local broadcast chat reader and OBS overlay with automatically generated AI viewers. AI replies appear only in this app. Live mode uses **session memory, staged viewer consent and a reviewed OpenAI API text-only profile**. An incomplete operating profile blocks collection and external AI processing.

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

A first exact `!동의` starts guidance; it does not grant participation. Each delivered notice requires a new explicit command: age 14+ self-confirmation, collection/use, broadcast/recording/publication, overseas processing, and third-party provision if applicable. Until every required stage succeeds, ordinary text is discarded before display, storage or AI processing. Account identity is scoped to platform, broadcaster and this broadcast session. Uncertain command order requires verification of the actual observed live command; old commands cannot be invented or approved on the viewer's behalf.

`!철회` invalidates the consent generation immediately, removes original and identifiable derived context, cancels queued/in-flight AI work and retracts tracked dependent replies. Late results cannot be published. Previously approved fixed-category anonymous topic/mood context may remain only until the session ends. `!참여상태` lets an operator confirm the account's current participation state. Commands are not chat or AI input.

The **개인정보·참여 관리** panel exposes staged guidance, age blocking and separate external/VOD follow-up work. Fixed notices must be delivered through an actually approved platform route; the app has no native outbound sender. Manual delivery confirmation is not a claim that the app sent a message. Legacy overlay-notice switches are informational, not viewer consent.

## Live configuration

Copy the structure in [config.example.yaml](config.example.yaml) into ignored `config.yaml`. Fill `privacy` with the real operator, contact, public policy/notice versions, actual API processing conditions, publication channels/periods and separately verified platform permissions. Empty defaults intentionally fail closed. YAML changes apply on restart, which clears the session and requires new consent. Do not copy synthetic test approvals into production.

Set `ai.provider: openai_api`, `ai.gate.enabled: false`, `OPENAI_API_KEY` and `OPENAI_MODEL`. The environment model must exactly match `privacy.processing.model`. The pinned endpoint and account retention/region eligibility must match the public notice. ChatGPT subscription login, Groq STT, Jev and unofficial SOOP adapters are unavailable in this live profile.

### YouTube: official gRPC and REST

Configure the enabled receiver, broadcast/channel and required credentials. The receiver must also match a `privacy.approvals` entry for the actual broadcaster. Platform permission, viewer consent and API credentials are independent prerequisites. See source-specific fields in the example and historical [contract research](research/platform-contracts.md).

### CHZZK: official OAuth and user session

Configure `chzzk.enabled`, the exact registered `redirectUri` and private client credentials. Authorize the broadcaster's own channel. Receiver startup additionally requires matching reviewed permissions. OAuth alone is not viewer consent or permission for external AI.

### SOOP: separate official and experimental paths

Live mode permits only the official browser SDK receiver after configured broadcaster approval. The experimental library remains a legacy fixture/evaluation component and is blocked by the live participation profile.

### SOOP official chat

Set `soop.mode: official`, `soop.streamerId`, registered callback and private `SOOP_CLIENT_ID` / `SOOP_CLIENT_SECRET`. After actual platform approval, authorize from admin and connect the SDK while the broadcaster's own stream is live. Keep the administrator page open for this browser SDK receiver. Its short-lived access token is supplied only when connecting; server token files are encrypted. Real account/SDK acceptance remains unverified by automated fixtures.

## OBS Program capture

The current live profile disables capture at the processing boundary: other on-screen chat cannot reliably be consent-filtered. The status card shows **사용 안 함**. Neither `programConfirmed` nor a mask-confirmation button is required. Existing capture/mask utilities remain for synthetic tests and future separately reviewed input profiles; changing `capture` configuration does not enable them in live mode.

### OBS on a separate Linux PC: optional RTMP input

Use the app's OBS Browser Source overlay for publication. RTMP capture/audio utilities remain in the repository, but the live privacy profile does not start or upload their inputs. See [live setup](LIVE_SETUP.md) for LAN reader/overlay access.

## Groq speech and AI model data review

Audio capture, transcription storage and transcript export are blocked in live mode, including authenticated export requests. This avoids reintroducing unconsented chat spoken by a broadcaster. Setting an audio URL/key cannot bypass the block.

### Optional Jev filter before answer generation

Jev is a legacy/demo component, not an optional live provider. Enabling `ai.gate` makes live AI unavailable; there is no automatic provider fallback.

## Image model and data review

Live requests contain only the current permitted text, synthetic persona style and approved anonymous categories. Each API stage rechecks consent revision/profile and current messages immediately before sending. Requests use `store:false`, no provider tools, no persistent conversation/file upload and no response chaining. An image inspection request has no available live frames and cannot enable capture.

`store:false` does not mean every provider log is deleted; regional and retention options require actual account eligibility and matching notices. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data). Token counting and generation use the same configured endpoint with no global fallback. Optional draft review uses the same approved API provider. Manual approval can be enabled with `ai.manualApproval`.

Call/input/output limits and optional verified-price USD estimates still apply. Counters are session memory, so restart resets local limits; use provider account limits for cross-restart spending controls. Cost estimates are not billing guarantees.

## Reader, overlay and operations

The first admin section shows screen, real chat and transcript availability, AI use and emergency stop. Healthy sources show concise status; details stay collapsed. **AI 채팅에 ‘AI 생성’ 표시하기** stops generation and reveals origins after confirmation; it cannot be undone within that session. Original names may then appear, so this must be included in the publication notice.

Reader and overlay share permitted-message filtering and bounded reconnection snapshots. Reader holds up to 300 messages; the transparent OBS overlay shows the latest 12. Until disclosure they use session pseudonyms. **Hide** removes local text and invalidates dependent context. **Close session** stops processing and clears session information; **New session** starts without consent or automatic AI resumption. If broadcast-end detection is uncertain, use the explicit close control instead of leaving a session open.

Reader tokens are URL fragments, not admin credentials. Admin uses a local HttpOnly session cookie. Rotate reader tokens from admin and update OBS links. Default bind is loopback. For a private LAN OBS PC use `network.bindHost: 0.0.0.0` and `network.publicBaseUrl: http://APP_PC_LAN_IP:3210`; admin remains loopback-only. Restrict host firewall access to the OBS PC. Internet-facing/reverse-proxy deployment is not supported.

## Storage and deletion

Every app instance uses SQLite **in memory** for chat, identities, consent, persona state, summaries, budgets and pending work. Session close and restart discard these; `database` and `retentionDays` no longer select a live chat file or promise a seven-day log. Standalone legacy Store fixtures still test old storage behavior, not the app's live persistence policy. No chat/transcript export is available in live mode.

`privacy.rightsDatabase` is a separate owner-only file for exceptional rights requests and video inventory. It contains minimum account/session/video/request identifiers and handling status, not ordinary chat, consent lists or AI context. App data reset does not erase unresolved requests. After each external/video/copy action and result notice, remove unnecessary resolved request records from admin. Credentials remain separate.

**Migration:** the new runtime never opens old chat databases. Stop the old server and remove its old `data/chat.sqlite`, `data/demo.sqlite`, associated `-wal`/`-shm`, exports and backups under your control after identifying them; custom old `database` paths need the same review. The app does not silently delete arbitrary pre-existing files. Review OS dump/swap/backup behavior using the [development guide](docs/development.md). Memory reference removal is not a forensic-erasure guarantee. Platform VODs, provider records and third-party captures require separate handling.

## Troubleshooting and verification

Check the admin operating-profile issues first, then actual platform authorization, model/environment match and API budgets. Disabled image/audio inputs are expected. After profile changes, start a new consent flow. Temporary disconnection is not proof of broadcast end; manual-live consent is invalidated on reconnect because event freshness is uncertain.

```sh
sh run-command.sh npm run check
sh run-command.sh npm run test:browser
```

Browser tests use synthetic fixtures on ports 33219/33220 and ignored `test-results/`. See [verification](VERIFICATION_REPORT.md) and [remaining acceptance](TASKS.md). Code lives in `apps/server`, `apps/web`, `packages` and `workers`; build after web changes.
