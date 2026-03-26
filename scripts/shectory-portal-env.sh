#!/usr/bin/env bash
set -euo pipefail
ROOT="/home/shectory/workspaces/shectory-portal"
ADMIN="$(openssl rand -hex 24)"
CREDS="/home/shectory/.db-projects/shectory_portal.env"

if [[ ! -f "$CREDS" ]]; then
  echo "Missing $CREDS. Run: sudo bash scripts/shectory-db-provision.sh project shectory-portal" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$CREDS"
cat > "$ROOT/.env" <<EOF
DATABASE_URL=${DATABASE_URL}
HOME=/home/shectory
NODE_ENV=production
ADMIN_TOKEN=${ADMIN}
EOF
chmod 600 "$ROOT/.env"
echo "ADMIN_TOKEN=${ADMIN}"
