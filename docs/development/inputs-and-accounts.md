# Inputs and accounts

This guide owns external transport, media worker and account implementation
boundaries. [Architecture](architecture.md) owns dependency rules and lifecycle;
[participation and storage](participation-and-storage.md) owns admission and
consent. For actual connection setup, use the [operator guide](../operations/setup.md).

## Platform composition

The [platform supervisor](../../packages/infrastructure/inputs/platform-supervisor.ts)
wires receiver adapters, notice delivery sessions and the application task owner.
Start checks current platform selection and participation availability rather than
using an old status string as permission. Unselected platforms remain disabled;
a formerly blocked receiver can start once currently permitted. Repeated input
start preserves an official SOOP connection that is connecting or subscribed,
so enabling AI cannot reset its receipt/admission gate to waiting for a browser.
Closed broadcasts cannot restart this composition.

The old root supervisor module only re-exports the infrastructure constructor.
[Synthetic chat](../../packages/infrastructure/reference/demo-chat.ts) and the
[historical SOOP library loop](../../packages/infrastructure/reference/soop-receiver.ts)
are separate reference implementations. The library loop is loaded only when
explicitly selected without live participation; live SOOP continues to use its
official browser bridge. No new operating mode is introduced.

## CHZZK reception

The [CHZZK connection adapter](../../packages/infrastructure/platforms/chzzk-connection.ts)
owns session authorization, worker subscription, reconnect backoff and cleanup.
The supervisor supplies account, admission, notice and status ports; the adapter
does not access broadcast storage. Each connection retires its callbacks on
abort, worker exit or error, removes listeners and clears its subscription timeout.
Late subscription failures cannot change a replacement connection's state or
admit messages. Repeated connected events issue only one subscription per worker.
Broadcaster messages and messages outside the subscribed room remain excluded.

## Fixed participation notices

The [notice delivery session](../../packages/application/participation/notice-delivery-session.ts)
owns the common YouTube/CHZZK one-second polling lifecycle. It permits only one
outstanding tick, cancels polling and resets the sender immediately on abort,
and drains the request before shutdown finishes. Queued callbacks and late
failures cannot restart sending. Unexpected exceptions retire this delivery
session and expose unconfirmed delivery; reconnect the platform to resume.
Expected provider failures retain their existing sender-specific backoff policy.
The [fixed notice delivery owner](../../packages/application/participation/fixed-notice-delivery.ts)
selects eligible waiting viewers, reserves attempts, binds one outstanding notice
to the broadcast/profile/consent revision, and verifies delivery receipts. Time
and identifier generation are injected by composition. Sending and receipt use
the same eligibility check; a target already covered by another confirmed notice
cannot turn a late receipt into delivery for newer viewers. Invalidated jobs
release the queue without waiting for their expiry. Reset discards receipts but
does not refund the process-level attempt budget. Only exact authenticated
broadcaster echoes confirm SOOP notices; individual consent remains separate.
The [YouTube notice transport](../../packages/infrastructure/platforms/youtube-notice-transport.ts)
owns token access, the fixed insertion request and typed receipt/error decoding.
It rechecks account and application eligibility after token refresh and after
reading response bodies. Reconnecting receipt input pauses new writes but does
not invalidate a successful insertion with the exact chat, broadcaster and text.
Invalidated requests cannot overwrite current status with late provider errors.
Failures identify `liveChatMessages.insert` as a send operation and preserve its
existing retry delay; provider bodies never become diagnostics.
The [CHZZK notice transport](../../packages/infrastructure/platforms/chzzk-notice-transport.ts)
owns account identity lookup and insertion with typed identity/receipt validation.
It binds requests to refreshed credentials and checks cancellation and application
eligibility after each response. Its result retains a validity check for the
application continuation, so replaced credentials or reset targets cannot apply
an obsolete success or error. Identity lookup and insertion keep separate API
failure attribution and their existing retry delays. No provider body is exposed
as an operator diagnostic. The [single-notice formatter](../../packages/domain/participation/notice-text.ts)
normalizes whitespace and rejects oversized complete notices. Senders hold one
message rather than a fragment array or progress index; the visible prefix has no
multipart counter. Existing conservative body budgets remain 170 UTF-16 code
units for YouTube and 88 for CHZZK. URLs and required text are never truncated.
YouTube can reserve another attempt after pausing before insertion, while
confirmed delivery completes the job immediately.

