# Persona and reaction experiments

The experiment workspace runs the production persona composition and reaction
pipeline without platform connectors or the broadcast database. It is a developer
tool, not a new operator persona-authoring or forced-response mode.

## Independent server

The live server on port 3210 does not mount the test API, serve the test UI or
construct an experiment workspace. Tests run in a separate process and frontend
bundle with no platform connectors, broadcast controls or live database handles.
The production reaction, nickname, transcription and pipeline modules remain shared
code. Unit/browser fixtures and replay reports remain isolated developer commands.

```sh
sh run-command.sh npm run experiments:setup
sh run-command.sh npm run build
sh run-command.sh just experiments-start
sh run-command.sh just experiments-status
sh run-command.sh just experiments-restart
sh run-command.sh just experiments-stop
```

For foreground development use `sh run-command.sh npm run experiments:start`.
The default test port is 3211. If changing `config.json` to another port, pass the
same value with `just --set experiments_port PORT experiments-start` (and the
corresponding status/restart commands). The test administrator token is
`EXPERIMENT_ADMIN_TOKEN` in `.local/experiments/.env`; it is different from the live
administrator token. Cookies have separate names, so logging out of one workspace
does not log out of the other. Test PID/log files are `.local/experiments/server.pid`
and `.local/experiments/server.log`. Existing `.local/experiments/interactive` history
is retained without copying or rewriting it.

Setup creates missing files only. It snapshots `audio.provider`, `audio.language`
and the pipeline profile path from the existing configuration, and copies only
`OPENAI_API_KEY`, `OPENAI_MODEL` and `GROQ_API_KEY` into the private test environment.
It generates independent administrator/encryption credentials. Runtime thereafter
reads only `.local/experiments/config.json` and `.local/experiments/.env`; live setting
changes do not affect it. API keys may initially refer to the same provider account
and billing budget; replace them in the test environment for separate billing.

Sign in with ChatGPT must be connected separately in **Test AI connection**.
The test server owns `.local/experiments/chatgpt.tokens` and refreshes only that file.
Successful OAuth returns to the test UI with account settings expanded, preserving
the original localhost/127.0.0.1 hostname. Failed callbacks do not redirect as a success.
Changing/disconnecting a test account stops the current test, never the broadcast.
Once a connected ChatGPT account has a selected model, new test forms default to
Sign in with ChatGPT unless the operator explicitly chose another provider.
Account/model saves disable test start until completion and automatically refresh
test readiness and clear outdated connection errors; no manual reconnect check is
needed. Startup errors identify the selected provider.
The replay CLI also uses the test environment and reads that test account without
refreshing it; run/refresh the test server account before a long CLI session.
Offline fixture replay needs no setup, credentials or running server.

## Interactive viewer tests

Open the independent test workspace at `http://127.0.0.1:3211/admin`. The primary surface is a conversation, with six
automatically composed viewers and expandable persona details alongside it.
Enter a broadcast topic, explicitly choose Responses API, Sign in with ChatGPT
or the offline fixture provider, and start a test. Text input represents what
the broadcaster says, entering the same speech evidence journal as microphone
transcriptions. It is not inserted as a consented platform viewer message.

The interactive session uses the production `ReactionCoordinator`, cast
selection, participation propensity, generation, review, pacing and publication
rules in real time. It can remain silent. It does not force every viewer to
reply or accelerate the profile's intervals. The selected startup pipeline
profile supplies persona definitions and prompts; this text/audio surface uses
`on_request` visual mode and supplies no screen frames. Changing a profile still
requires restarting the server and starting a new test.

Use **Speak with microphone** to continuously capture audio until **Stop microphone**.
The browser uses an AudioWorklet in a mono 16 kHz context and emits signed 16-bit
PCM chunks. It calls the same `PcmChunks` framing/RMS code as the broadcast FFmpeg
worker. The server calls the same `Transcriber`, `transcribeSpeech` and provider
adapter as broadcasting: default 10-second chunks (configurable 10–30 seconds),
RMS greater than 140, one request in flight with new chunks discarded while busy,
20-second transcription timeout, a shared 1,000-character transcript limit and
capture-end timestamps preserved through publication. Microphone transcripts use
the normal coordinator polling cadence; text input remains an immediate stimulus.

