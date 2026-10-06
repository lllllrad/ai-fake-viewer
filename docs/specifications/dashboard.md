# Operator workspace and conversation surfaces

This defines the replacement UI for the current live feature set. The rewrite is
in progress; the old single-page layout is not the design contract. Behavior is
owned by [requirements](behavior.md), [participation](participation.md) and
[personas](personas.md). Implementation boundaries are in [architecture](../development/architecture.md).

## Operator tasks and navigation

Use three clear destinations within the authenticated workspace:

- **Broadcast:** input health, AI enablement, conversation preview, recent speech,
  automatic cast, disclosure and broadcast end/new-session controls.
- **Connections:** selected platforms, account connection/reauthorization, input
  configuration status, AI account/model and usage/diagnostics.
- **Participation:** short guidance and individual consent status, withdrawal/age
  controls, operating profile, rights requests and optional video follow-up.

The broadcast screen is the landing page. The operator must not have to expand a
large technical settings panel to turn AI on/off or diagnose missing input.
Navigation must retain the single SOOP browser connection and its notice loop.
Reader and overlay remain separate routes with separate reader authorization.

## Broadcast screen

Keep one primary AI switch visible with broadcast identity/status. Represent
persisted intent separately from effective generation: enabled and waiting for
input after restart is not disabled. Stop remains usable when status is stale or
an input fails. Show a concise cause and a link to the relevant settings for a
blocked start. Do not display duplicated AI switches or start buttons.

Place three input summaries together: broadcast screen, platform chat and speech
transcription. Healthy inputs say only that they are healthy. Unconfigured and
selected-but-failing inputs are visibly different. Expanding details reveals
source/backend, recent timestamps and corrective action; raw transport codes do
not dominate normal operation. Configured screen/audio need no privacy toggle or
mask/preview acknowledgement.

The primary work area contains recent permitted conversation and current speech.
Show empty, waiting and failed states intentionally. Automatic AI viewers appear
as a read-only cast overview; the operator does not create, audition or approve
personas. Anonymous topic/mood context is secondary and can be cleared explicitly.

Broadcast end has a confirmation describing session deletion. Process restart is
not broadcast end. A closed broadcast offers an explicit new-broadcast action and
does not silently reopen when the page reloads or the process restarts.

## Controls and semantics

| Control                     | User-visible meaning                                                | Server responsibility                                                  |
| --------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| AI enable                   | Generate local AI chat when required inputs and the model are ready | Persist intent, reuse/create cast, apply evidence and budget checks    |
| AI disable / emergency stop | Cancel generation, review and pending publication                   | Persist disabled intent immediately; input collection is independent   |
| Start inputs                | Connect configured screen/audio and selected platform receivers     | Do not enable AI or grant consent                                      |
| Stop all inputs             | Stop collection and AI                                              | Cancel pending work before stopping adapters                           |
| Disclose AI messages        | Label AI-generated chat and disclose origins in reader/overlay      | Stop generation; irreversible for this broadcast; names stay unchanged |
| End broadcast               | Stop this broadcast and delete its session data                     | Atomically clear ordinary broadcast state and preserve closed marker   |
| New broadcast               | Start a distinct session with fresh participation                   | New identity, disabled AI intent, empty cast/consent/history           |
| Hide message                | Remove it from conversation and dependent model context             | Invalidate affected work and refresh every public surface              |
| Approve/reject candidate    | Publish or discard a waiting draft when manual review is configured | Revalidate evidence/consent/expiry on approval                         |

Use explicit localized action labels. A disclosure button must say what will be
shown; a status such as “already disclosed” is not an action label. Confirm only
destructive session/data actions and irreversible disclosure, not ordinary toggles.

## Connections and diagnostics

YouTube and CHZZK receive and send fixed notices on the server. SOOP uses its
supported browser SDK and requires the connected administrator tab to stay open.
Account connect/reauthorize actions remain visible when saved authorization exists.
Show the registered callback where it helps configuration, not on the dashboard.

Authentication uses **Sign in with ChatGPT** or an explicitly selected API key.
Inference uses the **Responses API**. Account/model selection and sign-out are
separate from the AI switch. No silent provider fallback is allowed.

