# Repository development

- Run repository commands through `sh run-command.sh <command> [args...]`.
  It selects the mise Node version and the installed browser libraries/fonts.
  See [development setup](docs/development/guide.md).
- Run `npm run check` for build, configuration/document validation and tests.
  For browser checks, build first, then run `npm run test:browser`.
  Format changed files with `npx prettier --write <files>`.
- Manage the shared server with `just server-start`, `server-stop`,
  `server-restart` and `server-status`. Do not launch detached replacement
  processes outside these recipes. Identify unmanaged port owners before stopping
  them. Do not run fixtures against the shared live server.
- Keep credentials, private config, raw viewer content and local research out of
  tracked files. Preserve user changes and verify behavior before committing.
- Update the owning document in [docs](docs/README.md). Keep current behavior and
  known limitations there; use tests and commit descriptions for verification,
  not append-only reports or duplicate task ledgers.
- Write tracked Markdown in English. Keep application UI localization and exact
  configuration/API identifiers intact. Use official names **Sign in with ChatGPT**
  and **Responses API**.
- Run `npm run docs:check` before committing documentation. Fix links and heading
  anchors when moving or renaming documents.
