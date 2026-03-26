"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fetchChatSession, waitForAssistantAfterUserMessage } from "@/lib/wait-agent-reply";

export default function ProjectAssistantPage({ params }: { params: { slug: string } }) {
  const sp = useSearchParams();
  const initialPrompt = useMemo(() => (sp.get("prompt") || "").trim(), [sp]);
  const [sessionId, setSessionId] = useState<string>("");
  const [prompt, setPrompt] = useState(initialPrompt);
  const [reply, setReply] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

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
    if (!prompt.trim()) return;
    setLoading(true);
    setErr("");
    setReply("");
    try {
      const text = prompt.trim();
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
        Окно для промптов администрирования (выполняется agent CLI на сервере).
      </p>

      <div className="mt-6 space-y-3">
        <textarea
          className="min-h-[10rem] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Промпт…"
        />
        {err && <div className="text-sm text-red-400">{err}</div>}
        <button
          type="button"
          disabled={loading || !sessionId}
          onClick={() => void ask()}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "…" : "Запустить"}
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

