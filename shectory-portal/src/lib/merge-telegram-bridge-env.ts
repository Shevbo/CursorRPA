import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const KEYS = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_USER_IDS"] as const;

function applyLine(key: string, valRaw: string): void {
  if (!(KEYS as readonly string[]).includes(key)) return;
  if (process.env[key] !== undefined && String(process.env[key]).trim() !== "") return;
  let val = valRaw.trim().replace(/\r$/, "");
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }
  if (val === "") return;
  process.env[key] = val;
}

function mergeFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  try {
    const raw = readFileSync(filePath, "utf8");
    for (const line of raw.split(/\n/)) {
      let t = line.trim().replace(/\r$/, "");
      if (!t || t.startsWith("#")) continue;
      if (t.startsWith("export ")) t = t.slice(7).trim();
      const eq = t.indexOf("=");
      if (eq < 1) continue;
      const k = t.slice(0, eq).trim();
      const val = t.slice(eq + 1);
      applyLine(k, val);
    }
  } catch {
    /* ignore */
  }
}

export function mergeTelegramKeysFromBridgeEnv(): void {
  const roots = new Set<string>();
  roots.add(join(homedir(), "workspaces", "CursorRPA"));
  if (process.env.CURSOR_RPA_ROOT?.trim()) roots.add(process.env.CURSOR_RPA_ROOT.trim());
  if (process.env.CURSOR_RPA_FIXED_WORKSPACE?.trim()) roots.add(process.env.CURSOR_RPA_FIXED_WORKSPACE.trim());

  const candidates: string[] = [];
  for (const root of Array.from(roots)) {
    candidates.push(
      join(root, "services", "telegram-bridge", "project-envs", "cursor-rpa.env"),
      join(root, "services", "telegram-bridge", ".env")
    );
  }
  candidates.push(
    join(process.cwd(), "..", "services", "telegram-bridge", "project-envs", "cursor-rpa.env"),
    join(process.cwd(), "..", "services", "telegram-bridge", ".env"),
    join(process.cwd(), "services", "telegram-bridge", "project-envs", "cursor-rpa.env"),
    join(process.cwd(), "services", "telegram-bridge", ".env")
  );

  const seen = new Set<string>();
  for (const p of candidates) {
    if (seen.has(p)) continue;
    seen.add(p);
    mergeFile(p);
  }
}
