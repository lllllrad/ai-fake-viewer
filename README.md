# Mixed Chat Studio

A local broadcast workspace, chat reader and OBS overlay with six automatically
composed synthetic AI viewers. AI replies appear in this app, reader and overlay;
platform senders deliver fixed participation notices only. The interface is Korean.

The [documentation index](docs/README.md) routes operators to setup and developers
to implementation contracts. Start with the [live runbook](docs/operations/setup.md)
for actual broadcasting or [AI viewer tests](docs/development/experiments.md) for
text/microphone conversations with an isolated cast.

## Processes and workspaces

| Process          | Default address               | Responsibility                                                    |
| ---------------- | ----------------------------- | ----------------------------------------------------------------- |
| Broadcast server | `http://127.0.0.1:3210/admin` | Broadcast controls, participation, reader and OBS overlay         |
| Test server      | `http://127.0.0.1:3211/admin` | Text/microphone tests, personas, AI state and call details        |
| AI service       | `http://127.0.0.1:3212`       | AI selection, generation/review and inspection API; no browser UI |

Broadcast and test servers have separate accounts, administrator credentials and
storage. Both use the [AI service](docs/development/ai-service.md); provider credentials,
usage accounting, input admission and final publication remain in the calling app.
Managed startup starts the AI service when needed. Stopping an app leaves it running.

## Quick start

Use Node pinned in [mise.toml](mise.toml) through the
[repository command wrapper](docs/development/guide.md):

```sh
sh run-command.sh npm ci
sh run-command.sh npm run setup
sh run-command.sh npm run build
sh run-command.sh just ai-service-start
sh run-command.sh npm run demo
```

Setup creates missing private credentials/configuration. Open the printed address
and sign in with `ADMIN_TOKEN` from `.env`. Demo uses synthetic input, an in-memory
broadcast store and a mock model. It still requires the local AI service. Stop the
foreground demo before starting another app on the same port.

## Live configuration

Complete ignored `config.yaml` using [config.example.yaml](config.example.yaml) and
the [live runbook](docs/operations/setup.md). Configure actual platform permissions,
public notices, selected model/account and broadcast media sources. Installing this
repository does not supply platform approval, viewer consent or provider eligibility.
A missing processing profile blocks live collection or AI processing as applicable.

Use `sh run-command.sh just server-start`, `server-status`, `server-restart` and
`server-stop` to manage the broadcast server. Foreground `npm start` requires the AI
service to be running first. YAML changes apply on restart; end the current broadcast
before changing its consent profile, including policy links.

Choose API-key authentication or **Sign in with ChatGPT** explicitly. Both inference
adapters use the **Responses API**; there is no silent provider fallback. OpenAI or
Groq speech transcription is configured independently. Screen and audio input follow
their configured sources; no obsolete screen-confirmation switch is required.
Generation usage is counted without a call-count ceiling. Token limits, optional
verified-price cost caps, transcription limits and publication pacing are separate.

## Automatic personas and viewer consent

Starting AI prepares or reuses six synthetic viewers without operator authoring or
real-viewer profiling. Ordinary viewers need one confirmed short notice and one
fresh individual consent command. Shared notice delivery does not grant shared
consent. Broadcast accounts have their documented admission exception; fixed-notice
echoes are excluded. Until permitted, ordinary viewer text is discarded before
storage, display or model context.

Withdrawal cancels dependent work and removes tracked raw and derived context.
Local deletion does not promise deletion of provider records, video or outside
copies. See [participation](docs/specifications/participation.md) and
[persona behavior](docs/specifications/personas.md).

## Interactive AI viewer tests

```sh
sh run-command.sh npm run experiments:setup
sh run-command.sh just experiments-start
```

Open port 3211 and use `EXPERIMENT_ADMIN_TOKEN` from `.local/experiments/.env`.
Connect a test account separately, or select the offline fixture for plumbing checks.
Talk through the microphone or type, inspect personas, then use the separate AI-state
and call-detail tabs when needed. Ended sessions can continue with the same cast and
history. Tests never send their conversations to platform chat or broadcast storage.
See [test setup, replay and algorithm replacement](docs/development/experiments.md).

## Storage and deletion

An open broadcast's cast, chat, consent, transcripts, counters and AI intent survive
server restarts. Explicit broadcast end deletes ordinary session data and leaves a
closed marker. Credentials, exceptional rights records and test histories have
separate lifetimes. Raw media stays transient; downloaded exports are operator-managed.
See [storage ownership](docs/development/participation-and-storage.md) and
[broadcast restart and end](docs/operations/setup.md#broadcast-restart-and-end).

## Development and verification

```sh
sh run-command.sh npm run check
sh run-command.sh npm run test:browser
sh run-command.sh npm run test:experiments:browser
```

`check` includes documentation/configuration validation, both frontend builds and
unit/integration tests. Browser fixtures use isolated synthetic servers and a separate
AI service child. They do not establish real account permissions, speech accuracy or
AI naturalness. See the [development guide](docs/development/guide.md) for browser
installation, lifecycle checks and design metadata maintenance.
