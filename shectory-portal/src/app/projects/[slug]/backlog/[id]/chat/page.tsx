"use client";

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import { CHAT_ATTACHMENT_MAX_FILES, parseChatAttachmentsJson } from "@/lib/chat-attachments";
import { useSearchParams } from "next/navigation";
import {
  CHAT_POST_MESSAGE_TYPE,
  CHAT_SCROLL_TO_BOTTOM_TYPE,
  type ChatAgentPresence,
  looksLikeAssistantBusy,
  looksLikeCommandFailure,
  looksLikeAssistantFailure,
  type TicketChatPostMessage,
} from "@/lib/agent-chat-presence";
import { collectClipboardFiles, mergePendingFiles } from "@/lib/chat-attachment-paste";
import { ChatPaperclipAttach } from "@/components/ChatPaperclipAttach";
import {
  TICKET_CONTEXT_HEAD,
  buildFollowUpTicketUserPayload,
  buildFullTicketContextText,
  stripTicketContextRefreshTag,
  userRequestedTicketContextRefresh,
} from "@/lib/ticket-chat-context";
import { formatMsgTime } from "@/lib/format-utils";
import { NotificationBell } from "@/components/NotificationBell";

type Msg = { id: string; role: string; content: string; createdAt: string; attachmentsJson?: string | null };
type Session = { id: string; title?: string; updatedAt?: string; messages: Msg[] };
type Ticket = { id: string; ticketKey?: string | null; title: string; description?: string | null; descriptionPrompt?: string };
type MePayload = { ok: boolean; user: { email: string; role: string; fullName?: string } | null };
type AgentSpecPayload = { ok: boolean; executor?: string; auditor?: string };

const PAGE_LIMIT = 80;
const EXECUTOR_PREFIX = "Агент-исполнитель (R) Shectory";
const AUDITOR_PREFIX = "Агент-аудитор (R) Shectory";

function messagesListEqual(a: Msg[], b: Msg[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].content !== b[i].content) return false;
    if ((a[i].attachmentsJson || "") !== (b[i].attachmentsJson || "")) return false;
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

