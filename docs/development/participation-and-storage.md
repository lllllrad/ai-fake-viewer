# Participation and storage implementation

This guide owns local admission, consent transactions, conversation persistence
and independent rights storage. The accepted behavior is defined in
[participation](../specifications/participation.md); [architecture](architecture.md)
owns dependency rules and broadcast/process lifecycle. External receivers and
notice transports are documented in [inputs and accounts](inputs-and-accounts.md).

## Ingestion, consent and withdrawal

1. Normalize the external event at the adapter boundary; retain original event
   ordering when available and never invent a provider timestamp.
2. Exclude the broadcast account and configured bots. Classify exact commands
   before any public storage or model context admission.
3. Store only minimal state for a nonparticipant. Never retain their ordinary
   message body in the database, diagnostics, browser state or summaries.
4. Send one fixed notice with its public URL. Confirm actual delivery using the
   provider's supported acknowledgement; unconfirmed sending is not delivery.
5. Share that delivery with the target and waiting viewers observed in the same
   room within five minutes. Unknown later arrivals are not assumed present.
6. Require each viewer's fresh command after delivery. Preserve ordering, notice
   version, account, platform, broadcaster and broadcast identity boundaries.
7. Admit only messages after that viewer's current consent generation.

The [consent policy](../../packages/domain/participation/consent.ts) is a pure
state transition over explicit time, profile availability and observation identity.
It returns the next participant, permission result and invalidation revision;
it performs no persistence, identifier generation or callbacks. The [participation service](../../packages/application/participation/service.ts)
applies these transitions with injected time, identifiers and profile fingerprints.
It owns command, delivery and profile operations; a bound persistence port commits
the resulting consent state and dependent chat removal together. The [guidance policy](../../packages/domain/participation/notices.ts) separately
decides rate reservations and room-scoped delivery opportunities without treating
either as consent. It rejects another reservation for an already-covered viewer.

Profile validation is
an application policy; the process adapter supplies cryptographic fingerprints
without importing Node APIs into the application layer.

### Transactional withdrawal

Withdrawal must commit consent invalidation and local raw/dependent deletion in
one storage transaction, then invalidate running work and refresh all projections.
The [SQLite transaction owner](../../packages/infrastructure/storage/transactions.ts)
joins nested synchronous mutations. Before the outer transaction it checkpoints
session identity, participant references, observations, profile and notice budget.
A work or commit failure restores those in-memory values as well as rolling back
SQL; even a swallowed nested failure prevents commit. Withdrawal callbacks and
public removal notifications run after successful commit, so failed writes cannot
create follow-up work or publish an uncommitted removal. Notification failures do
not roll back committed data or prevent the remaining queued notifications.

The [snapshot adapter](../../packages/infrastructure/participation/snapshots.ts)
retains the existing broadcast-database record. Restoring a process still drops
unconfirmed manual observations; rolling back a transaction preserves them.
The [conversation context service](../../packages/application/conversation/context-service.ts)
owns removal, summary reset and retention behind the participation persistence
port. Its [SQLite adapter](../../packages/infrastructure/conversation/context-sqlite.ts)
owns context queries, event writes and attempt cleanup. A
[pure dependency traversal](../../packages/domain/conversation/dependencies.ts)
includes transitive replies/provenance and terminates on cycles. The
[Store composition](../../packages/storage.ts) connects these services to the
ingestion, broadcast lifetime, cast runtime and publication owners described below.

### Anonymous summary retention

The [summary policy](../../packages/domain/conversation/summary.ts) classifies
recent permitted human messages into fixed labels with a three-account threshold
per label. Retaining an earlier approved summary revalidates its categories and
drops arbitrary stored fields or text. Live approved categories survive withdrawal
until broadcast end or explicit summary reset. The synthetic legacy consent path
retains its rolling-window behavior. Summary reset commits its sequence cutoff
and audit together before invalidating model work. Message, provenance and
identity cleanup are scoped to the current broadcast.

