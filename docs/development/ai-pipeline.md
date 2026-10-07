# AI pipeline

Both live broadcasting and [interactive tests](experiments.md) use the
[independent AI service](ai-service.md). The app supplies screen/microphone evidence,
persists state and controls publication. There is no platform-chat input to AI or participant workflow. Platform chat is
received in a separate presentation-only path described in [display-only chat](display-chat.md).

## Runtime ownership

[Server composition](../../apps/server/app.ts) resolves the dedicated stream,
opens its isolated database and connects the selected model provider. Starting AI
prepares or reuses six synthetic viewers. Restart recovery preserves enabled intent
while waiting for current stream/model readiness. Demo uses artificial frames and
a mock model.

The [coordinator](../../packages/application/reactions/coordinator.ts) owns scheduling,
cancellation, usage and final publication. Service implementations own selection,
generation, inspection and review. See [reaction implementation](reactions.md) for
the ports and [inputs/accounts](inputs-and-accounts.md) for media acquisition.

## Input and context

The default speech window contains the latest ten recent transcript chunks, bounded
by ai.contextWindowSeconds and member presence. New transcripts are separate from
background. Synthetic replies alone cannot trigger an infinite response loop.

Continuous mode includes the latest current frame. On-request mode begins with
speech/context and obtains a masked frame through bounded inspection when needed.
Images use high detail. Unreadable text must not be invented.

Each request includes bounded current AI conversation, persona state and applicable
continuation. The v1 service contract's chatSummary field is empty; no human-chat
summary is created or loaded. State and context are bound to session/member/account/
model/pipeline and their evidence dependencies. See
[tools and context reuse](ai-service.md#tools-and-reusable-viewer-context).

## Selection, generation and review

The service applies member presence, observation age, global/member pacing, topic
weighting and probabilistic silence. The standard algorithm exposes update_state,
send_chat, wait and inspect_stream tools. State updates and chat candidates are
validated by their contracts. There is no separate Jev/TypeSafe request.

Generation may inspect at most one frame and optionally review the proposed reply
with the selected model. Review is a second pass, not independent moderation.
Schema, evidence membership, length and output restrictions apply to every candidate.
Direct questions should receive relevant answers when evidence permits.

## Provider boundary

API-key mode and Sign in with ChatGPT both use the Responses API without silent
fallback. API-key mode uses OPENAI_MODEL at https://api.openai.com/v1 and performs
token counting. Sign in with ChatGPT uses the selected encrypted account/model and
its supported streaming request. Speech credentials are independent.

Requests use store:false and bounded explicit input, without remote provider tools,
files, persistent provider conversations or previous_response_id. Context reuse
retains stable prefixes and local continuation; it does not promise a cache hit.
Account/model changes during token refresh abort stale work.

The authorization service checks open-session state and exact outgoing frame bytes/
capture time, transcript text/time and current message contents before provider work.
A changed or removed message remains stale even when its ID is unchanged. Local
cancellation cannot retract bytes already sent to an external provider.

Streaming succeeds only after response.completed. If its output array is empty,
fully completed response.output_item.done items are retained in output-index order,
including tool calls and reasoning continuation. Deltas and interrupted streams
cannot publish.

## Publication and recovery

Optional manual approval retains an expiring candidate. Final validation checks
session, generation, member state, deadline, current message contents and cited media.
Stop, end, hide or context replacement discards stale results before publication.
Publication commits the message, provenance and attempt outcome in one transaction,
then notifies readers. A failed reader notification cannot cause duplicate publication.

Expired evidence and invalid decisions discard the attempt and wait for new input.
Transient transport failures have a bounded consecutive-failure policy; authentication,
configured limits and unexpected scheduler failures stop AI with a sanitized explanation.
Generation calls are counted without a call-count ceiling. Token bounds, optional
verified-price API cost caps, speech limits and pacing remain independent.

## Prompts and diagnostics

Default instructions are in prompts; versioned profiles may replace them. Service
implementations may provide ModelInput.instructions. The host renderer preserves
the provider contract while algorithms remain in the independent process.

Live status retains the last 100 structured diagnostic events. Managed logs contain
categories, durations, counts and fixed reason codes, not raw prompt/transcript/draft
text or credentials. Test call-detail tabs deliberately expose full synthetic test
prompts and responses in the isolated test workspace.

Use synthetic fixtures for changes. Run npm run check and browser suites after UI
changes. Real feed isolation, provider eligibility and subjective AI quality require
separate validation; never export live media as tracked test artifacts.
