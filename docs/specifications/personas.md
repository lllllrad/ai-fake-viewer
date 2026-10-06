# AI viewer persona system implementation specification

This document records implemented P0 behavior and limitations, including automatic composition and broadcast-lifetime privacy controls. It does not claim to reconstruct a missing original specification. See the [dashboard specification](dashboard.md) for UI goals and [AI_FLOW](../development/ai-pipeline.md) for the shared model pipeline.

## Scope and implementation evidence

Personas are synthetic viewers inside the app, not platform accounts. Their responses appear only in the local reader and OBS overlay. Local rules compose the default cast; the selected model generates chat. Demo chat uses fixtures.

| Responsibility                                | Source                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| Definition, brief and policy schemas          | [contracts.ts](../../packages/persona/contracts.ts)                         |
| Candidate model input/generation              | [generator.ts](../../packages/persona/generator.ts)                         |
| Versions, auditions, approval and sessions    | [service.ts](../../packages/persona/service.ts)                             |
| Observations, speech, review and cancellation | [scheduler.ts](../../packages/scheduler.ts)                                 |
| Storage, publication guards and retention     | [storage.ts](../../packages/storage.ts)                                     |
| Authenticated APIs and UI                     | [app.ts](../../apps/server/app.ts), [main.tsx](../../apps/web/src/main.tsx) |
| Regression coverage                           | [persona.test.ts](../../tests/persona.test.ts)                              |

## Default behavior: automatic composition

Operators do not create or approve personas. Manual AI start invokes `ensureAutomaticCast()`. Without an active cast, the scheduler uses public context from the broadcast description, creates six definitions, checks schema/name collisions and records snapshots and presence intervals. No separate model call, brief, audition, rating or disclosure acknowledgement is required for composition. Normal input readiness still applies.

[automatic.ts](../../packages/persona/automatic.ts) reflects motivations from the user-supplied local research `./.local/docs/real_viewer_persona_research_v0.1.md`. The private research is not a deployment dependency. Evidence IDs below refer to that source's references.

| Motivation                                      | Research evidence             | Participation behavior                                                      |
| ----------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| Background listening alongside other activities | R02/R03 personal self-reports | Low speech propensity; no claims about missed scenes                        |
| Curiosity and understanding                     | R05 spectator research        | Interest in decisions and new concepts                                      |
| Learning and trying things                      | R05 spectator research        | React to methods without fabricated expertise/experience                    |
| Vicarious experience and reaction               | R04 self-report/R05 research  | Short responses to unexpected outcomes                                      |
| Shared interests                                | R06/R07 research              | Join questions/perspectives; remain quiet in busy chat                      |
| Supporting the broadcaster's attempts           | R08 interviews                | Respond to progress without invented donations, subscriptions or friendship |

Six characters are a product default, not an estimate of domestic audience proportions. Voice is selected independently of motivation. R09 informs brief reactions, omitted context and mixed formality, without assigning voice to demographic stereotypes or combining real people/chat into replicas. Examples are synthetic. The system does not inject a fixed meme dictionary or invent unverified sources/channel jokes. Silence and reduced participation during busy chat reflect design informed by R10–R13.

The model receives motivation, interests, knowledge boundaries, voice and speech/silence conditions. Propensity also affects scheduler probability/weights. The model may skip when irrelevant or underinformed.

Stopping and restarting only AI within the same process/broadcast session reuses definitions and names. Broadcast end clears the cast; server restart restores it. A new stream session creates a new cast on its next AI start; an existing live cast is not replaced. The UI exposes a read-only summary, not authoring, selection, approval or arming forms.

Provenance records `automatic-research-composition`, research version, evidence IDs and `human_review: false`. Internal `approved` means schema/name checks passed, not human quality approval. No operator ratings or model auditions are fabricated.

## Legacy authoring and approval APIs

**These are legacy demo/standalone-library paths. The live privacy profile blocks persona mutation APIs and uses automatic composition plus shared AI controls.** The default UI does not invoke these paths.

