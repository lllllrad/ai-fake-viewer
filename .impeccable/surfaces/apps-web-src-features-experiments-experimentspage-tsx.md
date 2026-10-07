---
version: 1
slug: "apps-web-src-features-experiments-experimentspage-tsx"
primary_target: "apps/web/src/features/experiments/ExperimentsPage.tsx"
related_targets:
  - "apps/web/src/features/experiments/MicrophoneInput.tsx"
  - "apps/web/src/features/experiments/experiments.css"
  - "apps/web/src/main.tsx"
  - "apps/web/src/features/workspace/workspace.css"
---

# Interactive AI viewer testing

Mode: Operate. Scope: an isolated test conversation in the existing administrator workspace.

## Direction contract

THESIS: Let the broadcaster speak or type to synthetic viewers, observe their
responses and inspect the participating personas. Keep execution records behind
an explicit request so the conversation remains the primary activity.

OWN-WORLD: Extend the incumbent Broadcast Desk with shared Bootstrap-backed
controls, Lucide icons, Noto Sans KR, white bordered work surfaces on a cool slate
canvas and blue action/selection states. Retain readable semantic state labels,
keyboard focus and native confirmation dialogs. No new visual world or tokens.

STORY: Start a test or reopen a saved conversation; send text or a microphone
recording; follow responses and expand the six viewer personas; request execution
records when needed; end the test and retain or explicitly delete its saved records.
The screen identifies test isolation and distinguishes offline fixture responses.

FIRST VIEWPORT: The fifth task destination opens a title and test-only badge,
saved-session selector and new-test action. Before a session, a compact setup
surface collects test settings. During a session, status and end controls precede
the conversation/record controls. A scrollable conversation and its text/microphone
composer occupy the flexible desktop column; expandable personas occupy the right
column. At 1000px and below, personas follow the conversation in one column.
Mobile navigation stacks icons above labels. Execution records replace the
conversation view only after the operator requests them; returning to conversation
restores the primary workspace.

FORM: Category-standard, code-led extension of the established design system,
without a comp or aesthetic selection round. Shared controls and conventional
conversation rows establish the hierarchy; pale operator rows distinguish input,
and disclosures contain persona details and requested execution records. Keep
setup, conversation and record inspection legible at desktop and mobile widths.
