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

export type ChatAgentPresence = "thinking" | "idle" | "error";

export const CHAT_POST_MESSAGE_TYPE = "shectory-ticket-chat" as const;

export type TicketChatPostMessage = {
  type: typeof CHAT_POST_MESSAGE_TYPE;
  chatAgentPresence: ChatAgentPresence;
  loading: boolean;
  err: string;
};
