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
