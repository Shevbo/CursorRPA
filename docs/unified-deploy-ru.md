# Унифицированный деплой и коммит (для всех агентов)

Цель: чтобы любой агент (в Cursor workspace или в UI `shectory.ru`) всегда знал одну и ту же команду деплоя и правило “сначала коммит в git”.

## Единая команда

На `shectory-work`:

- `ssh shectory-work`
- `cd /home/shectory/workspaces/CursorRPA`
- `./scripts/deploy-project.sh <project-slug> hoster`

Примеры:

- `./scripts/deploy-project.sh cursorrpa hoster`
- `./scripts/deploy-project.sh komissionka hoster`
- `./scripts/deploy-project.sh ourdiary hoster`
- `./scripts/deploy-project.sh piranha-ai hoster`
- `./scripts/deploy-project.sh shectory-assist hoster` (Telegram-бот на **shectory-work**, см. `Shectory Assist/scripts/deploy.sh`)

Публичные UI прикладных продуктов на поддоменах `*.shectory.ru` перечислены в [shectory-wikipedia.md](shectory-wikipedia.md) (таблица «Публичные URL прикладных приложений Shectory»).

## Правило про git

Перед деплоем изменения должны быть зафиксированы в git:

- `git add -A`
- `git commit -m "..."` (если есть изменения)
- `git push`

`deploy-project.sh` делает это автоматически там, где проект является git-репозиторием.

Если `git push` сообщает **«No configured push destination»**, сначала настройте **`origin`**: канонический URL и путь клона указаны в [shectory-projects-registry.md](shectory-projects-registry.md). Норма для VDS — **SSH**-remote (`git@github.com:...`), см. раздел **«Git remote и новый прикладной репозиторий»** в [shectory-wikipedia.md](shectory-wikipedia.md).

## Прокси для скачивания зависимостей (универсально для всех проектов)

Если на сервере нужен прокси для скачивания зависимостей/ресурсов (pip/npm/docker build и т.д.), используйте единый файл:

- `~/.config/shectory/proxy.env` (права `600`)

Формат: обычные строки `KEY=value`. Обычно это:
- `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` (и/или нижний регистр)
- (опционально) `PIP_INDEX_URL`, `PIP_EXTRA_INDEX_URL`, `PIP_TRUSTED_HOST`

`deploy-project.sh` и проектные `scripts/deploy.sh` должны подхватывать этот файл, не печатая значения в логах.

## Если для проекта деплой не настроен

Если `deploy-project.sh` сообщает, что не нашёл deploy-скрипт/команды на целевом хосте, нужно:

- создать в репозитории проекта `scripts/deploy.sh` (или `scripts/deploy-hoster.sh`)
- и зафиксировать конкретные команды рестарта (pm2/systemctl/docker/nginx) в `RUNBOOK.md` проекта

## Портал Shectory (миграции Prisma на VDS)

После изменений в `prisma/migrations` монолита на **`shectory-work`** выполните `npx prisma migrate deploy` из каталога `shectory-portal` (см. флаг `--schema` в [shectory-wikipedia.md](shectory-wikipedia.md) → «Настройки портала»). Иначе `/settings` и API админки могут отдавать 5xx.

