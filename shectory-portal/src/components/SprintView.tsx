"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatMessage, ChatSession, Sprint } from "@prisma/client";
import { waitForAssistantAfterUserMessage } from "@/lib/wait-agent-reply";

type SessionWithMessages = ChatSession & { messages: ChatMessage[] };

type BacklogRow = {
  id: string;
  ticketKey?: string | null;
  title: string;
  status: string;
  priority: number;
  sprintNumber: number;
  sprintStatus: string;
  isPaused?: boolean;
};

function idLabel(b: BacklogRow) {
  return (b.ticketKey && String(b.ticketKey)) || b.id.slice(0, 8);
}

export function SprintView({
  projectId,
  projectSlug,
  sprintNumber,
  initialSprint,
}: {
  projectId: string;
  projectSlug: string;
  sprintNumber: number;
  initialSprint: unknown | null;
}) {
  const [items, setItems] = useState<BacklogRow[]>([]);
  const [sprint, setSprint] = useState<Sprint | null>(initialSprint as Sprint | null);
  const [session, setSession] = useState<SessionWithMessages | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const sprintTitle = useMemo(() => {
    if (!sprint) return `Sprint #${sprintNumber}`;
    return sprint.title?.trim() ? `Sprint #${sprintNumber} — ${sprint.title.trim()}` : `Sprint #${sprintNumber}`;
  }, [sprint, sprintNumber]);

  const load = useCallback(async () => {
    setErr("");
    const sp = new URLSearchParams({
      projectId,
      page: "1",
      limit: "200",
      sortBy: "priority",
      sortDir: "asc",
      sprintNumber: String(sprintNumber),
    });
    const r = await fetch(`/api/project/backlog?${sp}`, { credentials: "include" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr((j as { error?: string }).error ?? `HTTP ${r.status}`);
      return;
    }
    setItems((j as { items: BacklogRow[] }).items ?? []);
  }, [projectId, sprintNumber]);

  const loadSprint = useCallback(async () => {
    const sp = new URLSearchParams({ projectId });
    const r = await fetch(`/api/project/sprints?${sp}`, { credentials: "include" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    const found = ((j as { sprints?: (Sprint & { _count: { items: number } })[] }).sprints ?? []).find((x) => x.number === sprintNumber);
    if (found) setSprint(found);
  }, [projectId, sprintNumber]);

  useEffect(() => {
    void load();
    void loadSprint();
  }, [load, loadSprint]);

  const loadSession = useCallback(async (sessionId: string) => {
    const r = await fetch(
      `/api/project/chat-sessions/${encodeURIComponent(sessionId)}?limit=200`,
      { credentials: "include" }
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    setSession((j as { session: SessionWithMessages }).session);
  }, []);

  async function ensureSprintSession() {
    if (session?.id) return;
    const r = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/sessions`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `${sprintTitle} (agent)` }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr((j as { error?: string }).error ?? `HTTP ${r.status}`);
      return;
    }
    const sid = (j as { session?: { id?: string } }).session?.id ?? "";
    if (!sid) return;
    setSession({ id: sid, title: `${sprintTitle} (agent)`, projectId, createdAt: new Date(), updatedAt: new Date(), backlogItemId: null, messages: [] } as SessionWithMessages);
    await loadSession(sid);
  }

  async function send() {
    if (!input.trim() || !session?.id) return;
    setLoading(true);
    setErr("");
    try {
      const msg = input.trim();
      setInput("");
      const priorUserCount = session.messages.filter((m) => m.role === "user").length;
      const sprintBlock =
        `SPRINT #${sprintNumber}\n` +
        `Tickets:\n` +
        items.map((t) => `- ${idLabel(t)} ${t.title} (status=${t.status}, p=${t.priority}${t.isPaused ? ", paused" : ""})`).join("\n");
      const message =
        priorUserCount === 0
          ? `${sprintBlock}\n\nUser:\n${msg}`
          : `Контекст спринта и список тикетов уже в первом сообщении пользователя в этой сессии.\n\nUser:\n${msg}`;
      const r = await fetch("/api/agent/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          sessionId: session.id,
          message,
        }),
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
        await waitForAssistantAfterUserMessage(session.id, uid, { timeoutMs: t });
      }
      await Promise.all([load(), loadSession(session.id)]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs text-slate-500">Sprint</div>
            <div className="mt-1 text-lg font-semibold text-white">{sprintTitle}</div>
            <div className="mt-1 text-xs text-slate-500">Работа с агентом идёт по всему составу тикетов в этом спринте.</div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900/40"
              onClick={() => void load()}
            >
              Обновить состав
            </button>
            <button
              type="button"
              className="rounded bg-blue-600 px-3 py-2 text-sm text-white"
              onClick={() => void ensureSprintSession()}
            >
              Запустить работу со спринтом
            </button>
          </div>
        </div>

        {err && <div className="mt-3 text-sm text-red-400">{err}</div>}
      </div>

      <div className="overflow-auto rounded-xl border border-slate-800 bg-black/20">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="bg-slate-950/90 text-xs uppercase tracking-wide text-slate-500">
            <tr className="border-b border-slate-800">
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Priority</th>
              <th className="px-3 py-2">Paused</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {items.map((t) => (
              <tr key={t.id} className="hover:bg-slate-900/40">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  <Link href={`/projects/${projectSlug}/backlog/${t.id}`} className="text-blue-400 hover:underline">
                    {idLabel(t)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-slate-100">{t.title}</td>
                <td className="px-3 py-2 text-slate-300">{t.status}</td>
                <td className="px-3 py-2 text-slate-300">p{t.priority}</td>
                <td className="px-3 py-2 text-slate-400">{t.isPaused ? "yes" : "—"}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                  В спринте пока нет тикетов
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-slate-800 bg-black/20">
        <div className="border-b border-slate-800 p-4">
          <div className="text-sm font-medium text-white">Лента спринта (агент)</div>
          <div className="mt-1 text-xs text-slate-500">
            Сообщения сохраняются как обычная сессия чата проекта (title: “{sprintTitle} (agent)”).
          </div>
        </div>
        <div className="max-h-[45vh] overflow-y-auto p-4 text-sm">
          {session?.messages?.length ? (
            <div className="space-y-3">
              {session.messages.map((m) => (
                <div
                  key={m.id}
                  className={m.role === "user" ? "ml-8 rounded-lg bg-blue-900/30 p-3" : "mr-8 rounded-lg bg-slate-800/50 p-3"}
                >
                  <div className="text-xs text-slate-500">{m.role}</div>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-slate-200">{m.content}</pre>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-500">Пока нет сообщений.</div>
          )}
        </div>
        <div className="border-t border-slate-800 p-3">
          <div className="flex gap-2">
            <input
              className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              placeholder="Сообщение агенту по спринту…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), void send())}
              disabled={loading || !session?.id}
            />
            <button
              type="button"
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={loading || !session?.id || !input.trim()}
              onClick={() => void send()}
            >
              {loading ? "…" : "Отправить"}
            </button>
          </div>
          {!session?.id && <div className="mt-2 text-xs text-slate-500">Нажмите “Запустить работу со спринтом”.</div>}
        </div>
      </div>
    </div>
  );
}

