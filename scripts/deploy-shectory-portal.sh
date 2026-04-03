#!/usr/bin/env bash
# Деплой Shectory Portal на VDS Shectory — та же машина, где лежит клон CursorRPA.
# Запускать из корня репозитория:  bash scripts/deploy-shectory-portal.sh
# Собирает shectory-portal, перезапускает systemd (system или user unit), проверяет CSS.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NEXT_PORT="${NEXT_PORT:-3000}"
SERVICE_NAME="${SERVICE_NAME:-shectory-portal.service}"
PUBLIC_URL="${PUBLIC_URL:-https://shectory.ru}"
LOCAL_BASE="${LOCAL_BASE:-http://127.0.0.1:${NEXT_PORT}}"
# После рестарта: 1) проверка Next на этой VDS (LOCAL_BASE) — обязательна при VERIFY_CSS=1;
# 2) проверка публичного URL — предупреждение при расхождении (кэш nginx/CDN, старый HTML).
VERIFY_CSS="${VERIFY_CSS:-1}"
DO_GIT_PULL="${DO_GIT_PULL:-0}"
DO_DB_PUSH="${DO_DB_PUSH:-0}"
DO_DB_SEED="${DO_DB_SEED:-0}"
PORTAL_DIR="${PORTAL_DIR:-$ROOT_DIR/shectory-portal}"

cd "$ROOT_DIR"

echo "[deploy] repo: $ROOT_DIR"

if [[ -x "$ROOT_DIR/scripts/sync-agent-status-gifs.sh" ]]; then
  "$ROOT_DIR/scripts/sync-agent-status-gifs.sh"
fi

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

echo "[deploy] portal dependencies (shectory-portal — обязательно перед next build)"
if [[ -f shectory-portal/package-lock.json ]]; then
  npm ci --prefix shectory-portal
else
  npm install --prefix shectory-portal
fi

if [[ "$DO_DB_PUSH" == "1" ]]; then
  echo "[deploy] prisma db push"
  npm run -s db:push -- --accept-data-loss
fi

if [[ "$DO_DB_SEED" == "1" ]]; then
  echo "[deploy] prisma seed"
  npm run -s db:seed
fi

echo "[deploy] prisma migrate deploy (portal DB; требуется для /settings и admin API)"
(cd "$PORTAL_DIR" && npx prisma migrate deploy --schema=../prisma/schema.prisma)

echo "[deploy] portal build"
npm run -s build --prefix shectory-portal

BUILT_CSS="$(ls -1 shectory-portal/.next/static/css/*.css 2>/dev/null | head -n 1 || true)"
if [[ -n "${BUILT_CSS}" ]]; then
  echo "[deploy] built css: ${BUILT_CSS#${ROOT_DIR}/}"
fi

# Иначе старый next-server (не из этого user unit) держит :PORT — новый процесс не подхватывает свежий .next → 404 на CSS.
free_port() {
  local port="$1"
  if ! command -v ss >/dev/null 2>&1; then
    return 0
  fi
  local pid
  pid="$(ss -ltnp 2>/dev/null | awk -v p=":${port}" '$0 ~ p && $0 ~ /pid=/ { match($0,/pid=([0-9]+)/,m); print m[1]; exit }')"
  if [[ -n "${pid:-}" ]]; then
    echo "[deploy] free port ${port}: stopping pid ${pid} (stale listener)"
    kill "$pid" 2>/dev/null || true
    sleep 2
  fi
}

free_port "${NEXT_PORT}"

UNIT_RESTARTED=0
if command -v systemctl >/dev/null 2>&1; then
  echo "[deploy] restart systemd unit: $SERVICE_NAME"
  # 1) Системный unit
  if systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE_NAME}"; then
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
      sudo systemctl restart "$SERVICE_NAME" 2>/dev/null || systemctl restart "$SERVICE_NAME"
    else
      sudo systemctl start "$SERVICE_NAME" 2>/dev/null || systemctl start "$SERVICE_NAME"
    fi
    sudo systemctl --no-pager --full status "$SERVICE_NAME" -n 30 2>/dev/null || systemctl --no-pager --full status "$SERVICE_NAME" -n 30
    UNIT_RESTARTED=1
  # 2) User unit (типично: shectory-portal.service у пользователя shectory на VDS)
  elif systemctl --user list-unit-files 2>/dev/null | grep -q "^${SERVICE_NAME}"; then
    if systemctl --user is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
      systemctl --user restart "$SERVICE_NAME"
    else
      systemctl --user start "$SERVICE_NAME"
    fi
    systemctl --user --no-pager --full status "$SERVICE_NAME" -n 30
    UNIT_RESTARTED=1
  else
    echo "[deploy] WARN: unit not found (system nor user): $SERVICE_NAME"
  fi
else
  echo "[deploy] WARN: systemctl not available (skipping restart)"
fi

if [[ "$UNIT_RESTARTED" -eq 0 ]]; then
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

# Надёжнее, чем парсить /login: запросить ровно тот CSS, что только что собрали (избегает рассинхрона хешей).
verify_built_css_url() {
  local base="$1"
  local label="$2"
  local rel
  if [[ -z "${BUILT_CSS}" || ! -f "${BUILT_CSS}" ]]; then
    echo "[deploy] ${label}: no built css file to verify"
    return 1
  fi
  rel="/_next/static/css/$(basename "$BUILT_CSS")"
  local code
  code="$(curl -sS -o /dev/null -w "%{http_code}" -H 'Cache-Control: no-cache' "${base}${rel}" 2>/dev/null || echo "000")"
  if [[ "${code}" != "200" ]]; then
    echo "[deploy] ${label}: ${base}${rel} → HTTP ${code}"
    return 1
  fi
  echo "[deploy] ${label}: ${rel} → 200"
  return 0
}

if [[ "${VERIFY_CSS}" == "1" ]] && command -v curl >/dev/null 2>&1; then
  sleep 4
  echo "[deploy] verify built CSS on this VDS (Next ${LOCAL_BASE})"
  if ! verify_built_css_url "${LOCAL_BASE}" "local"; then
    echo "[deploy] ERROR: Next on this machine does not serve the new CSS. Check shectory-portal.service WorkingDirectory=${PORTAL_DIR} and PORT=${NEXT_PORT}."
    exit 1
  fi
  echo "[deploy] verify public URL (optional): ${PUBLIC_URL}"
  if verify_built_css_url "${PUBLIC_URL}" "public"; then
    :
  else
    echo "[deploy] WARN: public URL did not return new CSS (nginx/HTML cache or proxy). Локальный Next отдаёт сборку — см. scripts/nginx-shectory-portal.conf"
  fi
fi

echo "[deploy] done"

