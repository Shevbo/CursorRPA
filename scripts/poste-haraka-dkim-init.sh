#!/usr/bin/env bash
# После пересоздания контейнера Poste.io каталог /opt/haraka-submission/config/dkim очищается.
# Ключи лежат на томе /data/haraka-dkim — этот скрипт заново создаёт symlink и перезапускает submission.
# Запуск с VDS: bash scripts/poste-haraka-dkim-init.sh
set -euo pipefail
CONTAINER="${POSTE_CONTAINER:-mail-poste-poste-1}"
docker exec -u root "$CONTAINER" sh -exc '
test -f /data/haraka-dkim/shectory.ru/private || { echo "Missing /data/haraka-dkim/shectory.ru/private"; exit 1; }
mkdir -p /opt/haraka-submission/config/dkim
rm -rf /opt/haraka-submission/config/dkim/shectory.ru
ln -sf /data/haraka-dkim/shectory.ru /opt/haraka-submission/config/dkim/shectory.ru
s6-svc -r /run/s6/services/haraka-submission
sleep 2
echo "[poste-haraka-dkim-init] OK: symlink restored, haraka-submission restarted"
'
