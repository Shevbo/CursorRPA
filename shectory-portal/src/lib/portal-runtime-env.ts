import fs from "node:fs";
import path from "node:path";

/** Рядом с монорепо: CursorRPA/data/portal-runtime-env.json (секреты только на сервере). */
export function portalRuntimeEnvPath(): string {
  return path.join(process.cwd(), "..", "data", "portal-runtime-env.json");
}

/** Подмешать JSON в process.env (перезапись только непустых значений). */
export function loadRuntimeEnvIntoProcess(): void {
  const p = portalRuntimeEnvPath();
  if (!fs.existsSync(p)) return;
  try {
    const raw = fs.readFileSync(p, "utf8");
    const j = JSON.parse(raw) as Record<string, unknown>;
    for (const [k, v] of Object.entries(j)) {
      if (typeof v === "string" && v.length > 0) process.env[k] = v;
    }
  } catch {
    /* ignore broken file */
  }
}

export function writeRuntimeEnvFile(entries: Record<string, string>): void {
  const p = portalRuntimeEnvPath();
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(entries, null, 0), "utf8");
}
