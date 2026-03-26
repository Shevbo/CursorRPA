#!/usr/bin/env bash
set -euo pipefail

# Backward-compatible wrapper.
# New model: one DB/role per project + shared admin role.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

sudo bash "${ROOT_DIR}/scripts/shectory-db-provision.sh" admin --email "bshevelev@mail.ru"
sudo bash "${ROOT_DIR}/scripts/shectory-db-provision.sh" project "shectory-portal"

echo "Saved credentials:"
echo "  /home/shectory/.db-projects/cursorrpa_admin.env"
echo "  /home/shectory/.db-projects/shectory_portal.env"
