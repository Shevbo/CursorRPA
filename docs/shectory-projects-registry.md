# Реестр инициатив Shectory

Источник правды для путей и ролей серверов. **Секреты и значения `.env` сюда не пишутся** — только имена переменных, если нужно, в колонке `notes`.

**Модель репозитория:** репозиторий **CursorRPA** считается **монолитом**: в одном Git-хранилище лежат `docs/`, `scripts/`, `services/telegram-bridge/`, каталог **`shectory-portal/`** (исходники Web UI). На VDS прод-сборка портала может собираться из клона в `~/workspaces/CursorRPA/shectory-portal` или из отдельного деплой-каталога — зафиксируйте фактический `WorkingDirectory` в unit `shectory-portal.service`.

Обновляйте при смене папок клонов или `git remote`.

**Последнее исследование:** 2026-03-24 (структура `~/workspaces`, `git config`, `prisma/seed.ts` в корне монолита, проверка доступов `github.com`, `git ls-remote`, `https://shectory.ru`, SSH `shectory-work`).

---

## Архитектура монолита CursorRPA (логическая)

```mermaid
flowchart TB
  subgraph mono["Репозиторий CursorRPA"]
    docs[docs + scripts]
    bridge[services/telegram-bridge]
    portal[shectory-portal Web UI]
  end
  subgraph desk["VDS / рабочее место"]
    agent[Cursor Agent CLI]
    ws["~/workspaces прикладные проекты"]
  end
  subgraph ext["Внешнее"]
    tg[Telegram]
    gh[GitHub]
  end
  portal --> agent
  bridge --> agent
  portal --> gh
  bridge --> tg
  agent --> ws
  docs --> portal
```

---

## Таблица


| short_id    | name             | stage            | app_url                    | path_shectory (VDS)                     | git_remote                                                                              | github_access (2026-03-24) | hoster_role                       | stack                  | notes                                                                                                                         |
| ----------- | ---------------- | ---------------- | -------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------- | --------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| cursor-rpa  | CursorRPA (монолит) | dev + portal prod | `https://shectory.ru` (UI) | `/home/shectory/workspaces/CursorRPA`   | `https://github.com/Shevbo/CursorRPA.git`                                               | ok (`git ls-remote`)       | Web UI портала на VDS             | docs, scripts, Next.js в `shectory-portal/`, Python bridge | Один репозиторий: доки, скрипты, **Shectory Portal** (`shectory-portal/`), **Telegram bridge**. Публичный UI: `shectory.ru`. Unit: `shectory-portal.service`. |
| komissionka | Комиссионка      | dev / prod split | `https://komissionka92.ru` | `/home/shectory/workspaces/komissionka` | `https://github.com/Shevbo/komissionka-app.git`                                         | ok (`git ls-remote`)       | prod DB/UI/API на Hoster          | Prisma, Postgres, web  | Прод URL: `https://komissionka92.ru`.                                                                                           |
| piranha-ai  | PiranhaAI        | dev              | `-`                        | `/home/shectory/workspaces/PiranhaAI`   | *нет `.git` в корне проекта (portable)*                                                 | n/a                        | по продукту                       | .NET / native          | Проект в portable-режиме, remote в корне не зафиксирован.                                                                       |
| pingmaster  | PingMaster       | requirements     | `-`                        | `/home/shectory/workspaces/PingMaster`  | не подтверждено                                                                           | fail (repo/path unknown)   | нет prod на Hoster (requirements) | Android                | На `shectory-work` каталог `/home/shectory/workspaces/PingMaster` отсутствует; путь/remote требуют фикса в инфраструктуре.     |


---

## Связь с `~/workspaces` (shectory-work)


| Каталог в `~/workspaces`                 | Содержимое (на дату исследования)               | Куда смотрит код                                 |
| ---------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| `/home/shectory/workspaces/CursorRPA`    | git-клон монолита: docs, scripts, `shectory-portal/`, `services/telegram-bridge/` | репозиторий **CursorRPA**; Web UI — подкаталог `shectory-portal/` |
| `/home/shectory/workspaces/komissionka`  | git-клон продукта komissionka                   | рабочая копия проекта komissionka                |
| `/home/shectory/workspaces/PiranhaAI`    | проект в portable-режиме                         | рабочая копия проекта PiranhaAI                  |


---

## Соглашения

- `path_shectory`: единый корень `~/workspaces` (пользователь `shectory` на VDS). Имена каталогов на VDS синхронизируются с порталом из файловой системы; мета-проект `shectory-portal` в БД задаётся в [prisma/seed.ts](../prisma/seed.ts). Отдельная строка реестра «shectory-portal» как соседний клон **не используется** — UI входит в монолит `CursorRPA`. Схема БД: [prisma-cursorrpa.md](prisma-cursorrpa.md).
- `git_remote`: без токенов в URL; при приватном доступе — `ssh: git@github.com:...` без ключей в файле.
- `app_url`: отдельная колонка для публичного URL приложения (если есть). Для внутренних сервисов использовать `-`.

