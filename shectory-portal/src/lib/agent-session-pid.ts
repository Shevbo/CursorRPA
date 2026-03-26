import fs from "node:fs/promises";
import path from "node:path";

export function getAgentPidFilePath(sessionId: string): string {
  return path.join(process.cwd(), "tmp", "agent-runs", `${sessionId}.pid`);
}

export async function writeAgentPidFile(sessionId: string, pid: number): Promise<void> {
  const file = getAgentPidFilePath(sessionId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, String(pid), "utf8");
}

export async function readAgentPidFile(sessionId: string): Promise<number | null> {
  try {
    const raw = await fs.readFile(getAgentPidFilePath(sessionId), "utf8");
    const n = parseInt(raw.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export async function clearAgentPidFile(sessionId: string): Promise<void> {
  try {
    await fs.unlink(getAgentPidFilePath(sessionId));
  } catch {
    /* ignore */
  }
}
