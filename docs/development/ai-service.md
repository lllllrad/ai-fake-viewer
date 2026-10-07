# Independent AI pipeline service

The AI implementation runs in a separate Node process on local port 3212. The live
server (3210), test server (3211) and replay CLI are API clients. They never import
service implementation modules. Application code owns input admission, consent,
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
silently running an embedded implementation. A later service failure stops the
affected AI attempt; ordinary app HTTP and conversation storage remain available.

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
  or final outcome. The service can choose how many generation/review steps to use.
- `POST /v1/runs/:id/continue`: supplies a completed model result and refreshed
  evidence availability. A step number prevents duplicate continuation.
- `DELETE /v1/runs/:id`: cancels and releases the job.
- `POST /v1/inspect`: renders implementation-specific viewer state from explicit
  host observations. It makes no model calls.

Model requests return to the calling app, which invokes its own configured provider
with its own account, budget and authorization checks, then sends the result back.
Provider credentials never cross the service API. A service model request can set
`ModelInput.instructions` to replace developer instructions for that call; otherwise
the host uses the existing standard or experiment prompt profile. Provider message
serialization and the shared decision output schema remain host contracts. Live and test account ownership
remains separate. Returned candidates still pass host evidence, context-revision,
expiry and publication checks. Cancellation aborts host model work and deletes the
remote job; unreachable jobs expire after 90 seconds. The service has a 100-job cap,
16 MiB request limit and no database or request-body logging. It holds transient
admitted content in memory. Each HTTP step has a 15-second client timeout (inspection: 2 seconds); existing
model-request and speech timeouts continue to apply separately.

## Implementations

Register a `ServicePipeline` in
[service programs](../../services/viewer-ai/programs.ts). Its `select`, `draft` and
optional `inspect` methods belong to the AI service. The built-in `standard`
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
