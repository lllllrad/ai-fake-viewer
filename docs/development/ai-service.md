# Independent AI pipeline service

The AI implementation runs in a separate Node process on local port 3212. The live
server (3210), test server (3211) and replay CLI are API clients. They never import
service implementation modules. Application code owns input admission,
credentials, usage reservations, cancellation, pacing limits and final publication.
The service owns AI viewer selection, generation/review orchestration and per-viewer
inspection. This is process separation with an HTTP API, not an in-process plugin.

## Lifecycle

```sh
sh run-command.sh just ai-service-start
sh run-command.sh just ai-service-status
sh run-command.sh just ai-service-restart
sh run-command.sh just ai-service-stop
```

Managed app/test startup first starts this service if needed. Stopping an app does
not stop the AI service. Foreground operation uses `npm run ai-service:setup` then
`npm run ai-service:start`, both through the repository wrapper. Foreground app and
CLI commands require the service to be running already. Startup performs a protocol
and pipeline metadata handshake; an unavailable service fails startup rather than
silently running an embedded implementation. A later selection failure stops host scheduling; a failed draft step enters the
existing model-error path. The operator can restart AI after service recovery.
Inspection failures retain the last cached state and do not stop a test. Ordinary
app HTTP and conversation storage remain available. In-flight service jobs are
transient and are not recovered after a service restart.

The default shared local token is `.local/ai-service.token`, created once with
owner-only permissions. `AI_SERVICE_URL` and `AI_SERVICE_TOKEN` override the client
connection; `AI_SERVICE_PORT` and `AI_SERVICE_TOKEN` configure foreground service
startup. Only loopback HTTP endpoints are supported. The service binds to
127.0.0.1 and requires bearer authentication except for `/health`. Managed recipes
use port 3212. They keep separate `.local/ai-service.pid` and `.local/ai-service.log`.
This token authorizes private pipeline processing; it is not a model-provider key.

## Protocol and ownership

- `GET /v1/pipelines`: protocol version 1 and registered type metadata.
- `POST /v1/select`: admitted observation, cast and caller-supplied deterministic
  random draws; returns a selected member and its observation window.
- `POST /v1/runs`: starts an isolated draft job and returns a model-request step
  or state-update step or final outcome. The service can choose how many generation/review steps to use.
- `POST /v1/runs/:id/continue`: supplies a completed model result or committed state and refreshed
  evidence availability. A step number prevents duplicate continuation.
- `DELETE /v1/runs/:id`: cancels and releases the job.
- `POST /v1/inspect`: renders implementation-specific viewer state from explicit
  host observations. It makes no model calls.

Model requests return to the calling app, which invokes its own configured provider
with its own account, budget and authorization checks, then sends the result back.
Provider credentials never cross the service API. A service model request can set
`ModelInput.instructions` to replace developer instructions for that call; otherwise
the host uses the existing standard or experiment prompt profile. Provider message
serialization, bounded function-call transport and the final decision schema remain host contracts. Live and test account ownership
remains separate. Returned candidates still pass host evidence, context-revision,
expiry and publication checks. Cancellation aborts host model work and deletes the
remote job; unreachable jobs expire after 90 seconds. The service has a 100-job cap,
16 MiB request limit and no database or request-body logging. It holds transient
admitted content in memory. Each HTTP step has a 15-second client timeout (inspection: 2 seconds); existing
model-request and speech timeouts continue to apply separately.

## Implementations

Register a `ServicePipeline` in
[service programs](../../services/viewer-ai/programs.ts). Its `select`, `draft` and
required `inspect` methods belong to the AI service. The built-in `standard`
implementation delegates to the service-owned selection and draft/review modules.
Changing an algorithm does not require changing application code. Restart the AI
service after code changes; restart clients to rediscover added types or changed
revisions. Clients bind to the discovered revision and reject mismatches.
The shared [program port](../../packages/application/reactions/program.ts) describes
host capabilities; the [host lifecycle contract](../../packages/application/reactions/pipelines.ts)
is explicit and no longer derives its interface from an algorithm class.

Replay uses the same API with a simulated clock and seeded random draws. Unit tests
explicitly preload an in-process service implementation fixture for policy checks;
production never uses that fixture or falls back to it. Service integration and
browser tests spawn a separate foreground child on an ephemeral loopback port with
synthetic inputs and isolated credentials. They never connect to the managed live
service or establish real model quality.

## Tools and reusable viewer context

The standard service exposes strict `update_state`, `send_chat`, `wait` and
`inspect_screen` function tools. `update_state` replaces a concise mood, focus,
intent and conversation summary; these are observable simulation state, not hidden
model reasoning. Other implementations can define different state keys and tools.
The generic host state port bounds stored JSON, binds it to the selected viewer,
session and pipeline/persona definition, and rejects canceled or obsolete writes.

A state packet is committed by the host before the service receives its result.
A numbered step can be continued once. Invalid arguments, repeated call IDs or
conflicting terminal actions fail before writes. Each generation/review phase
allows four model rounds and eight tools per response. `send_chat` produces a
candidate, never a direct platform write: evidence validation, independent review,
pacing and final host publication still apply.

The host persists state in `viewer_memory`; it supplies current state alongside
the existing recent conversation on the next invocation. State expires within the
configured context window, without sliding an inherited summary indefinitely.
State is reused only while its original chat sources are still present in the current authorized message window, so publication provenance continues to cover those sources. Context invalidation, reset and broadcast close clear derived state.
Restarting only the AI service preserves host state; in-flight jobs are canceled.

Provider requests use strict Responses API function schemas, `store:false` and a
stable hashed `prompt_cache_key` per viewer binding. Stable instructions/tool
definitions precede variable input; cache hits depend on provider/model support,
prefix length and retention and are not guaranteed. `cachedInputTokens` is recorded
in model results; local USD accounting remains conservative at configured full
input prices. There is no `previous_response_id` or provider-hosted conversation.
Within a tool workflow, function calls and results are replayed explicitly, including
opaque encrypted reasoning items required for continuation. These items are
short-lived transport data and excluded from test traces and state inspection.

See the official [function calling guide](https://developers.openai.com/api/docs/guides/function-calling),
[conversation state guide](https://developers.openai.com/api/docs/guides/conversation-state)
and [prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching).

## Required initial viewer state

Each service pipeline declares a nonempty initialState object in discovery metadata
and implements inspect. The host persists a copy for every cast member before the
first observation or model call, bound to the broadcast, implementation and persona
definition. The standard state contains mood, focus, intent and summary. These are
simulation values; an initial summary states that no conversation has been observed.

The same stored state is supplied to model calls and inspection. Start and resume
refresh inspection before their HTTP response. Initialization does not invoke a model.
Custom pipelines own their state fields and initial values rather than receiving a
generic presentation fallback. Update tools must maintain their declared state shape;
the standard tool rejects empty field values.

Initial records are tagged initial; model tool writes are tagged updated. Initial
records carry no observed evidence and do not shorten the first model update's
evidence lifetime. Subsequent updates cannot extend inherited evidence expiration.
After expiration or context invalidation, the host recreates the pipeline's initial
state before another observation/inspection, without retaining the expired summary.
Older saved records without a kind are treated as updated; resuming initializes any
members that have no usable state. A disconnected inspection service remains an
operational error; no UI-generated pretend state is substituted.