The [notice sender application service](../../packages/application/participation/notice-sender.ts)
owns pending jobs, single-flight execution, account readiness, delivery confirmation
and provider retry deadlines for both platforms. It depends on a small
[transport port](../../packages/application/participation/notice-transport.ts), not
HTTP clients or credential classes. It revalidates ownership before applying
transport results and ignores late exceptions after reset. The
[infrastructure composition](../../packages/infrastructure/participation/platform-notices.ts)
provides transport, clock and identifiers; the old flat notice modules only
re-export these constructors for reference callers. The YouTube receiver and
CHZZK connection have separate owners; platform composition connects their
lifetimes without embedding provider protocols.

## YouTube reception

The [YouTube chat payload adapter](../../packages/infrastructure/platforms/youtube-chat-payload.ts)
normalizes REST and gRPC messages through the shared incoming-message contract.
Unusable individual messages are skipped; missing author identity is never
replaced with a fabricated viewer account. Provider timestamps remain unknown
when missing or invalid. Page cursors, offline timestamps and polling intervals
are validated before ingestion/checkpoint updates; malformed envelopes cannot
advance the cursor or end the broadcast. Both transports share own-channel
exclusion and broadcaster mapping. Discovery responses received after cancellation
do not resolve a channel or reopen receiver state.

The [YouTube gRPC adapter](../../packages/infrastructure/platforms/youtube-grpc.ts)
owns one authenticated stream and its client. It creates no client until token
refresh completes and cancellation is rechecked. Stream setup errors, consumer
errors, upstream failures, early broadcast end and normal completion all release
the client. Abort immediately cancels the stream and closes the client; queued
batches are ignored and cleanup is idempotent. Upstream error codes remain intact
for the receiver's quota and fallback decisions. Tests inject a stream client and
never connect to the actual provider.

The [YouTube read API adapter](../../packages/infrastructure/platforms/youtube-read-api.ts)
owns credential selection, read-only HTTP requests and typed search/video discovery.
Malformed discovery is distinct from an empty live list. Cancellation is checked
before HTTP and after response decoding. HTTP failures retain search, video or
chat-list attribution even when their body is not JSON; provider bodies are not
exposed in errors. Retry delays are finite, nonnegative and bounded to the host
timer range, including receiver jitter. Chat pages remain decoded by the shared
payload adapter before persistence.

The [YouTube receiver use case](../../packages/application/inputs/youtube-receiver.ts)
coordinates discovery, logical receive state, cursor recovery and fallback through
explicit transport/storage/clock ports. The [infrastructure composition](../../packages/infrastructure/platforms/youtube-receiver.ts)
binds it to one broadcast ID, typed HTTP/gRPC adapters, ingestion and the
[checkpoint repository](../../packages/infrastructure/storage/connector-checkpoints.ts).
A replaced or closed broadcast invalidates late discovery, REST responses and
gRPC callbacks before writes or status changes. Each failed gRPC attempt counts
once; configured fallback begins after three failures, using the REST-specific
cursor. Invalid cursors clear only their own key. Normal polling does not signal
reconnection, and REST decoder failures identify the list API rather than the
stream API. Production and tests import the responsible YouTube adapters directly.

## Broadcast-bound input lifetime

The [broadcast input scope](../../packages/infrastructure/inputs/broadcast-input.ts)
binds both platform receivers to one open broadcast and combines caller cancellation
with broadcast retirement. It observes committed reset/close events, so idle
streams are canceled without waiting for another chat event. Unrelated reader
resets do not stop reception; subscriptions are removed when the task settles.
The [CHZZK receiver composition](../../packages/infrastructure/platforms/chzzk-receiver.ts)
uses that scope for worker cancellation, admission, notice resolution and status
updates. A late token refresh cannot create a worker for a replaced broadcast,
and retired worker messages cannot enter the new broadcast.

