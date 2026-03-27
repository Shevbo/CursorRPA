#!/usr/bin/env bash
set -euo pipefail

# Унифицированный деплой/коммит для прикладных проектов Shectory.
# Запускать с машины/окружения, где настроены SSH алиасы `shectory-work` и `hoster`.
#
# Примеры:
#   ./scripts/deploy-project.sh cursorrpa hoster
#   ./scripts/deploy-project.sh komissionka hoster
#
# Принципы:
# - сначала git commit+push (на shectory-work, в workspace проекта)
# - потом деплой на целевой хост (обычно hoster) через ssh
#
# ВАЖНО: конкретные команды рестарта зависят от проекта; если не настроены — скрипт подскажет что нужно дописать.

PROJECT_SLUG="${1:-}"
ENV_NAME="${2:-hoster}"
COMMIT_MSG="${COMMIT_MSG:-chore(deploy): auto commit before deploy}"
GIT_USER_NAME="${GIT_USER_NAME:-Shectory}"
GIT_USER_EMAIL="${GIT_USER_EMAIL:-shectory@local}"

if [[ -z "${PROJECT_SLUG}" ]]; then
  echo "usage: $0 <project-slug> <env>"
  echo "env: hoster | shectory-work"
  exit 2
fi

SSH_WORK="${SHECTORY_SSH_WORK:-shectory-work}"
SSH_HOSTER="${SHECTORY_SSH_HOSTER:-hoster}"
PROXY_ENV_PATH="${SHECTORY_PROXY_ENV_PATH:-$HOME/.config/shectory/proxy.env}"

ws_path_for() {
  case "$1" in
    cursorrpa) echo "/home/shectory/workspaces/CursorRPA" ;;
    shectory-portal) echo "/home/shectory/workspaces/CursorRPA/shectory-portal" ;;
    komissionka) echo "/home/shectory/workspaces/komissionka" ;;
    piranha-ai) echo "/home/shectory/workspaces/PiranhaAI" ;;
    pingmaster) echo "/home/shectory/workspaces/PingMaster" ;;
    *) echo "/home/shectory/workspaces/$1" ;;
  esac
}

