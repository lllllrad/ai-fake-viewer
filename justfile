port := "3210"
entrypoint := "apps/server/main.ts"
experiments_port := "3211"
pid_file := ".local/server.pid"
log_file := ".local/server.log"

# List available recipes instead of starting a server implicitly.
default:
    @just --list

# Start the live server detached from the terminal.
server-start:
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p .local
    if [[ -f "{{pid_file}}" ]] && kill -0 "$(cat "{{pid_file}}")" 2>/dev/null; then
      echo "Server already running (PID $(cat "{{pid_file}}"))"
      exit 0
    fi
    rm -f "{{pid_file}}"
    if curl -fsS --max-time 1 "http://127.0.0.1:{{port}}/health" >/dev/null 2>&1; then
      echo "Port {{port}} is already serving an unmanaged process; stop it before starting this server."
      exit 1
    fi
    node_bin="$(mise which node)"
    setsid "$node_bin" --import tsx "{{entrypoint}}" >>"{{log_file}}" 2>&1 </dev/null &
    pid=$!
    echo "$pid" > "{{pid_file}}"
    for _ in {1..20}; do
      if ! kill -0 "$pid" 2>/dev/null; then
        rm -f "{{pid_file}}"
        cat "{{log_file}}"
        exit 1
      fi
      if curl -fsS --max-time 1 "http://127.0.0.1:{{port}}/health" >/dev/null 2>&1; then
        echo "Server started (PID $pid); http://127.0.0.1:{{port}}/admin"
        exit 0
      fi
      sleep 0.5
    done
    echo "Server is still starting (PID $pid). Logs: {{log_file}}"

# Stop the detached server.
server-stop:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ ! -f "{{pid_file}}" ]]; then
      echo "No managed server PID file found."
      exit 1
    fi
    pid="$(cat "{{pid_file}}")"
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "{{pid_file}}"
      echo "Removed stale server PID file."
      exit 0
    fi
    kill -TERM "$pid"
    for _ in {1..20}; do
      if ! kill -0 "$pid" 2>/dev/null; then
        rm -f "{{pid_file}}"
        echo "Server stopped."
        exit 0
      fi
      sleep 0.25
    done
    kill -KILL "$pid" 2>/dev/null || true
    rm -f "{{pid_file}}"
    echo "Server stopped."

# Restart the detached server.
server-restart:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -f "{{pid_file}}" ]] && kill -0 "$(cat "{{pid_file}}")" 2>/dev/null; then
      just --set port "{{port}}" --set entrypoint "{{entrypoint}}" --set pid_file "{{pid_file}}" --set log_file "{{log_file}}" server-stop
    fi
    just --set port "{{port}}" --set entrypoint "{{entrypoint}}" --set pid_file "{{pid_file}}" --set log_file "{{log_file}}" server-start

# Show the detached server PID and health endpoint.
server-status:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -f "{{pid_file}}" ]] && kill -0 "$(cat "{{pid_file}}")" 2>/dev/null; then
      echo "Server PID: $(cat "{{pid_file}}")"
      curl -fsS --max-time 2 "http://127.0.0.1:{{port}}/health"
      echo
    else
      echo "Server is not running under just."
      exit 1
    fi

# Follow the detached server log.
server-logs:
    tail -n 100 -f "{{log_file}}"

# Manage the independent AI test server with its own PID and logs.
experiments-start:
    @just --set port "{{experiments_port}}" --set entrypoint apps/experiments/main.ts --set pid_file .local/experiments/server.pid --set log_file .local/experiments/server.log server-start

experiments-stop:
    @just --set port "{{experiments_port}}" --set entrypoint apps/experiments/main.ts --set pid_file .local/experiments/server.pid --set log_file .local/experiments/server.log server-stop

experiments-restart:
    @just --set port "{{experiments_port}}" --set entrypoint apps/experiments/main.ts --set pid_file .local/experiments/server.pid --set log_file .local/experiments/server.log server-restart

experiments-status:
    @just --set port "{{experiments_port}}" --set entrypoint apps/experiments/main.ts --set pid_file .local/experiments/server.pid --set log_file .local/experiments/server.log server-status

experiments-logs:
    tail -n 100 -f .local/experiments/server.log
