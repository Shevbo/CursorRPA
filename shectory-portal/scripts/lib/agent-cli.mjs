import { spawn } from "node:child_process";
import * as fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = process.env.HOME ?? "/home/shectory";
const AGENT_BIN = process.env.AGENT_BIN ?? `${HOME}/.local/bin/agent`;
const CURSOR_ENV_FILE = process.env.CURSOR_ENV_FILE ?? `${HOME}/.config/cursor-rpa/env.sh`;

/** CursorRPA/data/portal-runtime-env.json — подмешивание настроек из UI портала. */
export function loadPortalRuntimeEnv() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const jsonPath = path.join(here, "..", "..", "..", "data", "portal-runtime-env.json");
    if (!fs.existsSync(jsonPath)) return;
    const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    for (const [k, v] of Object.entries(j)) {
      if (typeof v === "string" && v.length > 0) process.env[k] = v;
    }
  } catch {
    // ignore
  }
}

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

function mergeExtraEnv(env) {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("SHECTORY_") && env[k] === undefined) env[k] = process.env[k];
    if ((k === "GEMINI_API_KEY" || k === "GOOGLE_API_KEY") && env[k] === undefined) env[k] = process.env[k];
    if (k.startsWith("AGENT_") && env[k] === undefined) env[k] = process.env[k];
    if (k.startsWith("AUDITOR_") && env[k] === undefined) env[k] = process.env[k];
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
  mergeExtraEnv(env);
  return env;
}

/**
 * Прямой вызов Google Generative Language API (коммерческий ключ, не Cursor CLI).
 * @param {string} prompt
 * @param {string | undefined} modelId
 * @param {number} timeoutMs
 */
async function runGeminiApiPrompt(prompt, modelId, timeoutMs) {
  const key = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  if (!key) {
    return {
      ok: false,
      stdout: "",
      stderr: "GEMINI_API_KEY или GOOGLE_API_KEY не задан (Настройки портала → секреты или env).",
    };
  }
  const model = String(modelId || "gemini-2.0-flash").trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ac.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: String(prompt ?? "") }] }],
        generationConfig: { maxOutputTokens: 8192, temperature: 0.35 },
      }),
    });
    const j = await r.json().catch(() => ({}));
    clearTimeout(t);
    if (!r.ok) {
      const err = j?.error?.message || JSON.stringify(j).slice(0, 800);
      return { ok: false, stdout: "", stderr: `[Gemini API ${r.status}] ${err}` };
    }
    const text =
      j?.candidates?.[0]?.content?.parts?.map((p) => (typeof p.text === "string" ? p.text : "")).join("") || "";
    if (!String(text).trim()) {
      return { ok: false, stdout: "", stderr: "Gemini API: пустой ответ (нет candidates/parts)." };
    }
    return { ok: true, stdout: text, stderr: "" };
  } catch (e) {
    clearTimeout(t);
    const msg = e?.name === "AbortError" ? `timeout ${timeoutMs}ms` : String(e);
    return { ok: false, stdout: "", stderr: `[Gemini API] ${msg}` };
  }
}

function resolveBackend(role) {
  const r = String(role || "executor");
  if (r === "auditor") {
    let b = String(process.env.SHECTORY_AUDITOR_BACKEND || "").trim();
    if (!b) b = String(process.env.SHECTORY_EXECUTOR_BACKEND || "cursor_cli").trim();
    return b;
  }
  return String(process.env.SHECTORY_EXECUTOR_BACKEND || "cursor_cli").trim();
}

/**
 * @param {string} workspacePath
 * @param {string} prompt
 * @param {number} timeoutMs
 * @param {string | undefined} modelId
 * @param {"executor"|"auditor"} [role]
 */
export async function runAgentPrompt(workspacePath, prompt, timeoutMs, modelId, role = "executor") {
  loadPortalRuntimeEnv();
  loadApiKey();
  const backend = resolveBackend(role);
  if (backend === "gemini_api") {
    return runGeminiApiPrompt(prompt, modelId, timeoutMs);
  }

  const env = slimAgentEnv();
  const args = ["-p", "--trust", "--output-format", "text", "--workspace", workspacePath];
  const sandboxMode = String(process.env.SHECTORY_AGENT_SANDBOX_MODE || "disabled").trim();
  if (sandboxMode) args.push("--sandbox", sandboxMode);
  const allowCommands = String(process.env.SHECTORY_AGENT_ALLOW_COMMANDS || "1").trim();
  if (allowCommands !== "0" && allowCommands.toLowerCase() !== "false") {
    args.push("--yolo");
  }
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
    const timer = setTimeout(() => {
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
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: String(e) });
    });
  });
}
