#!/bin/sh
# Run repository tools with mise and the optional local Linux browser bundle.
set -eu

if [ "$#" -eq 0 ] || [ "${1-}" = "--help" ]; then
  cat <<'USAGE'
Usage: sh run-command.sh COMMAND [ARGUMENT ...]

Examples:
  sh run-command.sh npm run check
  sh run-command.sh npm run build
  sh run-command.sh npm run test:browser

Runs from the repository root using mise.toml.
On Linux, reuses /tmp/mixed-chat-browser-libs when present.
Override with MIXED_CHAT_BROWSER_LIBS_DIR=/path/to/bundle, or set it to
an empty string to use system libraries. Existing FONTCONFIG_FILE wins.
See docs/development.md for setup and troubleshooting.
USAGE
  if [ "$#" -eq 0 ]; then exit 2; fi
  exit 0
fi

mixed_chat_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$mixed_chat_root"

if command -v mise >/dev/null 2>&1; then
  mixed_chat_mise=$(command -v mise)
elif [ -x "${HOME}/.local/bin/mise" ]; then
  mixed_chat_mise="${HOME}/.local/bin/mise"
else
  echo "mise not found. Install mise and run 'mise trust' and 'mise install'; see docs/development.md." >&2
  exit 127
fi

if [ "$(uname -s)" = Linux ]; then
  mixed_chat_bundle=${MIXED_CHAT_BROWSER_LIBS_DIR-/tmp/mixed-chat-browser-libs}
  if [ -n "$mixed_chat_bundle" ]; then
    mixed_chat_lib_dir="$mixed_chat_bundle/root/usr/lib/x86_64-linux-gnu"
    if [ -d "$mixed_chat_lib_dir" ]; then
      export LD_LIBRARY_PATH="$mixed_chat_lib_dir${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
      if [ -z "${FONTCONFIG_FILE-}" ] && [ -f "$mixed_chat_bundle/fonts.conf" ]; then
        export FONTCONFIG_FILE="$mixed_chat_bundle/fonts.conf"
      fi
    elif [ "${MIXED_CHAT_BROWSER_LIBS_DIR+x}" = x ]; then
      echo "Browser bundle missing: $mixed_chat_lib_dir. Fix MIXED_CHAT_BROWSER_LIBS_DIR or set it to an empty string to use system libraries." >&2
      exit 1
    fi
  fi
fi

exec "$mixed_chat_mise" exec -- "$@"
