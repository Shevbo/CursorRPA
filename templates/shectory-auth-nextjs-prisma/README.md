# Shectory Auth (Next.js + Prisma + NextAuth)

Это переносимый “модуль‑шаблон” аутентификации и RBAC, вынесенный из `komissionka`.

## Что входит

- Prisma‑контракт `users` + `profiles` (1:1, общий id)
- NextAuth Credentials + JWT (`src/lib/auth.ts`)
- API routes:
  - `src/app/api/auth/[...nextauth]/route.ts`
  - `src/app/api/auth/signup/route.ts`
  - `src/app/api/auth/profile/route.ts`
  - `src/app/api/admin/profiles/[id]/role/route.ts`

## Как подключить

1) Скопируйте файлы из этого шаблона в ваш проект (с учётом ваших алиасов импорта).
2) Добавьте/адаптируйте Prisma schema: модели `users` и `profiles`.
3) Поставьте зависимости:
   - `next-auth`
   - `bcryptjs`
4) Добавьте переменные окружения:
   - `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL` (если требуется)
5) Добавьте страницу `/login` (у NextAuth pages.signIn = `/login`).

## Контроль доступа

Админ‑эндпоинты защищаются так:
- `getServerSession(authOptions)` -> `session.user.id`
- `profiles.findUnique({ where: { id: session.user.id }, select: { role: true } })`
- допускаем только `role === "admin"`

