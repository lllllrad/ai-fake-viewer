# Admin dashboard functional specification

Version 1.5. Operating controls remain the first priority. [Privacy implementation](privacy-implementation.md) defines live participation, staged consent and memory lifetime. Implementation evidence does not establish platform or provider approval.

## Implementation and requirement gaps

| Requirement    | Current behavior                                                                                            | Remaining acceptance                            |
| -------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| First screen   | Input status and AI controls precede privacy, summaries and automatic personas                              | Full accessibility audit                        |
| Readiness      | Server checks processing profile and selected service/model; failures link to relevant settings             | Actual contracts and account configuration      |
| Inputs         | Approved official receivers; screen/audio unused because nonparticipant content cannot be excluded reliably | Review before enabling alternative input        |
| Emergency stop | Available even with stale status; independent of receiver stop                                              | Extended network failure                        |
| Disclosure     | Confirmation disarms AI and exposes platform/AI labels; nicknames stay unchanged                            | Match the actual viewer notice                  |
| Restart        | New memory session, no consent/cast/raw-context recovery, manual AI start                                   | Host/service rehearsal                          |
| Guidance       | Automatic fixed notices, observed-command assistance, separate consent stages and child restrictions        | Real delivery permissions and event ordering    |
| Withdrawal     | Raw/derived removal, cancellation, preapproved anonymous categories retained only for the session           | Provider/VOD actions                            |
| Rights         | Minimal separate tasks, optional video list, independent app/provider/video/copy checks                     | Target identification, editing and notification |

Sources: [operations-dashboard.tsx](../apps/web/src/operations-dashboard.tsx), [privacy-panel.tsx](../apps/web/src/privacy-panel.tsx), [main.tsx](../apps/web/src/main.tsx) and [server](../apps/server/app.ts). Demo uses synthetic input and a mock model, not live approval evidence.

## 1. Product principles

The operator must immediately understand whether AI is running and which inputs are available. Do not show transport codes, internal counters or verbose healthy-state details on the primary dashboard. Do not present unknown or stale state as healthy. Explain the problem and next action. Notice toggles and administrator privileges cannot bypass viewer consent.

## 2. First-screen layout

The first section contains broadcast status, screen/real-chat/transcript cards, AI enablement, emergency stop and disclosure. Live screen/audio inputs are explicitly unused, not mandatory prerequisites awaiting confirmation. Privacy/participation management, anonymous topic/mood summary and automatic cast overview follow. Connection/model details start collapsed.

There is no mask-confirmation control or `capture.confirmed` / `programConfirmed` start gate. Input restrictions prevent unconsented information from bypassing text filtering; a manual mask acknowledgement does not lift them.

## Basic status and details

Use short healthy, unused, preparing, failed and stale states. Hide platform/transport names and counts in the normal summary; expand connection details for diagnosis. Mobile users must be able to find AI controls. Do not rely on color alone.

## 3. Primary state

| Area         | Display and behavior                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------- |
| Session      | Open/closed, new session and explicit close; uncertain connectivity is not proof of broadcast end |
| Screen/audio | Unused with the input restriction explained; demo shows synthetic state                           |
| Real chat    | Healthy/not ready/problem summary; unapproved channels cannot start                               |
| AI           | Enable switch, failed prerequisites, emergency stop; model/budget details collapsed               |
| Privacy      | Incomplete-profile warning, actual notice/consent stage and unsaved rights-task warning           |

Poll every two seconds using `generatedAt`. Status data older than ten seconds, failed reads or missing required state block start. Stop remains available.

## 4. Controls

### 4.1 AI generation and disclosure

The AI generation switch checks server readiness, automatically composes six personas and starts them. There are no operator authoring, audition or approval forms in the live UI. Stop cancels generation, review and pending publication independently of receivers. Restart does not resume AI automatically. AI can be enabled before fresh permitted chat arrives; it waits for input rather than producing unsolicited messages. Enabling AI does not start receivers.

The disclosure action explicitly identifies that it will label AI-generated chat. Confirmation disarms generation and the cast, then reveals origin labels. A status replaces the button afterward; disclosure is irreversible within the session. Actual viewer and synthetic persona names are visible both before and after disclosure.

