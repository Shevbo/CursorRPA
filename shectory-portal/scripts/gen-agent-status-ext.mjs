/**
 * Смотрит `icons agent status/` и генерирует расширения для URL (gif или jpg).
 * Запускается перед `next build`.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const portalRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(portalRoot, "..");
const iconsDir = path.join(repoRoot, "icons agent status");
const outFile = path.join(portalRoot, "src", "generated", "agent-status-ext.ts");

function resolveExt(base) {
  if (!fs.existsSync(iconsDir)) return "jpg";
  const gif = path.join(iconsDir, `${base}.gif`);
  const jpg = path.join(iconsDir, `${base}.jpg`);
  if (fs.existsSync(gif)) return "gif";
  if (fs.existsSync(jpg)) return "jpg";
  return "jpg";
}

const AGENT_STATUS_EXT = {
  Thinking3: resolveExt("Thinking3"),
  Noduty3: resolveExt("Noduty3"),
  Error3: resolveExt("Error3"),
  Auditing3: resolveExt("Auditing3"),
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
const body = `// Сгенерировано scripts/gen-agent-status-ext.mjs — не править вручную
export const AGENT_STATUS_EXT = ${JSON.stringify(AGENT_STATUS_EXT, null, 2)} as const;
`;
fs.writeFileSync(outFile, body);
console.log("[gen-agent-status-ext]", AGENT_STATUS_EXT);