## Screen and speech inputs

The [screen adapter](../../packages/infrastructure/inputs/screen-input.ts) wires
worker events to bounded screen context. Its artificial image renderer is loaded
only for demo capture. The [speech adapter](../../packages/infrastructure/inputs/speech-input.ts)
wires worker PCM to the transcription use case, provider transport and durable
publication callback. Production composition and tests import these adapters directly.

Speech requests have identity-bound ownership. Context invalidation and input
stop detach the current request before aborting it, so fresh context need not wait
for an obsolete transport to settle. A late success or failure cannot publish,
clear the replacement's busy state or apply budget-stop state to its worker.
Canceled requests retain their already-reserved usage. Only the current request
can finish its processing slot. Clearing context at an already-exhausted cap
stops the worker and reports that cap immediately, without waiting for a retired
response.

The [speech transcription use case](../../packages/application/inputs/transcribe-speech.ts)
owns durable request reservation, current-context checks, text normalization and
publication outcomes. The [Groq adapter](../../packages/infrastructure/inputs/groq-speech.ts)
owns WAV encoding, multipart request fields and provider response/error parsing.
The existing worker coordinator supplies cancellation, clocks and publication
callbacks. Failed request-count persistence sends no audio and conservatively retains
the attempted count because a throwing callback may already have committed. Late results and failures after context reset
cannot publish speech or overwrite the current input state. Recent-window
selection and the AI pipeline's latest-ten-chunk contract remain unchanged.

### Worker lifetime

The [input worker session](../../packages/infrastructure/inputs/worker-session.ts)
owns the child process, restricted environment, IPC listeners and reconnect timer
for both capture and speech. Stop releases callbacks before sending the stop
command and killing the child. Released generations and superseded retry
callbacks cannot mutate current state or restart inputs. Natural exit releases
the handle before notifying the coordinator. Capture and speech still own their
distinct backoff, input validation and recent-window policies; this process
adapter does not decide broadcast lifetime. Speech budget exhaustion stops the
worker without scheduling another reconnect.

### Screen evidence

The [screen context](../../packages/application/inputs/screen-context.ts) owns
frame evidence independently of processes and image encoding: ten retained
frames within thirty seconds, three preview candidates within ten seconds,
source-resolution invalidation and the context-clear timestamp barrier. The
capture adapter supplies IDs, hashing and a clock. Restarting an input cannot
erase the context-clear barrier and admit an older in-flight sample.
[Worker event contracts](../../packages/contracts/input-events.ts) and their
[decoder](../../packages/infrastructure/inputs/worker-events.ts) validate
timestamps, dimensions, bounded canonical base64 and exact configured PCM chunk
length before events reach the input coordinators. Speech context selection
continues to use the latest ten eligible chunks.

### Durable speech context

The [transcript journal](../../packages/application/inputs/transcript-journal.ts)
owns durable speech validation, closed-broadcast admission and the current
broadcast's two-minute recovery window. Its
[SQLite repository](../../packages/infrastructure/inputs/transcripts-sqlite.ts)
owns insert, recovery and administrative export queries against the existing
table. Recovery selects twelve chunks with insertion order as the timestamp-tie
breaker; AI context subsequently selects the latest ten. The
[transcript contract](../../packages/contracts/transcript.ts) is shared with
transcription publication. Restart restores committed text; broadcast erasure
continues to remove the table's session data within the broadcast transaction.
Diagnostic count/export reflects all stored rows so closed or foreign records
cannot be hidden from deletion verification. Context invalidation clears all
stored speech, preserving the existing erasure boundary.

## Platform account connections

The [platform account service](../../packages/application/accounts/platform-accounts.ts)
owns live configuration eligibility, authorization completion, disconnect ordering
and SOOP's single pending five-minute approval window. Its explicit ports keep
credentials, provider requests and receiver implementations out of application
code. Disconnect drains only the selected platform before deleting its stored
credentials; another platform's receiver remains running. New authorization for
that account is rejected while disconnect is draining.

