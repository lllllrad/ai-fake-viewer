# Documentation

| Role             | Document                                                           | Purpose                                                                              |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Operator         | [Setup and troubleshooting](operations/setup.md)                   | Dedicated stream, model accounts and operating checks                                |
| Developer        | [Architecture and runtime boundaries](development/architecture.md) | Responsibility boundaries, lifecycle, contracts and rewrite acceptance               |
| Developer        | [Development guide](development/guide.md)                          | Command wrapper, runtime, browser dependencies and tests                             |
| Developer        | [Persona and pipeline experiments](development/experiments.md)     | Interactive viewer tests, isolated replay, versioned profiles and comparison reports |
| Developer        | [Independent AI service](development/ai-service.md)                | Process boundary, HTTP protocol, lifecycle and algorithm registration                |
| Developer        | [AI pipeline](development/ai-pipeline.md)                          | Input selection, inference, review, diagnostics and publication                      |
| Developer        | [Reaction implementation](development/reactions.md)                | Cast, model ports, provider adapters, cancellation and publication ownership         |
| Developer        | [Inputs and accounts](development/inputs-and-accounts.md)          | Media workers, model authentication and account lifetimes                            |
| Developer        | [Display-only platform chat](development/display-chat.md)          | Receive-only connections, presentation memory and AI isolation                       |
| Developer        | [Conversation storage](development/storage.md)                     | Transactional publication, persistence and session deletion                          |
| Product contract | [Behavior](specifications/behavior.md)                             | Implemented requirements and known limitations                                       |
| Product contract | [Dashboard](specifications/dashboard.md)                           | Operator controls and status presentation                                            |
| Product contract | [Personas](specifications/personas.md)                             | Automatic cast and participation behavior                                            |
| Reference        | [Legacy persona authoring](reference/persona-authoring.md)         | Demo-only authoring, auditions and API contracts                                     |
| Reference        | [Dependencies](reference/dependencies.md)                          | Dependency choices and constraints                                                   |

[PRODUCT.md](../PRODUCT.md) records the confirmed audience, purpose and durable
product constraints for future design work. Detailed behavior remains owned by the
specifications above. [DESIGN.md](../DESIGN.md) records the implemented visual
system and shared component standards.

[README](../README.md) is the project entry point.
[Example configuration](../config.example.yaml) and [schema](../packages/config.ts)
are the configuration reference. Standard model instructions remain in `prompts/`; service implementations can supply
per-call instructions through the documented model port;

Update the owning document when behavior changes and distinguish current behavior
from unverified external assumptions. Keep validation in tests and commit
messages. Do not add chronological verification reports or duplicate task ledgers.
Use relative links, English prose and official API names. Run
`sh run-command.sh npm run docs:check` after documentation changes.
