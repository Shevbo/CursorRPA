/**
 * Сид монолита CursorRPA (общая БД Postgres).
 * Запуск: из корня `npm run db:seed` или из shectory-portal `npm run db:seed`.
 * Требуется DATABASE_URL и сгенерированный клиент (`npm run db:generate`).
 */
// Monorepo: Prisma client is generated into shectory-portal/node_modules/.prisma/client (see prisma/schema.prisma).
import { PrismaClient } from "../shectory-portal/node_modules/.prisma/client";

const prisma = new PrismaClient();

const DEFAULT_PORTAL_WORKSPACE =
  process.env.SHECTORY_PORTAL_WORKSPACE_PATH?.trim() ||
  "/home/shectory/workspaces/CursorRPA/shectory-portal";

function asciiLabel(input: string): string {
  const v = input
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return v || input;
}

function ticketPrefixFromSlug(slug: string): string {
  const p = slug
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 5);
  return p || "PRJ";
}

async function main() {
  await prisma.referenceItem.deleteMany();
  await prisma.referenceCategory.deleteMany();

  const cat = await prisma.referenceCategory.create({
    data: { name: "Площадки" },
  });
  await prisma.referenceItem.createMany({
    data: [
      { categoryId: cat.id, label: "Shectory (dev)", value: "VDS разработка, agent CLI, репозитории" },
      { categoryId: cat.id, label: "Hoster (prod)", value: "83.69.248.175 — бэкенды, UI, Postgres, Prisma" },
    ],
  });

  /** P0: мета-проект для dogfooding — хотелки по Web UI в бэклоге этого slug. См. docs/shectory-portal-backlog-contract.md */
  await prisma.project.upsert({
    where: { slug: "shectory-portal" },
    create: {
      slug: "shectory-portal",
      name: "Shectory Portal",
      ticketPrefix: ticketPrefixFromSlug("shectory-portal"),
      workspacePath: DEFAULT_PORTAL_WORKSPACE,
      uiUrl: "https://shectory.ru",
      description:
        "Мета-проект портала: бэклог хотелок по UI/оркестратору (P0–P3). Источник контракта: docs/shectory-portal-backlog-contract.md.",
      architectureMermaid:
        "flowchart LR\n  UI[Shectory Portal UI]\n  API[Next API]\n  DB[(Postgres)]\n  UI --> API --> DB",
      aiContext:
        "Разработка shectory-portal в монолите CursorRPA. Задачи вести в бэклоге этого проекта или в cursorrpa для сквозных тем.",
      createdSource: "manual",
      workspaceReady: true,
      gitReady: false,
      sshReady: true,
    },
    update: {
      name: "Shectory Portal",
      ticketPrefix: ticketPrefixFromSlug("shectory-portal"),
      workspacePath: DEFAULT_PORTAL_WORKSPACE,
      uiUrl: "https://shectory.ru",
    },
  });

  // Реестр инициатив Shectory (из docs/shectory-projects-registry.md) — хранится в БД, UI только отображает.
  const registry = [
    {
      slug: "cursorrpa",
      name: "CursorRPA (монолит)",
      stage: "dev + portal prod",
      uiUrl: "https://shectory.ru",
      workspacePath: "/home/shectory/workspaces/CursorRPA",
      repoUrl: "https://github.com/Shevbo/CursorRPA.git",
      stack: ["docs", "scripts", "Next.js (shectory-portal)", "Python (telegram bridge)"],
      notes:
        "Один репозиторий: доки, скрипты, Shectory Portal, Telegram bridge. Публичный UI: shectory.ru. Unit: shectory-portal.service.",
      hosterRole: "Web UI портала на VDS",
    },
    {
      slug: "komissionka",
      name: "Комиссионка",
      stage: "dev / prod split",
      uiUrl: "https://komissionka92.ru",
      workspacePath: "/home/shectory/workspaces/komissionka",
      repoUrl: "https://github.com/Shevbo/komissionka-app.git",
      stack: ["Prisma", "Postgres", "web"],
      notes: "Прод URL: https://komissionka92.ru.",
      hosterRole: "prod DB/UI/API на Hoster",
    },
    {
      slug: "piranha-ai",
      name: "PiranhaAI",
      stage: "dev",
      uiUrl: null,
      workspacePath: "/home/shectory/workspaces/PiranhaAI",
      repoUrl: null,
      stack: [".NET", "native"],
      notes: "Проект в portable-режиме, remote в корне не зафиксирован.",
      hosterRole: "по продукту",
    },
    {
      slug: "pingmaster",
      name: "PingMaster",
      stage: "requirements",
      uiUrl: null,
      workspacePath: "/home/shectory/workspaces/PingMaster",
      repoUrl: null,
      stack: ["Android"],
      notes:
        "На shectory-work каталог /home/shectory/workspaces/PingMaster отсутствует; путь/remote требуют фикса в инфраструктуре.",
      hosterRole: "нет prod на Hoster (requirements)",
    },
  ] as const;

  for (const p of registry) {
    const nodeId = p.slug.replace(/[^a-z0-9]/g, "") || "Project";
    const label = asciiLabel(p.name);
    const universalDeployContext = [
      "Унифицированный деплой/коммит (использовать в задачах агента, и в Cursor workspace, и в UI shectory.ru):",
      "- Все изменения фиксируем в git перед деплоем (git add -A, git commit, git push).",
      "- Унифицированная команда деплоя (из монолита CursorRPA):",
      `  /home/shectory/workspaces/CursorRPA/scripts/deploy-project.sh ${p.slug} hoster`,
      "- Если команда для проекта не поддержана — допишите deploy-скрипт проекта и зафиксируйте команды в RUNBOOK.md.",
      "",
      "Унифицированная аутентификация/пользователи/доступы (вынесено из komissionka):",
      "- Документация: /home/shectory/workspaces/CursorRPA/docs/unified-auth-users-rbac-ru.md",
      "- Шаблон для Next.js+Prisma: /home/shectory/workspaces/CursorRPA/templates/shectory-auth-nextjs-prisma/",
    ].join("\n");
    await prisma.project.upsert({
      where: { slug: p.slug },
      create: {
        slug: p.slug,
        name: p.name,
        ticketPrefix: p.slug === "piranha-ai" ? "PH" : ticketPrefixFromSlug(p.slug),
        workspacePath: p.workspacePath,
        uiUrl: p.uiUrl,
        stage: p.stage,
        status: "active",
        description: p.notes,
        architectureMermaid: `flowchart LR\n  ${nodeId}[${label}]`,
        aiContext: `Проект ${p.name}. Инфраструктурные метаданные и ссылки — в Project.registryMetaJson.\n\n${universalDeployContext}`,
        repoUrl: p.repoUrl,
        createdSource: "manual",
        workspaceReady: false,
        gitReady: false,
        sshReady: false,
        registryMetaJson: {
          shortId: p.slug,
          hosterRole: p.hosterRole,
          stack: p.stack,
          notes: p.notes,
          deploy: {
            unified: `/home/shectory/workspaces/CursorRPA/scripts/deploy-project.sh ${p.slug} hoster`,
            requiresGitCommit: true,
            requiresUserApproval: true,
          },
          servers:
            p.slug === "cursorrpa"
              ? [
                  {
                    id: "vds",
                    name: "VDS shectory",
                    group: "VDS",
                    role: "dev + ui",
                    host: "83.69.248.77",
                    links: [{ label: "shectory.ru", url: "https://shectory.ru" }],
                  },
                  {
                    id: "hoster",
                    name: "Hoster",
                    group: "Hoster",
                    role: "prod (DB)",
                    host: "83.69.248.175",
                    links: [{ label: "pgAdmin", url: "http://83.69.248.175:5050" }],
                  },
                ]
              : p.slug === "komissionka"
                ? [
                    {
                      id: "hoster",
                      name: "Hoster",
                      group: "Hoster",
                      role: "prod",
                      host: "83.69.248.175",
                      links: [
                        { label: "UI", url: "https://komissionka92.ru" },
                        { label: "pgAdmin", url: "http://83.69.248.175:5050" },
                      ],
                    },
                  ]
                : [],
          modules:
            p.slug === "cursorrpa"
              ? [
                  { id: "portal-ui", name: "Shectory Portal UI", kind: "ui", serverId: "vds" },
                  { id: "portal-api", name: "Shectory Portal API", kind: "api", serverId: "vds" },
                  { id: "agent", name: "Cursor Agent CLI", kind: "worker", serverId: "vds" },
                  { id: "bridge", name: "Telegram bridge", kind: "bridge", serverId: "vds" },
                  { id: "db", name: "Postgres (CursorRPA DB)", kind: "db", serverId: "hoster" },
                  { id: "pgadmin", name: "pgAdmin", kind: "admin", serverId: "hoster" },
                  { id: "github", name: "GitHub", kind: "external" },
                  { id: "telegram", name: "Telegram", kind: "external" },
                  { id: "browser", name: "Users/Browser", kind: "external" },
                ]
              : p.slug === "komissionka"
                ? [
                    { id: "browser", name: "Users/Browser", kind: "external" },
                    { id: "ui", name: "Komissionka UI", kind: "ui", serverId: "hoster" },
                    { id: "api", name: "Komissionka API", kind: "api", serverId: "hoster" },
                    { id: "db", name: "Postgres (komissionka_db)", kind: "db", serverId: "hoster" },
                  ]
                : [],
          flows:
            p.slug === "cursorrpa"
              ? [
                  { from: "browser", to: "portal-ui", label: "HTTP(S)" },
                  { from: "portal-ui", to: "portal-api", label: "RSC/API" },
                  { from: "portal-api", to: "db", label: "SQL" },
                  { from: "portal-api", to: "agent", label: "run prompt" },
                  { from: "bridge", to: "telegram", label: "bot" },
                  { from: "portal-api", to: "github", label: "repo ops" },
                  { from: "pgadmin", to: "db", label: "admin" },
                ]
              : p.slug === "komissionka"
                ? [
                    { from: "browser", to: "ui", label: "HTTP(S)" },
                    { from: "ui", to: "api", label: "API" },
                    { from: "api", to: "db", label: "SQL" },
                  ]
                : [],
          secrets: {
            hint:
              "Секреты не хранятся в БД. Смотрите docs/ и серверные файлы env/secret-stores (Hoster: /home/shectory/.db-projects, komissionka: /home/ubuntu/komissionka/.env).",
          },
        },
      },
      update: {
        name: p.name,
        ticketPrefix: p.slug === "piranha-ai" ? "PH" : ticketPrefixFromSlug(p.slug),
        workspacePath: p.workspacePath,
        uiUrl: p.uiUrl,
        stage: p.stage,
        repoUrl: p.repoUrl,
        architectureMermaid: `flowchart LR\n  ${nodeId}[${label}]`,
        aiContext: `Проект ${p.name}. Инфраструктурные метаданные и ссылки — в Project.registryMetaJson.\n\n${universalDeployContext}`,
        registryMetaJson: {
          shortId: p.slug,
          hosterRole: p.hosterRole,
          stack: p.stack,
          notes: p.notes,
          deploy: {
            unified: `/home/shectory/workspaces/CursorRPA/scripts/deploy-project.sh ${p.slug} hoster`,
            requiresGitCommit: true,
            requiresUserApproval: true,
          },
          servers:
            p.slug === "cursorrpa"
              ? [
                  {
                    id: "vds",
                    name: "VDS shectory",
                    group: "VDS",
                    role: "dev + ui",
                    host: "83.69.248.77",
                    links: [{ label: "shectory.ru", url: "https://shectory.ru" }],
                  },
                  {
                    id: "hoster",
                    name: "Hoster",
                    group: "Hoster",
                    role: "prod (DB)",
                    host: "83.69.248.175",
                    links: [{ label: "pgAdmin", url: "http://83.69.248.175:5050" }],
                  },
                ]
              : p.slug === "komissionka"
                ? [
                    {
                      id: "hoster",
                      name: "Hoster",
                      group: "Hoster",
                      role: "prod",
                      host: "83.69.248.175",
                      links: [
                        { label: "UI", url: "https://komissionka92.ru" },
                        { label: "pgAdmin", url: "http://83.69.248.175:5050" },
                      ],
                    },
                  ]
                : [],
          modules:
            p.slug === "cursorrpa"
              ? [
                  { id: "portal-ui", name: "Shectory Portal UI", kind: "ui", serverId: "vds" },
                  { id: "portal-api", name: "Shectory Portal API", kind: "api", serverId: "vds" },
                  { id: "agent", name: "Cursor Agent CLI", kind: "worker", serverId: "vds" },
                  { id: "bridge", name: "Telegram bridge", kind: "bridge", serverId: "vds" },
                  { id: "db", name: "Postgres (CursorRPA DB)", kind: "db", serverId: "hoster" },
                  { id: "pgadmin", name: "pgAdmin", kind: "admin", serverId: "hoster" },
                  { id: "github", name: "GitHub", kind: "external" },
                  { id: "telegram", name: "Telegram", kind: "external" },
                  { id: "browser", name: "Users/Browser", kind: "external" },
                ]
              : p.slug === "komissionka"
                ? [
                    { id: "browser", name: "Users/Browser", kind: "external" },
                    { id: "ui", name: "Komissionka UI", kind: "ui", serverId: "hoster" },
                    { id: "api", name: "Komissionka API", kind: "api", serverId: "hoster" },
                    { id: "db", name: "Postgres (komissionka_db)", kind: "db", serverId: "hoster" },
                  ]
                : [],
          flows:
            p.slug === "cursorrpa"
              ? [
                  { from: "browser", to: "portal-ui", label: "HTTP(S)" },
                  { from: "portal-ui", to: "portal-api", label: "RSC/API" },
                  { from: "portal-api", to: "db", label: "SQL" },
                  { from: "portal-api", to: "agent", label: "run prompt" },
                  { from: "bridge", to: "telegram", label: "bot" },
                  { from: "portal-api", to: "github", label: "repo ops" },
                  { from: "pgadmin", to: "db", label: "admin" },
                ]
              : p.slug === "komissionka"
                ? [
                    { from: "browser", to: "ui", label: "HTTP(S)" },
                    { from: "ui", to: "api", label: "API" },
                    { from: "api", to: "db", label: "SQL" },
                  ]
                : [],
          secrets: {
            hint:
              "Секреты не хранятся в БД. Смотрите docs/ и серверные файлы env/secret-stores (Hoster: /home/shectory/.db-projects, komissionka: /home/ubuntu/komissionka/.env).",
          },
        },
      },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
