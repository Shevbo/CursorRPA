import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { prisma } from "@/lib/prisma";

type CreateSource = "auto" | "manual";

export type ProjectSyncItem = {
  slug: string;
  name: string;
  workspacePath: string;
  repoUrl: string | null;
  gitReady: boolean;
  workspaceReady: boolean;
  sshReady: boolean;
  warnings: string[];
};

export type ProjectSyncResult = {
  ok: boolean;
  root: string;
  scanned: number;
  synced: number;
  created: number;
  updated: number;
  skipped: number;
  warnings: string[];
  items: ProjectSyncItem[];
};

export type CreateProjectInput = {
  slug: string;
  name: string;
  repoName: string;
  visibility: "private" | "public";
  owner: string;
  maintainer?: string;
  stage?: string;
  status?: string;
  docsUrl?: string;
  boardUrl?: string;
  runbookUrl?: string;
};

export type CreateProjectResult = {
  ok: boolean;
  warnings: string[];
  projectId: string;
  slug: string;
  workspacePath: string;
  sshCommand: string;
  workspaceReady: boolean;
  gitReady: boolean;
  sshReady: boolean;
  repoUrl: string | null;
  remoteCreated: boolean;
  gitStatusSummary: string;
};

const DEFAULT_ROOT = "/home/shectory/workspaces";
const DEFAULT_SSH_HOST = "shectory-work";
const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const RESERVED_DIRS = new Set([".git", ".cursor", "node_modules", "backups"]);

const UNIVERSAL_DEPLOY_BLOCK = [
  "Унифицированный деплой/коммит (важно для всех агентов):",
  "- Перед деплоем: git add -A, git commit -m \"...\", git push (если проект в git).",
  "- Унифицированная команда (из монолита CursorRPA):",
  "  /home/shectory/workspaces/CursorRPA/scripts/deploy-project.sh <project-slug> hoster",
  "- Если деплой для проекта не настроен: зафиксируйте команды в RUNBOOK.md и/или добавьте scripts/deploy.sh.",
  "",
  "Унифицированный welcome/login экран (обязательный фирменный стандарт):",
  "- Документ: /home/shectory/workspaces/CursorRPA/docs/welcome-page-standard-ru.md",
  "- Шаблон: /home/shectory/workspaces/CursorRPA/templates/shectory-welcome-frame/",
  "- Композиция: левый верхний logo Shectory, правый верхний logo проекта + версии, единая область логина, большой инфо-фрейм.",
  "",
  "Единый каталог пользователей и RBAC:",
  "- Документ: /home/shectory/workspaces/CursorRPA/docs/unified-auth-users-rbac-ru.md",
  "- Минимальные роли: user/admin. Управление ролями только у admin.",
  "- Учётка bshevelev@mail.ru — глобальный superadmin.",
  "- В прикладных проектах запрещены автономные каталоги пользователей; использовать только единый каталог/контракт Shectory.",
  "",
  "Метаданные карточки проекта (обязательно поддерживать в актуальном виде):",
  "- Название проекта и logo проекта.",
  "- Короткое описание 50-300 символов (задаёт админ).",
  "- Ссылка на описательную часть проекта, сформированную агентом по факту содержания.",
  "- Ссылка на UI проекта.",
  "- Статус: dev | mvp | prod | archive.",
].join("\n");

function workspaceRoot(): string {
  return process.env.SHECTORY_WORKSPACES_ROOT?.trim() || DEFAULT_ROOT;
}

function makeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

function validSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,62})$/.test(slug);
}

function validRepoName(name: string): boolean {
  return /^[a-z0-9](?:[a-z0-9._-]{1,98})$/i.test(name);
}

function validOwner(owner: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,38})$/i.test(owner);
}

function safeUrl(url?: string): string | null {
  if (!url?.trim()) return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(
  cwd: string,
  file: string,
  args: string[]
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString("utf-8");
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString("utf-8");
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim(), code });
    });
    child.on("error", (err) => {
      resolve({ ok: false, stdout: "", stderr: err.message, code: null });
    });
  });
}

async function getGitOrigin(repoPath: string): Promise<string | null> {
  const res = await runCommand(repoPath, "git", ["remote", "get-url", "origin"]);
  if (!res.ok) return null;
  return res.stdout || null;
}

