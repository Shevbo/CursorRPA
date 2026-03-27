#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="${SERVICE_NAME:-shectory-portal.service}"
PUBLIC_URL="${PUBLIC_URL:-https://shectory.ru}"
# After restart, curl ${PUBLIC_URL}/login and require global CSS → HTTP 200 (set 0 to skip).
VERIFY_CSS="${VERIFY_CSS:-1}"
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

if [[ "${VERIFY_CSS}" == "1" ]] && command -v curl >/dev/null 2>&1; then
  echo "[deploy] verify live stylesheet (GET ${PUBLIC_URL}/login → CSS URL → expect 200)"
  sleep 2
  LOGIN_HTML="$(curl -fsS "${PUBLIC_URL}/login" 2>/dev/null || true)"
  LIVE_CSS="$(echo "$LOGIN_HTML" | tr -d '\r\n' | grep -oE '/_next/static/css/[a-f0-9]+\.css' | head -n 1 || true)"
  if [[ -z "${LIVE_CSS}" ]]; then
    echo "[deploy] WARN: could not parse CSS path from /login HTML (skip VERIFY_CSS)"
  else
    CSS_CODE="$(curl -sS -o /dev/null -w "%{http_code}" "${PUBLIC_URL}${LIVE_CSS}" 2>/dev/null || echo "000")"
    if [[ "${CSS_CODE}" != "200" ]]; then
      echo "[deploy] ERROR: ${PUBLIC_URL}${LIVE_CSS} returned HTTP ${CSS_CODE} (expected 200)."
      echo "[deploy]         UI will be unstyled. Fix nginx / reverse proxy for /_next/static/*"
      echo "[deploy]         (see scripts/nginx-shectory-portal.conf)."
      exit 1
    fi
    echo "[deploy] OK: stylesheet ${LIVE_CSS} → 200"
    if [[ -n "${BUILT_CSS}" ]]; then
      BUILT_CSS_BASENAME="/_next/static/css/$(basename "$BUILT_CSS")"
      if [[ "${BUILT_CSS_BASENAME}" != "${LIVE_CSS}" ]]; then
        echo "[deploy] WARN: live HTML references ${LIVE_CSS} but this build has ${BUILT_CSS_BASENAME} — stale cache or wrong WorkingDirectory."
      fi
    fi
  fi
fi

echo "[deploy] done"

