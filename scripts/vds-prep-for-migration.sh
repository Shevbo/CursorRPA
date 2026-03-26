#!/usr/bin/env bash
# Подготовка домашнего окружения на сервере SHECTORY (новый VDS под разработку платформы).
# НЕ запускать на Hoster: там только рантайм (бэкенды, UI, Postgres, Prisma), без Cursor CLI.
# Ubuntu 22.04/24.04. Под целевым пользователем (например cursorrpa), без sudo.
# Нужны curl и git (если нет — сначала scripts/vds-prep-apt.sh под ubuntu).
#
#   chmod +x vds-prep-for-migration.sh && ./vds-prep-for-migration.sh
#
# Переменные окружения:
#   WORKSPACE_ROOT — корень репозиториев (по умолчанию $HOME/workspaces)

set -euo pipefail

WORKSPACE_ROOT="${WORKSPACE_ROOT:-$HOME/workspaces}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Не найдено: $1. На сервере под ubuntu выполните: bash vds-prep-apt.sh" >&2
    exit 1
  }
}

install_cursor_cli() {
  echo "==> Cursor Agent CLI (официальный инсталлятор)"
  curl https://cursor.com/install -fsS | bash
}

ensure_dirs() {
  echo "==> Каталоги: $WORKSPACE_ROOT, ~/.config/cursor-rpa"
  mkdir -p "$WORKSPACE_ROOT"
  mkdir -p "$HOME/.config/cursor-rpa"
  mkdir -p "$HOME/.local/bin"
}

ensure_env_file() {
  local f="$HOME/.config/cursor-rpa/env.sh"
  if [[ -f "$f" ]]; then
    echo "==> Уже есть $f — не перезаписываю"
    return 0
  fi
  cat > "$f" <<'EOF'
# Cursor: Cloud Agents → User API Keys. Не коммитьте этот файл.
# Добавьте одну строку:
#   export CURSOR_API_KEY="..."
# Затем: chmod 600 ~/.config/cursor-rpa/env.sh
EOF
  chmod 600 "$f"
  echo "==> Создан шаблон $f — добавьте export CURSOR_API_KEY"
}

ensure_bashrc_source() {
  local marker="# cursor-rpa env (vds-prep-for-migration)"
  local path_marker="# cursor agent CLI PATH (vds-prep-for-migration)"
  if ! grep -qF "$path_marker" "$HOME/.bashrc" 2>/dev/null; then
    {
      echo ""
      echo "$path_marker"
      echo 'export PATH="$HOME/.local/bin:$PATH"'
    } >> "$HOME/.bashrc"
    echo "==> В ~/.bashrc добавлен PATH для ~/.local/bin"
  else
    echo "==> PATH для ~/.local/bin уже помечен в ~/.bashrc"
  fi
  if grep -qF "$marker" "$HOME/.bashrc" 2>/dev/null; then
    echo "==> Маркер env уже есть в ~/.bashrc"
  else
    {
      echo ""
      echo "$marker"
      echo '[[ -f ~/.config/cursor-rpa/env.sh ]] && source ~/.config/cursor-rpa/env.sh'
    } >> "$HOME/.bashrc"
    echo "==> В ~/.bashrc добавлен source env.sh"
  fi
  bash -n "$HOME/.bashrc"
}

hint_next_steps() {
  echo ""
  echo "==> Дальше вручную:"
  echo "    1. Вставьте ключ в ~/.config/cursor-rpa/env.sh, chmod 600"
  echo "    2. Новый login или: source ~/.bashrc"
  echo "    3. Проверка: agent --version && agent status"
  echo "    4. После git clone: cp CursorRPA/scripts/rpa-agent.sh ~/.local/bin/ && chmod +x ~/.local/bin/rpa-agent.sh"
  echo "    5. GitHub SSH: scripts/cursorrpa-github-ssh-setup.sh"
}

main() {
  echo "==> vds-prep-for-migration: WORKSPACE_ROOT=$WORKSPACE_ROOT USER=$(whoami)"
  require_cmd curl
  install_cursor_cli
  ensure_dirs
  ensure_env_file
  ensure_bashrc_source
  hint_next_steps
  echo "==> Готово."
}

main "$@"
