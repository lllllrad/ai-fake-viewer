# Operator workspace and conversation surfaces

This defines the replacement UI for the current live feature set. The broadcast,
connections and participation destinations are implemented. The connection screen uses separate platform, media, AI account and reader-link
components. Participation uses separate participant, operating-profile, rights-request
and video-inventory views. The SOOP browser connection uses a dedicated controller, while server-side input
and account lifetimes belong to their infrastructure adapters. Behavior is
owned by [requirements](behavior.md), [participation](participation.md) and
[personas](personas.md). Implementation boundaries are in [architecture](../development/architecture.md).

## Operator tasks and navigation

Use five task destinations within the authenticated workspace:

- **Live:** conversation moderation, AI enablement/stop, concise input health,
  source preview, tabbed speech/cast/anonymous context, disclosure and session end.
- **Broadcast preparation:** persistent tabs for chat platforms, screen/audio,
  AI accounts/models and reader/OBS links. These are independent setup tasks,
  not a mandatory wizard. Each source keeps its diagnostics with its controls.
- **Participants:** searchable current participation states and a separate
  operating-profile/notice-settings tab.
- **Records and rights:** separate rights-request and video-inventory tabs for
  follow-up work that can outlive the broadcast.
- **AI viewer tests:** isolated text/microphone conversation, persona inspection
  and separately opened execution history. See [interactive tests](../development/experiments.md#interactive-viewer-tests).

The live workspace is the landing page. The conversation is the main work area;
source preview and context occupy a secondary column. The AI switch and emergency
stop are available above it. Source status expands inline, with links that open
and focus the corresponding preparation panel. Routine settings do not surround
the conversation. Destructive data reset is under explicit data management.

Desktop uses a left navigation rail. Narrow layouts use a labeled top navigation
and stack work areas. A compact emergency stop remains in the sticky mobile
navigation across all destinations. The UI uses shared Bootstrap buttons/forms, Radix tabs and
native modal dialogs for disclosure and destructive session/data actions. The
native dialog preserves focus and cancellation without injecting styles blocked
by the existing Content Security Policy. Design tokens and component conventions
are owned by [DESIGN.md](../../DESIGN.md).

Navigation retains the single SOOP browser connection and its notice loop.
Reader and overlay remain separate routes with separate reader authorization.

The [login screen](../../apps/web/src/features/workspace/AdminLogin.tsx) owns its
transient token and cancellable login action. Repeated submissions send one request;
input and submit controls show pending state. Failed login keeps the form usable,
and leaving it cancels its pending action. Logout also suppresses duplicate requests,
shows progress and clears the workspace after success. Returning to login starts
with an empty token field; credentials are never persisted in browser storage.

Workspace navigation uses fragment links (`#broadcast`, `#connections`,
`#participation`, `#records`, `#experiments`). Existing input-detail links select their owning screen. Broadcast and participation screens
retain their component lifetime while hidden: navigating must not reconnect SOOP
or discard unfinished participation forms. The test screen unmounts when leaving
to release the microphone; the isolated server session continues until ended. The broadcast conversation, transcripts,
cast and pending draft review are owned by
[BroadcastConversation](../../apps/web/src/features/workspace/BroadcastConversation.tsx).

Navigation waits for the authenticated workspace to exist before scrolling to the
selected destination and focusing its heading. Tab-trigger interaction retains
focus within the tab strip so consecutive arrow keys continue switching tabs. Direct detail links survive reload,
and changing between details on the same screen still updates focus. Headings use
programmatic focus without adding extra stops to normal Tab navigation. Routine
status refreshes preserve the operator's current focus.

## Broadcast screen

Keep one primary AI switch visible with broadcast identity/status. Represent
persisted intent separately from effective generation: enabled and waiting for
input after restart is not disabled. Stop remains usable when status is stale or
an input fails. Show a concise cause and a link to the relevant settings for a
blocked start. Do not display duplicated AI switches or start buttons.
Broadcast commands use the shared cancellable action owner: repeated clicks for
the same pending command issue one request, while emergency stop can run during
another command. Finishing stop does not clear the remaining command's pending
state. Signing out or losing authentication cancels pending broadcast actions.

Place three compact expandable input summaries together: broadcast screen, platform chat and speech
transcription. Healthy inputs say only that they are healthy. Unconfigured and
selected-but-failing inputs are visibly different. Expanding details reveals
source/backend, recent timestamps and corrective action; raw transport codes do
not dominate normal operation. Configured screen/audio need no privacy toggle or
mask/preview acknowledgement.

The [preview session](../../apps/web/src/features/workspace/preview-session.ts)
owns one image request and schedules the next poll after completion. Routine
status/frame updates do not restart that request. Stale status, an expired frame,
broadcast close/replacement and sign-out disable the preview, cancel its request
and release its image URL. Retired responses cannot allocate or restore an image;
a current request failure clears the old image and remains retryable. The broadcast
and connection views share this one preview lifetime.

The primary work area contains recent permitted conversation. Preview and tabbed
speech, cast and anonymous topic/mood context sit beside it.
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
Disclosure and session end use a focused dialog with explicit consequences and
cancel as the initial focus. Escape cancels; closing restores trigger focus.

## Connections and diagnostics

YouTube and CHZZK receive and send fixed notices on the server. SOOP uses its
supported browser SDK and requires the connected administrator tab to stay open.
Account connect/reauthorize actions remain visible when saved authorization exists.
Show the registered callback where it helps configuration, not on the dashboard.

[ConnectionsPage](../../apps/web/src/features/connections/ConnectionsPage.tsx)
composes independent platform, media, AI-account and reader-link views. Each view
owns its command progress and error presentation; duplicate commands in that view
are suppressed and requests are aborted on unmount. Authorization links, reader
links and model choices use a shared validated [connection contract](../../packages/contracts/connections.ts).
The screen hides routine transport details behind expandable settings and never
adds a second AI enable control.

The [SOOP controller](../../apps/web/src/features/soop/controller.ts) owns SDK
connection generations, verified-room readiness, ordered forwarding and one
fixed-notice poll at a time. Its [browser adapter](../../apps/web/src/features/soop/browser-adapter.ts)
owns SDK loading and HTTP payload validation; the view only presents controls.
Both SDK readiness and the configured broadcaster match are required before
forwarding. Disconnect invalidates old callbacks immediately. Server input-stop commands and
broadcast end disconnect the SDK; a new broadcast invalidates the old connection. A notice reserved
for an old connection cannot be sent through its replacement. Forwarding retains
at most 128 queued message bodies; overload and failures show fixed diagnostic
messages without raw SDK payloads. Connection setup times out after 30 seconds.
Only the server-observed notice echo confirms delivery.

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

### Platform preparation before receiving

On Broadcast preparation, idle platform cards show readiness from configured
credentials, account authentication, broadcast targets and the operating profile's
receive approvals, independently of whether the previous broadcast has ended.
They distinguish ready to connect, missing settings, missing account connection,
missing broadcast target, missing receive approval and disabled use. Known
connection errors and active transport state remain visible; stale status never
claims readiness. Starting a session or chat reception attempts the connection.
Prepared configuration is not proof of valid remote credentials, matching remote
account permissions or an active broadcast; those are checked on connection.
SOOP additionally requires the administrator browser tab to remain open.

## Participation and rights

Describe the normal flow once: one short delivered notice and one fresh individual
consent command. Sharing delivery with recently observed viewers is not shared
consent. The broadcast account is admitted automatically without guidance or a consent command; automatic notice echoes are excluded. Display meaningful participant states
such as waiting for guidance, waiting for consent, active, withdrawn and blocked;
do not show obsolete multistage counters.

Unconsented ordinary text is absent. Age is self-declared, never verified by chat.
An operator can block a known under-14 account or verify a particular newly
observed unordered command; there is no administrator activation shortcut. Failed
or unconfirmed notice delivery cannot be marked successful by a button.

Keep the operating profile readable and separate from live controls. Show missing
configuration with a relevant action. Search and status filters narrow current
participants without altering their participation state. Rights and video forms
remain mounted across navigation, preserving unfinished edits. Profile edits do not bypass real account
permissions or expand prior consent silently.

Rights requests survive broadcast end independently. Distinguish application
removal, provider action, public-video action and controlled-copy action. Require
an outcome or stated limitation before marking a request complete. The UI does
not claim to have performed external deletion by changing a status. Allow removal
of unnecessary resolved records and optional video inventory administration.

The [participation page](../../apps/web/src/features/participation/ParticipationPage.tsx)
owns one cancellable query lifetime for its
[validated status contract](../../packages/contracts/participation.ts). It reuses
the workspace request/session machinery rather than starting interval requests
that can overlap. Authentication failure clears its data; service or malformed
responses retain a visibly stale view with mutations disabled. Participant and
rights-record commands have independent pending/error state. Navigation and
polling preserve unfinished edits; untouched rights records follow current server
values. Resolved-record deletion requires confirmation. Shared
[admin actions](../../apps/web/src/lib/use-admin-actions.ts) suppress duplicate
commands and abort requests when their owning component is removed.

## Reader and OBS overlay

Use a shared conversation renderer with variants for the reader and transparent
OBS overlay. Actual viewer nicknames and synthetic persona names remain visible.
Origin labels are hidden until disclosure; disclosure does not rename participants.
The operator explanation must distinguish adding origin labels from showing names,
which are already visible before disclosure.
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
current snapshot arrives. The server-side
[projection service](../../packages/application/conversation/projection-service.ts)
rechecks consent/visibility when delivering a cached message event, reads the
snapshot window in one joined query, and limits disclosed identity mappings to
the current permitted window. Closed and foreign-broadcast cached events cannot
restore old message text. The reader retains at most 300 messages; the overlay
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
failure erases it. The [status contract](../../packages/contracts/admin-status.ts) validates both
server output and client input. Required missing or malformed fields make status
unavailable; the UI does not substitute healthy defaults. Unknown fields are
stripped at every object boundary. The [status projection](../../packages/application/status/projection.ts)
clears closed-broadcast messages, cast, transcripts, summary and pending drafts
without mutating its input. Transcript history is ordered newest first. Connection payloads use the shared [connection contracts](../../packages/contracts/connections.ts);
participation and rights views use their [participation](../../packages/contracts/participation.ts)
and [rights](../../packages/contracts/rights.ts) contracts. Successful commands whose
bodies are not consumed refresh the authoritative status rather than inventing local state.

Browser checks must cover navigation, controls, account actions, stale/error states,
manual candidate review, shared notice/individual consent, withdrawal and reconnect,
rights completion restrictions, reader/overlay synchronization and mobile layout.
Use synthetic inputs and mocked external adapters. Screenshots alone do not prove
server behavior, and fixture success does not certify real platform permissions.

## Validation scope and limitations

Browser fixtures exercise administrator login, deep-link focus, pending commands,
emergency stop, draft review, moderation, disclosure, close/new-session, setup tabs,
AI model selection, reader/overlay access and participation/rights workflows on
isolated synthetic servers. `UI_REVIEW=1 npm run test:browser` additionally captures
desktop/mobile views and axe accessibility results under ignored
`.impeccable/review/`. These are synthetic application checks, not acceptance of
real provider accounts, live platform permissions, speech accuracy or OBS operation.
The shipped theme is light for the workspace/reader and dark on a transparent
OBS canvas; theme switching is not implemented.
