# Repository development

Run commands from this repository with `sh run-command.sh <command> [args...]`.
The launcher selects the Node version from `mise.toml` and automatically adds the
existing Linux browser library/font bundle when present. Do not rediscover or
manually repeat the `LD_LIBRARY_PATH` / `FONTCONFIG_FILE` prefix.

- Build, document/config validation and unit tests: `sh run-command.sh npm run check`.
- Browser checks: run `sh run-command.sh npm run build`, then
  `sh run-command.sh npm run test:browser`. The browser test serves built `dist/web`.
- Format only changed files: `sh run-command.sh npx prettier --write <files>`.
- Check document links/config: `sh run-command.sh npm run docs:check`.

Read [the development guide](docs/development.md) for the existing browser bundle,
custom/system-library overrides, missing dependencies, test ports and artifacts.
The wrapper does not install packages, load `.env`, start a server or run a model
request unless the supplied command does so. Do not use a live server to run fixtures.

Update the owning documentation when behavior changes; consult the
[documentation index](docs/README.md). Keep requirement gaps separate from verified
implementation and record validation scope accurately.

## Documentation language and official terminology

- Write all repository documentation in English, including headings, tables,
  link labels, examples, comments in documentation code blocks and verification
  records. This applies to tracked and new non-ignored Markdown; private
  `.local/` source material and localized application UI are separate.
- Describe localized buttons and viewer commands in English and link to their
  implementation when exact localized strings are needed. Do not copy localized
  UI text into English documentation or change product localization to satisfy
  the documentation check.
- Use **Sign in with ChatGPT** for the authentication integration and
  **Responses API** for model inference. Distinguish API-key authentication from
  ChatGPT plan usage through Sign in with ChatGPT; both can use the Responses API.
  Preserve exact configuration identifiers, environment variables and wire values
  in code, such as `chatgpt_subscription` and `ChatGPT subscription`.
- Verify official product/API names against official documentation when adding
  integrations. Do not invent names or use billing arrangements as API names.
- Run `sh run-command.sh npm run docs:check` before committing documentation.
  The check rejects Hangul in repository Markdown and known unofficial API names,
  and validates local links/heading anchors and the example configuration.
  Translate linked headings and update incoming fragments together.
- For Content Security Policy changes, run the browser checks. Invalid source
  expressions and CSP console diagnostics must fail verification, not be ignored.
