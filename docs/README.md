# Documentation

| Role             | Document                                                              | Purpose                                                                            |
| ---------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Operator         | [Setup and troubleshooting](operations/setup.md)                      | OBS inputs, platform connections, accounts and operating checks                    |
| Developer        | [Architecture and reconstruction](development/architecture.md)        | Responsibility boundaries, lifecycle, contracts and rewrite acceptance             |
| Developer        | [Development guide](development/guide.md)                             | Command wrapper, runtime, browser dependencies and tests                           |
| Developer        | [Persona and pipeline experiments](development/experiments.md)        | Isolated replay, versioned profiles, comparison reports and production application |
| Developer        | [AI pipeline](development/ai-pipeline.md)                             | Input selection, inference, review, diagnostics and publication                    |
| Developer        | [Reaction implementation](development/reactions.md)                   | Cast, model ports, provider adapters, cancellation and publication ownership       |
| Developer        | [Inputs and accounts](development/inputs-and-accounts.md)             | Platform reception/notices, media workers, authentication and account lifetimes    |
| Developer        | [Participation and storage](development/participation-and-storage.md) | Admission, transactional consent/withdrawal, persistence and rights follow-ups     |
| Product contract | [Behavior](specifications/behavior.md)                                | Implemented requirements and known limitations                                     |
| Product contract | [Dashboard](specifications/dashboard.md)                              | Operator controls and status presentation                                          |
| Product contract | [Personas](specifications/personas.md)                                | Automatic cast and participation behavior                                          |
| Product contract | [Participation and data lifecycle](specifications/participation.md)   | Viewer consent, withdrawal, retention and rights handling                          |
| Reference        | [Platform contracts](reference/platform-contracts.md)                 | Dated external platform research                                                   |
| Reference        | [SOOP](reference/soop.md)                                             | Official integration investigation                                                 |
| Reference        | [Legacy persona authoring](reference/persona-authoring.md)            | Demo-only authoring, auditions and API contracts                                   |
| Reference        | [Dependencies](reference/dependencies.md)                             | Dependency choices and constraints                                                 |

[README](../README.md) is the project entry point.
[Example configuration](../config.example.yaml) and [schema](../packages/config.ts)
are the configuration reference. Runtime model instructions remain in `prompts/`;
third-party notices remain alongside their vendored components.

Update the owning document when behavior changes and distinguish current behavior
from unverified external assumptions. Keep validation in tests and commit
messages. Do not add chronological verification reports or duplicate task ledgers.
Use relative links, English prose and official API names. Run
`sh run-command.sh npm run docs:check` after documentation changes.
