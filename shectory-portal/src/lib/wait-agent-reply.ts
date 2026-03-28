export type ChatSessionPayload = {
  id: string;
  messages: { id: string; role: string; content: string; createdAt: string; sessionId?: string }[];
  hasMoreOlder?: boolean;
};

const DEFAULT_FETCH_LIMIT = 500;

export async function fetchChatSession(
  sessionId: string,
  opts?: { limit?: number; before?: string }
): Promise<ChatSessionPayload | null> {
  const sp = new URLSearchParams();
  sp.set("limit", String(opts?.limit ?? DEFAULT_FETCH_LIMIT));
  if (opts?.before) sp.set("before", opts.before);
  const r = await fetch(`/api/project/chat-sessions/${encodeURIComponent(sessionId)}?${sp}`, {
    credentials: "include",
  });
  const j = (await r.json().catch(() => ({}))) as {
    session?: ChatSessionPayload;
    error?: string;
    hasMoreOlder?: boolean;
  };
  if (!r.ok) return null;
  if (!j.session) return null;
  return { ...j.session, hasMoreOlder: j.hasMoreOlder };
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