1. Creating a brief creates a `draft` session with title, topic, viewer intent, public/private production context, locale, tone policy, candidate/cast counts and game mode. Candidate default/range: 12, 1–24. Cast default/range: 6, 1–12, never above candidate count. Only `cast_mode: fresh` is supported.
2. Candidate generation is asynchronous and uses six base behavioral templates. Only public planning and templates enter the model. Private production context is excluded, with an additional string-based output leak check that cannot guarantee semantic non-disclosure.
3. Review interests, knowledge boundaries, voice, propensity and speech/silence examples. Check duplicate definitions and names using NFKC normalization, lowercase and removal of whitespace/some punctuation.
4. Lock fields and regenerate selected dimensions or names. Store a new version while retaining older ones; approve the new version again. APIs also support template revisions, name denylists, cloning and retirement. Cloning creates a new identity without copying memory.
5. Run the `p0-v1` audition's 12 scenarios, covering success/failure, knowledge limits, quiet moments, answered questions, late arrival, viewer corrections, stale images, private plans, hostile chat, consecutive AI speech and invented past experience. Also check names, private-context leakage, silence examples and duplicate examples across candidates.
6. An operator approves the exact definition hash that passed audition. Consistency, distinction, naturalness and relevance each score 1–5; each must be at least 3 and the mean at least 4. The model does not automatically award these ratings.
7. Build the required cast from approved versions in the same session, confirm synthetic-viewer disclosure and freeze. Store definition snapshots/hashes and transition to `ready`.

Definitions include `core`, `knowledge`, `voice`, `participation`, `examples`, `negative_examples` and version identifiers. Provide 4–12 examples including silence, and 2–10 negative examples. The schema is authoritative for exact fields/ranges.

## Sessions and live controls

Persona sessions belong to the stream Store's `source_session`. The admin new-session action changes the stream session and the scope of the next automatic cast.

| State                     | Action                                                 | Result                                                        |
| ------------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| `draft`                   | Assemble approved cast, acknowledge disclosure, freeze | `ready`, disarmed                                             |
| `ready`                   | Start                                                  | `live`; arm according to `arm_ai`, disarm on failed readiness |
| `live`                    | Stop AI                                                | Preserve session, disarm, cancel work                         |
| `live`                    | Pause                                                  | `paused`, disarm, close observation interval                  |
| `paused`                  | Resume                                                 | `live`, still disarmed until separately armed                 |
| `ready`, `live`, `paused` | End                                                    | `ended`, disarm, remove presence and generate report          |

The primary AI switch controls the live cast too. Disclosure disarms generation and the live cast before revealing origin labels. Viewer nicknames and synthetic persona names stay visible throughout.

Legacy APIs can change presence, mute, attention and interest tags during live/paused sessions. Live server mutation restrictions still apply. Changes cancel affected reactions and increment epochs; policy updates invalidate pending candidates. The default UI remains read-only apart from shared AI/disclosure controls.

Start requires the current operating profile and selected Responses API authentication/model readiness. Screen/audio follow configured sources; continuous visual mode requires fresh frames. Human chat needs platform receipt/publication/external-AI approvals and current consent. See [privacy implementation](participation.md). Restart restores the broadcast session and AI execution intent, waiting for required inputs.

## Observation and speech selection

Server AI start creates an automatic live cast when needed and uses its frozen snapshots. Only compatibility use of the scheduler without the server preparation hook falls back to YAML `ai.personas`. The most recently created live session is selected; parallel multi-session operation and a hard single-live-session constraint are not guaranteed.

Presence intervals constrain message sequences/timestamps and legacy transcript/frame capture times. Absent/paused periods are not presented as observed. Interests, mentions, attention, propensity and recent speech select one character or silence. Model input includes the full approved definition and public brief.

Shared scheduler checks remain: fresh input, randomized pacing, suppression above 15 external messages/minute, and at most three AI messages/minute. Persona policy cannot raise these shared limits.

| Policy                               | Default/current enforcement                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| Global speech interval               | At least five seconds, plus shared randomized pacing                            |
| Individual cooldown                  | Greater of 30 seconds and `ai.pacing.minSeconds`                                |
| Consecutive speech by one persona    | At most two                                                                     |
| Activity-dependent AI cap            | Per 60 seconds: external 0–4 => 4; 5–19 => 2; 20+ => 1; shared cap also applies |
| Response delay                       | 500–2500 ms                                                                     |
| Reaction TTL / fresh observation age | 45-second reaction TTL / 12-second observation age                              |
| Model timeout                        | Automatic cast: 30 seconds                                                      |
| Live calls                           | 300, also bounded by shared Store usage and `ai.maxCalls`                       |
| Authoring calls                      | 200, with candidate/scenario-count checks                                       |