commit_push_on_work() {
  local slug="$1"
  local ws
  ws="$(ws_path_for "$slug")"
  if [[ -z "$ws" ]]; then
    echo "unknown project slug: $slug"
    exit 2
  fi

  # Коммитим только если есть изменения. Если репо не git — не падаем (portable проекты).
  if ! ssh -o BatchMode=yes "${SSH_WORK}" "bash --noprofile --norc -lc '
set -euo pipefail
cd \"$ws\" 2>/dev/null || { echo \"workspace missing: $ws\"; exit 3; }
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo \"git: not a repo (skip commit/push)\"
  exit 0
fi
dirty=\$(git status --porcelain)
if [[ -z \"\$dirty\" ]]; then
  echo \"git: clean (skip commit/push)\"
  exit 0
fi
git add -A
git -c user.name=\"${GIT_USER_NAME//\"/\\\"}\" -c user.email=\"${GIT_USER_EMAIL//\"/\\\"}\" commit -m \"${COMMIT_MSG//\"/\\\"}\" || true
git push
'"; then
    echo "warn: git commit/push step failed on ${SSH_WORK} for ${slug}; continuing to deploy"
  fi
}

deploy_cursorrpa_hoster() {
  # Деплой UI портала + сервиса на VDS, БД на hoster — по скрипту монолита.
  # Здесь env="hoster" означает "обновить прод окружение (hoster связка)".
  ssh -o BatchMode=yes "${SSH_WORK}" "bash -lc '
set -euo pipefail
cd /home/shectory/workspaces/CursorRPA
./scripts/deploy-shectory-portal.sh
'"
}

deploy_komissionka_hoster() {
  # На hoster ожидаем отдельный рабочий каталог (как минимум ~/komissionka).
  # Если у проекта есть свой deploy-скрипт — используем его.
  ssh -o BatchMode=yes "${SSH_HOSTER}" "bash -lc '
set -euo pipefail
if [[ -d \"\$HOME/komissionka\" ]]; then
  cd \"\$HOME/komissionka\"
elif [[ -d \"\$HOME/komissionka-test1\" ]]; then
  cd \"\$HOME/komissionka-test1\"
else
  echo \"hoster: komissionka directory not found in ~ (expected ~/komissionka or ~/komissionka-test1)\"
  exit 4
fi

if [[ -x \"./scripts/deploy.sh\" ]]; then
  ./scripts/deploy.sh
  exit 0
fi

if [[ -x \"./scripts/deploy-hoster.sh\" ]]; then
  ./scripts/deploy-hoster.sh
  exit 0
fi

echo \"hoster: no deploy script found (expected scripts/deploy.sh or scripts/deploy-hoster.sh)\"
echo \"hoster: you can implement it, or restart via pm2/systemctl after git pull\"
exit 5
'"
}

deploy_piranha_ai_hoster() {
  ssh -o BatchMode=yes "${SSH_HOSTER}" "bash --noprofile --norc -lc '
set -euo pipefail
cd \"\$HOME/piranha-ai\"
if [[ -f \"${PROXY_ENV_PATH}\" ]]; then
  # shellcheck disable=SC1090
  source \"${PROXY_ENV_PATH}\"
  export HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy PIP_INDEX_URL PIP_EXTRA_INDEX_URL PIP_TRUSTED_HOST || true
fi
./scripts/deploy.sh
'"
}

deploy_generic_hoster_by_script() {
  local slug="$1"
  # Попытка универсально: на hoster найти каталог и запустить scripts/deploy.sh (если есть).
  ssh -o BatchMode=yes "${SSH_HOSTER}" "bash --noprofile --norc -lc '
set -euo pipefail
candidates=(\"\$HOME/${slug}\" \"\$HOME/${slug}-prod\" \"\$HOME/${slug}-app\" \"\$HOME/${slug//-/_}\" )
target=\"\"
for d in \"\${candidates[@]}\"; do
  if [[ -d \"\$d\" ]]; then target=\"\$d\"; break; fi
done
if [[ -z \"\$target\" ]]; then
  echo \"hoster: project dir not found for slug=${slug} (looked in: \${candidates[*]})\"
  echo \"hoster: fix: set a stable deploy dir on hoster and document it in RUNBOOK.md\"
  exit 4
fi
cd \"\$target\"
if [[ -x \"./scripts/deploy.sh\" ]]; then
  ./scripts/deploy.sh
  exit 0
fi
echo \"hoster: scripts/deploy.sh not found or not executable in \$target\"
echo \"hoster: fix: add scripts/deploy.sh to the repo and document restart commands in RUNBOOK.md\"
exit 5
'"
}

case "${PROJECT_SLUG}:${ENV_NAME}" in
  cursorrpa:hoster | shectory-portal:hoster)
    commit_push_on_work "cursorrpa"
    deploy_cursorrpa_hoster
    ;;
  komissionka:hoster)
    commit_push_on_work "komissionka"
    deploy_komissionka_hoster
    ;;
  piranha-ai:hoster)
    commit_push_on_work "piranha-ai"
    deploy_piranha_ai_hoster
    ;;
  pingmaster:hoster)
    commit_push_on_work "pingmaster"
    ssh -o BatchMode=yes "${SSH_HOSTER}" "bash --noprofile --norc -lc 'set -euo pipefail; cd \"\$HOME/pingmaster\"; ./scripts/deploy.sh'"
    ;;
  *:hoster)
    commit_push_on_work "${PROJECT_SLUG}"
    deploy_generic_hoster_by_script "${PROJECT_SLUG}"
    ;;
  *)
    echo "unsupported combination: ${PROJECT_SLUG} ${ENV_NAME}"
    echo "supported:"
    echo "  - cursorrpa hoster"
    echo "  - komissionka hoster"
    echo "  - <any> hoster (requires scripts/deploy.sh on hoster checkout)"
    exit 2
    ;;
esac

echo "done"