async function gitIsRepo(repoPath: string): Promise<boolean> {
  const res = await runCommand(repoPath, "git", ["rev-parse", "--is-inside-work-tree"]);
  return res.ok && res.stdout === "true";
}

async function summarizeGitStatus(repoPath: string): Promise<string> {
  const res = await runCommand(repoPath, "git", ["status", "--short", "--branch"]);
  if (!res.ok) return res.stderr || "git status failed";
  return res.stdout || "clean";
}

function defaultDescription(name: string, slug: string): string {
  if (slug === "cursorrpa") {
    return (
      "Монолитный репозиторий CursorRPA: docs и scripts, Shectory Portal (Web UI на Next.js), " +
      "Telegram bridge → Cursor Agent CLI, общие утилиты для прикладных репозиториев в ~/workspaces."
    );
  }
  return `Проект ${name} (автозарегистрирован в реестре Shectory).`;
}

function defaultMermaid(name: string, slug: string): string {
  if (slug === "cursorrpa") {
    return [
      "flowchart TB",
      '  subgraph mono["Репозиторий CursorRPA (монолит)"]',
      "    docs[docs + scripts]",
      "    bridge[services/telegram-bridge]",
      '    portal["shectory-portal<br/>Web UI shectory.ru"]',
      "  end",
      '  subgraph desk["Рабочее место / VDS"]',
      "    agent[Cursor Agent CLI]",
      "    ws[~/workspaces: прикладные проекты]",
      "  end",
      "  subgraph ext[Внешнее]",
      "    tg[Telegram]",
      "    gh[GitHub]",
      "  end",
      "  portal --> agent",
      "  bridge --> agent",
      "  portal --> gh",
      "  bridge --> tg",
      "  agent --> ws",
      "  docs --> portal",
    ].join("\n");
  }
  const nodeId = name.replace(/[^a-zA-Z0-9]/g, "") || "Project";
  const safe = name.replace(/"/g, '\\"');
  return `flowchart LR\n  ${nodeId}["${safe}"]`;
}

function defaultAiContext(name: string): string {
  return (
    `Проект ${name}. Источник истины: git-репозиторий в workspace, оркестрация через Shectory Portal.\n\n` +
    UNIVERSAL_DEPLOY_BLOCK
  );
}

async function ensureFileIfMissing(filePath: string, content: string): Promise<boolean> {
  if (await pathExists(filePath)) return false;
  await writeFile(filePath, content, "utf-8");
  return true;
}

function runbookTemplate(opts: { name: string; slug: string }): string {
  return [
    `# RUNBOOK — ${opts.name}`,
    "",
    "## Быстрые команды (унифицированно)",
    "",
    "### Коммит + деплой (рекомендуемый путь)",
    "",
    "На shectory-work:",
    "- ssh shectory-work",
    `- cd \"/home/shectory/workspaces/CursorRPA\"`,
    `- ./scripts/deploy-project.sh ${opts.slug} hoster`,
    "",
    "### Коммит вручную (если нужно)",
    "",
    `- cd \"/home/shectory/workspaces/${opts.slug}\"`,
    "- git status",
    "- git add -A",
    "- git commit -m \"...\"",
    "- git push",
    "",
    "## Где деплоится",
    "",
    "- PROD обычно на hoster (см. SSH алиас `hoster`).",
    "- Если проект использует systemd/pm2/docker/nginx — зафиксируйте точные команды рестарта ниже.",
    "",
    "## Рестарт / проверка (заполнить под проект)",
    "",
    "hoster:",
    "- cd <deploy-dir>",
    "- (пример) pm2 status / pm2 restart <name>",
    "- (пример) systemctl status <unit> / systemctl restart <unit>",
    "",
    "## Переменные окружения / секреты",
    "",
    "- Где лежит .env на hoster/vds, какие переменные нужны (без значений).",
    "",
  ].join("\n");
}

function architectureTemplate(opts: { name: string; slug: string }): string {
  return [
    `# ARCHITECTURE — ${opts.name}`,
    "",
    "## Общее",
    `- slug: ${opts.slug}`,
    `- workspace: /home/shectory/workspaces/${opts.slug}`,
    "",
    "## Диаграмма (черновик)",
    "```mermaid",
    "flowchart LR",
    "  user[User/Browser] --> app[App]",
    "  app --> db[(DB)]",
    "```",
    "",
    "## Деплой (ссылка на RUNBOOK)",
    "- См. RUNBOOK.md в корне репозитория.",
    "",
  ].join("\n");
}

function deployScriptTemplate(): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "# Шаблон деплоя проекта.",
    "# Этот скрипт вызывается (опционально) из deploy-project.sh на целевом хосте (например hoster).",
    "# Заполните конкретными шагами: git pull, install, build, restart, smoke-check.",
    "",
    "echo \"deploy.sh: TODO — заполните команды деплоя для проекта\"",
  ].join("\n");
}

