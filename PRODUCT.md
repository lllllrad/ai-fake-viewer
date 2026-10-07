# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is a Korean-speaking broadcaster operating their own stream.
They need to follow live conversation and add natural AI participation to their
local chat reader and OBS overlay while retaining control during the broadcast.
Participating viewers encounter the consent guidance and the published conversation.

## Product Purpose

Mixed Chat Studio combines permitted live chat with synthetic AI viewers in a
local broadcast workspace, reader and OBS overlay. Success means relevant,
natural participation that supports the broadcast without overwhelming real chat,
and clear operator control over inputs, generation, disclosure and session end.

## Positioning

The product combines local publication, automatically composed synthetic viewers,
and participation controls scoped to each broadcast. AI replies stay inside the
app's conversation surfaces; platform senders deliver fixed participation notices,
not generated replies. Personas do not replicate or profile real viewers.

## Operating Context

The broadcaster uses a browser workspace with Live, Broadcast preparation, Participants and
Records/rights destinations. Separate reader and transparent overlay routes support
reading chat and publishing through an OBS Browser Source. YouTube, CHZZK and SOOP
integrations have distinct authorization and runtime requirements; SOOP's official
browser SDK requires the connected administrator tab to remain open.

Operation is local, with documented private-LAN reader/overlay access. Administrator
access remains local. Internet-facing and reverse-proxy deployment are unsupported.
Demo operation uses artificial input and no paid model.

## Capabilities and Constraints

- Compose six synthetic viewers automatically, without operator persona authoring
  or real-viewer profiling. Keep the cast for the broadcast, including restarts;
  permit silence and reduce AI activity when real chat is busy.
- Require the documented operating profile, platform permissions and individual
  participation conditions. Ordinary unconsented viewer text must not reach public
  display, storage or AI context. Fixed notice delivery alone does not grant consent.
- Use one fresh informed consent command after confirmed guidance, with the
  documented age self-declaration and broadcast-account exception. Operators cannot
  bypass participation requirements by directly activating a viewer.
- Withdrawal removes raw and identifiable derived context, cancels dependent work
  and prevents late publication. External provider records and published video
  require separate follow-up; local deletion does not promise remote deletion.
- Preserve broadcast state across process restarts. Explicit broadcast end deletes
  ordinary session data; a new broadcast starts with fresh participation and AI
  disabled. Credentials and unresolved rights requests have separate lifetimes.
- Keep AI stop available and disclose input or model failures clearly. Disclosure
  stops generation and reveals origins irreversibly for that broadcast, preserving
  real nicknames and synthetic names.
- Use the Responses API with explicitly selected Sign in with ChatGPT or API-key
  authentication. Account/model eligibility and processing conditions must match
  the operating profile; no silent provider fallback is allowed.
- Configured broadcast media, transcription and exports follow the current input
  contracts. Preserve consent and publication checks at processing boundaries.
- Keep credentials, private configuration, raw viewer content and local research
  out of tracked files.

Detailed behavior and known limitations remain owned by the
[current behavior contract](docs/specifications/behavior.md),
[dashboard specification](docs/specifications/dashboard.md),
[participation specification](docs/specifications/participation.md),
[persona specification](docs/specifications/personas.md) and
[AI pipeline documentation](docs/development/ai-pipeline.md).
These documents govern implementation details; this record captures durable
product intent. Latest accepted requirements take precedence over obsolete notes.

## Brand Commitments

Prefer category-standard interfaces, established UI libraries and familiar operating
patterns. Clarity and task efficiency take precedence over visual experimentation.
Screen organization is replaceable; preserve product capabilities and data/API
contracts rather than incidental navigation or inconvenient interactions.

Preserve the product name Mixed Chat Studio and Korean application UI localization.
Tracked documentation remains English. Use the official names **Sign in with
ChatGPT** and **Responses API**, and preserve exact configuration/API identifiers.

## Evidence on Hand

The repository contains the implemented browser surfaces in `apps/web`, current
[product contracts](docs/README.md), synthetic fixtures in `fixtures` and automated
tests in `tests`. The [operations guide](docs/operations/setup.md) documents setup
and remaining live acceptance responsibilities. Automated fixtures do not establish
real platform approval, actual notice delivery, provider eligibility, external
deletion or real-model naturalness. Do not invent such evidence or expose private
research as public product proof.

## Product Principles

- Support the broadcaster's live task with clear status and immediate control.
- Let synthetic participation respond to available evidence and leave room for
  real conversation; more replies are not inherently better.
- Treat consent, withdrawal and session boundaries as product behavior throughout
  every conversation surface and processing stage.
- Separate persisted operator intent from current readiness, and local actions
  from external outcomes.
- Keep routine operation understandable; reveal technical details when they help
  diagnose or resolve a problem.

## Accessibility & Inclusion

Preserve Korean-language readability, keyboard navigation and meaningful focus
behavior. Routine status updates must not steal focus. Keep explicit action labels,
usable pending/error states and clear distinctions between missing configuration,
waiting input and failure, as specified in the dashboard contract.
