#!/bin/bash
# Agent Watchdog — запускает agent-watchdog.mjs каждые 2 минуты.
# Используется как ExecStart в systemd-сервисе shectory-watchdog.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORTAL_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PORTAL_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  # Безопасная загрузка .env: только строки KEY=VALUE, без комментариев и пустых строк
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Пропускаем комментарии и пустые строки
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    # Экспортируем только строки вида KEY=...
    if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      export "$line"
    fi
  done < "$ENV_FILE"
fi

echo "[watchdog.sh] Старт, portal_dir=$PORTAL_DIR"

while true; do
  node "$SCRIPT_DIR/agent-watchdog.mjs" || echo "[watchdog.sh] agent-watchdog.mjs завершился с ошибкой (код $?)"
  sleep 120
done
