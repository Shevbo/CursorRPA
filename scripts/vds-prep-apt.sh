#!/usr/bin/env bash
# Системные пакеты на сервере SHECTORY (нужен sudo). Под пользователем с sudo, например ubuntu:
#   scp scripts/vds-prep-apt.sh shectory:~/ && ssh shectory 'bash ~/vds-prep-apt.sh'
# (замените Host в SSH config на ваш алиас нового VDS)
#
# Опционально после установки пакетов включить firewall (только если SSH на стандартном 22/tcp):
#   INSTALL_UFW=1 bash vds-prep-apt.sh

set -euo pipefail

INSTALL_UFW="${INSTALL_UFW:-0}"

sudo apt-get update -y
sudo apt-get install -y curl ca-certificates git jq ufw

if [[ "$INSTALL_UFW" == "1" ]]; then
  sudo ufw allow OpenSSH
  sudo ufw --force enable
  sudo ufw status verbose
else
  echo "UFW не включён (INSTALL_UFW=1 — включить allow OpenSSH и enable)."
fi

echo "vds-prep-apt.sh: готово. Дальше под cursorrpa: scripts/vds-prep-for-migration.sh"
