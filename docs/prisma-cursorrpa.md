# Prisma и БД в монолите CursorRPA

## Где схема

- **Один источник правды:** `prisma/schema.prisma` в **корне** репозитория `CursorRPA`.
- Данные — **PostgreSQL**. В проде строка подключения обычно указывает на **Hoster** (см. [shectory-projects-registry.md](shectory-projects-registry.md)); локально — свой инстанс или тот же URL при доступе по сети.

## Переменные окружения

- **`DATABASE_URL`** — обязательна для `db push`, `migrate`, `studio`, `generate` (проверка datasource), runtime Next.js (`shectory-portal`).
- Задаётся в `.env` в корне и/или в `shectory-portal/.env` (что подхватывает `next dev` / systemd `EnvironmentFile`). Пример без секретов: [../.env.example](../.env.example).

## Политика учёток и БД (проектная изоляция)

- Для каждого проекта используется отдельная пара:
  - отдельная БД: `project_<slug>`
  - отдельная роль: `project_<slug>_app`
- Техническая admin-роль для управления проектными БД: `cursorrpa_admin` (LOGIN + CREATEDB + membership в проектных ролях).
- Провижининг на сервере: `scripts/shectory-db-provision.sh`.

Примеры:

```bash
sudo bash scripts/shectory-db-provision.sh admin --email bshevelev@mail.ru
sudo bash scripts/shectory-db-provision.sh project shectory-portal
sudo bash scripts/shectory-db-provision.sh project cursorrpa
sudo bash scripts/shectory-db-provision.sh project komissionka
```

Секреты сохраняются на сервере в `/home/shectory/.db-projects/*.env` (права `600`).

## Команды из корня репозитория

Корневой `package.json` **проксирует** вызовы в `shectory-portal`, чтобы Prisma Client всегда генерировался в `shectory-portal/node_modules` (Next.js).

```bash
cd shectory-portal && npm install   # один раз (или из корня: npm install --prefix shectory-portal)
export DATABASE_URL='postgresql://...'
npm run db:push        # из корня CursorRPA
npm run db:generate
npm run db:seed
npm run db:studio
```

Коротко всё подряд: `npm run db:sync` (push + generate + seed).

Прямой вызов из каталога приложения:

```bash
cd shectory-portal
npm run db:push
```

## Команды из каталога `shectory-portal`

```bash
cd shectory-portal
npm install   # postinstall: prisma generate --schema=../prisma/schema.prisma
npm run build
npm run db:push
npm run db:seed
npm run db:generate
npm run db:studio
```

## Потребители кода

- Приложение **Shectory Portal** импортирует `@prisma/client` и синглтон из `shectory-portal/src/lib/prisma.ts`.
- Другие пакеты монолита при появлении Node-сервисов могут добавить зависимость `@prisma/client` и тот же путь генерации (`db:generate` из корня или из portal).

## Миграции

- Сейчас удобно использовать **`prisma db push`** в итеративной разработке.
- Для версионируемых миграций: `npm run db:migrate:dev` из корня (создаёт `prisma/migrations` рядом со схемой).