async function ensureWorkspaceRunbook(workspacePath: string, slug: string, name: string, warnings: string[]): Promise<void> {
  try {
    const createdRunbook = await ensureFileIfMissing(path.join(workspacePath, "RUNBOOK.md"), runbookTemplate({ name, slug }));
    const createdArch = await ensureFileIfMissing(path.join(workspacePath, "ARCHITECTURE.md"), architectureTemplate({ name, slug }));
    if (createdRunbook) warnings.push("bootstrapped RUNBOOK.md");
    if (createdArch) warnings.push("bootstrapped ARCHITECTURE.md");

    const scriptsDir = path.join(workspacePath, "scripts");
    if (!(await pathExists(scriptsDir))) await mkdir(scriptsDir, { recursive: true });
    const deployPath = path.join(scriptsDir, "deploy.sh");
    const createdDeploy = await ensureFileIfMissing(deployPath, deployScriptTemplate());
    if (createdDeploy) warnings.push("bootstrapped scripts/deploy.sh (template)");
  } catch (err) {
    warnings.push(`runbook bootstrap failed: ${(err as Error).message}`);
  }
}

async function upsertProjectFromWorkspace(item: {
  slug: string;
  name: string;
  workspacePath: string;
  repoUrl: string | null;
  warnings: string[];
}): Promise<"created" | "updated" | "skipped"> {
  const existingBySlug = await prisma.project.findUnique({ where: { slug: item.slug } });
  const existingByPath = await prisma.project.findFirst({
    where: { workspacePath: item.workspacePath },
  });
  const existingByRepo = item.repoUrl
    ? await prisma.project.findFirst({ where: { repoUrl: item.repoUrl } })
    : null;

  if (
    (existingBySlug && existingByPath && existingBySlug.id !== existingByPath.id) ||
    (existingBySlug && existingByRepo && existingBySlug.id !== existingByRepo.id)
  ) {
    item.warnings.push("duplicate conflict in DB (slug/path/repo); skipped");
    return "skipped";
  }

  const target = existingBySlug || existingByPath || existingByRepo;
  const baseData = {
    slug: item.slug,
    name: item.name,
    workspacePath: item.workspacePath,
    repoUrl: item.repoUrl,
    workspaceReady: true,
    gitReady: true,
    sshReady: true,
    createdSource: "auto" as CreateSource,
    lastSyncAt: new Date(),
    syncError: item.warnings.length ? item.warnings.join("; ") : null,
    owner: target?.owner ?? null,
    maintainer: target?.maintainer ?? null,
    stage: target?.stage ?? "dev",
    status: target?.status ?? "active",
    boardUrl: target?.boardUrl ?? null,
    runbookUrl: target?.runbookUrl ?? null,
    docsUrl: target?.docsUrl ?? null,
  };

  if (!target) {
    await prisma.project.create({
      data: {
        ...baseData,
        description: defaultDescription(item.name, item.slug),
        architectureMermaid: defaultMermaid(item.name, item.slug),
        aiContext: defaultAiContext(item.name),
      },
    });
    return "created";
  }

  await prisma.project.update({
    where: { id: target.id },
    data: baseData,
  });
  return "updated";
}