Live output uses shared `say / skip / inspect`, not the persona contract's separate `send / skip` schema. After model draft review and optional human review, publication rechecks arming/state, definition hash, policy revision, member epoch, expiry, duplication and frequency. Attempts/publication are recorded locally.

## APIs and concurrent changes

The following table describes legacy/demo contracts. Live mutation is restricted to shared AI controls. Paths are under `/api/admin/persona`, with administrator authentication and same-origin protections. Mutations require an 8–128-character `Idempotency-Key`. Different bodies under the same path/key conflict; in-progress and completed retries are distinguished. Use `expected_revision` for sessions, `expected_member_epoch` for members and `expected_control_epoch` for arming. Exact bodies are in [server routes](../../apps/server/app.ts).

| Operation                 | Method/path                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------- |
| Brief/session             | `POST /sessions`, `GET /sessions/:id`                                               |
| Templates                 | `GET /templates`, `POST /templates`                                                 |
| Candidates                | `POST /sessions/:id/candidates`, `GET /sessions/:id/candidates`                     |
| Name denylist/clone       | `POST /sessions/:id/nickname-denylist`, `POST /sessions/:id/clone`                  |
| Regenerate/approve/retire | `POST /versions/:id/regenerate`, `/approve`, `/retire`                              |
| Auditions/jobs            | `POST /sessions/:id/auditions`, `GET /jobs/:id`, `POST /jobs/:id/cancel`            |
| Cast/freeze               | `PUT /sessions/:id/cast`, `POST /sessions/:id/freeze`                               |
| Lifecycle                 | `POST /sessions/:id/start`, `/pause`, `/resume`, `/end`                             |
| AI controls               | `POST /sessions/:id/ai/arm`, `/ai/stop`                                             |
| Policy/member             | `PATCH /sessions/:id/policy`, `PATCH /sessions/:id/members/:memberId`               |
| Disclosure/report/replay  | `POST /sessions/:id/reveal`, `GET /sessions/:id/report`, `GET /sessions/:id/replay` |

## Storage and publication boundaries

Briefs, versions, frozen casts, presence, jobs, model metadata, auditions, ratings, audit entries, reactions and publication records live in the private broadcast SQLite database, survive restart and are deleted at broadcast end. Public views do not receive operational information or private briefs. Identity disclosure is a one-time confirmed action on a disarmed `live` or `ended` session.

Reports aggregate member publication counts/reactions. `usage` is shared stream Store usage, not an independent persona-session bill. Replay reads stored administrator records, not a model rerun. Details may disappear after retention cleanup. Standalone Store/service fixture retention is not the live persistence policy. No long-term memory storage/retrieval pipeline is connected.

## Remaining implementation and verification

- Schema fields do not prove runtime support. Multiple selections per event group, general reaction queues, AI trigger depth, automatic schema repair, memory retrieval and per-persona token limits are not guaranteed complete pipelines.
- Authoring is separate from live scheduling; do not assume the shared live USD budget covers generation, regeneration and auditions.
- Demo candidates may share examples and fail cross-candidate audition checks. Demo auditions return `skip` and do not establish character quality.
- The automatic overview comes from the status API and survives page reload within the session. Legacy authoring/replay APIs have no dedicated UI.
- Fixtures cover private-context exclusion/leak rejection, approval/freezing/policy/disclosure transitions and retention deletion. Real-model naturalness, platform receipt and full browser authoring flows require separate validation.

## Withdrawal and aggregate context

Withdrawal/hiding removes raw text and invalidates ongoing reactions. Scheduler caches/drafts and session reaction results/model manifests are cleared; recorded input dependencies conservatively remove directly and indirectly dependent published AI output. Persona definitions remain because they are not generated from participant raw text.

`anonymousChatSummary` contains only fixed topic/mood categories from recent two-minute permitted human chat, with at least three distinct accounts supporting each category. Preapproved categories without provenance may remain for the session; withdrawn text never creates a new summary. End clears all categories. These are not personal memories or evidence of past statements. See [AI_FLOW](../development/ai-pipeline.md#withdrawal-and-anonymous-chat-summaries).
