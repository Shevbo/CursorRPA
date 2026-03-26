import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const HOME = process.env.HOME ?? "/home/shectory";
const BRIDGE_DIR = `${HOME}/workspaces/CursorRPA/services/telegram-bridge`;
const PYTHON_BIN = `${BRIDGE_DIR}/.venv/bin/python`;
const BOT_SCRIPT = `${BRIDGE_DIR}/bot.py`;
const ENV_DIR = `${BRIDGE_DIR}/project-envs`;
const SYSTEMD_USER_DIR = `${HOME}/.config/systemd/user`;
const RPA_AGENT_SCRIPT = `${HOME}/.local/bin/rpa-agent.sh`;
const CURSOR_ENV_FILE = `${HOME}/.config/cursor-rpa/env.sh`;
const WORKSPACE_ROOT = `${HOME}/workspaces`;

export type ProjectBotStatus = {
  projectSlug: string;
  unitName: string;
  envPath: string;
  configured: boolean;
  hasToken: boolean;
  allowedUserIds: string;
  activeState: string;
  enabledState: string;
  lastError?: string;
};

function sanitizeSlug(slug: string): string {
  return slug.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

function unitNameFor(slug: string): string {
  return `cursorrpa-telegram-${sanitizeSlug(slug)}.service`;
}

function envPathFor(slug: string): string {
  return path.join(ENV_DIR, `${sanitizeSlug(slug)}.env`);
}

async function systemctlUser(args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("systemctl", ["--user", ...args], {
      env: process.env,
    });
    return { ok: true, out: stdout.trim(), err: stderr.trim() };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      out: (err.stdout ?? "").trim(),
      err: (err.stderr ?? err.message ?? "").trim(),
    };
  }
}

function parseEnv(envPath: string): { hasToken: boolean; allowedUserIds: string } {
  if (!fs.existsSync(envPath)) return { hasToken: false, allowedUserIds: "" };
  const raw = fs.readFileSync(envPath, "utf8");
  let token = "";
  let allowed = "";
  for (const line of raw.split("\n")) {
    const m1 = line.match(/^TELEGRAM_BOT_TOKEN=(.*)$/);
    if (m1) token = m1[1].trim();
    const m2 = line.match(/^TELEGRAM_ALLOWED_USER_IDS=(.*)$/);
    if (m2) allowed = m2[1].trim();
  }
  return { hasToken: Boolean(token && token !== "SET_ME"), allowedUserIds: allowed };
}

export async function getProjectBotStatus(projectSlug: string): Promise<ProjectBotStatus> {
  const unitName = unitNameFor(projectSlug);
  const envPath = envPathFor(projectSlug);
  const env = parseEnv(envPath);

  const active = await systemctlUser(["is-active", unitName]);
  const enabled = await systemctlUser(["is-enabled", unitName]);

  return {
    projectSlug,
    unitName,
    envPath,
    configured: fs.existsSync(envPath),
    hasToken: env.hasToken,
    allowedUserIds: env.allowedUserIds,
    activeState: active.ok ? active.out || "active" : active.out || "inactive",
    enabledState: enabled.ok ? enabled.out || "enabled" : enabled.out || "disabled",
    lastError: active.ok ? undefined : active.err || undefined,
  };
}

export async function configureProjectBot(opts: {
  projectSlug: string;
  workspacePath: string;
  token: string;
  allowedUserIds: string;
}): Promise<ProjectBotStatus> {
  const slug = sanitizeSlug(opts.projectSlug);
  const unitName = unitNameFor(slug);
  const envPath = envPathFor(slug);
  fs.mkdirSync(ENV_DIR, { recursive: true });
  fs.mkdirSync(SYSTEMD_USER_DIR, { recursive: true });

  const envText =
    `TELEGRAM_BOT_TOKEN=${opts.token.trim()}\n` +
    `TELEGRAM_ALLOWED_USER_IDS=${opts.allowedUserIds.trim()}\n` +
    `CURSOR_RPA_FIXED_WORKSPACE=${opts.workspacePath}\n` +
    `WORKSPACE_ROOT=${WORKSPACE_ROOT}\n` +
    `RPA_AGENT_SCRIPT=${RPA_AGENT_SCRIPT}\n` +
    `CURSOR_ENV_FILE=${CURSOR_ENV_FILE}\n` +
    `AGENT_TIMEOUT_SEC=900\n`;
  fs.writeFileSync(envPath, envText, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(envPath, 0o600);

  const unitPath = path.join(SYSTEMD_USER_DIR, unitName);
  const unitText =
    "[Unit]\n" +
    `Description=CursorRPA Telegram bot (${slug})\n` +
    "After=network-online.target\n" +
    "Wants=network-online.target\n\n" +
    "[Service]\n" +
    "Type=simple\n" +
    `WorkingDirectory=${BRIDGE_DIR}\n` +
    `EnvironmentFile=${envPath}\n` +
    `ExecStart=${PYTHON_BIN} ${BOT_SCRIPT}\n` +
    "Restart=always\n" +
    "RestartSec=5\n\n" +
    "[Install]\n" +
    "WantedBy=default.target\n";
  fs.writeFileSync(unitPath, unitText, "utf8");

  await systemctlUser(["daemon-reload"]);
  await systemctlUser(["enable", unitName]);
  await systemctlUser(["restart", unitName]);

  return getProjectBotStatus(slug);
}
