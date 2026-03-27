"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fetchChatSession, waitForAssistantAfterUserMessage } from "@/lib/wait-agent-reply";

function ProjectAssistantPageInner({ params }: { params: { slug: string } }) {
  const sp = useSearchParams();
  const legacyPromptFromUrl = useMemo(() => (sp.get("prompt") || "").trim(), [sp]);

  const [sessionId, setSessionId] = useState<string>("");
  const [adminBrief, setAdminBrief] = useState("");
  const [briefLoaded, setBriefLoaded] = useState(false);
  const [briefErr, setBriefErr] = useState("");
  const [userNote, setUserNote] = useState("");
  const [turn, setTurn] = useState(0);
  const [reply, setReply] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBriefErr("");
      try {
        const r = await fetch(`/api/projects/${encodeURIComponent(params.slug)}/admin-assistant-context`, {
          credentials: "include",
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
        const fromApi = String((j as { prompt?: string }).prompt ?? "").trim();
        if (!cancelled) {
          setAdminBrief(legacyPromptFromUrl || fromApi);
          setBriefLoaded(true);
        }
      } catch (e) {
        if (!cancelled) {
          if (legacyPromptFromUrl) {
            setAdminBrief(legacyPromptFromUrl);
            setBriefErr("");
          } else {
            setBriefErr(e instanceof Error ? e.message : String(e));
          }
          setBriefLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.slug, legacyPromptFromUrl]);

  useEffect(() => {
    let cancelled = false;
    async function ensureSession() {
      setErr("");
      try {
        const r = await fetch(`/api/projects/${encodeURIComponent(params.slug)}/sessions`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Admin — assistant" }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
        if (!cancelled) setSessionId((j as { session?: { id?: string } }).session?.id ?? "");
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    }
    void ensureSession();
    return () => {
      cancelled = true;
    };
  }, [params.slug]);

  async function ask() {
    if (!sessionId) return;
    if (!briefLoaded) return;

    const note = userNote.trim();
    let text: string;
    if (turn === 0) {
      const base = adminBrief.trim();
      if (!base) {
        setErr("Нет брифа администратора — обновите страницу или проверьте доступ.");
        return;
      }
      text = note ? `${base}\n\n---\n\n${note}` : base;
    } else {
      if (!note) {
        setErr("Введите текст сообщения.");
        return;
      }
      text = note;
    }

    setLoading(true);
    setErr("");
    setReply("");
    try {
      const r = await fetch("/api/agent/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectSlug: params.slug, sessionId, message: text }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
        userMsg?: { id: string };
        timeoutMs?: number;
      };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      const uid = j.userMsg?.id;
      if (!uid) throw new Error("Нет userMsg в ответе API");
      const t = (j.timeoutMs ?? 1_800_000) + 120_000;
      await waitForAssistantAfterUserMessage(sessionId, uid, { timeoutMs: t });
      const s = await fetchChatSession(sessionId);
      const msgs = s?.messages ?? [];
      const idx = msgs.findIndex((m) => m.id === uid);
      const after = idx >= 0 ? msgs.slice(idx + 1).filter((m) => m.role === "assistant") : [];
      const last = after[after.length - 1];
      setReply(last?.content ?? "(ответ не найден — обновите страницу)");
      setTurn((n) => n + 1);
      setUserNote("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-white">Assistant · {params.slug}</h1>
      <p className="mt-1 text-sm text-slate-400">
        Окно для промптов администрирования (выполняется agent CLI на сервере). Первый запрос включает бриф целиком;
        далее в чат уходит только ваш текст — полный контекст подмешивается на сервере из истории сессии.
      </p>

      {legacyPromptFromUrl && (
        <p className="mt-3 text-xs text-amber-200/90">
          Открыт URL с ?prompt= — значение использовано как бриф. Дальше лучше открывать страницу без длинного параметра в адресе.
        </p>
      )}
      {briefErr && !legacyPromptFromUrl && (
        <p className="mt-3 text-xs text-red-400">Не удалось загрузить бриф с сервера: {briefErr}</p>
      )}

      <details className="mt-5 rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm text-slate-300">
        <summary className="cursor-pointer select-none text-slate-200">
          Бриф для первого сообщения к агенту (показать / скрыть)
        </summary>
        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-slate-800 bg-black/40 p-3 text-xs text-slate-400">
          {adminBrief || "…загрузка…"}
        </pre>
      </details>

      <div className="mt-6 space-y-3">
        <textarea
          className="min-h-[7rem] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
          value={userNote}
          onChange={(e) => setUserNote(e.target.value)}
          placeholder={
            turn === 0
              ? "Уточнение к первому запросу (по желанию). Если пусто — уйдёт только стандартный бриф проекта."
              : "Следующее сообщение агенту (короткий текст; история подставится автоматически)…"
          }
        />
        {err && <div className="text-sm text-red-400">{err}</div>}
        <button
          type="button"
          disabled={loading || !sessionId || !briefLoaded}
          onClick={() => void ask()}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "…" : turn === 0 ? "Первый запрос" : "Отправить"}
        </button>
      </div>

      {reply && (
        <div className="mt-6 rounded-xl border border-slate-800 bg-black/30 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Ответ</h2>
          <pre className="mt-3 whitespace-pre-wrap text-sm text-slate-200">{reply}</pre>
        </div>
      )}
    </main>
  );
}

export default function ProjectAssistantPage({ params }: { params: { slug: string } }) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-3xl px-4 py-8 text-slate-400">
          <p>Загрузка…</p>
        </main>
      }
    >
      <ProjectAssistantPageInner params={params} />
    </Suspense>
  );
}
