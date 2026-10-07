# Mixed Chat Studio

A local workspace, reader and OBS overlay with six synthetic AI viewers. A dedicated
stream supplies the intended screen and microphone. Generated replies appear only
in the app, reader and overlay. The interface is Korean.

See the [documentation index](docs/README.md), [setup guide](docs/operations/setup.md)
and [interactive AI tests](docs/development/experiments.md).

## Processes and workspaces

| Process          | Address                     | Responsibility                                          |
| ---------------- | --------------------------- | ------------------------------------------------------- |
| Broadcast server | http://127.0.0.1:3210/admin | Media input, AI controls, reader and overlay            |
| Test server      | http://127.0.0.1:3211/admin | Text/microphone tests, personas, state and call details |
| AI service       | http://127.0.0.1:3212       | Shared AI algorithms; no browser UI                     |

Broadcast and test apps have separate credentials, accounts and storage. Both call
the [independent AI service](docs/development/ai-service.md). Managed startup ensures
that service is running; stopping an app leaves it available.

## Quick start

Use the pinned Node version through [run-command.sh](run-command.sh):

```sh
sh run-command.sh npm ci
sh run-command.sh npm run setup
sh run-command.sh npm run build
sh run-command.sh just ai-service-start
sh run-command.sh npm run demo
```

Setup creates missing private credentials/configuration. Sign in with ADMIN_TOKEN
from .env. Demo uses synthetic frames, an in-memory store and a mock model.
Stop the foreground demo before starting another app on the same port.

## Live configuration

Set input.streamUrl in private config.yaml to the dedicated RTMP/RTMPS playback
address. Screen and speech use that same feed. Prepare a screen without viewer chat
or notifications and an audio track containing only the intended microphone.
The app does not create an RTMP server or configure OBS.

Choose Sign in with ChatGPT or API-key authentication explicitly. Both use the
Responses API. Configure OpenAI or Groq transcription separately. There is no silent
provider or input fallback. See [configuration](config.example.yaml) and
[setup](docs/operations/setup.md).

Manage the shared server with just server-start, server-status, server-restart and
server-stop through the command wrapper. YAML changes take effect on restart.

## Interactive AI viewer tests

```sh
sh run-command.sh npm run experiments:setup
sh run-command.sh just experiments-start
```

Use EXPERIMENT_ADMIN_TOKEN from .local/experiments/.env on port 3211. Connect a test
account separately or select the offline fixture. Type or speak, inspect personas,
and open AI-state and call-detail tabs when needed. Ended sessions can continue with
the same cast and history. The microphone shares live framing/transcription code.

## Storage and deletion

An open broadcast's cast, AI chat, transcripts, counters and enabled intent survive
restart. Explicit broadcast end deletes its ordinary records and leaves a closed
marker. Test histories and encrypted model accounts have separate lifetimes.
Raw media is transient. Downloaded exports and old database files are operator-managed.
See [storage](docs/development/storage.md) and
[broadcast restart and end](docs/operations/setup.md#broadcast-restart-and-end).

## Development and verification

```sh
sh run-command.sh npm run check
sh run-command.sh npm run test:browser
sh run-command.sh npm run test:experiments:browser
```

Check includes documentation/configuration validation, both frontend builds and
unit/integration tests. Browser fixtures use isolated synthetic servers and a separate
AI service child. They do not establish real microphone isolation, masking quality,
provider eligibility or naturalness. See the [development guide](docs/development/guide.md).
