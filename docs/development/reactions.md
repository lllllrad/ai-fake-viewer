# Reaction implementation

This guide owns AI generation, cast execution and publication boundaries.
[Architecture](architecture.md) owns dependency rules; the [AI pipeline guide](ai-pipeline.md)
owns the runtime walkthrough, prompt changes and diagnostics. Product behavior is
specified in [personas](../specifications/personas.md) and [behavior](../specifications/behavior.md).
Media acquisition is documented in [inputs and accounts](inputs-and-accounts.md).

## Evidence and orchestration

Separate input selection, pacing/eligibility, persona selection, model request,
review and publication. Use injected time/randomness at policy boundaries so tests
do not depend on sleeps or probability. Context includes the latest ten recent
transcript chunks, eligible human text and configured visual evidence. New input
and background context are distinct; input received during pacing remains eligible.

The provider port supports API-key authentication and Sign in with ChatGPT using
the Responses API. Preserve working authentication, token-counting, streaming,
storage settings and bounded concurrency. Do not replace tested wire protocols
with assumptions. A provider cannot silently switch account or authentication.

The [evidence policy](../../packages/domain/reactions/evidence.ts) selects the
current chat window and latest ten transcript chunks by capture time, separates
new triggers from background, and prunes consumed-input bookkeeping without
consuming new evidence. Synthetic chat alone is not a speech-trigger substitute.
Message revisions include both speaker and text; the coordinator hashes that
revision into its duplicate key so edits to the same platform message remain
eligible without retaining raw text in the key.

The [cast selection policy](../../packages/domain/reactions/cast-selection.ts)
owns presence boundaries, observation age, global and per-member pacing,
activity-band caps, topic/mention weighting and probabilistic silence. It receives
time and random draws explicitly and performs no storage, network or timer work.
Zero propensity always stays silent. Observation age includes configured pacing
and model delay but never exceeds the context window.

The [reaction coordinator](../../packages/application/reactions/coordinator.ts)
owns the generation, review, pacing and publication workflow. Its explicit
[ports](../../packages/application/reactions/coordinator-ports.ts) supply current
conversation/cast state, usage and attempt storage, screen/speech evidence, and
runtime time, timers, identifiers, hashing and sanitized provider-error mapping.
It imports no concrete store, capture worker, provider adapter or Node runtime.
The [Node composition](../../packages/infrastructure/reactions/scheduler.ts)
connects those ports to the durable services. Production and tests import this
composition directly. The same candidate and evidence guards run
for automatic dispatch and manual approval.

Every attempt carries broadcast/context/consent and cast revisions. Review and
publication validate those revisions, cited evidence, expiry, duplicate and
frequency rules. Silence is a normal result. Failures distinguish authentication,
quota, local budget, token bounds, timeouts and invalid output. Diagnostics contain
fixed categories/counts/IDs, never raw input, drafts or credential payloads.

The [decision contract](../../packages/contracts/decision.ts) owns the model-output
shape. The [application validator](../../packages/application/reactions/validate-decision.ts)
parses that shape and applies the
[pure evidence/output policy](../../packages/domain/reactions/decision.ts).
[Review and publication policies](../../packages/domain/reactions/publication.ts)
drop expired background speech while rejecting expired cited speech; bind a
candidate to its broadcast, generation, consent revision and deadline; and require
all input message bodies to match their current permitted versions. An edited
message is stale evidence even if its identifier still exists. The coordinator
gathers current evidence through its adapters and applies the same checks after
review and before publication. Invalid candidates are discarded before another
publication-delay timer is scheduled. Rejection diagnostics contain fixed reasons,
not input text.

## Outgoing authorization and draft review

The [model authorization service](../../packages/application/reactions/model-authorization.ts)
revalidates the exact outgoing message text, frame bytes/capture time and both
background/new transcript windows at each provider boundary. Current consent
revision, profile availability and an open broadcast are required even for
text-only or empty contexts. An edited message with the same ID is stale input.
The [audience query](../../packages/infrastructure/reactions/model-audience.ts)
loads message authors in one broadcast-scoped query and matches platform/account/
channel identities. Only participant IDs and authorized epochs are retained for
late provider request tracking, never mutable participant objects or raw chat.
The [runtime adapter](../../packages/infrastructure/reactions/model-authorization.ts)
connects these ports to current media, consent, storage and rights follow-up owners.

The [draft and review use case](../../packages/application/reactions/draft-review.ts)
owns the bounded generation workflow: an initial response, at most one requested
frame inspection, and optional independent review. It receives provider, current
input and cancellation ports rather than storage or timer objects. Every awaited
response is checked against the current execution before another request or a
candidate can be returned. Review excludes expired background speech and rejects
expired cited speech. Unavailable or repeated inspection ends the cast attempt as
skipped instead of leaving it generating. The coordinator owns pacing and candidate
publication; it does not duplicate the draft/review sequence.

