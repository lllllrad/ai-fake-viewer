# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A Korean-speaking broadcaster operating their own stream and improving AI viewer
behavior. They need natural synthetic reactions, clear input/model status, immediate
control and a reader/OBS overlay. A separate test workspace supports text/microphone
conversations, persona inspection and optional execution detail.

## Product Purpose

Mixed Chat Studio creates synthetic viewer reactions from a dedicated screen and
microphone feed. Success means relevant, natural participation and clear operator
control over generation and session lifetime.

## Positioning

AI viewers are synthetic identities, not replicas or profiles of real viewers.
Generated replies stay in the app, reader and overlay. Actual YouTube, CHZZK and
SOOP chat is received for display alongside AI messages, never for AI processing.
The app does not send native platform chat or manage viewer consent/rights requests.

## Operating Context

Live and Broadcast preparation are the two operator destinations. Separate reader
and transparent overlay routes support publishing through an OBS Browser Source.
The producer supplies an already prepared RTMP/RTMPS stream containing the intended
screen and microphone. The app consumes the feed and applies optional capture masks.

The independent test app has separate credentials, accounts and sessions. Both apps
call the same AI service and share speech processing. Operation is local, with optional
private-LAN reader access. Administrator access remains local.

## Capabilities and Constraints

- Compose six persistent synthetic viewers with stable generated nicknames.
- Preserve silence, pacing and evidence-bound reactions; more replies are not inherently better.
- Use one dedicated media URL without fallback to a public broadcast or another device.
- Keep AI stop available and distinguish enabled intent from current input/model readiness.
- Preserve live state across restart. End erases ordinary records; new sessions start disabled.
- Keep model accounts and test histories separate from broadcast data.
- Support Sign in with ChatGPT and API-key authentication through the Responses API,
  with independent OpenAI/Groq speech credentials and no provider fallback.
- Support resuming ended test conversations and keep microphone capture outside tabs.
- Expose AI state and full test call details separately from normal conversation.
- Reuse bounded state/context and support replaceable algorithms through the AI service.
- Keep private credentials, configuration, media and local research out of tracked files.

Current behavior is owned by [behavior](docs/specifications/behavior.md),
[dashboard](docs/specifications/dashboard.md), [personas](docs/specifications/personas.md),
[AI pipeline](docs/development/ai-pipeline.md), [AI service](docs/development/ai-service.md)
and [test workspace](docs/development/experiments.md).

## Brand Commitments

Prefer category-standard interfaces and established libraries. Clarity, familiar
controls and efficient tasks take precedence over visual experiments. Preserve the
Mixed Chat Studio name and Korean UI. Tracked documentation is English and uses
the official names Sign in with ChatGPT and Responses API.

## Evidence on Hand

The implementation, current contracts and synthetic tests document behavior.
Automated checks do not establish real source masking, microphone isolation,
provider eligibility or subjective AI naturalness. Do not expose private research
as public proof or fabricate real-provider validation.

## Product Principles

- Make live input, generation and publication state understandable.
- Preserve session and account boundaries across asynchronous work.
- Keep detailed execution inspection optional and separate from conversation.
- Distinguish local actions from external outcomes.

## Accessibility & Inclusion

Use Korean-readable typography, keyboard navigation and predictable focus.
Routine polling must not steal focus. Preserve clear empty, loading, pending,
stale and failure states and mobile access to emergency stop.
