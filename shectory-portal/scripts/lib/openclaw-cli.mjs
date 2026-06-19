import { spawn } from "node:child_process";
import * as fs from "node:fs";

/** Найти исполняемый openclaw: глобальный .mjs (node) или бинарь на PATH. */
export function resolveOpenclawCmd() {
  const mjs = "/usr/lib/node_modules/openclaw/openclaw.mjs";
  if (fs.existsSync(mjs)) return { cmd: process.execPath, prefix: [mjs] };
  return { cmd: "openclaw", prefix: [] };
}

export function buildOpenclawArgs({ agentId, message, modelId, timeoutSec }) {
  const a = ["agent", "--agent", agentId, "--message", String(message ?? "")];
  if (modelId) a.push("--model", modelId);
  a.push("--json");
  if (timeoutSec) a.push("--timeout", String(timeoutSec));
  return a;
}

/** Извлечь текст из JSON-ответа openclaw (формат не зафиксирован — пробуем ключи). */
export function parseOpenclawJson(stdout) {
  try {
    const j = JSON.parse(stdout);
    return String(j.reply ?? j.text ?? j.message ?? j.content ?? "").trim();
  } catch {
    return "";
  }
}

/** Запустить openclaw agent. Возвращает {ok, stdout, stderr} (контракт как у runAgentPrompt). */
export async function runOpenclawAgent({ agentId, message, modelId, timeoutMs }) {
  const { cmd, prefix } = resolveOpenclawCmd();
  const ms = timeoutMs ?? 120000;
  const timeoutSec = Math.max(30, Math.floor(ms / 1000));
  const args = [...prefix, ...buildOpenclawArgs({ agentId, message, modelId, timeoutSec })];
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: false });
    let stdout = "", stderr = "";
    const t = setTimeout(() => { try { child.kill("SIGTERM"); } catch {} resolve({ ok: false, stdout: "", stderr: stderr + "\n[timeout]" }); }, ms + 5000);
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      clearTimeout(t);
      const text = parseOpenclawJson(stdout);
      resolve({ ok: code === 0 && !!text, stdout: text || stdout, stderr });
    });
    child.on("error", (e) => { clearTimeout(t); resolve({ ok: false, stdout: "", stderr: String(e) }); });
  });
}
