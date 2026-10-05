# Development environment and verification

The root [run-command.sh](../run-command.sh) applies `mise exec --` and the available Linux browser library/font environment. [AGENTS.md](../AGENTS.md) is the agent entry point. Do not rediscover temporary libraries or repeat long environment-variable prefixes.

## Routine commands

```sh
# Documentation/configuration checks, TypeScript/Vite build and unit tests
sh run-command.sh npm run check

# Chromium checks for admin, reader and overlay
sh run-command.sh npm run build
sh run-command.sh npm run test:browser

# Documentation checks and formatting of changed files
sh run-command.sh npm run docs:check
sh run-command.sh npx prettier --write README.md

sh run-command.sh --help
```

Browser tests serve `dist/web`, so build after web changes. Fixtures use ports `127.0.0.1:33219` and `127.0.0.1:33220`, memory databases, isolated credential paths and synthetic input. Do not run multiple browser checks on those ports simultaneously. JSON reports and screenshots go to ignored `test-results/`. These tests do not establish real broadcast compatibility or paid-model quality. Browser verification fails on page errors and CSP console diagnostics.

The wrapper changes to the repository root regardless of its invocation directory. Use its absolute path from elsewhere. It forwards arguments with `"$@"`, preserves spaces and returns the command exit code. Pass `sh -c '...'` explicitly when shell syntax is required.

## Initial setup

Use Node 24.21.0 pinned in [mise.toml](../mise.toml). The current host may not expose npm on the ordinary PATH. The wrapper looks for mise on PATH, then at `$HOME/.local/bin/mise`.

```sh
mise trust
mise install
sh run-command.sh npm ci
sh run-command.sh npx playwright install chromium
```

The wrapper does not install packages. Linux CI uses `npx playwright install --with-deps chromium`, including OS dependencies; see [the workflow](../.github/workflows/check.yml). The current host instead uses extracted libraries below. On Windows PowerShell, prepare Node and run npm scripts directly; the wrapper requires a POSIX shell.

## Current host browser environment

Paths verified on 2026-10-05:

| Component        | Path                                                         |
| ---------------- | ------------------------------------------------------------ |
| Shared libraries | `/tmp/mixed-chat-browser-libs/root/usr/lib/x86_64-linux-gnu` |
| Fontconfig       | `/tmp/mixed-chat-browser-libs/fonts.conf`                    |
| Fonts            | `/tmp/mixed-chat-browser-libs/root/usr/share/fonts`          |
| Font cache       | `/tmp/mixed-chat-browser-libs/font-cache`                    |

On Linux, when this bundle exists, the wrapper prepends its libraries to `LD_LIBRARY_PATH`. An existing `FONTCONFIG_FILE` takes precedence; otherwise the bundle configuration is used. On other systems, or without the default bundle, the wrapper uses the system environment. Absence of the bundle is not proof that Chromium can run.

These commands use the same browser environment on the current host:

```sh
sh run-command.sh npm run test:browser

LD_LIBRARY_PATH=/tmp/mixed-chat-browser-libs/root/usr/lib/x86_64-linux-gnu \
FONTCONFIG_FILE=/tmp/mixed-chat-browser-libs/fonts.conf \
mise exec -- npm run test:browser
```

To override the bundle or disable automatic injection:

```sh
MIXED_CHAT_BROWSER_LIBS_DIR=/absolute/path/to/browser-libs \
  sh run-command.sh npm run test:browser

MIXED_CHAT_BROWSER_LIBS_DIR= sh run-command.sh npm run test:browser
```

A custom bundle must use the same `root/usr/lib/x86_64-linux-gnu` layout. An explicitly configured missing path fails instead of concealing a typo. Prefer absolute paths; relative paths resolve from the repository root. An empty value disables only wrapper injection and does not unset caller-provided library/font variables.

The Linux x86_64 bundle is not tracked and may disappear after reboot or temporary-directory cleanup. Do not assume copied libraries are compatible with another host. Update absolute font/cache paths inside `fonts.conf` when moving it.

## Troubleshooting

| Symptom                                           | Action                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| npm not found                                     | Use the wrapper; verify mise installation and `mise install`                          |
| mise not found                                    | Install it on PATH or at `$HOME/.local/bin/mise`                                      |
| Chromium executable missing                       | Run `sh run-command.sh npx playwright install chromium`                               |
| Missing shared library, such as `libatk-1.0.so.0` | Check the bundle or install compatible OS dependencies                                |
| Fontconfig warnings or missing fonts              | Check paths in `fonts.conf`; existing `FONTCONFIG_FILE` overrides automatic selection |
| Browser shows old UI                              | Build, then rerun browser checks                                                      |
| Test port already occupied                        | Finish the earlier browser check before starting another                              |

If only downloaded `.deb` files remain in the bundle, the same host can extract each with `dpkg-deb -x` into its `root/`. This does not download or install OS packages; fonts and `fonts.conf` must also exist. If the whole bundle is absent, use the dependency setup above; the wrapper does not rebuild it.

Record command scope in [VERIFICATION_REPORT](../VERIFICATION_REPORT.md). Follow [LIVE_SETUP](../LIVE_SETUP.md) and `justfile` for service management. The wrapper itself does not load `.env` or start services; it runs only the supplied command.

## Memory-only operation and host review

Live chat, consent and personas are memory-only. The wrapper uses `ulimit -c 0` to disable ordinary core dumps, but this does not control OS crash capture, service-manager dumps, container snapshots or swap. Review actual host crash reporting, swap/encryption, memory snapshots and backup paths, and restrict raw-data persistence according to the operating policy. This review has not been claimed complete for the deployment host.

Fastify body logging is disabled. The UI does not persist chat in localStorage/IndexedDB. Do not add real chat to SDK debug logs, browser network exports, prompt traces, external error collection, fixtures or screenshots. Test artifacts use synthetic data only.

The live app does not open legacy chat databases. Before migration, stop the old process and identify its SQLite/WAL/SHM files, transcript exports, recovery copies and backups for cleanup. Credentials and the minimal rights database have separate purposes and lifetimes. Reference removal and file deletion are not guarantees of physical forensic erasure.
