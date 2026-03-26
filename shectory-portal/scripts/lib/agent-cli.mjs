import { spawn } from "node:child_process";
import * as fs from "node:fs";

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
 * @param {string} workspacePath
 * @param {string} prompt
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: boolean; stdout: string; stderr: string }>}
 */
export function runAgentPrompt(workspacePath, prompt, timeoutMs) {
  loadApiKey();
  const env = { ...process.env, HOME, PATH: `${HOME}/.local/bin:${process.env.PATH ?? ""}` };
  const args = ["-p", "--trust", "--output-format", "text", "--workspace", workspacePath, prompt];
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
