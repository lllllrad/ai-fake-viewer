# Persona and reaction experiments

The experiment workspace runs the production persona composition and reaction
pipeline without platform connectors or the broadcast database. It is a developer
tool, not a new operator persona-authoring or forced-response mode.

## Run and compare

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

Choose a network provider explicitly:

```sh
sh run-command.sh npm run experiment -- --provider openai_api --max-calls 6
sh run-command.sh npm run experiment -- --provider chatgpt_subscription --max-calls 6
```

The Responses API adapter uses `OPENAI_API_KEY` and `OPENAI_MODEL` from `.env`.
The Sign in with ChatGPT adapter reads the project's existing selected account
using `TOKEN_ENCRYPTION_KEY`. Experiment execution never refreshes or writes the
shared token file: if the access token needs refresh, refresh the session through
the running project's account flow and rerun. There is no account/provider
fallback. The server remains the owner of persistent authentication updates.

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
