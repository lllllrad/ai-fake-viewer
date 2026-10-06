# AI chat pipeline and improvement guide

The live profile is consent-gated chat and optional broadcast-transcript and OBS Program image processing through the OpenAI Responses API, with explicitly selected API-key authentication or Sign in with ChatGPT for eligible ChatGPT plan usage. [Privacy implementation](docs/privacy-implementation.md) owns the data-boundary requirements; [development](docs/development.md) owns fixture commands.

## Runtime scope and startup

`createApp` always constructs an in-memory Store. Live mode additionally installs Participation, blocks unapproved receiver scopes and pins the selected API or subscription adapter to the privacy profile. Startup requires a complete profile, matching selected-service model/credentials and disabled third-party gate, not audio/video. AI requires manual start after restart. Automatic persona creation uses local synthetic templates rather than viewer histories or operator authoring.

Jev, persistent Store and persona authoring libraries remain standalone paths. Live video and broadcast transcription have separate explicit profile options. Demo uses artificial data and a mock model.

## Withdrawal and anonymous chat summaries

- Every raw-message admission and public projection checks the current platform/broadcaster/session/account consent generation. General text from nonparticipants is discarded before message/event storage. Private IDs, original names and consent records are absent from model DTOs.
- Withdrawal invalidates the generation synchronously, erases raw messages and orphan mappings, aborts work and clears queued drafts/cache/manifests. Tracked directly or indirectly dependent AI messages are removed conservatively. Late responses cannot publish. External processing already started is not described as undone.
- Local summary creation considers currently permitted recent human chat only. It emits fixed topic/mood labels supported by at least three distinct accounts, without quotes, personal stories, links or provenance tables. Counts/regular expressions alone do not certify legal anonymity. No external summary request is made.
- The strict live anonymous area retains categories approved before withdrawal for the rest of the current session; withdrawn text is never used to rebuild them. No account/message/source mapping is stored in that area. Session close/reset clears it. Admin **Reset chat summary** clears the aggregate with a sequence cutoff and invalidates current work.
- Model request IDs are associated with participants only in memory. Withdrawal creates a separate minimal rights task if text was displayed or requests were associated. App deletion, provider handling and VOD/copy handling remain distinct.

## Runtime overview

```mermaid
flowchart TD
  A[Official receiver] --> B[Exact command and current consent check]
  B -->|Not permitted| C[Discard ordinary body]
  B -->|Current ACTIVE generation| D[Session memory]
  D --> E[Filtered reader and overlay]
  D --> F[Fixed anonymous categories]
  D --> G[Persona selection and context]
  F --> G
  G --> H[Recheck profile and consent revision]
  H --> I[Responses API with selected authentication]
  I --> J[Schema and evidence checks / optional draft review]
  J --> K[Current generation check and local publication]
  W[Withdrawal / profile change] --> L[Invalidate and cancel / remove raw and derived context]
  L --> R[Separate minimal external and video follow-up]
```

## Stage reference

### 1. Audio capture and transcription

