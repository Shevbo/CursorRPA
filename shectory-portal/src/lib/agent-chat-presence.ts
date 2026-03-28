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

export type ChatAgentPresence = "thinking" | "idle" | "error";

export const CHAT_POST_MESSAGE_TYPE = "shectory-ticket-chat" as const;

export type TicketChatPostMessage = {
  type: typeof CHAT_POST_MESSAGE_TYPE;
  chatAgentPresence: ChatAgentPresence;
  loading: boolean;
  err: string;
};
