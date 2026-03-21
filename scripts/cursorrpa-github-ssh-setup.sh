#!/usr/bin/env bash
# Запускать на Linux под тем пользователем, который будет делать git clone (например cursorrpa).
# Создаёт ~/.ssh/id_ed25519 при отсутствии, выводит публичный ключ для GitHub → Settings → SSH keys.
#
#   chmod +x cursorrpa-github-ssh-setup.sh && ./cursorrpa-github-ssh-setup.sh
#
set -euo pipefail

KEY="${SSH_KEY_PATH:-$HOME/.ssh/id_ed25519}"
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"

if [[ ! -f "$KEY" ]]; then
  echo "==> Создаю $KEY"
  ssh-keygen -t ed25519 -C "$(whoami)@$(hostname -s 2>/dev/null || echo host)" -f "$KEY" -N ""
fi

chmod 600 "$KEY"
chmod 644 "${KEY}.pub"

eval "$(ssh-agent -s)" >/dev/null
ssh-add "$KEY" 2>/dev/null || true

echo ""
echo "=== Скопируйте блок ниже в GitHub: https://github.com/settings/ssh/new ==="
echo ""
cat "${KEY}.pub"
echo ""
echo "=== После сохранения ключа на GitHub выполните: ssh -T git@github.com ==="
echo ""
