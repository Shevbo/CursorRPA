/** Эвристика: последний ответ ассистента похож на сбой процесса, а не на нормальный текст. */
export function looksLikeAssistantFailure(content: string): boolean {
  const c = content;
  const low = c.toLowerCase();
  if (/e2big/i.test(c)) return true;
  if (/\bspawn\s+e[a-z0-9_]+\b/i.test(low)) return true;
  if (/ошибка\s+фонов(ого)?\s+агента/i.test(c)) return true;
  if (/\bargument list too long\b/i.test(low)) return true;
  if (/оркестратор\s+завис/i.test(c)) return true;
  if (/watchdog\s+обнаружил/i.test(low)) return true;
  if (/помечен\s+как\s+ошибочн/i.test(low)) return true;
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

/**
 * Аудитор ещё работает (промежуточное сообщение «проверяю…»).
 * Финальные сообщения аудитора (Вердикт: ..., ошибка процесса и т.п.) → false → статус idle.
 */
export function looksLikeAuditorBusy(content: string): boolean {
  const c = (content ?? "").trimStart();
  if (!c.startsWith("🕵️ Аудитор:")) return false;
  // Final verdict messages — auditor is done
  if (c.startsWith("🕵️ Аудитор: Вердикт:")) return false;
  if (c.startsWith("🕵️ Аудитор: не смог")) return false;
  if (c.startsWith("🕵️ Аудитор: ошибка")) return false;
  // Intermediate: "🕵️ Аудитор: проверяю…" etc.
  return true;
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

export type ChatAgentPresence = "thinking" | "auditing" | "idle" | "error";

export const CHAT_POST_MESSAGE_TYPE = "shectory-ticket-chat" as const;

/** Родитель (BacklogTicketView) → iframe чата: прокрутить к низу после отправки сообщения. */
export const CHAT_SCROLL_TO_BOTTOM_TYPE = "shectory-ticket-chat-scroll-bottom" as const;

export type TicketChatPostMessage = {
  type: typeof CHAT_POST_MESSAGE_TYPE;
  chatAgentPresence: ChatAgentPresence;
  loading: boolean;
  err: string;
};
