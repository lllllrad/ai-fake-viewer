---
version: 1
slug: "apps-experiments-web-features-experimentspage-tsx"
primary_target: "apps/experiments/web/features/ExperimentsPage.tsx"
related_targets:
  [
    "apps/experiments/web/features/MicrophoneInput.tsx",
    "apps/experiments/web/features/experiments.css",
    "apps/experiments/web/main.tsx",
    "apps/experiments/web/shell.css",
  ]
---

# Interactive AI viewer testing

Mode: Operate. Scope: the independent AI viewer test app on port 3211.

## Direction contract

THESIS: Let the broadcaster speak or type to synthetic viewers, observe responses
and inspect personas. AI state and full model-call details are separate optional tabs.

OWN-WORLD: Reuse the Broadcast Desk tokens, Bootstrap-backed controls, Lucide icons,
Noto Sans KR, Radix tabs and native confirmation dialogs. The test shell has its own
header, login and account settings, without live navigation or broadcast controls.

STORY: Connect a test account or choose the fixture provider; start a conversation;
send text or continuous microphone input; inspect personas, per-viewer state and call
details; end and later resume the same cast/history, export it or delete the record.
Test accounts, credentials and saved sessions are isolated from the broadcast app.

FIRST VIEWPORT: The test heading and account disclosure precede the saved-session
selector. A new test collects topic, AI type and provider. An active session shows
status and end controls, then microphone controls above the three tabs. Conversation
and expandable personas occupy two columns, stacking at 1000px. Header/account actions
stack at 600px. New messages scroll only the log; reading older messages suspends
following. Tab changes preserve microphone capture and the conversation draft.

FORM: Category-standard, code-led extension of the existing system. No visual
redesign or generated comp is required. Shared controls and ordinary conversation
rows prioritize clarity, familiar operation and efficient comparison.

CONSTRAINTS: Generation has no configurable call-count cap; show accumulated usage.
Microphone chunks share the broadcast framing/transcription path. Stopping capture
or ending the test cancels pending capture work; leaving the page releases the mic
but does not end the server session. Fixture responses verify plumbing, not AI quality.

Ownership: [test behavior](../../docs/development/experiments.md),
[visual system](../../DESIGN.md) and [AI service](../../docs/development/ai-service.md).
