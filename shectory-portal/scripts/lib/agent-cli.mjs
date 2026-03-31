import { spawn } from "node:child_process";
import * as fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

const HOME = process.env.HOME ?? "/home/shectory";
const AGENT_BIN = process.env.AGENT_BIN ?? `${HOME}/.local/bin/agent`;
const CURSOR_ENV_FILE = process.env.CURSOR_ENV_FILE ?? `${HOME}/.config/cursor-rpa/env.sh`;

export function loadApiKey() {
  try {
    if (!fs.existsSync(CURSOR_ENV_FILE)) return;
    const raw = fs.readFileSync(CURSOR_ENV_FILE, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*export\s+CURSOR_API_KEY=(.+)$/);
      if (m) {
        let v = m[1].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env.CURSOR_API_KEY = v;
        return;
      }
    }
  } catch {
    // ignore
  }
}

/**
 * Урезанное окружение для дочернего процесса — снижает риск E2BIG из-за гигантского process.env.
 */
function slimAgentEnv() {
  const allow = new Set([
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "DISPLAY",
    "XDG_RUNTIME_DIR",
    "TMPDIR",
    "TEMP",
    "TZ",
    "CURSOR_API_KEY",
    "AGENT_BIN",
    "NODE_OPTIONS",
    "CI",
    "FORCE_COLOR",
    "NO_COLOR",
  ]);
  const env = {
    HOME,
    PATH: `${HOME}/.local/bin:${process.env.PATH || "/usr/bin:/bin"}`,
  };
  for (const k of allow) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("CURSOR_") && env[k] === undefined) env[k] = process.env[k];
  }
  return env;
}

/**
 * Cursor agent CLI currently does NOT take the prompt from stdin.
 * To avoid argv E2BIG on large prompts, we spill prompt into a temp file and pass a short wrapper prompt instead.
 * @param {string} workspacePath
 * @param {string} prompt
 * @param {number} timeoutMs
 * @param {string | undefined} modelId
 * @returns {Promise<{ ok: boolean; stdout: string; stderr: string }>}
 */
export function runAgentPrompt(workspacePath, prompt, timeoutMs, modelId) {
  loadApiKey();
  const env = slimAgentEnv();
  const args = ["-p", "--trust", "--output-format", "text", "--workspace", workspacePath];
  const m = String(modelId || "").trim();
  if (m) args.push("--model", m);

  const rawPrompt = String(prompt ?? "");
  let finalPrompt = rawPrompt;
  const PROMPT_ARG_MAX = Number(process.env.AGENT_PROMPT_ARG_MAX || "6000") || 6000;
  if (rawPrompt.length > PROMPT_ARG_MAX) {
    const dir = path.join(os.tmpdir(), "shectory-agent-prompts");
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // ignore
    }
    const hash = crypto.createHash("sha256").update(rawPrompt, "utf8").digest("hex").slice(0, 16);
    const file = path.join(dir, `prompt-${Date.now()}-${hash}.txt`);
    fs.writeFileSync(file, rawPrompt, "utf8");
    finalPrompt =
      "В рабочей копии открыт вспомогательный файл с полным промптом.\n" +
      `1) Открой и прочитай файл: ${file}\n` +
      "2) Строго выполни инструкции из этого файла.\n";
  }
  args.push(finalPrompt);
  return new Promise((resolve) => {
    const child = spawn(AGENT_BIN, args, { env, shell: false });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          if (!child.killed) child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, 5000);
      resolve({ ok: false, stdout, stderr: stderr + "\n[timeout]" });
    }, timeoutMs);

    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, stdout, stderr });
    });
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ ok: false, stdout, stderr: String(e) });
    });
  });
}
