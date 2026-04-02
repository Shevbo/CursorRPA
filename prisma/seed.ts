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

/** Диаграммы для карточки проекта: хосты, протоколы, роли. */
const ARCH_MERMAID_BY_SLUG: Record<string, string> = {
  cursorrpa: `flowchart LR
    Browser["Браузер"]
    subgraph VDS["VDS shectory 83.69.248.77"]
      PortalUI["Shectory Portal Next.js"]
      PortalAPI["Next.js API"]
      Agent["Cursor Agent CLI (пользователь shectory)"]
      Bridge["Telegram bridge Python"]
    end
    subgraph Hoster["Hoster 83.69.248.175"]
      PG[("Postgres")]
      PgAdmin["pgAdmin"]
    end
    GH["GitHub"]
    TG["Telegram"]
    Browser -->|HTTPS| PortalUI
    PortalUI -->|RSC/API| PortalAPI
    PortalAPI -->|Prisma SQL| PG
    PortalAPI -->|spawn| Agent
    Bridge -->|HTTPS Bot API| TG
    PortalAPI -->|git SSH| GH
    PgAdmin -->|HTTP| PG`,
  komissionka: `flowchart LR
    U["Пользователь"]
    subgraph Hoster["Hoster 83.69.248.175"]
      Web["Komissionka UI"]
      API["Backend API"]
      DB[("Postgres komissionka_db")]
    end
    U -->|HTTPS| Web
    Web -->|REST| API
    API -->|SQL| DB`,
  pingmaster: `flowchart LR
    Dev["Разработчик"]
    subgraph Pi["Shevbo-Pi 192.168.1.105"]
      PM["PingMaster Next.js :4555"]
      SL["syslog-srv UI :4444"]
    end
    Mon["Мониторинг / Telegram bridge"]
    Dev -->|HTTP| PM
    Dev -->|HTTP| SL
    Mon -->|SSH tailscale user shevbo| Pi`,
  "piranha-ai": `flowchart LR
    Dev["Разработчик"]
    App["PiranhaAI .NET / native"]
    Repo["Git remote"]
    Dev -->|IDE| App
    Dev -->|git SSH| Repo`,
};

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
      {
        categoryId: cat.id,
        label: "Shevbo-Pi",
        value:
          "Raspberry Pi (LAN 192.168.1.105, Tailscale); пользователь shevbo; syslog-srv HTTP :4444, PingMaster HTTP :4555; снаружи — без TLS на портах (открывать http://)",
      },
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
        "Мета-проект Shectory Portal: оркестратор проектов, бэклог UI (P0–P3). Стек: Next.js, Prisma. Хост: VDS + Postgres на Hoster. Главный UI: https://shectory.ru. Контракт: docs/shectory-portal-backlog-contract.md.",
      architectureMermaid: `flowchart LR
        Admin["Админ портала"]
        subgraph VDS["VDS"]
          UI[Shectory Portal Next.js]
          API[Next.js API]
        end
        subgraph Hoster["Hoster"]
          DB[(Postgres)]
        end
        Admin -->|HTTPS| UI
        UI -->|RSC/API| API
        API -->|Prisma SQL| DB`,
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
      architectureMermaid: `flowchart LR
        Admin["Админ портала"]
        subgraph VDS["VDS"]
          UI[Shectory Portal Next.js]
          API[Next.js API]
        end
        subgraph Hoster["Hoster"]
          DB[(Postgres)]
        end
        Admin -->|HTTPS| UI
        UI -->|RSC/API| API
        API -->|Prisma SQL| DB`,
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
        "Монолит CursorRPA: документация, скрипты, shectory-portal (Next.js), telegram-bridge (Python). Главный UI: https://shectory.ru. Модули: Portal UI/API, Prisma+Postgres на Hoster, Agent CLI на VDS, бот. Unit: shectory-portal.service.",
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
      notes:
        "Комиссионка: Prisma, Postgres, веб. Главный UI прод: https://komissionka92.ru. Модули: UI, API, БД на Hoster 83.69.248.175.",
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
      notes:
        "PiranhaAI: .NET / native. Назначение и модули — по продукту; prod URL и хосты не зафиксированы в реестре (portable).",
      hosterRole: "по продукту",
    },
    {
      slug: "pingmaster",
      name: "PingMaster",
      stage: "requirements",
      uiUrl: "http://192.168.1.105:4555",
      workspacePath: "/home/shectory/workspaces/PingMaster",
      repoUrl: null,
      stack: ["Android", "Next.js (PingMaster web)", "Node (syslog-srv)"],
      notes:
        "PingMaster (Android) + веб на Shevbo-Pi: HTTP http://192.168.1.105:4555; рядом syslog-srv UI http://192.168.1.105:4444. Пользователь на Pi: shevbo. Прод на Hoster пока нет.",
      hosterRole: "нет prod на Hoster (requirements); dev на Shevbo-Pi",
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
      "Фирменный стандарт welcome/login страницы (обязательно):",
      "- Документ: /home/shectory/workspaces/CursorRPA/docs/welcome-page-standard-ru.md",
      "- Шаблон: /home/shectory/workspaces/CursorRPA/templates/shectory-welcome-frame/",
      "- Структура: большой инфо-фрейм + единая login-область + логотипы (Shectory слева сверху, проект справа сверху) + версии модулей.",
      "",
      "Унифицированная аутентификация/пользователи/доступы (вынесено из komissionka):",
      "- Документация: /home/shectory/workspaces/CursorRPA/docs/unified-auth-users-rbac-ru.md",
      "- Шаблон для Next.js+Prisma: /home/shectory/workspaces/CursorRPA/templates/shectory-auth-nextjs-prisma/",
      "- Глобальный superadmin: bshevelev@mail.ru.",
      "- В прикладных проектах запрещены автономные каталоги пользователей; использовать единый каталог Shectory и единый RBAC-контракт.",
      "",
      "Метаданные карточки проекта (поддерживать актуально):",
      "- name/logo, описание 50-300 символов, ссылка на агентное описание проекта, UI-ссылка, статус dev|mvp|prod|archive.",
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
        architectureMermaid:
          ARCH_MERMAID_BY_SLUG[p.slug] ?? `flowchart LR\n  ${nodeId}["${label.replace(/"/g, '\\"')}"]`,
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
                : p.slug === "pingmaster"
                  ? [
                      {
                        id: "shevbo-pi",
                        name: "Shevbo-Pi",
                        group: "LAN",
                        role: "PingMaster + syslog dev",
                        host: "192.168.1.105 (Tailscale), Linux user shevbo",
                        links: [
                          { label: "PingMaster HTTP", url: "http://192.168.1.105:4555" },
                          { label: "Syslog UI HTTP", url: "http://192.168.1.105:4444" },
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
                : p.slug === "pingmaster"
                  ? [
                      { id: "dev", name: "Разработчик / браузер", kind: "external" },
                      {
                        id: "pm-web",
                        name: "PingMaster Next.js",
                        kind: "ui",
                        host: "192.168.1.105:4555",
                        serverId: "shevbo-pi",
                      },
                      {
                        id: "syslog-ui",
                        name: "syslog-srv UI Next.js",
                        kind: "ui",
                        host: "192.168.1.105:4444",
                        serverId: "shevbo-pi",
                      },
                      { id: "android", name: "Android приложение PingMaster", kind: "mobile" },
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
                : p.slug === "pingmaster"
                  ? [
                      { from: "dev", to: "pm-web", label: "HTTP :4555" },
                      { from: "dev", to: "syslog-ui", label: "HTTP :4444" },
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
        architectureMermaid:
          ARCH_MERMAID_BY_SLUG[p.slug] ?? `flowchart LR\n  ${nodeId}["${label.replace(/"/g, '\\"')}"]`,
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
                : p.slug === "pingmaster"
                  ? [
                      {
                        id: "shevbo-pi",
                        name: "Shevbo-Pi",
                        group: "LAN",
                        role: "PingMaster + syslog dev",
                        host: "192.168.1.105 (Tailscale), Linux user shevbo",
                        links: [
                          { label: "PingMaster HTTP", url: "http://192.168.1.105:4555" },
                          { label: "Syslog UI HTTP", url: "http://192.168.1.105:4444" },
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
                : p.slug === "pingmaster"
                  ? [
                      { id: "dev", name: "Разработчик / браузер", kind: "external" },
                      {
                        id: "pm-web",
                        name: "PingMaster Next.js",
                        kind: "ui",
                        host: "192.168.1.105:4555",
                        serverId: "shevbo-pi",
                      },
                      {
                        id: "syslog-ui",
                        name: "syslog-srv UI Next.js",
                        kind: "ui",
                        host: "192.168.1.105:4444",
                        serverId: "shevbo-pi",
                      },
                      { id: "android", name: "Android приложение PingMaster", kind: "mobile" },
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
                : p.slug === "pingmaster"
                  ? [
                      { from: "dev", to: "pm-web", label: "HTTP :4555" },
                      { from: "dev", to: "syslog-ui", label: "HTTP :4444" },
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
