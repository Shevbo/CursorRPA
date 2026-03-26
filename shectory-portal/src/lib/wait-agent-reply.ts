export type ChatSessionPayload = {
  id: string;
  messages: { id: string; role: string; content: string; createdAt: string; sessionId?: string }[];
};

export async function fetchChatSession(sessionId: string): Promise<ChatSessionPayload | null> {
  const r = await fetch(`/api/project/chat-sessions/${encodeURIComponent(sessionId)}`, { credentials: "include" });
  const j = (await r.json().catch(() => ({}))) as { session?: ChatSessionPayload; error?: string };
  if (!r.ok) return null;
  return j.session ?? null;
}

/** Ждём появления assistant-сообщения после указанного user-сообщения. */
export async function waitForAssistantAfterUserMessage(
  sessionId: string,
  userMsgId: string,
  options?: { timeoutMs?: number; pollMs?: number }
): Promise<{ done: boolean; timedOut: boolean; session: ChatSessionPayload | null }> {
  const timeoutMs = options?.timeoutMs ?? 1_920_000;
  const pollMs = options?.pollMs ?? 2000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const session = await fetchChatSession(sessionId);
    if (!session) return { done: false, timedOut: false, session: null };
    const idx = session.messages.findIndex((m) => m.id === userMsgId);
    const hasAssistant = idx >= 0 && session.messages.slice(idx + 1).some((m) => m.role === "assistant");
    if (hasAssistant) return { done: true, timedOut: false, session };
    await new Promise((res) => setTimeout(res, pollMs));
  }

  const session = await fetchChatSession(sessionId);
  return { done: false, timedOut: true, session };
}