The test configuration copies `audio.chunkSeconds` and `audio.maxRequests` at setup
in addition to provider/language. Existing test settings use the broadcast defaults
when those fields are absent. OpenAI uses `whisper-1` with `OPENAI_API_KEY`; Groq
uses `whisper-large-v3-turbo` with `GROQ_API_KEY`. Empty language enables detection.
Transcription is independently billable even with fixture reactions. No provider
fallback occurs. Full chunks send automatically; silence makes no provider call.
Stopping discards the partial chunk and cancels in-flight transcription; there is
no short-recording flush or backlog replay. Raw PCM is not persisted.

Browsers must support AudioWorklet and microphone access on localhost or HTTPS.
Audio device/resampling differences remain: the test source is the browser mic,
while the live source is configured FFmpeg input. Permission/support failures leave
text input available. These capture adapters share downstream framing and processing.

Each test permits 1–100 model calls (default 12), counting generation and review,
the configured audio request budget (default 360) and 300 submitted utterances, and ends after 30
minutes. Model requests have a 30-second timeout; speech requests use the broadcast 20-second timeout. The limits are
call limits, not monetary guarantees. One test runs at a time. Leaving the page
stops local recording but does not stop the server-side test; use **End test**.
Ending cancels outstanding requests and prevents late replies from being
published. No platform connector, live transcript journal, reader overlay or
broadcast database receives test input or output.

**Execution history** is an explicit secondary view, fetched on demand. It
contains actual model requests and responses, diagnostic stages, participation
and publication attempts, and the resolved profile/prompts. These are observable
application steps, not private model reasoning. Download the full JSON record
for separate inspection. Returning to the conversation does not trigger new
inference.

