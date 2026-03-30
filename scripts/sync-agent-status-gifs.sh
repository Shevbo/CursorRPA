#!/usr/bin/env bash
# Копирует картинки статусов агента из `icons agent status/` в public перед сборкой.
# Нужны все три: Thinking3.jpg, Noduty3.jpg, Error3.jpg.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/icons agent status"
DST="$ROOT/shectory-portal/public/brand/agent-status"
mkdir -p "$DST"
for base in Thinking3 Noduty3 Error3; do
  if [[ ! -f "$SRC/$base.jpg" ]]; then
    echo "[sync-agent-status-gifs] нет $SRC/$base.jpg — оставляем public как есть" >&2
    exit 0
  fi
done
cp -f "$SRC/Thinking3.jpg" "$SRC/Noduty3.jpg" "$SRC/Error3.jpg" "$DST/"
echo "[sync-agent-status-gifs] OK → $DST"
