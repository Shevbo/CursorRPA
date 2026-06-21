import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

const projects = [
  { slug:"shectory-assist",       name:"Shectory Assist",      stage:"prod", ws:true, git:true, ssh:true, wsPath:"~/workspaces/Shectory Assist",     repo:"https://github.com/Shevbo/ShectoryAssist",        desc:"Голосовой Telegram-бот ASR\u2192NLU\u2192skills\u2192TTS на Google Gemini.", actx:"Telegram-бот на TS с Gemini. ASR Whisper, TTS Google.", mm:"flowchart LR\\n  TG[Telegram] --> B[grammy bot]\\n  B --> G[Gemini API]\\n  B --> S[skills]\\n  G --> TTS" },
  { slug:"pingmaster",            name:"PingMaster",           stage:"prod", ws:true, git:true, ssh:true, wsPath:"~/workspaces/PingMaster",          repo:"ssh://hoster/home/ubuntu/repos/pingmaster.git",    desc:"Мониторинг сети ICMP ping. Raspberry Pi + WireGuard.", actx:"Next.js SPA для ping-мониторинга. SQLite Prisma. На Pi, экспорт через WG.", mm:"flowchart LR\\n  Pi[RPi] --> PM[PingMaster]\\n  PM --> DB[(SQLite)]\\n  WG[WireGuard] --> Pi\\n  User --> WG" },
  { slug:"piranha-ai",            name:"PiranhaAI",            stage:"dev",  ws:true, git:true, ssh:true, wsPath:"~/workspaces/PiranhaAI",            repo:"ssh://hoster/home/ubuntu/repos/piranha-ai.git",    desc:"Торговая платформа: Python + Go, QUIK, Points2RUR.", actx:"Торговая платформа с Python-ядром и Go-агентами. QUIK API.", mm:"flowchart LR\\n  Py[Python Core] --> Q[QUIK API]\\n  Py --> P2R[Points2RUR]\\n  Go[Go Agent] --> Py\\n  DB[(SQLite)] --> Py" },
  { slug:"shectory-trade-lab",    name:"Shectory Trade & Lab", stage:"lab",  ws:true, git:false,ssh:false,wsPath:"~/workspaces/Shectory Trade & Lab",repo:null,                                                desc:"Документация и ТЗ для Shectory Trader (Finam API).", actx:"Документация по торговому терминалу Shectory Trader, Finam API.", mm:"flowchart LR\\n  Docs[Документация] --> TZ[ТЗ]\\n  Docs --> API[Finam API]\\n  Docs --> Plans[Планы]" },
  { slug:"komissionka",           name:"Komissionka",          stage:"prod", ws:true, git:true, ssh:true, wsPath:"~/workspaces/komissionka",          repo:"https://github.com/Shevbo/komissionka-app",        desc:"Комиссионные товары. Next.js + PostgreSQL + NextAuth.", actx:"Next.js доска объявлений. PostgreSQL Prisma. Два инстанса.", mm:"flowchart LR\\n  N[Next.js :3000] --> DB[(PostgreSQL)]\\n  N --> Auth[NextAuth]\\n  Nginx --> N" },
  { slug:"openclaw-dev",          name:"OpenClaw Dev",         stage:"dev",  ws:true, git:true, ssh:true, wsPath:"~/workspaces/openclaw",              repo:"https://github.com/Shevbo/OpenClaw-Dev",           desc:"Скрипты и конфиги деплоя OpenClaw на ферме Shectory.", actx:"Dev-конфиги OpenClaw. WireGuard VPN для Pi в локальной сети.", mm:"flowchart LR\\n  OC[OpenClaw] --> Conf[Configs]\\n  OC --> WG[WireGuard]\\n  OC --> SSH[SSH Keys]\\n  OC --> Pi[RPi]" },
  { slug:"ourdiary",              name:"OurDiary",             stage:"prod", ws:true, git:true, ssh:true, wsPath:"~/workspaces/ourdiary",              repo:"https://github.com/Shevbo/ourdiary",               desc:"Семейная соцсеть: дневник, календарь, бюджет.", actx:"Семейная соцсеть на Next.js. PostgreSQL Prisma. QR-декодинг.", mm:"flowchart LR\\n  N[Next.js :3002] --> DB[(PostgreSQL)]\\n  N --> Auth[NextAuth]\\n  N --> Upload[Multer/Sharp]\\n  N --> QR[QR decode]\\n  Nginx --> N" },
  { slug:"syslog-srv",            name:"Syslog Server",        stage:"prod", ws:true, git:false,ssh:true, wsPath:"~/workspaces/syslog-srv",            repo:null,                                                desc:"Syslog-сервер на Pi для логов Keenetic + WireGuard.", actx:"Syslog-сервер на Raspberry Pi. Сбор логов с Keenetic через WG.", mm:"flowchart LR\\n  Router[Keenetic] -->|syslog| Pi[RPi]\\n  Pi --> SL[Syslog App]\\n  SL --> DB[(SQLite)]\\n  WG[WireGuard] --> Pi" },
  { slug:"cursor-rpa",            name:"CursorRPA",            stage:"prod", ws:true, git:true, ssh:true, wsPath:"~/workspaces/CursorRPA",             repo:"https://github.com/Shevbo/CursorRPA",              desc:"Мета-проект: Telegram-мост, RPA, Cursor-агенты.", actx:"Система управления Cursor-агентами. Telegram RPA, PostgreSQL.", mm:"flowchart LR\\n  TG[Telegram] --> B[Bridge]\\n  B --> C[Cursor Agent]\\n  RPA[RPA Scripts] --> C\\n  C --> WS[Workspaces]" },
  { slug:"shectory-portal",       name:"Shectory Portal",      stage:"prod", ws:true, git:true, ssh:true, wsPath:"~/workspaces/CursorRPA/shectory-portal", repo:null,           desc:"Портал-витрина проектов Shectory. Next.js + Prisma + PostgreSQL.", actx:"Витрина проектов Shectory. Mermaid-диаграммы, PostgreSQL на hoster.", mm:"flowchart LR\\n  N[Next.js :3000] --> DB[(PostgreSQL)]\\n  N --> API[/api/*]\\n  Nginx --> N\\n  User -->|shectory.ru| Nginx" },
];

console.log("Importing " + projects.length + " projects...");
for (const pr of projects) {
  await p.project.upsert({
    where: { slug: pr.slug },
    update: {
      name: pr.name, stage: pr.stage, description: pr.desc,
      workspacePath: pr.wsPath, repoUrl: pr.repo,
      workspaceReady: pr.ws, gitReady: pr.git, sshReady: pr.ssh,
      status: "active", architectureMermaid: pr.mm, aiContext: pr.actx,
    },
    create: {
      slug: pr.slug, name: pr.name, stage: pr.stage, status: "active",
      workspacePath: pr.wsPath, description: pr.desc,
      repoUrl: pr.repo, version: "0.1.0",
      workspaceReady: pr.ws, gitReady: pr.git, sshReady: pr.ssh,
      architectureMermaid: pr.mm, aiContext: pr.actx,
    },
  });
  console.log("  OK " + pr.name);
}
const count = await p.project.count();
console.log("\nTotal: " + count);
await p.$disconnect();
