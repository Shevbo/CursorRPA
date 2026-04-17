# Реестр инициатив Shectory

Источник правды для путей и ролей серверов. **Секреты и значения `.env` сюда не пишутся** — только имена переменных, если нужно, в колонке `notes`.

**Модель репозитория:** репозиторий **CursorRPA** считается **монолитом**: в одном Git-хранилище лежат `docs/`, `scripts/`, `services/telegram-bridge/`, каталог **`shectory-portal/`** (исходники Web UI). **VDS Shectory — это та же машина**, где лежит клон (например `~/workspaces/CursorRPA`); прод-сборка портала делается **на месте** скриптом `scripts/deploy-shectory-portal.sh` из корня клона. Зафиксируйте фактический `WorkingDirectory` в unit `shectory-portal.service` (часто user-unit под `shectory`).

Обновляйте при смене папок клонов или `git remote`.

**Последнее исследование:** 2026-04-02 (канонические публичные URL прикладных приложений — поддомены `*.shectory.ru`, см. **`docs/shectory-wikipedia.md`**; общий хост с Node: **`docs/raspi-safe-node-process-management-ru.md`**, **`scripts/kill-node-in-workdir.sh`**).

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
| piranha-ai  | PiranhaAI        | dev              | `https://piranhahypervisor.shectory.ru` | `/home/shectory/workspaces/PiranhaAI`   | *нет `.git` в корне проекта (portable)*                                                 | n/a                        | бэкенд в Docker на Hoster; HTTPS на VDS | .NET / native, облачный UI | Публичный UI — поддомен на VDS (nginx → Hoster :5000). Регламент: **`PiranhaAI/docs/agent-handoff-piranhahypervisor.shectory.ru.md`**. Деплой: **`deploy-project.sh piranha-ai hoster`**. |
| pingmaster  | PingMaster       | requirements     | `https://pingmaster.shectory.ru` | `/home/shectory/workspaces/PingMaster`  | локальный git инициализирован (remote не настроен)                                      | partial                    | веб-UI на Pi, снаружи — VDS nginx | Android + Next.js web | Публичный вход — **`https://pingmaster.shectory.ru`**. Процесс на Pi (порт **4555**), прокси с **`shectory-work`**. См. **`docs/shectory-wikipedia.md`** (Pi ↔ VDS). |
| syslog-srv  | Syslog Server    | prod (UI)        | `https://syslog.shectory.ru` | `/home/shectory/workspaces/syslog-srv`  | по факту клона на Pi/VDS                                                                | partial                    | UI на Pi, HTTPS на VDS            | Next.js, UDP syslog      | Публичный вход — **`https://syslog.shectory.ru`**. Чеклист: **`syslog-srv/docs/agent-handoff-syslog.shectory.ru.md`**. |
| ourdiary    | Наш дневник (ourdiary) | dev         | `https://ourdiary.shectory.ru/` (nginx на VDS → `127.0.0.1:3002`, PM2 на Hoster) | `/home/shectory/workspaces/ourdiary`    | `git@github.com:Shevbo/ourdiary.git`                                                    | ok                         | prod на Hoster (Postgres локально) | Next.js 16, Prisma, NextAuth | Публичный URL только поддомен; внутренний порт и PM2 — **`ourdiary/RUNBOOK.md`** («Внешний URL»). Деплой: **`deploy-project.sh ourdiary hoster`**. |
| shectory-assist | Shectory Assist | mvp | карточка: `https://shectory.ru/projects/shectory-assist` (бот без отдельного публичного UI) | `/home/shectory/workspaces/Shectory Assist` | `git@github.com:Shevbo/ShectoryAssist.git` | ok | PM2 на Hoster `~/shectory-assist` | TypeScript, grammy, Gemini | Деплой: **`deploy-project.sh shectory-assist hoster`**. Allowlist Telegram user id: **`/projects/shectory-assist/control`** (портал). |


---

## Связь с `~/workspaces` (shectory-work)


| Каталог в `~/workspaces`                 | Содержимое (на дату исследования)               | Куда смотрит код                                 |
| ---------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| `/home/shectory/workspaces/CursorRPA`    | git-клон монолита: docs, scripts, `shectory-portal/`, `services/telegram-bridge/` | репозиторий **CursorRPA**; Web UI — подкаталог `shectory-portal/` |
| `/home/shectory/workspaces/komissionka`  | git-клон продукта komissionka                   | рабочая копия проекта komissionka                |
| `/home/shectory/workspaces/PiranhaAI`    | проект в portable-режиме                         | рабочая копия проекта PiranhaAI                  |
| `/home/shectory/workspaces/PingMaster`   | базовый bootstrap по стандарту Shectory          | рабочая копия проекта PingMaster                 |
| `/home/shectory/workspaces/syslog-srv`   | syslog UI + приём UDP (часто деплой на Pi)        | репозиторий **syslog-srv**                       |
| `/home/shectory/workspaces/ourdiary`     | семейный дневник: лента, календарь, расходы, TV  | репозиторий **ourdiary**                         |
| `/home/shectory/workspaces/Shectory Assist` | голосовой Telegram-бот Assist (Gemini, навык Gazeta) | репозиторий **ShectoryAssist**; рантайм на Hoster |


---

## Соглашения

- `path_shectory`: единый корень `~/workspaces` (пользователь `shectory` на VDS). Имена каталогов на VDS синхронизируются с порталом из файловой системы; мета-проект `shectory-portal` в БД задаётся в [prisma/seed.ts](../prisma/seed.ts). Отдельная строка реестра «shectory-portal» как соседний клон **не используется** — UI входит в монолит `CursorRPA`. Схема БД: [prisma-cursorrpa.md](prisma-cursorrpa.md).
- `git_remote`: без токенов в URL; при приватном доступе — `ssh: git@github.com:...` без ключей в файле.
- `app_url`: **канонический публичный HTTPS-URL** приложения на поддомене `*.shectory.ru` (если есть). Не указывать здесь `shectory.ru:порт` или LAN `http://192.168…` как основной адрес. Для сервисов без публичного UI — `-`.

