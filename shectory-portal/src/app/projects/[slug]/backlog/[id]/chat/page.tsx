"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { waitForAssistantAfterUserMessage } from "@/lib/wait-agent-reply";
import {
  TICKET_CONTEXT_HEAD,
  buildFollowUpTicketUserPayload,
  buildFullTicketContextText,
  stripTicketContextRefreshTag,
  userRequestedTicketContextRefresh,
} from "@/lib/ticket-chat-context";

type Msg = { id: string; role: string; content: string; createdAt: string };
type Session = { id: string; title?: string; messages: Msg[] };
type Ticket = { id: string; ticketKey?: string | null; title: string; description?: string | null; descriptionPrompt?: string };

const PAGE_LIMIT = 80;

function messagesListEqual(a: Msg[], b: Msg[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].content !== b[i].content) return false;
  }
  return true;
}

function mergeOlderPrefixWithLatestTail(prev: Msg[], tail: Msg[]): Msg[] {
  if (tail.length === 0) return prev;
  if (prev.length === 0) return tail;
  const t0 = new Date(tail[0].createdAt).getTime();
  const prefix = prev.filter((m) => new Date(m.createdAt).getTime() < t0);
  return [...prefix, ...tail];
}

function formatMsgTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "medium" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

type ChatAgentPresence = "thinking" | "idle" | "error";

function looksLikeAssistantFailure(content: string): boolean {
  const c = content;
  const low = c.toLowerCase();
  if (/e2big/i.test(c)) return true;
  if (/\bspawn\s+e[a-z0-9_]+\b/i.test(low)) return true;
  if (/ошибка\s+фонов(ого)?\s+агента/i.test(c)) return true;
  if (/\bargument list too long\b/i.test(low)) return true;
  return false;
}