Automatic test casts use the same [stable synthetic nickname rules](../specifications/personas.md#stable-synthetic-nicknames) as broadcasts. Trace downloads include `personaProvenance`, including the saved name, root and transformations; older traces default this field to an empty list.

Conversation, persona and trace snapshots are privately stored in
`.local/experiments/interactive/` with owner-only files. Reloading the browser
reopens the active test; server restart leaves saved sessions readable but does
not resume generation. An interrupted session is labeled accordingly. Retain at
most 100 sessions; delete old sessions using **Delete test record**. Test records
are independent of broadcast withdrawal, retention and session end, so use only
your own or separately authorized inputs. Deleting a record does not delete
downloaded copies or provider-side records. Test keys and account credentials
are never included in records.

The fixtures verify the browser's continuous PCM/upload flow with a synthetic
microphone and mocked transcription providers. They do not establish real microphone quality,
speech recognition accuracy or real-model naturalness.

## Replaceable AI implementations

**AI type** selects an algorithm implementation independently of **AI connection**
(the model provider/account). The shared [implementation registry](../../packages/application/reactions/pipelines.ts)
contains the built-in `standard` pipeline. Its `create` factory replaces the whole
reaction engine, including observation/selection, generation/review and scheduling;
this is not a provider adapter or a prompt-only preset. The engine implements the
public `ReactionEngine` lifecycle contract. The `draft` entry supplies its matching
isolated draft path. Registered implementations are trusted repository code; JSON
selects an ID and cannot load arbitrary executable module paths.

To add an algorithm, implement `ReactionPipeline` (`id`, `revision`, `label`,
`description`, `create`, `draft`) in an application module and register it alongside
`standard`. Keep module dependencies within the application/domain boundaries.
The test UI lists registry metadata automatically. Select it for a new test, then
promote the same ID to live `ai.pipelineType` (or a versioned profile's
`ai.pipelineType`) and restart the live server. No separate test implementation
needs to be ported. The test server's `pipelineType` setting supplies its default;
a profile's type overrides that default, and an explicit test selection wins for
that test. Existing tests keep their chosen type until ended.

Both server composition roots and replay use this registry. Draft CLI runs call
the selected entry's `draft`, not a hardcoded baseline. Unknown IDs fail without
fallback. Interactive snapshots retain type ID and implementation revision; old
records default to `standard@1`. A type registration itself is not evidence of
correct publication or consent behavior: alternate engines must preserve cancellation,
usage accounting, evidence and publication guards, and pass the same conformance
suite before live use. Only the existing standard algorithm ships by default;
synthetic alternate implementations are exercised in tests, not presented as
validated new AI behavior.

## Replay and compare

From the repository root:

```sh
sh run-command.sh npm run experiment
sh run-command.sh npm run experiment -- \
  --profile experiments/profiles/baseline.json \
  --profile experiments/profiles/short-context.json \
  --scenario experiments/scenarios/direct-question.json \
  --scenario experiments/scenarios/silence.json \
  --repeat 3 --seed 1
sh run-command.sh npm run experiment -- --mode draft --persona 0
sh run-command.sh npm run experiment -- --mode draft \
  --scenario experiments/scenarios/screen-question.json
sh run-command.sh npm run experiment -- --help
```

The command prints the path to a standalone `report.html`. Open it in a browser;
no development server or network connection is required to view it. Each column
contains final local messages, generated drafts, review calls, actual model
inputs, rendered requests, persona snapshots, diagnostic reasons, checks and
usage. Filter runs and export evaluation notes with the controls at the top.
Notes are not saved until exported. `results.json` retains machine-readable
results; `manifest.json` records the source commit, dirty state and tracked diff
hash. Commit source changes for reproducible comparisons: untracked source is not
included in the diff hash.

Results default to an ignored, private `.local/experiments/<timestamp>` directory.
`--out DIRECTORY` must name a new directory; old results are not overwritten.
Delete an experiment directory when its artifacts are no longer needed. These
artifacts have an independent lifetime from a broadcast.

The default `fixture` provider is deterministic, offline plumbing validation. It
quotes synthetic evidence with an explicit fixture prefix; it cannot measure
naturalness, persona quality or real model latency. Compare real model results
before promoting a behavioral change. No live provider calls are part of the
repository's experiment tests.

## Two execution levels

- `replay` executes `ReactionCoordinator`, automatic cast selection, context
  selection, usage reservation, generation, inspection, review, pacing and local
  publication against an isolated SQLite memory store. It does not bypass
  participation propensity, limits or review to manufacture a response.
- `draft` assembles the final scenario context and invokes the shared
  `generateReviewedDraft` flow for one `--persona 0..5`. It includes optional
  inspection, review and call metering, but deliberately bypasses cast selection
  and publication. A candidate is not a published message.

Replay uses a seeded random stream and an injected clock, never global timer or
`Date.now` patches. Scenarios run for at most ten virtual minutes. Inputs are
applied at their timestamps; the coordinator is polled at one-second intervals
and event boundaries; publication delays execute at their scheduled time. Model
calls are awaited with virtual time paused. Reported wall time measures actual
model calls; virtual timestamps describe simulated scheduling, not live latency.
This is serialized replay, not a load/concurrent-arrival simulator. Existing
race/cancellation tests cover inputs changing during outstanding requests.
Identical fixture runs are reproducible; real model outputs need not be.

## Versioned pipeline profiles

`experiments/profiles/` holds strict JSON profiles. A profile identifies its
`schemaVersion`, `id` and positive `revision`. Increment the revision for an
intentional change; the resolved content hash also detects edits without a
revision bump. Profiles can change:

- `ai.visualMode`, `reviewDraft`, `contextWindowSeconds`, `transcriptLimit` and
  `pacing`. Limits use the production configuration schema. Transcript selection
  supports one to ten chunks from the existing bounded speech journal.
- `prompts.answer` and `prompts.review`: file paths relative to the profile file.
  Both are required when overriding prompts. Omit this object to use the shared
  files in `prompts/`. The resolved prompt text is captured in results.
- `personas`: exactly six partial patches in automatic seed order: background
  listening, curiosity, learning, vicarious reaction, shared interest and support.
  `core`, `voice` and `participation` merge by field. `knowledge`, `examples` and
  `negative_examples` replace whole arrays. Identity remains automatically
  generated, and the final definition must pass the production schema.

For example, a participation experiment can use:

```json
{
  "schemaVersion": 1,
  "id": "curiosity-more-active",
  "revision": 1,
  "ai": { "visualMode": "on_request" },
  "personas": [
    {},
    { "participation": { "base_propensity": 0.45 } },
    {},
    {},
    {},
    {}
  ]
}
```

Algorithm changes belong in the shared application/domain owners, not a second
implementation inside the runner. The experiment profile is a typed configuration
boundary, not an arbitrary executable plugin loader. Broadcast cast size remains
six. Timing-provider experiments and operator manual message approval are not
included in this runner.

## Synthetic scenarios and checks

Scenarios declare a topic, duration and ordered `events` with `atMs` and `kind`:

- `speech`: synthetic transcription text.
- `chat`: synthetic author and text, admitted as a consented fixture viewer.
- `withdraw`: erase that fixture author's current chat context and dependent
  output. A subsequent fixture `chat` explicitly grants consent again.
- `frame`: a local image `file` relative to the scenario; decoded with pixel/byte
  limits and converted to JPEG. Continuous video profiles need a frame at time
  zero and fresh frames throughout the scenario. Image IDs and bytes are captured
  in rendered requests for review.

Fixtures do not transcribe audio or connect to OBS. They represent inputs after
those adapters. Synthetic chat follows production ingestion/storage rules; the
runner does not test platform notice delivery or pretend a fixture represents a
real viewer's consent. Never automatically export live viewer chat or audio into
tracked scenarios. Full fixture inputs and outputs are intentionally retained in
experiment artifacts; only use synthetic or separately authorized material.

`expectations.minPublished`, `maxPublished` and `forbiddenText` are replay checks.
They examine output remaining at scenario completion, after any withdrawal.
A failed check or model-call error gives the CLI a nonzero exit status while
preserving completed results. Absence of a check is not evidence of quality.
Human evaluation should cover relevance, evidence grounding, persona distinction,
repetition, invented history and appropriate silence, not just response count.
Use paired seeds and several scenarios, including empty input and active viewers.

## Existing model accounts

Both interactive tests and CLI runs use an explicitly selected provider.
Choose a CLI network provider explicitly:

```sh
sh run-command.sh npm run experiment -- --provider openai_api --max-calls 6
sh run-command.sh npm run experiment -- --provider chatgpt_subscription --max-calls 6
```

The Responses API adapter uses `OPENAI_API_KEY` and `OPENAI_MODEL` from
`.local/experiments/.env`. The Sign in with ChatGPT CLI adapter reads only the test
account using `EXPERIMENT_ENCRYPTION_KEY`. Replay never refreshes or writes that
token file: refresh the account through the independent test server and rerun.
There is no account/provider fallback or live-account access.

`--max-calls` defaults to 12 per run and counts generation, inspection and review.
`--total-calls` defaults to 100 across the entire command. Runs are sequential and
model calls have a 30-second timeout. Input/output token limits use the production
configuration defaults (24,000/500); these are not monetary spending guarantees.
Usage limits belong to experiments separately from the broadcast session.

## Apply or roll back in the project

After reviewing the results, set the existing local `config.yaml` field:

```yaml
ai:
  pipelineProfile: experiments/profiles/baseline.json
```

Keep all other existing configuration. Restart through `just server-restart` to
load the selected file. Prompt and pipeline settings are read once at startup;
editing an experiment file does not mutate the running server. The server records
the profile ID, revision and resolved hash in its audit log. Empty
`pipelineProfile` restores built-in behavior. Selecting the previous version and
restarting rolls back the pipeline.

Automatic cast definitions belong to the broadcast and survive restart. Changed
persona patches take effect when the next broadcast creates its cast; restarting
does not rewrite existing viewers. To compare a coherent new cast plus pipeline,
promote between broadcasts. On an existing broadcast, a restart can apply new
prompts/settings while retaining the old cast. Profiles do not change privacy
configuration, platform connectivity, model account selection or budgets.

## Ownership and verification

- [Profile loader](../../packages/infrastructure/reactions/pipeline-profile.ts):
  strict profile validation, prompt resolution, fingerprint and cast composition.
- [Interactive workspace](../../packages/infrastructure/experiments/interactive.ts):
  isolated real-time sessions, bounded private history and shutdown.
- [Interactive routes](../../apps/experiments/routes.ts):
  administrator-only commands, text admission, bounded audio upload and trace export.
- [Interactive UI](../../apps/experiments/web/features/ExperimentsPage.tsx):
  conversation-first tests, personas and optional execution history.
- [Runner](../../packages/infrastructure/experiments/runner.ts): isolated adapters,
  fixture ingestion and production pipeline invocation.
- [Runtime](../../packages/infrastructure/experiments/runtime.ts): clock, delayed
  callbacks, random stream and identifiers scoped to one run.
- [Report](../../packages/infrastructure/experiments/report.ts): escaped standalone
  comparison UI with no external assets or remote calls.
- [CLI](../../scripts/experiment.ts): suite iteration, provider selection, whole
  command call cap and private artifacts.
- [Tests](../../tests/experiments.test.ts): reproducibility, silence, participation,
  review rejection, budget exhaustion, withdrawal, prompt application and escaping.

Run `sh run-command.sh npm run check` and
`sh run-command.sh npm run test:experiments:browser` after building.
