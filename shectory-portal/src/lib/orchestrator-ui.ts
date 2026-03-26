/** Совпадает с TOTAL_STEPS в ticket-orchestrator-runner.mjs */
export const ORCHESTRATOR_STEP_TOTAL = 5;

export function isOrchestratorFinished(content: string): boolean {
  if (/^###\s*Шаг\s+5\/5\b/im.test(content)) return true;
  const m = content.match(/^###\s*Этап\s+(\d+)\/(\d+)/im);
  return !!(m && m[1] === m[2]);
}

export function orchestratorProgress(
  messages: Array<{ id: string; role: string; content: string }>,
  startUserMsgId: string | undefined
): { done: number; total: number } {
  const total = ORCHESTRATOR_STEP_TOTAL;
  if (!startUserMsgId) return { done: 0, total };
  const idx = messages.findIndex((m) => m.id === startUserMsgId);
  if (idx < 0) return { done: 0, total };
  let maxStep = 0;
  for (const m of messages.slice(idx + 1)) {
    if (m.role !== "assistant") continue;
    const sh = m.content.match(/^###\s*Шаг\s+(\d+)\/(\d+)/im);
    if (sh) {
      const a = parseInt(sh[1], 10);
      const b = parseInt(sh[2], 10);
      if (b === total && !Number.isNaN(a)) maxStep = Math.max(maxStep, a);
    }
    const em = m.content.match(/^###\s*Этап\s+(\d+)\/(\d+)/im);
    if (em && em[1] === em[2]) maxStep = Math.max(maxStep, total);

    // Backward-compat: старые heartbeat были формата:
    // «⏳ **Шаг N: ...** — CLI агента всё ещё выполняется ...»
    if (m.content.includes("CLI агента всё ещё выполняется")) {
      const hb = m.content.match(/Шаг\s+(\d+)\s*:/im);
      if (hb) {
        const n = parseInt(hb[1], 10);
        if (!Number.isNaN(n)) maxStep = Math.max(maxStep, n);
      }
    }
  }
  return { done: maxStep, total };
}
