# Conversation storage and lifecycle

[Store](../../packages/storage.ts) composes SQLite repositories and transactional
application services. Live sessions retain records across restart and erase ordinary
content at explicit end. Experiment sessions use their own storage and can resume
after ending. [BroadcastLifetime](../../packages/application/broadcast/lifetime.ts)
and [BroadcastRetention](../../packages/application/broadcast/retention.ts) own
these policies.

## Isolation

Live composition resolves database to database + .ai-stream, except for :memory:.
This continues the dedicated-stream namespace and never opens the earlier mixed-chat
database. The test app has separate database/account paths. Credentials are not
ordinary broadcast records.

The input journal accepts synthetic experiment messages only. The live app exposes
no human-message ingestion endpoint. Public projection also rejects historical
non-synthetic rows. Session identity, evidence freshness and hidden-message checks
still apply to outgoing context and final publication.

Older database files and obsolete tables in an existing dedicated-stream database
are not automatically destroyed. They are not read by current runtime features.
Archive/deletion of historical files, exported transcripts and backups is an operator
action. No platform tokens or rights database are opened by the current app.

## Transactions and recovery

Message publication, provenance and attempt outcome commit atomically. Reader events
are sent after commit; notification failure cannot roll back committed publication.
Hiding a message removes dependent context, cancels pending attempts and clears
viewer memory. Late results cannot revive hidden content or an ended session.

SQLite migrations preserve the current session and use explicit columns so extra
historical columns do not become runtime dependencies. Files are owner-only where
supported. Initialization and shutdown close acquired resources even after errors.
Closed markers prevent accidental reopening of an ended broadcast after restart.
Saved cast policies drop the retired platform-activity bands on read. Publication
uses the AI message cap, global interval and individual cooldown instead.

## Data lifetime

Open live sessions retain AI messages, transcripts, personas, counters and enabled
intent. End clears those records and compacts storage. New sessions begin disabled.
Raw video/PCM is bounded transient input. Encrypted model accounts persist separately
and are removed through account disconnect. Test history is managed in the test app.

The independent AI service receives bounded input but owns no database or credentials.
The app persists viewer state and model continuation scoped to session, member,
account, model and pipeline. Changes that invalidate context clear those bindings.

The v1 AI service input retains an empty chatSummary compatibility field. Human-chat
summarization and its UI/API are removed; no historical summary is loaded as model
evidence.
