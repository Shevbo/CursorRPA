#!/usr/bin/env bash
# WireGuard / fallback health monitor for VDS.
# Checks WG handshake age and Pi port reachability.
# Sends Telegram alert on status transitions.
#
# Deploy:
#   cp wg-monitor.sh /usr/local/bin/wg-monitor.sh
#   chmod +x /usr/local/bin/wg-monitor.sh
#   cp wg-monitor.service wg-monitor.timer /etc/systemd/system/
#   systemctl daemon-reload && systemctl enable --now wg-monitor.timer

set -euo pipefail

WG_IFACE="wg0"
PI_WG_IP="10.66.0.2"
PI_SYSLOG_PORT="4444"
PI_PINGMASTER_PORT="4555"
AUTOSSH_FALLBACK_SYSLOG="127.0.0.1:24444"
AUTOSSH_FALLBACK_PINGMASTER="127.0.0.1:24555"

STATE_FILE="/var/lib/shectory/wg-monitor-state"
# Max WireGuard handshake age before considering tunnel stale (seconds)
WG_HANDSHAKE_MAX_AGE="${WG_HANDSHAKE_MAX_AGE:-180}"

# Telegram settings (read from env or .env file)
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_IDS="${TELEGRAM_CHAT_IDS:-}"

# Try to load from shectory-portal .env if not set
for env_file in \
  /home/shectory/workspaces/CursorRPA/shectory-portal/.env \
  /home/shectory/workspaces/CursorRPA/services/telegram-bridge/project-envs/cursor-rpa.env \
  /etc/shectory/wg-monitor.env; do
  if [[ -f "$env_file" && -z "$TELEGRAM_BOT_TOKEN" ]]; then
    # shellcheck disable=SC1090
    source <(grep -E '^(export )?(TELEGRAM_BOT_TOKEN|TELEGRAM_ALLOWED_USER_IDS)=' "$env_file" | sed 's/^export //')
    TELEGRAM_CHAT_IDS="${TELEGRAM_ALLOWED_USER_IDS:-}"
  fi
done

mkdir -p "$(dirname "$STATE_FILE")"
touch "$STATE_FILE"

send_telegram() {
  local msg="$1"
  if [[ -z "$TELEGRAM_BOT_TOKEN" || -z "$TELEGRAM_CHAT_IDS" ]]; then
    echo "[telegram] not configured, skipping: $msg"
    return
  fi
  IFS=',' read -ra CHAT_IDS <<< "$TELEGRAM_CHAT_IDS"
  for chat_id in "${CHAT_IDS[@]}"; do
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${chat_id}" \
      -d "text=${msg}" \
      -d "parse_mode=HTML" \
      > /dev/null || true
  done
}

tcp_check() {
  local host="$1"
  local port="$2"
  timeout 3 bash -c "echo >/dev/tcp/${host}/${port}" 2>/dev/null && echo "ok" || echo "fail"
}

wg_handshake_age() {
  # Returns age in seconds of the last WG handshake, or 9999 if no handshake
  local latest
  latest=$(wg show "$WG_IFACE" latest-handshakes 2>/dev/null | awk '{print $2}' | sort -n | tail -1)
  if [[ -z "$latest" || "$latest" == "0" ]]; then
    echo "9999"
    return
  fi
  local now
  now=$(date +%s)
  echo $(( now - latest ))
}

# --- Collect current status ---
WG_AGE=$(wg_handshake_age)
WG_OK="false"
if [[ "$WG_AGE" -lt "$WG_HANDSHAKE_MAX_AGE" ]]; then
  WG_OK="true"
fi

SYSLOG_WG=$(tcp_check "$PI_WG_IP" "$PI_SYSLOG_PORT")
PINGMASTER_WG=$(tcp_check "$PI_WG_IP" "$PI_PINGMASTER_PORT")
SYSLOG_FALLBACK=$(tcp_check "127.0.0.1" "24444")
PINGMASTER_FALLBACK=$(tcp_check "127.0.0.1" "24555")

# Overall status
if [[ "$WG_OK" == "true" && "$SYSLOG_WG" == "ok" && "$PINGMASTER_WG" == "ok" ]]; then
  STATUS="ok"
elif [[ "$SYSLOG_FALLBACK" == "ok" || "$PINGMASTER_FALLBACK" == "ok" ]]; then
  STATUS="fallback"
else
  STATUS="down"
fi

echo "[wg-monitor] wg_age=${WG_AGE}s wg_ok=${WG_OK} syslog_wg=${SYSLOG_WG} pingmaster_wg=${PINGMASTER_WG} fallback_syslog=${SYSLOG_FALLBACK} fallback_pingmaster=${PINGMASTER_FALLBACK} => ${STATUS}"

# --- Compare with previous status ---
PREV_STATUS=$(cat "$STATE_FILE" 2>/dev/null || echo "unknown")

if [[ "$STATUS" != "$PREV_STATUS" ]]; then
  echo "[wg-monitor] Status changed: ${PREV_STATUS} -> ${STATUS}"
  echo "$STATUS" > "$STATE_FILE"

  case "$STATUS" in
    ok)
      MSG="✅ <b>Pi VPN восстановлен</b>
WireGuard handshake: ${WG_AGE}s назад
Syslog :4444 → ok | PingMaster :4555 → ok"
      ;;
    fallback)
      MSG="⚠️ <b>Pi VPN: WireGuard деградация, работает fallback</b>
WG handshake: ${WG_AGE}s назад (порог ${WG_HANDSHAKE_MAX_AGE}s)
WG syslog: ${SYSLOG_WG} | WG pingmaster: ${PINGMASTER_WG}
Fallback syslog: ${SYSLOG_FALLBACK} | Fallback pingmaster: ${PINGMASTER_FALLBACK}"
      ;;
    down)
      MSG="🔴 <b>Pi VPN: нет связи ни через WireGuard, ни через fallback</b>
WG handshake: ${WG_AGE}s назад
Все каналы недоступны. Проверь Pi."
      ;;
  esac

  send_telegram "$MSG"
fi

exit 0
