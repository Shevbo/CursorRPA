#!/usr/bin/env bash
# Пример DEPLOY_UI_SCRIPT для .env бота.
# Вызывается с env: WORKSPACE, PROJECT_NAME
set -euo pipefail
# Раскомментируйте и подставьте пользователя/VDS и путь на веб-сервере:
# rsync -az --delete "${WORKSPACE}/web/dist/" "deploy@YOUR_VDS:/var/www/proto/${PROJECT_NAME}/"

echo "Заглушка: настройте rsync/scp/docker в этом скрипте. WORKSPACE=${WORKSPACE:-}"