function TicketChatFramePageInner({ params }: { params: { slug: string; id: string } }) {
  const WAITING_CODE = "[***waiting for answer***]";
  const sp = useSearchParams();
  const sessionId = useMemo(() => (sp.get("sessionId") || "").trim(), [sp]);
  const [session, setSession] = useState<Session | null>(null);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const loadInFlightRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickBottomRef = useRef(true);
  /** Пользователь подгружал «Ранее» — нельзя затирать историю обычным load(tail). */
  const historyExpandedRef = useRef(false);

  const ticketLabel = ticket?.ticketKey?.trim() || params.id.slice(0, 8);

  /** Только внутри listRef — не вызывать scrollIntoView (на iOS прокручивает родителя/iframe и сбивает позицию). */
  const scrollListToBottomIfPinned = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = listRef.current;
    if (!el || !stickBottomRef.current) return;
    requestAnimationFrame(() => {
      const node = listRef.current;
      if (!node || !stickBottomRef.current) return;
      node.scrollTo({ top: node.scrollHeight, behavior });
    });
  }, []);

  const messagesScrollKey = useMemo(() => {
    const m = session?.messages;
    if (!m?.length) return "";
    const last = m[m.length - 1];
    return `${m.length}:${last.id}:${last.content.length}`;
  }, [session?.messages]);

  const chatAgentPresence = useMemo((): ChatAgentPresence => {
    if (loading) return "thinking";
    if (err.trim()) return "error";
    const msgs = session?.messages ?? [];
    if (msgs.length === 0) return "idle";
    const last = msgs[msgs.length - 1]!;
    if (last.role === "user") return "thinking";
    if (looksLikeAssistantFailure(last.content ?? "")) return "error";
    return "idle";
  }, [loading, err, session?.messages]);

  const presenceUi = useMemo(() => {
    switch (chatAgentPresence) {
      case "thinking":
        return {
          emoji: "🤔",
          label: "Агент отвечает — подождите новое сообщение в чате.",
          short: "Ждём агента",
        };
      case "error":
        return {
          emoji: "🤦",
          label:
            "Похоже на сбой (ошибка процесса или ответа). Нового текста от агента без вашего действия обычно не будет — проверьте сообщение и при необходимости запустите снова или напишите в поддержку.",
          short: "Ошибка",
        };
      default:
        return {
          emoji: "😴",
          label:
            "Ответ агента уже в чате; автоматически нового сообщения сейчас не ожидается. Если агент задал вопрос — ответьте сами кнопкой «Отправить».",
          short: "Пауза",
        };
    }
  }, [chatAgentPresence]);

  const loadTicket = useCallback(async () => {
    setErr("");
    const r = await fetch(`/api/project/backlog/${encodeURIComponent(params.id)}`, { credentials: "include" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    const item = (j as { item?: Ticket }).item;
    if (item) setTicket(item);
  }, [params.id]);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setErr("");
    const r = await fetch(
      `/api/project/chat-sessions/${encodeURIComponent(sessionId)}?limit=${PAGE_LIMIT}`,
      { credentials: "include" }
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr((j as { error?: string }).error ?? `HTTP ${r.status}`);
      return;
    }
    const payload = j as {
      session?: Session;
      hasMoreOlder?: boolean;
    };
    if (payload.session) {
      if (historyExpandedRef.current) {
        setSession((prev) => {
          if (!prev) return payload.session!;
          const merged = {
            ...prev,
            messages: mergeOlderPrefixWithLatestTail(prev.messages, payload.session!.messages),
          };
          if (messagesListEqual(prev.messages, merged.messages)) return prev;
          return merged;
        });
      } else {
        setSession(payload.session);
      }
      setHasMoreOlder(Boolean(payload.hasMoreOlder));
      stickBottomRef.current = true;
    }
  }, [sessionId]);

  const loadOlder = useCallback(async () => {
    if (!sessionId || !session?.messages?.length || loadingOlder || !hasMoreOlder) return;
    const oldest = session.messages[0];
    if (!oldest?.createdAt) return;
    setLoadingOlder(true);
    const el = listRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const r = await fetch(
        `/api/project/chat-sessions/${encodeURIComponent(sessionId)}?limit=${PAGE_LIMIT}&before=${encodeURIComponent(oldest.createdAt)}`,
        { credentials: "include" }
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return;
      const payload = j as { session?: Session; hasMoreOlder?: boolean };
      const olderMsgs = payload.session?.messages ?? [];
      if (olderMsgs.length === 0) {
        setHasMoreOlder(false);
        return;
      }
      historyExpandedRef.current = true;
      setSession((prev) =>
        prev
          ? { ...prev, messages: [...olderMsgs.filter((m) => !prev.messages.some((x) => x.id === m.id)), ...prev.messages] }
          : prev
      );
      setHasMoreOlder(Boolean(payload.hasMoreOlder));
      requestAnimationFrame(() => {
        const node = listRef.current;
        if (node) node.scrollTop = node.scrollHeight - prevHeight;
      });
    } finally {
      setLoadingOlder(false);
    }
  }, [sessionId, session?.messages, loadingOlder, hasMoreOlder]);

  useEffect(() => {
    void load();
    void loadTicket();
  }, [load, loadTicket]);

  useEffect(() => {
    scrollListToBottomIfPinned("auto");
  }, [messagesScrollKey, scrollListToBottomIfPinned]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const interval = setInterval(() => {
      if (loadInFlightRef.current) return;
      loadInFlightRef.current = true;
      void (async () => {
        try {
          if (cancelled) return;
          const r = await fetch(
            `/api/project/chat-sessions/${encodeURIComponent(sessionId)}?limit=${PAGE_LIMIT}`,
            { credentials: "include" }
          );
          const j = await r.json().catch(() => ({}));
          if (!r.ok || cancelled) return;
          const payload = j as { session?: Session; hasMoreOlder?: boolean };
          if (!payload.session) return;
          const tail = payload.session.messages;
          setSession((prev) => {
            if (!prev) {
              stickBottomRef.current = true;
              return payload.session!;
            }
            const next =
              historyExpandedRef.current ? { ...prev, messages: mergeOlderPrefixWithLatestTail(prev.messages, tail) } : payload.session!;
            if (messagesListEqual(prev.messages, next.messages)) {
              return prev;
            }
            const prevLast = prev.messages[prev.messages.length - 1]?.id;
            const nextLast = next.messages[next.messages.length - 1]?.id;
            if (prevLast !== nextLast) stickBottomRef.current = true;
            return next;
          });
          setHasMoreOlder(Boolean(payload.hasMoreOlder));
        } finally {
          loadInFlightRef.current = false;
        }
      })();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId]);

  function buildOutgoingPayload(rawUserText: string, t: Ticket | null, sess: Session | null): string {
    const trimmed = rawUserText.trim();
    if (!t) return trimmed;

    const priorUserCount = (sess?.messages ?? []).filter((m) => m.role === "user").length;
    const refresh = userRequestedTicketContextRefresh(trimmed);
    const body = stripTicketContextRefreshTag(trimmed) || trimmed;

    const key = t.ticketKey?.trim() || t.id;
    if (priorUserCount === 0 || refresh) {
      return buildFullTicketContextText({
        ticketKeyOrId: key,
        title: t.title,
        description: t.description,
        descriptionPrompt: t.descriptionPrompt,
        userMessage: body,
      });
    }
    return buildFollowUpTicketUserPayload(body);
  }

  async function send() {
    if (!input.trim() || !sessionId) return;
    setLoading(true);
    setErr("");
    try {
      const raw = input.trim();
      setInput("");
      const tr = await fetch(`/api/project/backlog/${encodeURIComponent(params.id)}`, { credentials: "include" });
      const tj = await tr.json().catch(() => ({}));
      const latestTicket = (tj as { item?: Ticket }).item ?? ticket;
      if ((tj as { item?: Ticket }).item) setTicket((tj as { item: Ticket }).item);
      const ctx = buildOutgoingPayload(raw, latestTicket ?? null, session);
      const r = await fetch("/api/agent/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectSlug: params.slug, sessionId, message: ctx }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
        userMsg?: { id: string };
        timeoutMs?: number;
      };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      const uid = j.userMsg?.id;
      stickBottomRef.current = true;
      if (uid) {
        const t = (j.timeoutMs ?? 1_800_000) + 120_000;
        await waitForAssistantAfterUserMessage(sessionId, uid, { timeoutMs: t });
      }
      await load();
      scrollListToBottomIfPinned("auto");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-slate-800 bg-slate-950/80 px-3 py-2 text-xs text-slate-400">
        Чат тикета · {params.slug}/{ticketLabel}
        {sessionId ? ` · сессия ${sessionId.slice(0, 8)}` : " · сессия —"}
      </div>

      {err ? <div className="shrink-0 px-3 py-2 text-xs text-red-400">{err}</div> : null}

      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          className="absolute inset-0 overflow-y-auto overscroll-y-contain p-3 pb-10 pr-14 text-sm [-webkit-overflow-scrolling:touch]"
          onScroll={(e) => {
            const t = e.currentTarget;
            const dist = t.scrollHeight - t.scrollTop - t.clientHeight;
            stickBottomRef.current = dist < 120;
          }}
        >
          {hasMoreOlder ? (
            <div className="mb-3 flex justify-center">
              <button
                type="button"
                disabled={loadingOlder}
                onClick={() => void loadOlder()}
                className="rounded border border-slate-600 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              >
                {loadingOlder ? "Загрузка…" : "Ранее в переписке"}
              </button>
            </div>
          ) : null}
          {session?.messages?.length ? (
            <div className="space-y-3">
              {session.messages.map((m) => (
                <div
                  key={m.id}
                  className={m.role === "user" ? "ml-8 rounded-lg bg-blue-900/30 p-3" : "mr-8 rounded-lg bg-slate-800/50 p-3"}
                >
                  <div className="text-xs text-slate-500">
                    {m.role === "user" ? (
                      <>
                        <span className="text-slate-400">{formatMsgTime(m.createdAt)}</span>
                        <span className="mx-1.5">·</span>
                        <span>user</span>
                      </>
                    ) : (
                      m.role
                    )}
                  </div>
                  {m.role === "user" &&
                  m.content.startsWith(TICKET_CONTEXT_HEAD) &&
                  m.content.length > 1400 ? (
                    <details className="mt-1 rounded border border-slate-700/60 bg-slate-950/40 p-2">
                      <summary className="cursor-pointer select-none text-xs text-slate-400">
                        Полный контекст тикета ({m.content.length.toLocaleString("ru-RU")} симв.) — развернуть
                      </summary>
                      <pre className="mt-2 max-h-[50vh] overflow-y-auto whitespace-pre-wrap font-sans text-sm text-slate-200">
                        {m.content}
                      </pre>
                    </details>
                  ) : (
                    <pre className="mt-1 whitespace-pre-wrap font-sans text-slate-200">
                      {m.role !== "user" && m.content.includes(WAITING_CODE)
                        ? m.content.replace(WAITING_CODE, "").trim()
                        : m.content}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-500">Нет сообщений.</div>
          )}
        </div>
        {sessionId ? (
          <div
            className="pointer-events-none absolute bottom-2 right-2 z-10"
            role="status"
            aria-live="polite"
            aria-label={presenceUi.label}
          >
            <div
              className="pointer-events-auto cursor-default rounded-md border border-slate-600/90 bg-slate-950/95 px-2 py-1.5 text-lg leading-none shadow-md backdrop-blur-sm"
              title={presenceUi.label}
            >
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden>{presenceUi.emoji}</span>
                <span className="hidden text-[10px] font-medium text-slate-400 sm:inline">{presenceUi.short}</span>
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-slate-800 bg-slate-950/95 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
        <p className="mb-1 px-1 text-[10px] leading-snug text-slate-500">
          Первое сообщение в сессии передаёт полный контекст тикета; дальше — только ваш текст. Чтобы снова отправить поля тикета, добавьте в сообщение{" "}
          <span className="font-mono text-slate-400">[обновить контекст]</span>.
        </p>
        <div className="flex gap-2">
          <textarea
            className="min-h-[2.75rem] max-h-32 flex-1 resize-y rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-60"
            placeholder="Сообщение агенту…"
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            disabled={loading || !sessionId}
          />
          <button
            type="button"
            className="h-fit shrink-0 self-end rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            disabled={loading || !sessionId || !input.trim()}
            onClick={() => void send()}
          >
            {loading ? "…" : "Отправить"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TicketChatFramePage({ params }: { params: { slug: string; id: string } }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[200px] items-center justify-center text-sm text-slate-400">Загрузка…</div>
      }
    >
      <TicketChatFramePageInner params={params} />
    </Suspense>
  );
}
