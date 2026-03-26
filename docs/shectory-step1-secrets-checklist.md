# Shectory Step1 Secrets Checklist

Names only. Do not store secret values in git.

## Platform (shectory.ru)

- `DATABASE_URL` (Hoster PostgreSQL for Shectory platform)
- `ADMIN_TOKEN` (web admin auth)
- `CURSOR_API_KEY` (agent CLI runtime on Shectory)
- `BOT_TOKEN` (Telegram bot token for CursorRPAbot)
- `TELEGRAM_ALLOWED_CHAT_IDS` (if used by bridge)

## Optional per-project vars

- `KOMISSIONKA_*` runtime variables (if proxied/managed by orchestrator)
- `PIRANHAAI_*` runtime variables (if project helpers require env values)

## Storage locations

- Shectory server:
  - `/home/shectory/workspaces/shectory-portal/.env`
  - `/home/shectory/.config/cursor-rpa/env.sh` (600)
  - `services/telegram-bridge/.env` (on host where bridge runs)
- Hoster server:
  - DB credentials and prod app env files

## Permissions

- `chmod 600` for secret files
- no secrets in tracked files or commits
