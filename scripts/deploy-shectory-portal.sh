#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="${SERVICE_NAME:-shectory-portal.service}"
PUBLIC_URL="${PUBLIC_URL:-https://shectory.ru}"
DO_GIT_PULL="${DO_GIT_PULL:-0}"
DO_DB_PUSH="${DO_DB_PUSH:-0}"
DO_DB_SEED="${DO_DB_SEED:-0}"
PORTAL_DIR="${PORTAL_DIR:-$ROOT_DIR/shectory-portal}"
NEXT_PORT="${NEXT_PORT:-3000}"

cd "$ROOT_DIR"

echo "[deploy] repo: $ROOT_DIR"

if [[ "$DO_GIT_PULL" == "1" ]]; then
  echo "[deploy] git pull"
  git pull
fi

echo "[deploy] npm install (root, if needed)"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm i
fi

if [[ "$DO_DB_PUSH" == "1" ]]; then
  echo "[deploy] prisma db push"
  npm run -s db:push -- --accept-data-loss
fi

if [[ "$DO_DB_SEED" == "1" ]]; then
  echo "[deploy] prisma seed"
  npm run -s db:seed
fi

echo "[deploy] portal build"
npm run -s build --prefix shectory-portal

BUILT_CSS="$(ls -1 shectory-portal/.next/static/css/*.css 2>/dev/null | head -n 1 || true)"
if [[ -n "${BUILT_CSS}" ]]; then
  echo "[deploy] built css: ${BUILT_CSS#${ROOT_DIR}/}"
fi

if command -v curl >/dev/null 2>&1; then
  LIVE_CSS="$(
    curl -fsS "${PUBLIC_URL}/" \
      | tr -d '\r\n' \
      | grep -oE '/_next/static/css/[^"'"'"']+\.css' \
      | head -n 1 \
      || true
  )"
  if [[ -n "${LIVE_CSS}" ]]; then
    echo "[deploy] live html references css: $LIVE_CSS"
  fi
fi

if command -v systemctl >/dev/null 2>&1; then
  echo "[deploy] restart systemd unit: $SERVICE_NAME"
  if systemctl list-unit-files | grep -q "^${SERVICE_NAME}"; then
    # user may not have sudo; try both
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
      sudo systemctl restart "$SERVICE_NAME" || systemctl restart "$SERVICE_NAME"
    else
      sudo systemctl start "$SERVICE_NAME" || systemctl start "$SERVICE_NAME"
    fi
    sudo systemctl --no-pager --full status "$SERVICE_NAME" -n 30 || systemctl --no-pager --full status "$SERVICE_NAME" -n 30
  else
    echo "[deploy] WARN: unit not found: $SERVICE_NAME (skipping systemctl)"
  fi
else
  echo "[deploy] WARN: systemctl not available (skipping restart)"
fi

if [[ ! "$(command -v systemctl >/dev/null 2>&1; echo $?)" == "0" ]] || ! systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE_NAME}"; then
  # Fallback for setups where Next is started without systemd unit.
  if command -v pkill >/dev/null 2>&1 && command -v nohup >/dev/null 2>&1; then
    echo "[deploy] fallback restart: pkill + nohup npm run start (port $NEXT_PORT)"
    # Be conservative: only restart if portal dir exists.
    if [[ -d "$PORTAL_DIR" ]]; then
      # Kill the process bound to the port (more reliable than matching cmdline).
      if command -v ss >/dev/null 2>&1; then
        pid="$(ss -ltnp 2>/dev/null | awk -v p=":$NEXT_PORT" '$0 ~ p && $0 ~ /pid=/ {match($0,/pid=([0-9]+)/,m); print m[1]; exit}')"
        if [[ -n "${pid:-}" ]]; then
          echo "[deploy] killing pid on port ${NEXT_PORT}: $pid"
          kill "$pid" 2>/dev/null || true
          sleep 1
        fi
      fi
      pkill -f "next-server.*-p ${NEXT_PORT}" 2>/dev/null || true
      pkill -f "next start .* -p ${NEXT_PORT}" 2>/dev/null || true
      (
        cd "$PORTAL_DIR"
        # Use a login shell so PATH / npm env is loaded; use npm to resolve next binary.
        nohup bash -lc "cd \"$PORTAL_DIR\" && PORT=$NEXT_PORT npm run -s start" >"${ROOT_DIR}/.next-start.log" 2>&1 &
      )
      sleep 1
    else
      echo "[deploy] WARN: portal dir not found: $PORTAL_DIR (skipping fallback restart)"
    fi
  fi
fi

if [[ -n "${BUILT_CSS}" && -n "${LIVE_CSS:-}" ]]; then
  BUILT_CSS_BASENAME="/_next/static/css/$(basename "$BUILT_CSS")"
  if [[ "$BUILT_CSS_BASENAME" != "$LIVE_CSS" ]]; then
    echo "[deploy] WARN: live site css hash differs from built output."
    echo "[deploy]      This usually means the running service is using a different build directory or wasn't restarted."
  fi
fi

echo "[deploy] done"