External-request authorization is rechecked after asynchronous preparation and
immediately before transmission. Late provider results must pass the same current
permission checks before publication. Only previously approved coarse anonymous
categories can survive withdrawal; they expire at broadcast end.

## Persistence and external effects

The [conversation identity service](../../packages/application/conversation/identity-service.ts)
owns origin disclosure and collision refresh. Its
[SQLite repository](../../packages/infrastructure/conversation/identity-sqlite.ts)
projects only visible, current-broadcast actor IDs, display names and origin
kinds. Full disclosure disables durable AI intent and writes the disclosure event
in one transaction; reference cast disclosure selects only that cast's synthetic
actors. Collision normalization is a pure domain rule. Readers receive the event
and reset only after commit, and transaction rollback restores the collision cache
along with persisted intent. Private account identifiers are never disclosure fields.

The [incoming message contract](../../packages/contracts/incoming.ts) validates
platform input before persistence. The
[incoming SQLite writer](../../packages/infrastructure/conversation/incoming-sqlite.ts)
accepts only admitted messages and owns source deduplication, immutable author
binding, actor creation, edits, message events and connector checkpoints. It runs
inside the ingestion transaction; summary updates share that transaction and
reader notifications wait for its outermost commit. Failed batches leave no
messages, actor records, summary or advanced cursor. A closed broadcast admits
neither content nor post-ingestion summary writes. The [ingestion use case](../../packages/application/conversation/ingestion.ts)
owns validation, admission, persistence, summary refresh and post-commit effects.
Live admission delegates exclusively to ParticipationService; local demo consent
and notice claims belong to the
[reference adapter](../../packages/infrastructure/participation/reference-admission.ts).
Reference notice claims share the ingestion transaction, so rollback never leaves
a failed batch marked as announced. Platform input adapters call the use case
directly; Store only composes its dependencies and retains compatibility methods.

[Broadcast retention](../../packages/application/broadcast/retention.ts) keeps
active live-broadcast history regardless of its age. For eligible historical
records, its [SQLite repository](../../packages/infrastructure/storage/retention-sqlite.ts)
removes expired content, related cast records and orphaned identities in one
transaction. It preserves the current session row, including a closed marker,
so cleanup cannot implicitly reopen a broadcast on restart. Identity disclosure
payloads lose deleted actors without removing fresh disclosures. Only committed
changes trigger compaction and reader reset; no-op cleanup emits neither.

[Database initialization](../../packages/infrastructure/storage/initialize.ts)
sets connection pragmas and rejects schemas newer than this application supports
before writing broadcast records. The
[schema owner](../../packages/infrastructure/storage/schema.ts) creates and
upgrades tables; the
[restart recovery owner](../../packages/infrastructure/storage/recovery.ts)
invalidates unfinished reactions, advances live cast epochs and selects the
latest broadcast, including its closed marker. Schema changes, recovery and the
schema version commit in one transaction. Failure restores the prior database;
startup closes its connection instead of exposing a partially initialized Store.
Recovery preserves chat, participation, transcripts and durable AI intent.

The [broadcast lifetime service](../../packages/application/broadcast/lifetime.ts)
owns end, replacement and explicit erasure. Its
[SQLite repository](../../packages/infrastructure/broadcast/lifetime-sqlite.ts)
owns the disposable record set and post-commit database compaction. A live
broadcast replacement erases the prior data, creates one new session and updates
the in-memory participation state in a single transaction. A failed write restores
both SQL and memory; readers receive a reset only after commit. Ending an already
closed broadcast is idempotent. Independent rights follow-ups and account tokens
survive these transitions. The reference/demo path retains historical records on
end, but its close and next-session creation share the same transaction boundary.

One private SQLite broadcast database owns session-scoped records; a separate
rights database and encrypted account files have independent lifetimes. Keep the
current configured database usable through explicit, tested schema migrations.
Do not silently select another file, discard an open broadcast or start a fresh
session to make a migration pass. Runtime DB handles remain inside adapters.

