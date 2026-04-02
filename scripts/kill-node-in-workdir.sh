#!/usr/bin/env bash
# Безопасная остановка dev-процессов Node/npm/npx в одном дереве каталогов.
# Не использовать pkill -f "node dist/server.js" на общих хостах — убьёт syslog-srv и любые другие node с тем же argv.
#
# Использование:
#   ./scripts/kill-node-in-workdir.sh /home/shevbo/workspaces/PingMaster
#   ./scripts/kill-node-in-workdir.sh --dry-run /home/shevbo/workspaces/PingMaster
set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  shift
fi

ROOT="${1:-}"
if [[ -z "$ROOT" ]]; then >&2 echo "Usage: $0 [--dry-run] /absolute/path/to/project"; exit 1; fi
if [[ "$ROOT" != /* ]]; then >&2 echo "Path must be absolute: $ROOT"; exit 1; fi
if [[ ! -d "$ROOT" ]]; then >&2 echo "Not a directory: $ROOT"; exit 1; fi

ROOT="$(realpath "$ROOT")"
my_uid="$(id -u)"

should_kill_pid() {
  local pid="$1"
  [[ -z "$pid" ]] && return 1
  [[ ! -d "/proc/$pid" ]] && return 1
  local proc_uid
  proc_uid="$(awk '/^Uid:/{print $2; exit}' "/proc/$pid/status" 2>/dev/null || echo "")"
  [[ -z "$proc_uid" ]] && return 1
  if [[ "$my_uid" != "0" && "$proc_uid" != "$my_uid" ]]; then
    return 1
  fi
  local cwd
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
  [[ -z "$cwd" ]] && return 1
  if [[ "$cwd" == "$ROOT" || "$cwd" == "$ROOT"/* ]]; then
    return 0
  fi
  return 1
}

print_cmd() {
  local pid="$1"
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | head -c 240 || true
}

signal_pids() {
  local sig="$1"
  local name="$2"
  local pids
  pids="$(pgrep -x "$name" 2>/dev/null || true)"
  for pid in $pids; do
    should_kill_pid "$pid" || continue
    if $DRY_RUN; then
      echo "[dry-run] SIG${sig##-} pid=$pid bin=$name cwd=$(readlink -f /proc/$pid/cwd) cmd=$(print_cmd "$pid")"
      continue
    fi
    echo "[kill] SIG${sig##-} pid=$pid bin=$name cwd=$(readlink -f /proc/$pid/cwd)"
    kill "$sig" "$pid" 2>/dev/null || true
  done
}

# Сначала мягко: npm/npx (родитель), затем node
for bin in npm npx node; do
  signal_pids -TERM "$bin"
done

if ! $DRY_RUN; then
  sleep 2
  for bin in npm npx node; do
    pids="$(pgrep -x "$bin" 2>/dev/null || true)"
    for pid in $pids; do
      should_kill_pid "$pid" || continue
      if kill -0 "$pid" 2>/dev/null; then
        echo "[kill] SIGKILL pid=$pid bin=$bin (still alive after TERM)"
        kill -KILL "$pid" 2>/dev/null || true
      fi
    done
  done
fi

echo "Done. workdir root: $ROOT"
