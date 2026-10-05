# Documentation index and maintenance

Start with the [current behavior requirements and implementation status](behavior-requirements.md), including the platform execution/delivery matrix. Follow its links to owning specifications. Requirements, implementation limitations and historical verification records are separate evidence.

| Document                                                                                                 | Purpose                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [Privacy, participation and withdrawal](privacy-implementation.md)                                       | Memory lifetime, staged consent, processing profile, rights handling and acceptance scope |
| [Development](development.md)                                                                            | Command wrapper, mise, Linux browser libraries/fonts and troubleshooting                  |
| [Project README](../README.md)                                                                           | Installation, operation and feature overview                                              |
| [Live setup](../LIVE_SETUP.md)                                                                           | Separate OBS PC, credentials and operational rehearsal                                    |
| [AI pipeline](../AI_FLOW.md)                                                                             | Collection, model, filtering, review and publication                                      |
| [Persona implementation](ai-viewer-persona-system-spec.md)                                               | Automatic composition, research, cast, controls and legacy APIs                           |
| [Admin dashboard specification](admin-dashboard-functional-spec.md)                                      | UI contract and remaining acceptance work                                                 |
| [Task status](../TASKS.md)                                                                               | Implemented scope and outstanding acceptance                                              |
| [Verification report](../VERIFICATION_REPORT.md)                                                         | Dated evidence and unverified scope                                                       |
| [Example configuration](../config.example.yaml) / [schema](../packages/config.ts)                        | Configuration defaults and validation                                                     |
| [Platform contracts](../research/platform-contracts.md)                                                  | Dated external research, not a guarantee of current service contracts                     |
| [SOOP research](../research/soop-official-verification.md) / [dependencies](../research/dependencies.md) | Investigation evidence and follow-up needs                                                |

The [privacy contract review evidence map](privacy-review-evidence.md) links PC01–PC12 to owning clauses, synthetic checks and outstanding operational acceptance.

## Ownership

| Feature                                  | Source                                                                                                                           | Documents to update                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Startup, readiness and controls          | `apps/server/main.ts`, `apps/server/app.ts`, `apps/web/src/operations-dashboard.tsx`                                             | README, LIVE_SETUP, AI_FLOW, dashboard specification    |
| Consent, withdrawal, names and summaries | `packages/participation.ts`, `packages/storage.ts`, `apps/web/src/privacy-panel.tsx`                                             | Privacy implementation, README, dashboard specification |
| Personas and sessions                    | `packages/persona/`, `packages/scheduler.ts`, `packages/storage.ts`                                                              | Persona specification, AI_FLOW, TASKS                   |
| Model input, prompts and budgets         | `packages/model.ts`, `packages/gate.ts`, `prompts/`                                                                              | AI_FLOW, README                                         |
| Platform authentication and messages     | `packages/youtube*.ts`, `packages/chzzk*.ts`, `packages/soop.ts`, `packages/notice-bot.ts`, `packages/supervisor.ts`, `workers/` | README, LIVE_SETUP, relevant research                   |

## Maintenance rules

- Write repository documentation in English. Describe localized UI and commands in English and link to their implementation for exact strings. Preserve product localization and exact machine identifiers.
- Use official names: **Sign in with ChatGPT** for authentication and **Responses API** for inference. ChatGPT plan usage and API-key billing are distinct authentication/billing paths, not different names for the inference API. See [official integration documentation](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).
- Update owning documents when behavior changes. Distinguish declared schema fields from connected runtime functionality.
- Requirements are not implementation evidence. Track gaps in the owning specification and TASKS.
- Record verification dates, commands, scope and failures. Never carry a historical PASS forward as verification of a new revision.
- Use relative repository links; add new documents here and repair references when moving files or translating headings.
- `sh run-command.sh npm run docs:check` checks tracked and new non-ignored Markdown for language, terminology, local targets and heading fragments, and validates `config.example.yaml`. It does not fetch external URLs or prove that external contracts are current.
- Format changed files with `sh run-command.sh npx prettier --write <files>`; repository formatting includes `docs/`.
- Do not publish private `.local/` input material. Do not link missing private documents as if they were tracked specifications. Record the implemented result and separate unverified assumptions.
