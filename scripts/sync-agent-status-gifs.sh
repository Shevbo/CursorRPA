#!/usr/bin/env bash
# Копирует GIF статусов агента из корня репозитория (как C:\dev\CursorRPA\icons agent status)
# в shectory-portal/public/brand/agent-status/ перед сборкой.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/icons agent status"
DST="$ROOT/shectory-portal/public/brand/agent-status"
mkdir -p "$DST"
for f in Thinking3.gif Noduty3.gif Error3.gif; do
  if [[ ! -f "$SRC/$f" ]]; then
    echo "[sync-agent-status-gifs] нет источника: $SRC/$f — оставляем файлы в public как есть" >&2
    exit 0
  fi
done
cp -f "$SRC/Thinking3.gif" "$SRC/Noduty3.gif" "$SRC/Error3.gif" "$DST/"
echo "[sync-agent-status-gifs] OK → $DST"