The [metered model-call use case](../../packages/application/reactions/model-call.ts)
owns pre-request budget reservation, bounded diagnostic metadata and post-response
usage settlement. The [SQLite usage adapter](../../packages/infrastructure/reactions/usage-sqlite.ts)
atomically reserves call and monetary capacity within the current broadcast.
Already-aborted requests consume no capacity. Ambiguous provider failures retain
the reservation; missing or invalid token counts cannot reduce its monetary bound.
Sign in with ChatGPT records token usage without applying Responses API monetary
rates. Late settlement is scoped to the broadcast that is still current. Provider
transport and scheduling have separate owners described below.

## Publication and automatic cast

The [local publication service](../../packages/application/reactions/publication-service.ts)
commits the response, full source-message provenance and cast attempt outcome in
one transaction through its [SQLite adapter](../../packages/infrastructure/conversation/publication-sqlite.ts).
Both cast and fallback generation use this path. Missing, hidden or foreign
source messages and closed broadcasts reject publication. Reader notification
runs after commit; notification failure does not turn a durable publication into
a failed attempt that could be retried. Reconnect snapshots recover committed
messages. A provenance write failure rolls back publication before any notification.

The [automatic cast service](../../packages/application/cast/automatic.ts) reuses
the current broadcast cast or composes exactly six distinct synthetic identities.
It validates the [definition contract](../../packages/contracts/persona-definition.ts)
and resolves normalized display-name collisions without modifying composition
seeds. The [SQLite adapter](../../packages/infrastructure/cast/automatic-sqlite.ts)
commits approved definitions, present members, initial presence intervals and
system provenance together. This path does not invoke manual candidate creation,
operator review, audition or cast approval. A storage failure leaves no partial
cast. Live composition uses the broadcast cast API described below; reference
authoring remains isolated from that execution path.

The [cast execution control](../../packages/application/cast/control.ts) owns
arming and stopping independently of authoring. Its
[SQLite adapter](../../packages/infrastructure/cast/control-sqlite.ts) scopes
commands to the current broadcast. A stop commits the disabled flag, execution
epoch advance, cancellation of unfinished attempts and audit record together.
Arming checks the current epoch and an open broadcast, and commits its audit in
the same transaction. Failure cannot leave a half-applied control transition;
re-arming never revives canceled attempts.

Live server composition now instantiates only the
[broadcast cast API](../../packages/application/cast/broadcast-cast.ts) through
its [runtime factory](../../packages/infrastructure/cast/runtime.ts). AI startup
prepares/reuses the cast and arms its current execution; status and shutdown use
the same owners. It does not seed authoring templates, construct audition clients
or install authoring idempotency hooks. The legacy endpoints and their persistence
hooks are isolated in [demo routes](../../apps/server/demo/persona-routes.ts),
loaded only for synthetic demo operation. They remain reference functionality,
not part of the live product's architecture or UI.

## Durable attempts and dispatch

The [reaction attempt port](../../packages/application/reactions/attempts.ts)
separates scheduling from durable context reservation and outcome recording.
Its [SQLite adapter](../../packages/infrastructure/reactions/attempts-sqlite.ts)
inserts only when the current broadcast is open and the live, armed cast and
present, unmuted member still match the captured epochs, definition hash and
configuration revision. The eligibility check and insertion are one SQL statement;
duplicate member/context reservations remain idempotent. Candidate promotion
rechecks those bindings and only advances a generating attempt. Terminal
attempts cannot be revived, dispatching cannot regress to candidate, and outcome
updates cannot cross the current broadcast boundary. Atomic public message
publication remains the separate publication repository's responsibility.

The [cast runtime query](../../packages/infrastructure/cast/runtime-query.ts)
loads the current open broadcast's active cast in five queries regardless of
member count. Last visible speech, the leading consecutive speaker and ordered
presence intervals are computed from batched reads. Muted and absent members
are excluded. The [runtime contract](../../packages/contracts/cast-runtime.ts)
validates definition snapshots, presence and the shared
[cast configuration](../../packages/contracts/cast-configuration.ts) before
the coordinator receives them. Invalid persisted definitions or policies fail
the read rather than entering model context. Legacy authoring imports re-export
the same configuration schemas; they do not own a second definition of them.

