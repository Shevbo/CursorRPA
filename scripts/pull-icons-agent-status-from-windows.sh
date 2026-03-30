#!/usr/bin/env bash
# Копирует файлы статусов агента с ПК (путь как C:\dev\CursorRPA\icons agent status\)
# в репозиторий: icons agent status/
#
# Источник (первый сработавший вариант):
#   1) ICONS_AGENT_STATUS_SRC=/абсолютный/путь/к/папке
#   2) Каталог WSL: /mnt/c/dev/CursorRPA/icons agent status
#   3) Удалённый Windows с OpenSSH:
#        export WINDOWS_ICONS_PULL=user@windows-host
#        (путь на удалённой машине задаётся WINDOWS_ICONS_REMOTE_DIR, по умолчанию
#         C:/dev/CursorRPA/icons agent status по умолчанию)
#
# После копирования вызывается sync-agent-status-gifs.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DST="$ROOT/icons agent status"
WSL_SRC="/mnt/c/dev/CursorRPA/icons agent status"

resolve_src() {
  if [[ -n "${ICONS_AGENT_STATUS_SRC:-}" ]] && [[ -d "${ICONS_AGENT_STATUS_SRC}" ]]; then
    echo "${ICONS_AGENT_STATUS_SRC}"
    return 0
  fi
  if [[ -d "$WSL_SRC" ]]; then
    echo "$WSL_SRC"
    return 0
  fi
  return 1
}

mkdir -p "$DST"

if src="$(resolve_src)"; then
  echo "[pull-icons] копирую из: $src"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --exclude='.DS_Store' "$src/" "$DST/"
  else
    shopt -s dotglob nullglob
    for f in "$src"/*; do
      [[ -e "$f" ]] || continue
      [[ -f "$f" ]] && cp -f "$f" "$DST/"
    done
  fi
elif [[ -n "${WINDOWS_ICONS_PULL:-}" ]]; then
  REMOTE="${WINDOWS_ICONS_REMOTE_DIR:-C:/dev/CursorRPA/icons agent status}"
  echo "[pull-icons] rsync с ${WINDOWS_ICONS_PULL}:'${REMOTE}/'"
  if ! command -v rsync >/dev/null 2>&1; then
    echo "Для pull по SSH нужен rsync (apt install rsync)." >&2
    exit 1
  fi
  # Одинарные кавычки вокруг пути на удалённой стороне — пробелы в «icons agent status»
  rsync -avz -e ssh "${WINDOWS_ICONS_PULL}:'${REMOTE}/'" "$DST/" || {
    echo "rsync не удался. Проверьте WINDOWS_ICONS_PULL, SSH-ключи и WINDOWS_ICONS_REMOTE_DIR." >&2
    echo "С ПК проще: scripts/push-icons-agent-status-from-windows.ps1" >&2
    exit 1
  }
else
  echo "[pull-icons] Нет локального источника." >&2
  echo "  • На этой машине: смонтируйте диск или задайте" >&2
  echo "      export ICONS_AGENT_STATUS_SRC=/путь/к/«icons agent status»" >&2
  echo "  • WSL на том же ПК: должен существовать $WSL_SRC" >&2
  echo "  • С удалённого Windows с SSH:" >&2
  echo "      export WINDOWS_ICONS_PULL=user@ip" >&2
  echo "      export WINDOWS_ICONS_REMOTE_DIR='C:/dev/CursorRPA/icons agent status'  # при необходимости" >&2
  echo "  • Самый простой способ: с Windows выполнить push (см. scripts/push-icons-agent-status-from-windows.ps1)." >&2
  exit 1
fi

echo "[pull-icons] → $DST"
ls -la "$DST"
"$ROOT/scripts/sync-agent-status-gifs.sh"
echo "[pull-icons] готово (sync в public выполнен)"