export async function syncProjectsFromWorkspaces(): Promise<ProjectSyncResult> {
  const root = workspaceRoot();
  const warnings: string[] = [];
  const items: ProjectSyncItem[] = [];

  let dirents: string[] = [];
  try {
    const rows = await readdir(root, { withFileTypes: true });
    dirents = rows.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (err) {
    return {
      ok: false,
      root,
      scanned: 0,
      synced: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      warnings: [`cannot read workspaces root: ${(err as Error).message}`],
      items: [],
    };
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const name of dirents) {
    if (RESERVED_DIRS.has(name)) continue;
    const full = path.join(root, name);
    const localWarnings: string[] = [];

    let st;
    try {
      st = await stat(full);
    } catch (err) {
      warnings.push(`${full}: stat failed (${(err as Error).message})`);
      skipped += 1;
      continue;
    }
    if (!st.isDirectory()) continue;

    const isGit = await gitIsRepo(full);
    if (!isGit) continue;

    const slug = makeSlug(name);
    if (!validSlug(slug)) {
      warnings.push(`${full}: invalid slug after normalization (${slug})`);
      skipped += 1;
      continue;
    }

    const repoUrl = await getGitOrigin(full);
    if (!repoUrl) localWarnings.push("origin remote missing or unreadable");

    await ensureWorkspaceRunbook(full, slug, name, localWarnings);

    const upsertState = await upsertProjectFromWorkspace({
      slug,
      name,
      workspacePath: full,
      repoUrl,
      warnings: localWarnings,
    });
    if (upsertState === "created") created += 1;
    if (upsertState === "updated") updated += 1;
    if (upsertState === "skipped") skipped += 1;

    items.push({
      slug,
      name,
      workspacePath: full,
      repoUrl,
      gitReady: true,
      workspaceReady: true,
      sshReady: true,
      warnings: localWarnings,
    });
  }

  return {
    ok: true,
    root,
    scanned: dirents.length,
    synced: items.length,
    created,
    updated,
    skipped,
    warnings,
    items,
  };
}

let autoSyncRunning = false;
let lastAutoSyncAt = 0;

export function triggerAutoSyncIfDue(): void {
  const now = Date.now();
  if (autoSyncRunning) return;
  if (now - lastAutoSyncAt < AUTO_SYNC_INTERVAL_MS) return;
  autoSyncRunning = true;
  lastAutoSyncAt = now;
  void syncProjectsFromWorkspaces()
    .catch(() => {
      // silent by design: sync should never break rendering path
    })
    .finally(() => {
      autoSyncRunning = false;
    });
}

export async function createProjectWithWorkspace(input: CreateProjectInput): Promise<CreateProjectResult> {
  const slug = makeSlug(input.slug);
  if (!validSlug(slug)) throw new Error("Invalid slug. Use lowercase letters, numbers, hyphen.");
  if (!validRepoName(input.repoName)) throw new Error("Invalid repoName.");
  if (!validOwner(input.owner)) throw new Error("Invalid owner.");

  const root = workspaceRoot();
  const workspacePath = path.join(root, slug);
  const warnings: string[] = [];
  const sshHost = process.env.SHECTORY_SSH_HOST?.trim() || DEFAULT_SSH_HOST;
  const repoOwner = process.env.SHECTORY_GITHUB_OWNER?.trim();
  const expectedRepoUrl = repoOwner ? `https://github.com/${repoOwner}/${input.repoName}` : null;
  const stage = input.stage?.trim() || "dev";
  const status = input.status?.trim() || "active";

  const duplicate = await prisma.project.findFirst({
    where: {
      OR: [{ slug }, { workspacePath }, ...(expectedRepoUrl ? [{ repoUrl: expectedRepoUrl }] : [])],
    },
  });
  if (duplicate) throw new Error(`Project already exists: ${duplicate.slug}`);

  try {
    await mkdir(workspacePath, { recursive: false });
  } catch (err) {
    throw new Error(`Cannot create workspace: ${(err as Error).message}`);
  }

  await writeFile(
    path.join(workspacePath, "README.md"),
    `# ${input.name}\n\nCreated by Shectory Portal.\n`,
    "utf-8"
  );
  await writeFile(
    path.join(workspacePath, ".gitignore"),
    "node_modules\n.env\n.next\n.DS_Store\n",
    "utf-8"
  );

  const gitInit = await runCommand(workspacePath, "git", ["init", "-b", "main"]);
  if (!gitInit.ok) warnings.push(`git init failed: ${gitInit.stderr || "unknown error"}`);

  const gitAdd = await runCommand(workspacePath, "git", ["add", "."]);
  if (!gitAdd.ok) warnings.push(`git add failed: ${gitAdd.stderr || "unknown error"}`);

  const gitCommit = await runCommand(workspacePath, "git", [
    "commit",
    "-m",
    `chore: bootstrap ${slug}`,
  ]);
  if (!gitCommit.ok) warnings.push(`git commit skipped: ${gitCommit.stderr || "unknown error"}`);

  let repoUrl: string | null = null;
  let remoteCreated = false;
  if (repoOwner) {
    const gh = await runCommand(workspacePath, "gh", [
      "repo",
      "create",
      `${repoOwner}/${input.repoName}`,
      "--source=.",
      "--remote=origin",
      "--push",
      `--${input.visibility}`,
    ]);
    if (gh.ok) {
      remoteCreated = true;
      repoUrl = `https://github.com/${repoOwner}/${input.repoName}`;
    } else {
      warnings.push(`remote repo not created: ${gh.stderr || gh.stdout || "gh failed"}`);
    }
  } else {
    warnings.push("SHECTORY_GITHUB_OWNER is not set; remote repo skipped");
  }

  if (!repoUrl) repoUrl = await getGitOrigin(workspacePath);

  const workspaceReady = await pathExists(workspacePath);
  const gitReady = await gitIsRepo(workspacePath);
  const sshReady = workspaceReady;
  const gitStatusSummary = await summarizeGitStatus(workspacePath);

  const created = await prisma.project.create({
    data: {
      slug,
      name: input.name.trim(),
      owner: input.owner.trim(),
      maintainer: input.maintainer?.trim() || null,
      stage,
      status,
      workspacePath,
      description: `Проект ${input.name.trim()} (создан вручную из Shectory Portal).`,
      architectureMermaid: defaultMermaid(input.name.trim(), slug),
      aiContext: defaultAiContext(input.name.trim()),
      repoUrl: repoUrl || null,
      docsUrl: safeUrl(input.docsUrl),
      boardUrl: safeUrl(input.boardUrl),
      runbookUrl: safeUrl(input.runbookUrl),
      createdSource: "manual",
      workspaceReady,
      gitReady,
      sshReady,
      lastSyncAt: new Date(),
      syncError: warnings.length ? warnings.join("; ") : null,
      chats: {
        create: {
          title: "Админ — старт проекта",
          messages: {
            create: {
              role: "system",
              content:
                `Проект ${input.name.trim()} создан в реестре. Workspace: ${workspacePath}. ` +
                `Продолжайте работу через SSH: ssh ${sshHost}`,
            },
          },
        },
      },
    },
  });

  return {
    ok: true,
    warnings,
    projectId: created.id,
    slug: created.slug,
    workspacePath,
    sshCommand: `ssh ${sshHost}`,
    workspaceReady,
    gitReady,
    sshReady,
    repoUrl: created.repoUrl,
    remoteCreated,
    gitStatusSummary,
  };
}

export async function getProjectHandoffBySlug(slug: string): Promise<string> {
  const project = await prisma.project.findUnique({ where: { slug } });
  if (!project) throw new Error("Project not found");
  const sshHost = process.env.SHECTORY_SSH_HOST?.trim() || DEFAULT_SSH_HOST;
  const unifiedDeploy = [
    "Унифицированный деплой/коммит:",
    `1) SSH: ssh ${sshHost}`,
    `2) cd "${project.workspacePath}"`,
    "3) (опционально) обновить локально: git status / git pull",
    "4) Унифицированная команда (из монолита CursorRPA):",
    `   /home/shectory/workspaces/CursorRPA/scripts/deploy-project.sh ${project.slug} hoster`,
    "",
    "Если для проекта не настроен рестарт/деплой на целевом хосте — допишите deploy-скрипт проекта или зафиксируйте команды в RUNBOOK.md.",
  ].join("\n");
  return [
    `Project: ${project.name} (${project.slug})`,
    `Workspace: ${project.workspacePath}`,
    `SSH: ssh ${sshHost}`,
    `Next step: cd "${project.workspacePath}"`,
    project.repoUrl ? `Repo: ${project.repoUrl}` : "Repo: not configured",
    `Readiness: workspace=${project.workspaceReady} git=${project.gitReady} ssh=${project.sshReady}`,
    "",
    unifiedDeploy,
  ].join("\n");
}

export async function getWorkspaceBootstrapSummary(workspacePath: string): Promise<{
  readmeExists: boolean;
  gitignoreExists: boolean;
}> {
  let readmeExists = false;
  let gitignoreExists = false;
  try {
    await readFile(path.join(workspacePath, "README.md"), "utf-8");
    readmeExists = true;
  } catch {
    // noop
  }
  try {
    await readFile(path.join(workspacePath, ".gitignore"), "utf-8");
    gitignoreExists = true;
  } catch {
    // noop
  }
  return { readmeExists, gitignoreExists };
}
