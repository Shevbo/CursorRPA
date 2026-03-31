#!/usr/bin/env bash
# Копирует статусы агента из `icons agent status/` в public перед сборкой.
# Для каждого имени: приоритет .gif, иначе .jpg.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/icons agent status"
DST="$ROOT/shectory-portal/public/brand/agent-status"
mkdir -p "$DST"
for base in Thinking3 Noduty3 Error3 Auditing3; do
  if [[ ! -f "$SRC/$base.gif" ]] && [[ ! -f "$SRC/$base.jpg" ]]; then
    echo "[sync-agent-status-gifs] нет $SRC/$base.gif или .jpg — оставляем public как есть" >&2
    exit 0
  fi
done
for base in Thinking3 Noduty3 Error3 Auditing3; do
  rm -f "$DST/$base.gif" "$DST/$base.jpg"
  if [[ -f "$SRC/$base.gif" ]]; then
    cp -f "$SRC/$base.gif" "$DST/$base.gif"
  else
    cp -f "$SRC/$base.jpg" "$DST/$base.jpg"
  fi
done
echo "[sync-agent-status-gifs] OK → $DST"
