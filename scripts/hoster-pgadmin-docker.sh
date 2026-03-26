#!/usr/bin/env bash
# Запуск pgAdmin 4 в Docker на том же хосте, что и PostgreSQL.
# Использование на Hoster (sudo):
#   export PGADMIN_PASSWORD='your-strong-password'
#   sudo -E bash scripts/hoster-pgadmin-docker.sh
#
# После: http://SERVER_IP:5050 — логин email из PGADMIN_EMAIL, пароль из PGADMIN_PASSWORD.
set -euo pipefail

PORT="${PGADMIN_PORT:-5050}"
EMAIL="${PGADMIN_EMAIL:-bshevelev@mail.ru}"
PASS="${PGADMIN_PASSWORD:-}"

if [[ -z "$PASS" ]]; then
  echo "Задайте PGADMIN_PASSWORD (и при желании PGADMIN_EMAIL, PGADMIN_PORT)." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker не найден. Установите: sudo apt-get update && sudo apt-get install -y docker.io" >&2
  exit 1
fi

docker rm -f pgadmin 2>/dev/null || true
exec docker run -d --name pgadmin \
  --restart unless-stopped \
  --network host \
  -e PGADMIN_LISTEN_PORT="$PORT" \
  -e PGADMIN_DEFAULT_EMAIL="$EMAIL" \
  -e PGADMIN_DEFAULT_PASSWORD="$PASS" \
  dpage/pgadmin4