Authentication uses **Sign in with ChatGPT** when `chatgpt_subscription` is selected. Inference uses the **Responses API** with either that account's eligible ChatGPT plan usage or an explicitly configured API key. Authentication/billing and inference are distinct concepts.

### 4.2 Input controls

Starting inputs does not start AI. Separate all-input stop from individual receiver state, and recheck settings/approvals on the server. Live screen/audio start requests are rejected. If end detection is uncertain, the operator explicitly closes the session.

### 4.3 Guidance and connection controls

Legacy overlay notice switches are informational, not delivery or consent. Their runtime values are memory-only and restart from YAML defaults. SOOP uses its official browser SDK; YouTube uses server OAuth and the YouTube Live Streaming API to send fixed non-display introductions and stage notices. CHZZK uses the official Chat API from the server. These senders never send AI replies or viewer text.

CHZZK setup places its connect/reauthorize action directly next to its configuration status and callback. The action remains available when credentials are configured and authorization is already saved; disabled configuration explains the required correction. Saved authorization is not live permission verification. Connection details expose YouTube account connect/disconnect. The connected channel must match the broadcast. YouTube sending continues while the server receiver runs, without an open admin tab. SOOP requires the connected admin tab. Show waiting, approval, sending, unconfirmed and permission/quota states. YouTube confirms every part of a long notice before recording delivery; SOOP requires the matching authenticated broadcaster MESSAGE echo. Both enforce account/global attempt limits and have no manual delivery-completion control. CHZZK also confirms every part through an API message ID, enforces attempt limits and disables manual delivery confirmation. Its server sender does not depend on an open admin tab. See the [platform behavior matrix](behavior-requirements.md#platform-execution-and-notice-delivery).

## 5. Participation and privacy

The first exact consent command begins guidance. Age self-declaration, collection/use, video publication, overseas processing and any third-party provision are separate delivered stages, each requiring a fresh command. The participant list shows only minimal account, stage, age status and observed commands; unconsented ordinary text is absent. Administrators cannot set ACTIVE directly. SDK events with uncertain ordering require verification of the specific newly observed command, not old retransmissions.

Withdrawal invalidates consent, removes raw/derived context and cancels AI. Previously approved anonymous categories may remain until session end. A status command lets the operator inspect current participation. Age is shown as self-declared 14+, not verified. Known under-14 or contradictory declarations are blocked. There is no guardian-consent verification workflow, and self-issued commands cannot override the restriction.

Profile changes invalidate old consent; processing-scope updates require a new notice version. New sessions begin without participation. Exact localized command strings and stage behavior are defined in [participation.ts](../packages/participation.ts); see [privacy implementation](privacy-implementation.md) for limits and APIs.

## 6. Rights and video

Withdrawal creates minimal follow-up work when there is display/external-processing history. Requests remain possible after a session ends. Contact details are optional; no unnecessary ID-document or raw-chat input field exists. App, provider, public video and original/edited/reuploaded copies require separate checks before completion. Notify limitations for records outside operator control. Status updates do not perform external deletion.

The optional content list records platform, location, broadcast time and publication state. Automatic editing, per-viewer indexes and exhaustive causal tracking are not mandatory. Long-term VOD publication is not automatically prohibited or deleted. Remove resolved request data when no longer needed. Session deletion does not remove unresolved rights tasks.

## 7. Data and API contract

`GET /api/admin/status` returns session, inputs, readiness, privacy state and generation time. `GET /api/admin/privacy` returns public profile/issues, current participants, minimal rights tasks and optional video inventory. Mutations enforce authentication and local/Origin boundaries; browser confirmations cannot bypass server checks.

Reader/overlay messages are projected from current permitted consent generations. They do not receive administrative account lists, consent records or rights tasks. Reconnection replaces content with the current filtered snapshot. Ordinary chat is not saved in browser storage.

## 8. Acceptance

Use [browser checks](../scripts/browser-check.ts), [privacy UI checks](../scripts/privacy-browser-check.ts) and [privacy tests](../tests/privacy-requirements.test.ts). Verify first-screen placement, concise healthy status, stale-state blocking, keyboard/mobile controls, raw-text exclusion, observed-command handling, child restrictions, refusal to close app-only rights tasks and absence of browser/CSP errors. Platform contracts, real delivery and external/video actions remain operational acceptance, not synthetic PASS claims.