For limits or denied requests, identify the actual API and operation: receive/read,
account lookup, fixed-notice send, transcription or AI generation/review. Distinguish
provider quota from application call/token/cost budgets. An observed read failure
does not prove that the send API separately exhausted its quota.

Diagnostics may expose sanitized timestamps, durations, stages, counts and reason
codes. They do not show raw provider responses, credentials or unconsented text.
Transcript download and media preview require administrator authorization.

## Participation and rights

Describe the normal flow once: one short delivered notice and one fresh individual
consent command. Sharing delivery with recently observed viewers is not shared
consent. The broadcast account is excluded. Display meaningful participant states
such as waiting for guidance, waiting for consent, active, withdrawn and blocked;
do not show obsolete multistage counters.

Unconsented ordinary text is absent. Age is self-declared, never verified by chat.
An operator can block a known under-14 account or verify a particular newly
observed unordered command; there is no administrator activation shortcut. Failed
or unconfirmed notice delivery cannot be marked successful by a button.

Keep the operating profile readable and separate from live controls. Show missing
configuration with a relevant action. Profile edits do not bypass real account
permissions or expand prior consent silently.

Rights requests survive broadcast end independently. Distinguish application
removal, provider action, public-video action and controlled-copy action. Require
an outcome or stated limitation before marking a request complete. The UI does
not claim to have performed external deletion by changing a status. Allow removal
of unnecessary resolved records and optional video inventory administration.

## Reader and OBS overlay

Use a shared conversation renderer with variants for the reader and transparent
OBS overlay. Actual viewer nicknames and synthetic persona names remain visible.
Origin labels are hidden until disclosure; disclosure does not rename participants.
The reader supports following new messages and jumping to the latest. The overlay
has a bounded recent-message window and no administrator controls or diagnostics.

Reader authentication uses the existing reader token/links. Never store tokens,
chat, transcripts or consent in localStorage, sessionStorage or IndexedDB. Reconnect
replaces the window with a current permitted snapshot; removed messages cannot
reappear through event replay. Broadcast end clears every conversation surface.

The conversation implementation lives in
[`features/conversation`](../../apps/web/src/features/conversation/ConversationPage.tsx).
A single subscription owns authorization, reconnects and cleanup; the pure state
reducer rejects foreign-session and replayed events. The shared public
[contract](../../packages/contracts/conversation.ts) validates inbound packets
before rendering. A disconnected surface clears its cached conversation until a
current snapshot arrives. The reader retains at most 300 messages; the overlay
keeps the latest 12 and clips older rows to keep the newest entry on the canvas.

## Presentation and accessibility

Use one visual system: typography, spacing, surfaces, control states and semantic
colors shared across screens. Prefer readable conversation space over nested
cards and repeated status badges. Keep normal states calm and errors actionable.
Avoid mixing untranslated operational prose into the Korean workspace; keep
product names and configuration identifiers exact where necessary.

Support narrow screens without horizontal scrolling, keyboard navigation, visible
focus, semantic labels and non-color status cues. Async actions show progress and
recoverable errors. One failed request must not freeze unrelated controls or cause
uncaught browser errors. Do not clear input forms merely because status polls.

## Data contracts and verification

A typed client owns request/error parsing. One workspace session owns status
refresh, freshness and authentication; screens consume projections rather than
making competing polling loops. Status older than ten seconds or failed status
reads cannot be presented as healthy. Stop stays available.

The [administrator transport](../../apps/web/src/lib/admin-client.ts) owns
same-origin credentials, request timeouts and HTTP error decoding. It distinguishes
HTTP 401 from network/service failures and supports validated response decoders.
The [status session](../../apps/web/src/features/workspace/status-session.ts)
owns one status request and schedules its next poll after completion. Explicit
refresh or sign-out invalidates older responses, including transports that ignore
cancellation. Service failures retain an explicitly stale view; authentication
failure erases it. The remaining legacy status projection and feature-specific
payloads still require conversion to shared validated DTOs during reconstruction.

Browser checks must cover navigation, controls, account actions, stale/error states,
manual candidate review, shared notice/individual consent, withdrawal and reconnect,
rights completion restrictions, reader/overlay synchronization and mobile layout.
Use synthetic inputs and mocked external adapters. Screenshots alone do not prove
server behavior, and fixture success does not certify real platform permissions.
