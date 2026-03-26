#!/usr/bin/env bash
# Shectory VDS: создать пользователя shectory с тем же SSH-доступом, что у ubuntu, и группой sudo.
# Запуск на сервере ОДИН РАЗ под ubuntu (с sudo):
#   bash shectory-create-user.sh
# Через PowerShell-обертку: ./scripts/shectory-run-create-user.ps1 (не копировать тело скрипта в консоль)
set -euo pipefail
NEWUSER=shectory

if id "$NEWUSER" &>/dev/null; then
  echo "==> $NEWUSER уже есть"
else
  sudo useradd -m -s /bin/bash "$NEWUSER"
  echo "==> создан $NEWUSER"
fi

sudo mkdir -p "/home/$NEWUSER/.ssh"
sudo chmod 700 "/home/$NEWUSER/.ssh"

if [[ -f /home/ubuntu/.ssh/authorized_keys ]]; then
  sudo cp /home/ubuntu/.ssh/authorized_keys "/home/$NEWUSER/.ssh/authorized_keys"
elif [[ -f /root/.ssh/authorized_keys ]]; then
  sudo cp /root/.ssh/authorized_keys "/home/$NEWUSER/.ssh/authorized_keys"
else
  echo "Нет /home/ubuntu/.ssh/authorized_keys — добавьте ключ вручную" >&2
  exit 1
fi

sudo chown -R "$NEWUSER:$NEWUSER" "/home/$NEWUSER/.ssh"
sudo chmod 600 "/home/$NEWUSER/.ssh/authorized_keys"
sudo usermod -aG sudo "$NEWUSER"

if sudo test ! -f /etc/sudoers.d/99-shectory-nopasswd; then
  echo "$NEWUSER ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/99-shectory-nopasswd >/dev/null
  sudo chmod 440 /etc/sudoers.d/99-shectory-nopasswd
  sudo visudo -c -f /etc/sudoers.d/99-shectory-nopasswd
  echo "==> NOPASSWD sudo для $NEWUSER (только для своего VDS)"
fi

echo "==> Готово. Подключение: ssh shectory-work"