function TicketChatFramePageInner({ params }: { params: { slug: string; id: string } }) {
  const WAITING_CODE = "[***waiting for answer***]";
  const sp = useSearchParams();
  const sessionId = useMemo(() => (sp.get("sessionId") || "").trim(), [sp]);
  const embedThread = useMemo(() => (sp.get("embed") || "").trim() === "thread", [sp]);
  const [session, setSession] = useState<Session | null>(null);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [me, setMe] = useState<MePayload["user"] | null>(null);
  const [agentSpec, setAgentSpec] = useState<{ executor: string; auditor: string } | null>(null);
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const loadInFlightRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickBottomRef = useRef(true);
  /** Пользователь подгружал «Ранее» — нельзя затирать историю обычным load(tail). */
  const historyExpandedRef = useRef(false);

  const ticketLabel = ticket?.ticketKey?.trim() || params.id.slice(0, 8);

  const messagesScrollKey = useMemo(() => {
    const m = session?.messages;
    if (!m?.length) return "";
    const last = m[m.length - 1];
    const att = (last.attachmentsJson || "").length;
    return `${m.length}:${last.id}:${last.content.length}:${att}`;
  }, [session?.messages]);

  const chatAgentPresence = useMemo((): ChatAgentPresence => {
    if (loading) return "thinking";
    if (err.trim()) return "error";
    const msgs = session?.messages ?? [];
    if (msgs.length === 0) return "idle";
    const last = msgs[msgs.length - 1]!;
    if (last.role === "user") return "thinking";
    if (looksLikeAssistantBusy(last.content ?? "")) {
      const age = Date.now() - new Date(last.createdAt).getTime();
      // If heartbeat (updatedAt) is fresh (< 3 min), agent is alive regardless of message age
      const heartbeatAge = session?.updatedAt
        ? Date.now() - new Date(session.updatedAt).getTime()
        : Infinity;
      if (heartbeatAge < 3 * 60 * 1000) return "thinking";
      if (age > 10 * 60 * 1000) return "idle";
      return "thinking";
    }
    if (looksLikeCommandFailure(last.content ?? "")) return "error";
    if (looksLikeAssistantFailure(last.content ?? "")) return "error";
    if ((last.content ?? "").trimStart().startsWith("🕵️ Аудитор:")) return "auditing";
    return "idle";
  }, [loading, err, session?.messages]);

  useEffect(() => {
    if (!embedThread || typeof window === "undefined" || window.parent === window) return;
    const payload: TicketChatPostMessage = {
      type: CHAT_POST_MESSAGE_TYPE,
      chatAgentPresence,
      loading,
      err,
    };
    window.parent.postMessage(payload, window.location.origin);
  }, [chatAgentPresence, loading, err, embedThread]);

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
    let alive = true;
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((j: MePayload) => {
        if (!alive) return;
        setMe(j?.user ?? null);
      })
      .catch(() => {
        if (!alive) return;
        setMe(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/system/agent-spec", { credentials: "include" })
      .then((r) => r.json())
      .then((j: AgentSpecPayload) => {
        if (!alive) return;
        if (j?.ok && (j.executor || j.auditor)) {
          setAgentSpec({ executor: String(j.executor || ""), auditor: String(j.auditor || "") });
        }
      })
      .catch(() => {
        if (!alive) return;
        setAgentSpec(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const roleLabel = useCallback(
    (m: Msg): string => {
      if (m.role === "user") {
        const base = me?.role === "admin" || me?.role === "superadmin" ? "Админ" : "Пользователь";
        const who = me?.fullName?.trim() ? `${me.fullName.trim()} (${me.email})` : me?.email || "—";
        return `${base}: ${who}`;
      }
      if ((m.content ?? "").trimStart().startsWith("🕵️")) {
        const spec = agentSpec?.auditor?.trim();
        return spec ? `${AUDITOR_PREFIX} (${spec})` : `${AUDITOR_PREFIX} (спецификация модели ИИ)`;
      }
      const spec = agentSpec?.executor?.trim();
      return spec ? `${EXECUTOR_PREFIX} (${spec})` : `${EXECUTOR_PREFIX} (спецификация модели ИИ)`;
    },
    [me, agentSpec]
  );

  /** Прокрутка сразу после обновления DOM; если последнее — user, всегда к низу (отправка своего сообщения). */
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const msgs = session?.messages;
    if (!msgs?.length) return;
    const last = msgs[msgs.length - 1];
    if (last.role === "user") stickBottomRef.current = true;
    if (!stickBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messagesScrollKey, session?.messages]);

  useEffect(() => {
    if (!embedThread) return;
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const d = ev.data as { type?: string } | null;
      if (d?.type !== CHAT_SCROLL_TO_BOTTOM_TYPE) return;
      stickBottomRef.current = true;
      requestAnimationFrame(() => {
        const node = listRef.current;
        if (!node) return;
        node.scrollTop = node.scrollHeight;
        requestAnimationFrame(() => {
          const n2 = listRef.current;
          if (n2) n2.scrollTop = n2.scrollHeight;
        });
      });
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [embedThread]);

  const onFramePaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = collectClipboardFiles(e);
    if (files.length === 0) return;
    e.preventDefault();
    setPendingFiles((prev) => mergePendingFiles(prev, files));
  }, []);

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
    if ((!input.trim() && pendingFiles.length === 0) || !sessionId) return;
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
      let r: Response;
      if (pendingFiles.length > 0) {
        const fd = new FormData();
        fd.set("projectSlug", params.slug);
        fd.set("sessionId", sessionId);
        fd.set("message", ctx);
        for (const f of pendingFiles) fd.append("files", f, f.name);
        r = await fetch("/api/agent/chat", { method: "POST", credentials: "include", body: fd });
      } else {
        r = await fetch("/api/agent/chat", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectSlug: params.slug, sessionId, message: ctx }),
        });
      }
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
        userMsg?: { id: string };
        timeoutMs?: number;
      };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setPendingFiles([]);
      stickBottomRef.current = true;
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {!embedThread ? (
        <>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/80 px-3 py-2 text-xs text-slate-400">
            <span>
              Чат тикета · {params.slug}/{ticketLabel}
              {sessionId ? ` · сессия ${sessionId.slice(0, 8)}` : " · сессия —"}
            </span>
            <NotificationBell />
          </div>
          {err ? <div className="shrink-0 px-3 py-2 text-xs text-red-400">{err}</div> : null}
        </>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          className={`absolute inset-0 overflow-y-auto overscroll-y-contain p-3 text-sm [-webkit-overflow-scrolling:touch] ${
            embedThread ? "" : "pb-10 pr-14"
          }`}
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
                    <span className="text-slate-400">{formatMsgTime(m.createdAt)}</span>
                    <span className="mx-1.5">·</span>
                    <span>{roleLabel(m)}</span>
                  </div>
                  {m.role === "user" &&
                  m.content.startsWith(TICKET_CONTEXT_HEAD) &&
                  m.content.length > 1400 ? (
                    <>
                      <details className="mt-1 rounded border border-slate-700/60 bg-slate-950/40 p-2">
                        <summary className="cursor-pointer select-none text-xs text-slate-400">
                          Полный контекст тикета ({m.content.length.toLocaleString("ru-RU")} симв.) — развернуть
                        </summary>
                        <pre className="mt-2 max-h-[50vh] overflow-y-auto whitespace-pre-wrap font-sans text-sm text-slate-200">
                          {m.content}
                        </pre>
                      </details>
                      {parseChatAttachmentsJson(m.attachmentsJson).length > 0 ? (
                        <div className="mt-2 rounded border border-slate-700/60 bg-slate-950/50 px-2 py-1.5 text-[11px] text-slate-400">
                          <div className="font-medium text-slate-300">Вложения</div>
                          <ul className="mt-1 list-inside list-disc space-y-0.5">
                            {parseChatAttachmentsJson(m.attachmentsJson).map((a) => (
                              <li key={a.relPath}>
                                <span className="text-slate-200">{a.name}</span>
                                <span className="font-mono text-slate-500"> · {a.relPath}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <pre className="mt-1 whitespace-pre-wrap font-sans text-slate-200">
                        {m.role !== "user" && m.content.includes(WAITING_CODE)
                          ? m.content.replace(WAITING_CODE, "").trim()
                          : m.content}
                      </pre>
                      {m.role === "user" && parseChatAttachmentsJson(m.attachmentsJson).length > 0 ? (
                        <div className="mt-2 rounded border border-slate-700/60 bg-slate-950/50 px-2 py-1.5 text-[11px] text-slate-400">
                          <div className="font-medium text-slate-300">Вложения</div>
                          <ul className="mt-1 list-inside list-disc space-y-0.5">
                            {parseChatAttachmentsJson(m.attachmentsJson).map((a) => (
                              <li key={a.relPath}>
                                <span className="text-slate-200">{a.name}</span>
                                <span className="font-mono text-slate-500"> · {a.relPath}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-500">Нет сообщений.</div>
          )}
        </div>
      </div>

      {!embedThread ? (
        <div className="shrink-0 border-t border-slate-800 bg-slate-950/95 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
          <p className="mb-1 px-1 text-[10px] leading-snug text-slate-500">
            Первое сообщение в сессии передаёт полный контекст тикета; дальше — только ваш текст. Чтобы снова отправить поля
            тикета, добавьте <span className="font-mono text-slate-400">[обновить контекст]</span>. Скрепка и{" "}
            <span className="font-mono text-slate-400">Ctrl+V</span> — вложения (до {CHAT_ATTACHMENT_MAX_FILES} шт.) в
            workspace.
          </p>
          <input
            ref={attachInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const list = e.target.files ? Array.from(e.target.files) : [];
              setPendingFiles((prev) => [...prev, ...list].slice(0, CHAT_ATTACHMENT_MAX_FILES));
              e.target.value = "";
            }}
          />
          {pendingFiles.length > 0 ? (
            <div className="mb-1 flex max-h-14 flex-wrap gap-1 overflow-y-auto px-1 text-[10px]">
              {pendingFiles.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-slate-300"
                >
                  {f.name}
                  <button
                    type="button"
                    className="text-slate-500 hover:text-red-300"
                    aria-label="Убрать файл"
                    onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="flex gap-2">
            <div className="relative min-h-[2.75rem] min-w-0 max-h-32 flex-1">
              <textarea
                className="min-h-[2.75rem] max-h-32 w-full resize-y rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-60"
                placeholder="Сообщение агенту…"
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={onFramePaste}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                disabled={loading || !sessionId}
              />
              <ChatPaperclipAttach
                className="pointer-events-auto absolute bottom-1.5 right-2 z-10"
                disabled={loading || !sessionId || pendingFiles.length >= CHAT_ATTACHMENT_MAX_FILES}
                onPickFiles={() => attachInputRef.current?.click()}
              />
            </div>
            <div className="flex shrink-0 flex-col items-end justify-end self-stretch">
              <button
                type="button"
                className="mt-auto rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                disabled={loading || !sessionId || (!input.trim() && pendingFiles.length === 0)}
                onClick={() => void send()}
              >
                {loading ? "…" : "Отправить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
