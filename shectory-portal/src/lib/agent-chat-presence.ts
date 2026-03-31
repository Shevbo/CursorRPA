/** Эвристика: последний ответ ассистента похож на сбой процесса, а не на нормальный текст. */
export function looksLikeAssistantFailure(content: string): boolean {
  const c = content;
  const low = c.toLowerCase();
  if (/e2big/i.test(c)) return true;
  if (/\bspawn\s+e[a-z0-9_]+\b/i.test(low)) return true;
  if (/ошибка\s+фонов(ого)?\s+агента/i.test(c)) return true;
  if (/\bargument list too long\b/i.test(low)) return true;
  return false;
}

/** Эвристика: ассистент пишет служебное «ждём/думаю», значит он ещё занят. */
export function looksLikeAssistantBusy(content: string): boolean {
  const c = (content ?? "").trimStart();
  if (!c) return false;
  if (c.startsWith("⏳")) return true;
  if (c.includes("[***waiting for answer***]")) return true;
  return false;
}

/** Эвристика: ассистент показал exit_code != 0 → это ошибка выполнения команд. */
export function looksLikeCommandFailure(content: string): boolean {
  const c = content ?? "";
  // Both formats occur in logs: `exit_code: 1`, `exit_code:1`, `exit-code: 1`
  const m = c.match(/\bexit[-_]?code:\s*([0-9-]+)\b/i);
  if (!m) return false;
  const code = Number(m[1]);
  return Number.isFinite(code) && code !== 0;
}

/**
 * Эвристика: даже при exit_code=0 считаем ошибкой, если в выводе явная ошибка.
 * Нужна из-за кейсов, когда команда с pipe/tee теряет код возврата или пишет ошибку в stdout.
 */
export function looksLikeOutputFailure(stdout: string, stderr: string): boolean {
  const out = `${stdout || ""}\n${stderr || ""}`.trim();
  if (!out) return false;
  const low = out.toLowerCase();
  // Strong indicators
  if (/\bbuild error occurred\b/i.test(out)) return true;
  if (/\bfailed to compile\b/i.test(out)) return true;
  if (/\bbuild failed because of\b/i.test(out)) return true;
  if (/\bfailed to load\b/i.test(out)) return true;
  if (/\bcannot find module\b/i.test(out)) return true;
  if (/\bmodule not found\b/i.test(out)) return true;
  if (/\bcan['’]?t resolve\b/i.test(out)) return true;
  if (/\bmodule_not_found\b/i.test(out)) return true;
  if (/\bunknown or unexpected option\b/i.test(out)) return true;
  if (/\b(error|exception):/i.test(out)) return true;
  // npm/yarn/pnpm hard failures
  if (/\bnpm\b.*\berr!\b/i.test(out)) return true;
  if (/\bpnpm\b.*\berr!\b/i.test(out)) return true;
  if (low.includes("http: 000")) return true;
  return false;
}

export type ChatAgentPresence = "thinking" | "auditing" | "idle" | "error";

export const CHAT_POST_MESSAGE_TYPE = "shectory-ticket-chat" as const;

export type TicketChatPostMessage = {
  type: typeof CHAT_POST_MESSAGE_TYPE;
  chatAgentPresence: ChatAgentPresence;
  loading: boolean;
  err: string;
};
