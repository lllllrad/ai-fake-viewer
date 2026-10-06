# Legacy persona authoring reference

This describes the retained demo and standalone authoring experiment. It is not
the live product contract or an operator setup procedure. Live startup does not
instantiate the authoring service or register these endpoints. Its old mutation
URLs are rejected and its old read URLs are not found. The live workspace uses
[automatic viewers](../specifications/personas.md) and shared AI controls.

The [demo routes](../../apps/server/demo/persona-routes.ts) load the
[authoring service](../../packages/persona/service.ts) only for demo composition.
The [generator](../../packages/persona/generator.ts) and
[legacy tests](../../tests/persona.test.ts) preserve this reference behavior;
they do not define additional rewrite requirements for live operation.

## Authoring workflow

1. Creating a brief creates a `draft` session with title, topic, viewer intent, public/private production context, locale, tone policy, candidate/cast counts and game mode. Candidate default/range: 12, 1–24. Cast default/range: 6, 1–12, never above candidate count. Only `cast_mode: fresh` is supported.
2. Candidate generation is asynchronous and uses six base behavioral templates. Only public planning and templates enter the model. Private production context is excluded, with an additional string-based output leak check that cannot guarantee semantic non-disclosure.
3. Review interests, knowledge boundaries, voice, propensity and speech/silence examples. Check duplicate definitions and names using NFKC normalization, lowercase and removal of whitespace/some punctuation.
4. Lock fields and regenerate selected dimensions or names. Store a new version while retaining older ones; approve the new version again. APIs also support template revisions, name denylists, cloning and retirement. Cloning creates a new identity without copying memory.
5. Run the `p0-v1` audition's 12 scenarios, covering success/failure, knowledge limits, quiet moments, answered questions, late arrival, viewer corrections, stale images, private plans, hostile chat, consecutive AI speech and invented past experience. Also check names, private-context leakage, silence examples and duplicate examples across candidates.
6. An operator approves the exact definition hash that passed audition. Consistency, distinction, naturalness and relevance each score 1–5; each must be at least 3 and the mean at least 4. The model does not automatically award these ratings.
7. Build the required cast from approved versions in the same session, confirm synthetic-viewer disclosure and freeze. Store definition snapshots/hashes and transition to `ready`.

Definitions include `core`, `knowledge`, `voice`, `participation`, `examples`, `negative_examples` and version identifiers. Provide 4–12 examples including silence, and 2–10 negative examples. The schema is authoritative for exact fields/ranges.

## Demo sessions

The reference workflow supports draft, ready, live, paused and ended persona
sessions. Freezing follows explicit approval and disclosure acknowledgement;
starting or resuming and arming are separate operations. It can change member
presence, mute, attention, interest tags and policy revisions. Those controls
invalidate affected work and increment the appropriate epochs. None are operator
requirements for the live automatic cast.

## API contracts

The following table describes legacy/demo contracts. Live mutation is restricted to shared AI controls. Paths are under `/api/admin/persona`, with administrator authentication and same-origin protections. Mutations require an 8–128-character `Idempotency-Key`. Different bodies under the same path/key conflict; in-progress and completed retries are distinguished. Use `expected_revision` for sessions, `expected_member_epoch` for members and `expected_control_epoch` for arming. Exact bodies are in [demo routes](../../apps/server/demo/persona-routes.ts).

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

## Limits of the reference

Authoring budgets are separate from shared live inference usage. Demo candidates
may share examples, and demo auditions return `skip`; fixture success does not
establish naturalness or distinct character quality. Reports aggregate recorded
publication/reaction data; replay reads local administrator records rather than
rerunning a model. There is no dedicated authoring or replay UI.

Schema fields for multiple selections, reaction queues, trigger depth, repair,
memory retrieval and per-persona token budgets do not establish corresponding
live features. No persistent personal memory pipeline is connected. Source-session
records use private broadcast storage, but standalone service retention fixtures
are not the live broadcast-end policy.
