import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { Readable } from "node:stream";
import { getAgentPromptTimeoutMs } from "@/lib/agent-timeout";

const HOME = process.env.HOME ?? "/home/shectory";
const AGENT_BIN = process.env.AGENT_BIN ?? `${HOME}/.local/bin/agent`;
const CURSOR_ENV_FILE = process.env.CURSOR_ENV_FILE ?? `${HOME}/.config/cursor-rpa/env.sh`;

function loadApiKey(): void {
  try {
    if (!fs.existsSync(CURSOR_ENV_FILE)) return;
    const raw = fs.readFileSync(CURSOR_ENV_FILE, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*export\s+CURSOR_API_KEY=(.+)$/);
      if (m) {
        let v = m[1].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
          v = v.slice(1, -1);
        process.env.CURSOR_API_KEY = v;
        return;
      }
    }
  } catch {
    /* ignore */
  }
}

function slimAgentEnv(): Record<string, string> {
  const allow = [
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
    "NODE_ENV",
    "CI",
    "FORCE_COLOR",
    "NO_COLOR",
  ] as const;
  const env: Record<string, string> = {
    HOME,
    PATH: `${HOME}/.local/bin:${process.env.PATH || "/usr/bin:/bin"}`,
  };
  for (const k of allow) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("CURSOR_") && env[k] === undefined) {
      const v = process.env[k];
      if (v !== undefined) env[k] = v;
    }
  }
  if (env.NODE_ENV === undefined) env.NODE_ENV = process.env.NODE_ENV || "production";
  return env;
}

/** Промпт через stdin («-»), не в argv — избегаем spawn E2BIG на длинном контексте. */
export async function runAgentPrompt(
  workspacePath: string,
  prompt: string,
  timeoutMs = getAgentPromptTimeoutMs()
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  loadApiKey();
  const env = slimAgentEnv();
  const args = ["-p", "--trust", "--output-format", "text", "--workspace", workspacePath, "-"];
  return new Promise((resolve) => {
    const child = spawn(AGENT_BIN, args, { env: env as NodeJS.ProcessEnv, shell: false });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          if (!child.killed) child.kill("SIGKILL");
        } catch {
          /* ignore */
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
    if (child.stdin) src.pipe(child.stdin);

    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
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
