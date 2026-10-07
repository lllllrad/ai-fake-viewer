# Architecture and runtime boundaries

Current behavior is owned by [behavior](../specifications/behavior.md),
[personas](../specifications/personas.md) and [dashboard](../specifications/dashboard.md).
The live app consumes a dedicated screen/microphone stream; the separate test app
shares speech processing and the independent AI service.

## Dependencies and ownership

| Location                | Responsibility                                              |
| ----------------------- | ----------------------------------------------------------- |
| packages/domain         | Pure lifecycle, evidence, naming and publication policies   |
| packages/application    | Use cases, cancellation, lifecycle and explicit ports       |
| packages/infrastructure | SQLite, media workers, model authentication and adapters    |
| packages/contracts      | Validated boundary DTOs                                     |
| apps/server             | Live composition, HTTP security and websocket delivery      |
| apps/experiments        | Isolated tests, their accounts and conversation history     |
| apps/web                | Operator workspace, reader and overlay                      |
| services/viewer-ai      | Replaceable AI algorithms behind an authenticated local API |
| workers                 | Bounded screen and PCM acquisition                          |

Domain/application code must not import concrete network or storage adapters.
HTTP routes validate and call application services; they do not own SQL or provider
protocols. [Architecture tests](../../tests/architecture-boundaries.test.ts) enforce
these boundaries.

## Live composition

[createApp](../../apps/server/app.ts) resolves one media URL, opens the dedicated
session store, connects model authentication, wires broadcast lifecycle and registers
media/model/reader APIs. Display-only platform receivers, OAuth and the SOOP SDK
bridge feed a separate in-memory presentation projection. They hold no AI store
reference. Participant admission, policy-profile updates, consent notices and rights
workflows remain removed. See [display-only chat](display-chat.md).

BroadcastService owns operator intent, start/stop/end/new-session and shutdown.
Stopping AI does not stop media collection. End closes the session synchronously,
then drains inputs; async callbacks cannot start work in a replaced session.
[Storage](storage.md) documents retention and historical-file isolation.

## AI boundary

The app owns input, credentials, usage accounting and final publication. The
[independent AI service](ai-service.md) selects personas and performs algorithm
steps through model and inspection callbacks. The model authorization boundary
rechecks exact frame bytes/times, transcript text/times and current message contents.
Publication rechecks session, generation, member policy, deadline and evidence.

## HTTP and readers

Administrator and OAuth routes are loopback-only. Host/origin validation, independent
admin/reader tokens, HTTP-only login cookies, sanitized errors and bounded websocket
delivery remain. Optional LAN access is limited to reader/overlay surfaces.

Reader sessions authenticate before receiving the current snapshot. Every event is
reprojected before delivery. Backpressure, heartbeat failure, token rotation and
shutdown dispose subscriptions and timers. No notice packets are emitted.

## Verification

Changes must preserve restart recovery, transactional deletion, late-result rejection,
account/model pinning, media cancellation and independent test sessions. Run the full
check and isolated browser suites. Synthetic checks do not establish source masking,
real microphone isolation or AI naturalness.
