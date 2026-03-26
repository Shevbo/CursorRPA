#!/usr/bin/env bash
set -euo pipefail

# Provision PostgreSQL roles/databases by project:
# - one LOGIN role per project (project_<slug>_app)
# - one database per project (project_<slug>)
# - shared admin LOGIN role (cursorrpa_admin) with CREATEDB and membership in project roles
#
# Usage:
#   sudo bash scripts/shectory-db-provision.sh admin
#   sudo bash scripts/shectory-db-provision.sh project shectory-portal
#   sudo bash scripts/shectory-db-provision.sh project komissionka --db komissionka_db

STORE_DIR="/home/shectory/.db-projects"
ADMIN_ROLE="cursorrpa_admin"

usage() {
  cat <<'EOF'
Usage:
  shectory-db-provision.sh admin [--email EMAIL]
  shectory-db-provision.sh project <slug> [--db DB_NAME]

Notes:
  - slug is normalized to lowercase and '-' is converted to '_'
  - credentials are saved in /home/shectory/.db-projects/*.env
EOF
}

normalize_slug() {
  local raw="$1"
  echo "$raw" | tr '[:upper:]' '[:lower:]' | tr '-' '_' | tr -cd 'a-z0-9_'
}

random_password() {
  openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | head -c 32
}

ensure_store() {
  mkdir -p "$STORE_DIR"
  chmod 700 "$STORE_DIR"
}

run_psql() {
  sudo -u postgres psql -v ON_ERROR_STOP=1 "$@"
}

ensure_admin() {
  local email="$1"
  local pass
  pass="$(random_password)"

  run_psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ADMIN_ROLE}') THEN
    CREATE ROLE ${ADMIN_ROLE} WITH LOGIN CREATEDB PASSWORD '${pass}';
  ELSE
    ALTER ROLE ${ADMIN_ROLE} WITH LOGIN CREATEDB PASSWORD '${pass}';
  END IF;
END
\$\$;
SQL

  ensure_store
  cat > "${STORE_DIR}/${ADMIN_ROLE}.env" <<EOF
PGADMIN_EMAIL=${email}
PGADMIN_DEFAULT_EMAIL=${email}
POSTGRES_ADMIN_ROLE=${ADMIN_ROLE}
POSTGRES_ADMIN_PASSWORD=${pass}
EOF
  chmod 600 "${STORE_DIR}/${ADMIN_ROLE}.env"

  echo "Admin role ready: ${ADMIN_ROLE}"
  echo "Saved: ${STORE_DIR}/${ADMIN_ROLE}.env"
}

ensure_project() {
  local slug="$1"
  local db_name="$2"
  local role_name="project_${slug}_app"
  local pass
  pass="$(random_password)"

  run_psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role_name}') THEN
    CREATE ROLE ${role_name} WITH LOGIN PASSWORD '${pass}';
  ELSE
    ALTER ROLE ${role_name} WITH LOGIN PASSWORD '${pass}';
  END IF;
END
\$\$;
SQL

  run_psql -tc "SELECT 1 FROM pg_database WHERE datname = '${db_name}'" | grep -q 1 || \
    run_psql -c "CREATE DATABASE ${db_name} OWNER ${role_name};"

  # Ownership/grants hardening even if DB already existed.
  run_psql -c "ALTER DATABASE ${db_name} OWNER TO ${role_name};"
  run_psql -c "GRANT CONNECT, TEMPORARY ON DATABASE ${db_name} TO ${role_name};"
  run_psql -d "${db_name}" -c "ALTER SCHEMA public OWNER TO ${role_name};"
  run_psql -d "${db_name}" -c "GRANT ALL ON SCHEMA public TO ${role_name};"
  run_psql -d "${db_name}" -c "ALTER DEFAULT PRIVILEGES FOR ROLE ${role_name} IN SCHEMA public GRANT ALL ON TABLES TO ${role_name};"
  run_psql -d "${db_name}" -c "ALTER DEFAULT PRIVILEGES FOR ROLE ${role_name} IN SCHEMA public GRANT ALL ON SEQUENCES TO ${role_name};"
  run_psql -d "${db_name}" -c "ALTER DEFAULT PRIVILEGES FOR ROLE ${role_name} IN SCHEMA public GRANT ALL ON FUNCTIONS TO ${role_name};"

  # Allow shared admin to fully manage project DB through role membership.
  run_psql -tc "SELECT 1 FROM pg_roles WHERE rolname = '${ADMIN_ROLE}'" | grep -q 1 && \
    run_psql -c "GRANT ${role_name} TO ${ADMIN_ROLE};" || true

  ensure_store
  cat > "${STORE_DIR}/${slug}.env" <<EOF
PROJECT_SLUG=${slug}
POSTGRES_DB=${db_name}
POSTGRES_ROLE=${role_name}
POSTGRES_PASSWORD=${pass}
DATABASE_URL=postgresql://${role_name}:${pass}@localhost:5432/${db_name}?schema=public
EOF
  chmod 600 "${STORE_DIR}/${slug}.env"

  echo "Project ready: ${slug}"
  echo "  role: ${role_name}"
  echo "  db:   ${db_name}"
  echo "Saved: ${STORE_DIR}/${slug}.env"
}

main() {
  if [[ $# -lt 1 ]]; then
    usage
    exit 1
  fi

  local mode="$1"
  shift

  case "$mode" in
    admin)
      local email="bshevelev@mail.ru"
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --email)
            email="${2:-}"
            shift 2
            ;;
          *)
            echo "Unknown argument: $1" >&2
            usage
            exit 1
            ;;
        esac
      done
      ensure_admin "$email"
      ;;
    project)
      if [[ $# -lt 1 ]]; then
        usage
        exit 1
      fi
      local raw_slug="$1"
      shift
      local slug db_name
      slug="$(normalize_slug "$raw_slug")"
      db_name="project_${slug}"
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --db)
            db_name="${2:-}"
            shift 2
            ;;
          *)
            echo "Unknown argument: $1" >&2
            usage
            exit 1
            ;;
        esac
      done
      ensure_project "$slug" "$db_name"
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
