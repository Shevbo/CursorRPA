"use client";

import { Suspense, useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { waitForAssistantAfterUserMessage } from "@/lib/wait-agent-reply";

type Msg = { id: string; role: string; content: string; createdAt: string };
type Session = { id: string; messages: Msg[] };
type Ticket = { id: string; ticketKey?: string | null; title: string; description?: string | null; descriptionPrompt?: string };

function formatMsgTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "medium" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function TicketChatFramePageInner({ params }: { params: { slug: string; id: string } }) {
  const WAITING_CODE = "[***waiting for answer***]";
  const sp = useSearchParams();
  const sessionId = useMemo(() => (sp.get("sessionId") || "").trim(), [sp]);
  const [session, setSession] = useState<Session | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const loadInFlightRef = useRef(false);

  const ticketLabel = ticket?.ticketKey?.trim() || params.id.slice(0, 8);

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
    const r = await fetch(`/api/project/chat-sessions/${encodeURIComponent(sessionId)}`, { credentials: "include" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr((j as { error?: string }).error ?? `HTTP ${r.status}`);
      return;
    }
    setSession((j as { session: Session }).session);
  }, [sessionId]);

  useEffect(() => {
    void load();
    void loadTicket();
  }, [load, loadTicket]);

  // Дёргаем загрузку сессии, чтобы «⏳-сообщения» оркестратора/агента появлялись в ленте
  // без ручного обновления окна iframe.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const interval = setInterval(() => {
      if (loadInFlightRef.current) return;
      loadInFlightRef.current = true;
      void (async () => {
        try {
          if (cancelled) return;
          await load();
        } finally {
          loadInFlightRef.current = false;
        }
      })();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId, load]);

  async function send() {
    if (!input.trim() || !sessionId) return;
    setLoading(true);
    setErr("");
    try {
      const msg = input.trim();
      setInput("");
      await loadTicket();
      const ctx = ticket
        ? [
            "КОНТЕКСТ ТИКЕТА (актуальная версия полей):",
            `Ticket: ${ticket.ticketKey || ticket.id}`,
            `Заголовок: ${ticket.title}`,
            "",
            ticket.description ? `Описание:\n${ticket.description}` : "Описание: (пусто)",
            "",
            ticket.descriptionPrompt?.trim() ? `Инженерный промпт:\n${ticket.descriptionPrompt.trim()}` : "Инженерный промпт: (пусто)",
            "",
            "Если я ссылаюсь на поле (например: «в описании…», «в промпте…») — используй значения выше.",
            "",
            "СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ:",
            msg,
          ].join("\n")
        : msg;
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
      if (uid) {
        const t = (j.timeoutMs ?? 1_800_000) + 120_000;
        await waitForAssistantAfterUserMessage(sessionId, uid, { timeoutMs: t });
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-slate-800 bg-slate-950/80 px-3 py-2 text-xs text-slate-400">
        Чат тикета · {params.slug}/{ticketLabel}
        {sessionId ? ` · сессия ${sessionId.slice(0, 8)}` : " · сессия —"}
      </div>

      {err ? <div className="shrink-0 px-3 py-2 text-xs text-red-400">{err}</div> : null}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 text-sm">
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
                <pre className="mt-1 whitespace-pre-wrap font-sans text-slate-200">
                  {m.role !== "user" && m.content.includes(WAITING_CODE)
                    ? m.content.replace(WAITING_CODE, "").trim()
                    : m.content}
                </pre>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-500">Нет сообщений.</div>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-800 bg-slate-950/95 p-2 backdrop-blur-sm">
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