Opt-in through `privacy.audioEnabled`. The configured audio source is transcribed by Groq; recent transcript text can enter the selected Responses API model. Session transcripts support authenticated export. Withdrawal/context invalidation clears speech history and discards in-flight results. No automatic speaker-to-viewer consent mapping is inferred. See [audio setup](LIVE_SETUP.md#broadcast-audio-and-transcription).

### 2. Video capture and masking

Disabled live because screen chat cannot be reliably consent-filtered. No frame upload, preview-confirmation gate or implicit image fallback. Synthetic demo capture remains available.

### 3. Event selection and scheduler

Enabled AI waits when no new permitted human text or enabled transcript is available; readiness alone does not guarantee generation. New permitted human text or enabled speech triggers evaluation within `ai.contextWindowSeconds`; synthetic replies alone do not trigger loops. Random pacing, global/per-character cooldown, session budgets and busy-chat suppression apply. Current message DTOs, recent synthetic replies, automatic persona style and approved fixed summaries are explicit model context. Consent revision is captured with the input. Queue, review and publication invalidation uses the existing scheduler/persona cancellation controls.

Reaction deduplication uses a hash of the current chat sequence and message,
transcript and frame IDs, scoped to persona session/member. The chat sequence is
still recorded for diagnostics, but it is not the sole identity: fresh speech can
arrive without any new chat event. Duplicate context reservations are skipped
without raising a database uniqueness error. The scheduler catches preparation
errors as well as model failures; unexpected preparation failures stop AI with
`scheduler_error` instead of terminating the server. Legacy standalone databases
migrate the older sequence-only uniqueness constraint without dropping attempts.

### 4. Legacy Jev timing veto (disabled live)

Legacy utility only. Enabling it blocks live readiness rather than transmitting text to TypeSafe.

### 5. Answer generation and inspection

Both adapters check profile/model/revision, explicit video/audio permission and freshness/content of transcript evidence and current permission for every input message during preparation and immediately before the Responses API request. Only API-key mode performs token counting, with a permission check before that request too; token counting and inference use the configured endpoint. Sign in with ChatGPT uses its supported public Responses API endpoint without the API-key token-counting preflight. Neither mode silently falls back to another region/provider. Requests have `store:false`, bounded input/output, strict output schema, no provider tools, persistent conversation, `previous_response_id`, files or opaque retained context. Image inspection requires enabled video and current frames.

### 6. AI draft review (default enabled)

The same approved model may reject or lightly edit a proposed response; it is not independent moderation. It receives the same consent/profile checks and cancellation. Schema, length, evidence/reference and obvious unsafe-pattern checks remain. Detection is imperfect; administrator hiding and rights-request handling remain necessary.

### 7. Human review and local publication

Optional manual approval adds an expiring queue. Stopping, withdrawal, removed evidence or stale generation prevents publication. Approved AI messages enter only the local memory stream and its reader/overlay. There is no AI native-platform sender.

## Prompt and tool inventory

Live response/review prompts live under `prompts/`; model serialization is in `packages/model.ts`, consent in `packages/participation.ts`, projection/summary/deletion in `packages/storage.ts`, and authorization wiring in `apps/server/app.ts`. The model receives no tools or rights-queue data. For SOOP, the connected admin SDK automatically sends server-issued fixed notices after unconsented chat and at each consent stage, with pre-send account/global limits and matching broadcaster MESSAGE confirmation. YouTube and CHZZK run their fixed-notice senders on the server while receivers are active; every notice part requires a successful platform response. AI replies never use those senders. Fixed platform guidance is rendered from the reviewed public profile, never generated by AI or interpolated with viewer text/nicknames.

## Fast improvement workflow

Change prompts or scheduler behavior with synthetic fixtures. Run `sh run-command.sh npm run check` and the browser checks after UI changes. Never copy real chat, screenshots, API credentials or SDK debug payloads into fixtures, logs or reports. Check both withdrawal cancellation and current-generation validation when changing queue behavior.

## Configuration and live visibility

Use [config.example.yaml](config.example.yaml), [live setup](LIVE_SETUP.md) and the admin operating-profile panel. `privacy` is public configuration, not a credential store. Default blank fields fail closed. A current-process profile PUT stops inputs/generation, invalidates consent and removes previous raw context; persistent changes belong in YAML. Budgets are current-session memory; provider account limits are separate.

## Privacy and boundaries

`store:false` is not proof that all provider logs are erased. Actual account data controls, region/model eligibility and retention must match the notices; see [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data). Local cancellation cannot retract network bytes already delivered. Host swap/crash captures and external video copies require operator review. Session end clears all ordinary app context; exceptional rights tasks and credentials have separate storage and purpose.

## Sign in with ChatGPT without an API key

`chatgpt_subscription` uses the app's Sign in with ChatGPT account and selected model, with no API-key/environment-model requirement. The OpenAI Responses API HTTP request uses `store:false`, `stream:true` and explicit required history in `input`, with no tools/chaining. Inference succeeds only after `response.completed`; deltas alone, interrupted streams and failed/incomplete terminal events do not qualify. The same current-consent guard runs before preparation and after asynchronous token refresh immediately before sending; account/model changes during refresh abort the call. Request IDs enter the same withdrawal follow-up mechanism. Subscription requests do not use API-key token counting or API USD pricing; local call/size and reported token limits still apply. Contract/profile mismatches stay blocked.

The explicit [operator-reviewed test configuration](docs/privacy-implementation.md#operator-reviewed-test-configuration) can defer descriptive profile metadata during reviewed testing. Viewer consent, withdrawal, channel approval, model compatibility and actual notice limits remain required.

## Per-attempt failures and AI enablement

Expired/replaced transcript context and rejected or invalid model decisions discard
only the current attempt. AI remains enabled and waits for new input at the normal
configured pace; the discarded input is not replayed automatically. Transient
network/timeout failures may continue on fresh input, but three consecutive such
failures stop generation. Authentication/provider failures, privacy restrictions,
call budgets and unexpected scheduler failures still stop AI.

The admin status exposes a sanitized `ai.lastIssue` category, timestamp, explanation
and continuation flag; the dashboard shows the explanation next to AI controls.
Raw provider payloads or transcript bodies are not included in this diagnostic.
The original historical `model_error` state did not expose a precise cause, so it
cannot by itself establish whether a past stop was a timeout, invalid output or
stale input. Current transcript evidence is still revalidated before each model
request, including draft review.

## Temporary reply testing

`ai.forceReplyTest` defaults to false. When enabled, an additional developer prompt
asks generation and review to produce a short grounded Korean reply even for
ordinary new input, overriding voluntary silence and novelty preferences. The
scheduler bypasses probabilistic participation suppression and the optional timing
gate. It still selects one eligible persona, not the entire cast.

Fresh permitted evidence, persona presence, cooldowns, configured pacing, volume
caps, consent, withdrawal, output validation, review, and call budgets remain in
force. There is no fabricated fallback response or retry loop to force publication.
The model can still skip unusable or unsafe input, and provider errors can still
prevent a reply. Status and the administrator dashboard identify this temporary
mode. Disable `ai.forceReplyTest` and restart to restore ordinary participation;
restore any separately adjusted pacing values as well.

Before draft review, expired background transcripts are removed from both the
context and new-transcript lists. If a draft cites an expired transcript, that
attempt is discarded instead. Review still rechecks the original privacy revision
and all current permissions; expiration cleanup never authorizes withdrawn data.

AI diagnostics retain the last 100 structured events in authenticated
`/api/admin/status` under `ai.diagnostics`. The managed server also writes these as
`ai_diagnostic` JSON lines to `.local/server.log`. Events distinguish generation
and review requests/results, review rejection, expired context, and publication or
candidate discard. They contain timestamps, stages, validated decision actions,
counts, durations and fixed reason codes, never chat/transcript/draft text, names,
credentials or raw provider errors. A reviewer `skip` is recorded as a rejection;
its internal rationale is not inferred or logged. Logs are local diagnostics, not
proof that a browser displayed a published message.

New persona sessions allow 30 seconds total for generation plus review, with a
45-second reaction lifetime measured from the triggering observation. This replaces
the previous 6-second request deadline and 12-second reaction lifetime, which could
abort review after generation had already succeeded. Existing explicit session
policies are not rewritten. Evidence expiry, withdrawal and session changes can
still discard a result sooner; this is not an extension of transcript retention.
