/** Default 30 minutes — Cursor Agent CLI tasks often exceed 2–5 minutes. */
export function getAgentPromptTimeoutMs(): number {
  const raw = process.env.AGENT_PROMPT_TIMEOUT_MS;
  if (raw === undefined || raw === "") return 1_800_000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 60_000 ? n : 1_800_000;
}

/** Фиксированное число шагов сценария: анализ + 3 подзадачи + итог. */
export function getAgentOrchestratorStepCount(): number {
  return 5;
}

/**
 * Таймаут одного вызова CLI в оркестраторе: бюджет AGENT_PROMPT_TIMEOUT_MS делится на 5 шагов,
 * в пределах 3–15 минут (переопределение: AGENT_ORCHESTRATOR_PHASE_TIMEOUT_MS).
 */
export function getAgentOrchestratorPhaseTimeoutMs(): number {
  const raw = process.env.AGENT_ORCHESTRATOR_PHASE_TIMEOUT_MS;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 60_000) return n;
  }
  const total = getAgentPromptTimeoutMs();
  const steps = getAgentOrchestratorStepCount();
  return Math.min(900_000, Math.max(180_000, Math.floor(total / steps)));
}
