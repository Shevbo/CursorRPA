#!/usr/bin/env bash
# Только env.sh: shevbo -> cursorrpa (sudo). Остальное не трогает.
# Когда ~/.local/bin уже скопирован, а env.sh потерян или остался только .swp от vim.
#
#   chmod +x cursorrpa-sync-env-from-shevbo.sh && ./cursorrpa-sync-env-from-shevbo.sh
#
set -euo pipefail

SRC_HOME="${SHEVBO_HOME:-/home/shevbo}"
DST_HOME="${CURSORRPA_HOME:-/home/cursorrpa}"

if [[ "$(id -un)" != "shevbo" ]] && [[ "${ALLOW_NON_SHEVBO:-}" != "1" ]]; then
  echo "Запускайте под shevbo (или ALLOW_NON_SHEVBO=1)." >&2
  exit 1
fi

if ! id cursorrpa &>/dev/null; then
  echo "Нет пользователя cursorrpa." >&2
  exit 1
fi

if [[ ! -f "$SRC_HOME/.config/cursor-rpa/env.sh" ]]; then
  echo "Нет $SRC_HOME/.config/cursor-rpa/env.sh — создайте ключ у shevbo сначала." >&2
  exit 1
fi

sudo mkdir -p "$DST_HOME/.config/cursor-rpa"
sudo cp -f "$SRC_HOME/.config/cursor-rpa/env.sh" "$DST_HOME/.config/cursor-rpa/env.sh"
sudo chown cursorrpa:cursorrpa "$DST_HOME/.config/cursor-rpa/env.sh"
sudo chmod 600 "$DST_HOME/.config/cursor-rpa/env.sh"
sudo find "$DST_HOME/.config/cursor-rpa" -maxdepth 1 -name '*.swp' -delete 2>/dev/null || true

echo "OK: $DST_HOME/.config/cursor-rpa/env.sh"
sudo -u cursorrpa env HOME="$DST_HOME" PATH="$DST_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" \
  bash --noprofile --norc -c '
set -euo pipefail
set -a
source "$HOME/.config/cursor-rpa/env.sh"
set +a
echo "CURSOR_API_KEY длина: ${#CURSOR_API_KEY}"
'
