# Унифицированная аутентификация, каталог пользователей и роли (RBAC)

Цель: любой агент (в workspace проекта или в чате `shectory.ru`) должен знать стандартный способ:
- входа (credentials),
- хранения пользователей,
- управления профилями и ролями,
- защиты админ‑эндпоинтов,
- деплоя изменений.

Источник эталонной реализации: проект `komissionka` (Next.js + Prisma + NextAuth Credentials + JWT).

---

## 1) Базовый контракт данных (Prisma)

Минимальный набор моделей:

- `users`: учётка (email, пароль‑хеш, признак SSO).
- `profiles`: профиль (роль, контактные поля, telegram‑привязка и т.п.).

Ключевой принцип: **один id** на `users.id` и `profiles.id` (1:1), создаются в транзакции.

Роли:
- `role = "user" | "admin" | "superadmin"` (строка в `profiles.role`).
- `superadmin` — единая учётка Shectory (глобально для всех прикладных проектов).

---

## 2) Стандарт аутентификации (NextAuth Credentials + JWT)

- Provider: `CredentialsProvider`
- Session strategy: `jwt`
- В `jwt` callback кладём `token.id`, `token.email`
- В `session` callback кладём `session.user.id` из `token.id`

Точка входа NextAuth:
- `src/app/api/auth/[...nextauth]/route.ts`

Конфиг:
- `src/lib/auth.ts`

---

## 3) Стандарт API для пользователей/профиля/ролей

### Регистрация
`POST /api/auth/signup`
- создаёт `users` + `profiles` в `$transaction`
- email нормализуется в lowercase
- пароль хешируется (`bcryptjs`)

### Профиль текущего пользователя
`GET /api/auth/profile`
- если нет сессии: `{ profile: null }`
- если профиль не найден: возвращает пустую структуру

`PATCH /api/auth/profile`
- обновляет контактные поля профиля
- если меняется email: обновляет и в `users`, и в `profiles`
- валидирует уникальность email

`DELETE /api/auth/profile`
- удаляет `users` (каскадом удаляет профиль и зависимости по FK/relations)

### Управление ролями (админ)
`PATCH /api/admin/profiles/:id/role`
- доступ только если текущий `profiles.role === "admin"`
- защита от снятия админ‑роли с самого себя

---

## 4) Как переносить в любой Next.js+Prisma проект

Используйте шаблон:
- `templates/shectory-auth-nextjs-prisma/`

Шаги:
1) Добавить Prisma‑модели `users`/`profiles` (или адаптировать существующие).
2) Добавить `src/lib/auth.ts` и API‑routes из шаблона.
3) Добавить страницы/формы `login` и `signup` (минимум: форма входа на `/login`).
4) Защитить админ‑роуты: проверка `getServerSession(authOptions)` + `profiles.role`.

Критично:
- **запрещено** заводить автономные каталоги пользователей в прикладных проектах;
- прикладные проекты обязаны использовать единый каталог пользователей Shectory/единый RBAC-контракт;
- учётка `bshevelev@mail.ru` должна иметь роль `superadmin` во всех проектах и контурах.

---

## 4.1) Единый фирменный welcome/login экран

Для всех прикладных проектов обязателен стандарт:
- `docs/welcome-page-standard-ru.md`
- `templates/shectory-welcome-frame/`

Минимальная структура:
- большой инфо-фрейм (проектный HTML/CSS),
- слева сверху: логотип Shectory,
- справа сверху: логотип проекта + версии модулей,
- унифицированная область логина.

---

## 5) Деплой/коммит (единый контракт)

Перед деплоем всегда фиксируйте изменения в git.

Унифицированная команда:
- `/home/shectory/workspaces/CursorRPA/scripts/deploy-project.sh <project-slug> hoster`

---

## 6) Для проектов НЕ на Next.js/Prisma

Если проект не на Next.js/Prisma (например .NET/native):
- контракт ролей остаётся тем же (минимум `user/admin`)
- каталог пользователей должен иметь аналог `users/profiles` (или таблица/коллекция с полями email/роль)
- UI/админка должны позволять менять роль только админам
- деплой/коммит — по унифицированной команде проекта (см. `RUNBOOK.md`)

