# Контракт бэклога Shectory Portal (P0)

Дата: 2026-03-26  
Назначение: единые словари и **канонический проект** для dogfooding — хотелки по порталу ведём в бэклоге того же инструмента.

## Канонический slug для хотелок по Web UI

- **`shectory-portal`** — мета-проект «Shectory Portal» в БД портала (создаётся/обновляется через `npm run db:seed`, если ещё нет).
- Альтернатива для хотелок **всего монолита** (docs, bridge, portal): проект с slug **`cursorrpa`**, если он появился из sync каталога `CursorRPA` в `~/workspaces`.

Рекомендация: задачи **только про UI панели** — в `shectory-portal`; **сквозные по монолиту** — в `cursorrpa`, если оба проекта есть в реестре.

## Статусы задачи (`BacklogItem.status`)

| Значение       | Смысл              |
| -------------- | ------------------ |
| `new`          | Новая              |
| `in_progress`  | В работе           |
| `testing`      | На проверке        |
| `done`         | Готово             |
| `rejected`     | Отклонено          |

## Статусы спринта (`BacklogItem.sprintStatus`)

| Значение   | Смысл        |
| ---------- | ------------ |
| `forming`  | Формируется  |
| `active`   | Активен      |
| `released` | Выпущен      |
| `archived` | Архив        |

## Поля (кратко)

- `title` — короткое название (аналог headline).
- `description` — произвольное описание / заметки.
- `descriptionPrompt` — основной текст промпта / ТЗ для агента (пустая строка по умолчанию).
- `sprintNumber` + `sprintStatus` — привязка к спринту; `0` и `forming` — «вне активного спринта» или бэклог до планирования.
- К:classifierы `taskType`, `modules`, `components`, `complexity` — опционально, для отчётов и фильтров.
- Поля `prompt*` и ссылки `docLink`, `testOrderOrLink` — для parity с komissionka и сценария Generate Prompt (позже).

Валидация на API: см. `shectory-portal/src/lib/backlog-constants.ts`.

## Реализация в коде (P0–P3)

- Контракт и slug зафиксированы здесь; запись `shectory-portal` создаётся/обновляется в **[`prisma/seed.ts`](../prisma/seed.ts)** (`npm run db:seed` из **корня** репозитория или из `shectory-portal`).
- Расширенная модель `BacklogItem`, `GET/POST` с фильтрами и пагинацией, `PATCH/DELETE` по id, UI `BacklogPanel`, маршрут `/projects/[slug]/control`.