The [cast dispatch port](../../packages/application/reactions/dispatch.ts)
claims a candidate immediately before local publication. Its
[SQLite adapter](../../packages/infrastructure/reactions/dispatch-sqlite.ts)
rechecks the candidate's cast/member ownership, current broadcast, epochs,
definition hash and configuration revision inside the same transaction as the
candidate-to-dispatching transition. Input references are checked together
against visible messages and persisted speech in that broadcast.
The [pure dispatch policy](../../packages/domain/reactions/dispatch.ts) evaluates
reserved plus published activity, global/member cooldowns, inflight and
consecutive limits, and normalized long-text duplication. Invalid records or a
failed write leave the candidate unclaimed; a second claim cannot succeed.

## Model adapters and payloads

Provider HTTP composition belongs to the
[Responses API adapter](../../packages/infrastructure/reactions/responses-api.ts)
and the [Sign in with ChatGPT model adapter](../../packages/infrastructure/reactions/chatgpt-model.ts).
Both implement the application model port. The API adapter accepts an injected
transport for fixture verification; the subscription adapter only depends on
current account/model identity and token access, not the account storage class.
Input authorization and request-ID recording remain at every outgoing request
boundary. Shared [response payload validation](../../packages/infrastructure/reactions/response-payload.ts)
rejects negative/non-numeric token counts and malformed output text before usage
accounting. Production, reference fixtures and tests import model ports, validation and provider adapters directly. Node callers declare `Model<Buffer>` and `ModelInput<Buffer>` explicitly; the application contract remains independent of Node.

The [Responses API stream decoder](../../packages/infrastructure/reactions/responses-stream.ts)
handles SSE framing, chunked UTF-8 text, completion validation and optional usage
counts separately from authentication, HTTP requests and decision validation.
It requires a completed response, rejects invalid/oversized text and bounds the
stream to 1 MiB. Parse failures and caller cancellation cancel the reader before
releasing its lock; cancellation also wakes an idle stream read. Its event types
follow the [official streaming guide](https://developers.openai.com/api/docs/guides/streaming-responses).

The [outgoing context projection](../../packages/application/reactions/model-context.ts)
selects message IDs, pseudonymous speakers, text, transcript timestamps and frame
references explicitly. Extra fields attached to internal objects never enter the
model payload. Anonymous summaries are restricted to approved topic/mood labels.
The [message renderer](../../packages/infrastructure/reactions/model-messages.ts)
loads the answer/review prompts and encodes the selected frame bytes for the wire
format. Application context projection does not read files or depend on a provider
client, and image encoding handles Uint8Array views without exposing adjacent bytes.

The [model port](../../packages/application/reactions/model-port.ts) defines
provider-independent generation input and result types. Image bytes are generic
Uint8Array data; the Node composition retains Buffer compatibility without
requiring capture workers or HTTP clients in that interface. The
[model concurrency limiter](../../packages/application/reactions/model-concurrency.ts)
owns FIFO admission, canceled waiter removal and exactly-once slot release.
Invalid limits fail immediately rather than leaving requests queued forever;
queued cancellations never invoke a provider. Active calls retain their slots
until they settle, even if their caller has requested cancellation.

## Failure recovery and scheduling

The [generation recovery policy](../../packages/application/reactions/recovery.ts)
owns retry decisions and the operator-facing issue state. Three consecutive
transient request failures stop AI; a successful response or a non-transient
validation/stale-context outcome breaks that streak. Permanent errors and budget
exhaustion stop immediately. Provider error classification supplies a typed issue,
while the coordinator applies the returned stop state only for its current generation.

The optional [timing gate use case](../../packages/application/reactions/timing-gate.ts)
owns its separate request cap, probability threshold and evaluation status.
Its [TypeSafe adapter](../../packages/infrastructure/reactions/typesafe-gate.ts)
owns prompt loading, credentials, the text-only HTTP payload, bounded response
validation and timeout. Each evaluation snapshots its configuration and has a
revision; a superseded response cannot overwrite the newest status or allow a
canceled generation. Every outgoing evaluation still counts toward the cap.

The [generation work owner](../../packages/application/reactions/generation-work.ts)
tracks the current asynchronous request with an identity-bound lease. Cancellation
advances the generation, detaches the busy slot, clears retained chat context
from every draft/review input variant and aborts the request. A replacement can
start even if an old transport ignores cancellation. Late completion or input
callbacks cannot clear the new busy slot, restore canceled context or change its
pacing. The coordinator also ignores errors escaping an obsolete generation.

The [reaction schedule](../../packages/application/reactions/scheduling.ts)
owns polling and delayed-publication timers through an injected clock. Canceling,
restarting or replacing a timer invalidates callbacks already queued by the host;
an old callback cannot execute or clear its replacement. Publication callbacks
are one-shot even when invoked again. A synchronous polling or publication error
stops both timers before reaching the coordinator's error handler. Delayed storage
failures therefore stop AI with a diagnostic instead of escaping the timer and
terminating the process. Manual publication also cancels its queued callback.
