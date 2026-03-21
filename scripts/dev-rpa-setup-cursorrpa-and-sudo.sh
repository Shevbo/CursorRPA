#!/usr/bin/env bash
# НА dev-rpa под пользователем shevbo.
#
# Только cursorrpa (спросит пароль sudo несколько раз):
#   bash dev-rpa-setup-cursorrpa-and-sudo.sh
#
# Плюс passwordless sudo для shevbo (ОДИН раз спросит пароль, дальше sudo без пароля):
#   bash dev-rpa-setup-cursorrpa-and-sudo.sh --nopasswd-sudo
#
# ВНИМАНИЕ: --nopasswd-sudo даёт shevbo полный sudo без пароля. Только на своей dev-VM.

set -euo pipefail

create_cursorrpa() {
  echo "=== Пользователь cursorrpa ==="
  if id cursorrpa &>/dev/null; then
    echo "Уже есть: cursorrpa"
  else
    sudo useradd -m -s /bin/bash cursorrpa
    echo "Создан: cursorrpa"
  fi

  sudo mkdir -p /home/cursorrpa/workspaces /home/cursorrpa/.ssh
  sudo chmod 700 /home/cursorrpa/.ssh

  if [[ -f /home/shevbo/.ssh/authorized_keys ]]; then
    sudo cp /home/shevbo/.ssh/authorized_keys /home/cursorrpa/.ssh/authorized_keys
    sudo chmod 600 /home/cursorrpa/.ssh/authorized_keys
    echo "SSH: authorized_keys скопирован shevbo -> cursorrpa"
  else
    echo "ВНИМАНИЕ: нет /home/shevbo/.ssh/authorized_keys"
  fi

  sudo chown -R cursorrpa:cursorrpa /home/cursorrpa
  echo "Готово. С ПК: ssh dev-rpa-cursorrpa"
  echo "Дальше: скопировать agent и env.sh с shevbo — см. scripts/sync-cursor-tools-shevbo-to-cursorrpa.sh"
}

nopasswd_sudo_shevbo() {
  echo "=== Passwordless sudo для shevbo ==="
  if sudo test -f /etc/sudoers.d/99-shevbo-nopasswd; then
    echo "Файл уже есть: /etc/sudoers.d/99-shevbo-nopasswd"
    sudo cat /etc/sudoers.d/99-shevbo-nopasswd
  else
    echo 'shevbo ALL=(ALL) NOPASSWD: ALL' | sudo tee /etc/sudoers.d/99-shevbo-nopasswd >/dev/null
    sudo chmod 440 /etc/sudoers.d/99-shevbo-nopasswd
    sudo visudo -c -f /etc/sudoers.d/99-shevbo-nopasswd
    echo "Создан /etc/sudoers.d/99-shevbo-nopasswd"
  fi
  if sudo -n true 2>/dev/null; then
    echo "Проверка: sudo -n true -> OK (passwordless активен)"
  else
    echo "Проверка: sudo -n true -> ещё запрашивает пароль (откройте новый shell или перелогиньтесь)"
  fi
}

create_cursorrpa

if [[ "${1:-}" == "--nopasswd-sudo" ]]; then
  nopasswd_sudo_shevbo
fi
