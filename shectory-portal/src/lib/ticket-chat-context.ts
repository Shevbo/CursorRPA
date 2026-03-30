/** Маркер полного блока контекста тикета (первое user-сообщение в сессии). */
export const TICKET_CONTEXT_HEAD = "КОНТЕКСТ ТИКЕТА";

export function buildFullTicketContextText(opts: {
  ticketKeyOrId: string;
  title: string;
  description: string | null | undefined;
  descriptionPrompt: string | null | undefined;
  userMessage: string;
}): string {
  const dp = opts.descriptionPrompt?.trim();
  return [
    `${TICKET_CONTEXT_HEAD} (актуальная версия полей):`,
    `Ticket: ${opts.ticketKeyOrId}`,
    `Заголовок: ${opts.title}`,
    "",
    opts.description ? `Описание:\n${opts.description}` : "Описание: (пусто)",
    "",
    dp ? `Инженерный промпт:\n${dp}` : "Инженерный промпт: (пусто)",
    "",
    "Если я ссылаюсь на поле (например: «в описании…», «в промпте…») — используй значения выше.",
    "Если ты предлагаешь/выполняешь shell-команды через чат, успех = только `exit_code: 0`.",
    "Любой `exit_code != 0` — это ошибка: объясни причину, поправь команды и продолжай до успешного выполнения (или чётко опиши, что мешает и как это устранить).",
    "",
    "СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ:",
    opts.userMessage,
  ].join("\n");
}

const REFRESH_TAG = "[обновить контекст]";

export function userRequestedTicketContextRefresh(text: string): boolean {
  return text.toLowerCase().includes(REFRESH_TAG.toLowerCase());
}

export function stripTicketContextRefreshTag(text: string): string {
  return text.replace(new RegExp(REFRESH_TAG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "").trim();
}

/** Второе и последующие сообщения: без повторения полей тикета (контекст в первом user-сообщении). */
export function buildFollowUpTicketUserPayload(userMessage: string): string {
  return [
    "Контекст тикета (поля, описание, инженерный промпт) уже в первом сообщении пользователя в этой сессии — опирайся на него, не проси повторить весь блок.",
    "Если поля тикета в UI сильно изменились и нужен новый снимок — пользователь может отправить тег [обновить контекст] (тогда придёт полный блок снова).",
    "Shell-политика: успех = только `exit_code: 0`. При `exit_code != 0` — это ошибка, продолжай исправлять до успеха.",
    "",
    "СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ:",
    userMessage,
  ].join("\n");
}