Durable writes precede externally visible publication or acknowledgement. Provider
writes remain at-least-once where remote acknowledgement is ambiguous; do not
claim exactly-once delivery. Confirmed notices and usage survive restart. On end,
remove chat, consent, summaries, transcripts, cast, pending work and broadcast
budgets atomically, then checkpoint/compact according to the storage adapter.

Raw PCM and frames stay bounded in memory. Browser storage must not contain chat,
transcripts, consent records or credentials. Transcript downloads are explicit
administrator actions and remain outside automatic deletion. Reader projections
never contain administrator-only account, consent or rights data.

### Rights and durable follow-ups

The [rights service](../../packages/application/rights/service.ts) owns request
intake, bounded provider-request references, resolution checks and deletion
eligibility. Its [pure policy](../../packages/domain/rights/resolution.ts) checks
completion independently of transport and storage. The
[SQLite adapter](../../packages/infrastructure/rights/sqlite.ts) preserves the
existing separate database format, validates stored records, and performs
read/modify/write operations in transactions. The
[HTTP routes](../../apps/server/http/routes/rights.ts) validate transport inputs
and delegate to the service; they do not access SQL. The shared
[profile contract](../../packages/contracts/privacy-profile.ts) is independent
of profile fingerprinting and runtime participation behavior.

The [withdrawal follow-up coordinator](../../packages/application/rights/withdrawal-followups.ts)
connects committed withdrawal to the independent rights database. Its
[durable queue](../../packages/infrastructure/rights/followup-queue.ts) is written
inside the consent/erasure transaction and contains only intake identifiers and at
most 100 distinct provider request IDs. A queue write failure rolls back that
transaction. Undelivered rights work survives broadcast end and restart; it is
rights-processing data, not retained chat or media. Startup and participation
status queries retry delivery. Successful delivery removes the queue payload.

The rights database commits a minimal receipt with each intake. Retrying after a
crash between intake and queue acknowledgement reuses the same task identifier.
Receipt tombstones contain only opaque IDs and prevent a resolved/deleted task
from being recreated by an old retry. Late provider IDs attach to their matching
consent epoch. Rights-storage failure leaves work pending without reversing
completed local erasure or propagating an unrelated model-request failure.

### Public conversation projection

The [conversation projection service](../../packages/application/conversation/projection-service.ts)
owns public DTO creation, current consent checks, origin disclosure, snapshot
windows and replay projection. Its
[read adapter](../../packages/infrastructure/conversation/projection-sqlite.ts)
loads the latest 300 visible messages in one joined query, in chronological order;
replay remains bounded to 1,001 events. Private account/channel/consent fields
never enter the public DTO. The
[disclosure policy](../../packages/domain/conversation/disclosure.ts) preserves
actual names and changes only origin labels, with the existing synthetic-name
suffix normalization.

Reader event delivery rechecks message visibility and permission rather than
trusting cached payload text. Closed or foreign broadcasts cannot revive cached
messages. Identity payloads are rebuilt for the currently visible permitted
window; removed identities and extra stored fields are excluded. The server's
synchronous snapshot/listener registration remains unchanged.

### Participation administration

The [participation administration service](../../packages/application/participation/administration.ts)
owns the administrator projection and participation controls. Status retries
durable rights follow-ups before reporting the pending count, projects only
reviewed participant fields, and includes a notice only while awaiting consent.
Participant-internal replay IDs, provider request IDs and accepted-policy
bookkeeping are not copied into participant rows. Manual notice confirmation cannot bypass automatic delivery on
YouTube, CHZZK or SOOP. Live-command confirmation and age blocking delegate to the
same transactional participation owner used by ingestion. The
[HTTP routes](../../apps/server/http/routes/participation.ts) validate participant
identifiers and explicit confirmation fields; demo mode has no live controls.
