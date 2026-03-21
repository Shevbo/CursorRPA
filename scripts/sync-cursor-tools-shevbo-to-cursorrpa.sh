#!/usr/bin/env bash
# На dev-rpa под пользователем shevbo (нужен sudo).
# Копирует в /home/cursorrpa: ~/.local/bin, ~/.local/share/cursor-agent (реальные бинарники),
# ~/.config/cursor-rpa/env.sh. Симлинки agent -> .../shevbo/... неработоспособны (chmod 750 на $HOME),
# поэтому share копируется и ссылки перепривязываются на /home/cursorrpa/...
# чтобы не ставить curl|bash второй раз и не вводить ключ заново.
#
#   chmod +x sync-cursor-tools-shevbo-to-cursorrpa.sh
#   ./sync-cursor-tools-shevbo-to-cursorrpa.sh
#
# Если у shevbo нет env.sh — создайте его сначала (см. deploy-cursor-vds-rpa.md).
# После копирования: sudo -u cursorrpa bash -lc 'source ~/.config/cursor-rpa/env.sh; export PATH="$HOME/.local/bin:$PATH"; agent -p --trust --output-format text "OK"'

set -euo pipefail

SRC_HOME="${SHEVBO_HOME:-/home/shevbo}"
DST_HOME="${CURSORRPA_HOME:-/home/cursorrpa}"

if [[ "$(id -un)" != "shevbo" ]] && [[ "${ALLOW_NON_SHEVBO:-}" != "1" ]]; then
  echo "Запускайте под shevbo на dev-rpa (или установите ALLOW_NON_SHEVBO=1)." >&2
  exit 1
fi

if ! id cursorrpa &>/dev/null; then
  echo "Пользователь cursorrpa не найден. Сначала: scripts/dev-rpa-setup-cursorrpa-and-sudo.sh" >&2
  exit 1
fi

echo "=== Каталоги cursorrpa ==="
sudo mkdir -p "$DST_HOME/.local/bin" "$DST_HOME/.local/share" "$DST_HOME/.config/cursor-rpa"

if [[ -d "$SRC_HOME/.local/share/cursor-agent" ]]; then
  echo "Копирование $SRC_HOME/.local/share/cursor-agent -> $DST_HOME/.local/share/ (нужно для agent)"
  sudo rm -rf "$DST_HOME/.local/share/cursor-agent"
  sudo cp -a "$SRC_HOME/.local/share/cursor-agent" "$DST_HOME/.local/share/"
fi

if [[ -d "$SRC_HOME/.local/bin" ]] && [[ -n "$(ls -A "$SRC_HOME/.local/bin" 2>/dev/null)" ]]; then
  echo "Копирование $SRC_HOME/.local/bin -> $DST_HOME/.local/bin"
  sudo cp -a "$SRC_HOME/.local/bin/." "$DST_HOME/.local/bin/"
else
  echo "ВНИМАНИЕ: $SRC_HOME/.local/bin пуст или отсутствует. Установите CLI под shevbo: curl https://cursor.com/install -fsS | bash" >&2
fi

# Симлинки вида agent -> /home/shevbo/.local/share/... у cursorrpa не исполняются (нет доступа в /home/shevbo)
# Важно: [[ -d $DST_HOME/... ]] от shevbo ложно (chmod 750 на /home/cursorrpa) — только sudo test -d
if sudo test -d "$DST_HOME/.local/bin"; then
  echo "Перепривязка симлинков в $DST_HOME/.local/bin на $DST_HOME"
  while IFS= read -r -d '' link; do
    t=$(sudo readlink "$link")
    if [[ "$t" == "$SRC_HOME"* ]]; then
      new="${t/$SRC_HOME/$DST_HOME}"
      base=$(basename "$link")
      sudo rm -f "$link"
      sudo ln -sf "$new" "$link"
      echo "  $base -> $new"
    fi
  done < <(sudo find "$DST_HOME/.local/bin" -maxdepth 1 -type l -print0 2>/dev/null || true)
fi

if [[ -f "$SRC_HOME/.config/cursor-rpa/env.sh" ]]; then
  echo "Копирование env.sh (принудительно перезаписывает существующий)"
  sudo cp -f "$SRC_HOME/.config/cursor-rpa/env.sh" "$DST_HOME/.config/cursor-rpa/env.sh"
  sudo chown cursorrpa:cursorrpa "$DST_HOME/.config/cursor-rpa/env.sh"
  sudo chmod 600 "$DST_HOME/.config/cursor-rpa/env.sh"
else
  echo "ВНИМАНИЕ: нет $SRC_HOME/.config/cursor-rpa/env.sh — создайте вручную с export CURSOR_API_KEY=..." >&2
fi

# Зависший swap Vim (если env.sh открывали в vim и не сохранили — остаётся только .swp, без env.sh)
echo "Удаление *.swp в $DST_HOME/.config/cursor-rpa/ (если есть)"
sudo find "$DST_HOME/.config/cursor-rpa" -maxdepth 1 -name '*.swp' -delete 2>/dev/null || true

sudo chown -R cursorrpa:cursorrpa "$DST_HOME/.local" "$DST_HOME/.config/cursor-rpa"

if ! sudo test -f "$DST_HOME/.config/cursor-rpa/env.sh"; then
  echo "ОШИБКА: $DST_HOME/.config/cursor-rpa/env.sh отсутствует после копирования." >&2
  exit 1
fi

echo "=== Готово. Проверка (ожидается ответ от модели, напр. OK) ==="
# Не bash -lc: иначе сломанный ~/.bashrc у cursorrpa обрывает проверку до agent.
sudo -u cursorrpa env HOME="$DST_HOME" PATH="$DST_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" \
  bash --noprofile --norc -c '
set -euo pipefail
set -a
source "$HOME/.config/cursor-rpa/env.sh"
set +a
if [[ -z "${CURSOR_API_KEY:-}" ]]; then
  echo "ОШИБКА: CURSOR_API_KEY пустой после source env.sh" >&2
  exit 1
fi
if [[ ! -x "$HOME/.local/bin/agent" ]]; then
  echo "ОШИБКА: нет исполняемого $HOME/.local/bin/agent" >&2
  ls -la "$HOME/.local/bin" 2>&1 || true
  exit 1
fi
echo "agent: $(command -v agent)"
agent -p --trust --output-format text "Ответь одним словом: OK"
'
