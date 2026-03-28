import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { Readable } from "node:stream";

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
 * Промпт в stdin (аргумент «-»), а не в argv — иначе длинный контекст даёт spawn E2BIG.
 * @param {string} workspacePath
 * @param {string} prompt
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: boolean; stdout: string; stderr: string }>}
 */
export function runAgentPrompt(workspacePath, prompt, timeoutMs) {
  loadApiKey();
  const env = slimAgentEnv();
  const args = ["-p", "--trust", "--output-format", "text", "--workspace", workspacePath, "-"];
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

    const payload = Buffer.from(prompt ?? "", "utf8");
    const src = Readable.from([payload]);
    src.on("error", (e) => {
      clearTimeout(t);
      resolve({ ok: false, stdout, stderr: stderr + String(e) });
    });
    child.stdin?.on("error", (e) => {
      clearTimeout(t);
      resolve({ ok: false, stdout, stderr: stderr + String(e) });
    });
    src.pipe(child.stdin);

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
