#!/usr/bin/env bash
# Распаковывает архив как на Windows: C:\dev\CursorRPA\icons agent status.zip
# Положите zip в корень репозитория или передайте путь первым аргументом.
# В архиве должны быть Thinking3 / Noduty3 / Error3 (.gif, .jpg или .png).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ZIP="${1:-$ROOT/icons agent status.zip}"
DST="$ROOT/icons agent status"
if ! command -v unzip >/dev/null 2>&1; then
  echo "Нужен unzip (apt install unzip)." >&2
  exit 1
fi
[[ -f "$ZIP" ]] || {
  echo "Нет файла: $ZIP" >&2
  echo "Скопируйте с ПК «icons agent status.zip» в $ROOT или укажите путь: $0 /path/to/archive.zip" >&2
  exit 1
}
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
unzip -q -o "$ZIP" -d "$TMP"
mkdir -p "$DST"
for base in Thinking3 Noduty3 Error3; do
  f="$(find "$TMP" -type f \( -iname "${base}.gif" -o -iname "${base}.jpg" -o -iname "${base}.jpeg" -o -iname "${base}.png" \) | head -1)"
  if [[ -z "$f" ]]; then
    echo "В архиве не найден ${base}.(gif|jpg|png)" >&2
    exit 1
  fi
  ext="${f##*.}"
  el="${ext,,}"
  rm -f "$DST/$base.gif" "$DST/$base.jpg" "$DST/$base.jpeg" "$DST/$base.png"
  if [[ "$el" == "gif" ]]; then
    cp -f "$f" "$DST/$base.gif"
  else
    cp -f "$f" "$DST/$base.jpg"
  fi
  echo "  OK $base ← $(basename "$f")"
done
echo "[import-icons-agent-status-zip] готово → $DST"
echo "Дальше: ./scripts/sync-agent-status-gifs.sh && (cd shectory-portal && npm run build)"