The [account HTTP routes](../../apps/server/http/routes/platform-accounts.ts)
validate callback inputs and render fixed UTF-8 responses while preserving existing
administrator endpoints and OAuth callback URLs. Provider details are mapped to
bounded diagnostic messages. SOOP consumes its pending approval before exchange;
a superseding authorization invalidates both the old token write and its late
status update. Provider protocol and encrypted account state belong to the
[YouTube](../../packages/infrastructure/accounts/youtube-auth.ts),
[CHZZK](../../packages/infrastructure/accounts/chzzk-auth.ts) and
[SOOP](../../packages/infrastructure/accounts/soop-auth.ts) account adapters.
SOOP browser chat operations and AI provider accounts have separate lifecycles.

### Refresh ownership

The [account refresh owner](../../packages/application/accounts/refresh-flight.ts)
shares one pending refresh within an account generation. Authorization changes
and forgetting credentials retire that request immediately; its late completion
cannot release a replacement refresh or return retired credentials. Provider
adapters retain their generation checks before encrypted writes. Successful
CHZZK/SOOP authorization also retires refreshes started while that exchange was
pending. CHZZK session API responses are bound to the requesting account before
sending, before applying status and after body decoding, so an old response
cannot expire a new token or supply its session result.

CHZZK [chat decoding](../../packages/infrastructure/platforms/chzzk-chat-payload.ts)
is independent of account persistence and refresh. Production composition and
tests import the responsible account and payload adapters directly.

### Credential persistence

The [encrypted token file](../../packages/infrastructure/accounts/encrypted-token-file.ts)
owns credential file I/O for YouTube, CHZZK, SOOP and Sign in with ChatGPT.
It preserves the existing AES-256-GCM envelope and validates each adapter's
stored schema after decryption and before replacement. Missing files mean no
stored account; unreadable, invalid or unauthenticated files fail closed without
overwriting them or exposing plaintext in errors. Replacement uses a unique
exclusive owner-only temporary file, flushes it before rename and removes it on
failure. Provider adapters update in-memory platform tokens only after the write
succeeds. Sign in with ChatGPT retains its independent multi-account state and
sign-out behavior; the shared file mechanism does not own account selection or
revocation.

## AI account selection

The [model account service](../../packages/application/accounts/model-account.ts)
owns generation stop and context invalidation when the selected AI account or
model changes. It rejects pending model lists and selections after another
account command supersedes them, and stops generation again after asynchronous
model validation in case an operator restarted it during the query. Successful
account callback persistence always invalidates context, including a later
command arriving before its continuation resumes. Sign-out invalidates pending
selection before the adapter clears local secrets and awaits remote revocation.
Model selection also advances the adapter's authorization generation so an
older token exchange cannot overwrite the selection. The
[HTTP routes](../../apps/server/http/routes/model-account.ts) validate fields
before invoking effects and preserve existing endpoints; protocol and encrypted
account state remain in the adapter.

## Official SOOP browser bridge

The [SOOP bridge service](../../packages/application/inputs/soop-bridge.ts)
owns the official browser SDK's server-side session, status, inbound messages
and fixed-notice coordination. Its
[HTTP adapter](../../apps/server/http/routes/soop-bridge.ts) validates browser
payloads without accessing credentials or mutating participation directly.
An awaited credential result is rechecked against the open broadcast, channel
and app configuration before returning it to the browser. Late failures from a
different broadcast cannot overwrite current authorization status. Closed
broadcasts reject status and chat updates and cannot issue notices.
The session response includes the durable broadcast ID. Every browser status,
message and notice request carries that acquired ID; the server rejects a
different ID before any side effect, even if the new broadcast is already open.
Controller callbacks retain their own ID across reconnection, including rejection
of an old pending notice. A failed authorization sends no unscoped status.
The [shared bridge contract](../../packages/contracts/soop-bridge.ts) is consumed
by both HTTP and browser adapters. Existing tabs must reload the updated client
at cutover; missing broadcast scope is rejected.
Broadcaster messages go only to exact notice echo confirmation; viewer messages
enter the normal consent-aware ingestion path. Non-subscribed reports reset
pending notices and delivery opportunity before updating receiver status.
