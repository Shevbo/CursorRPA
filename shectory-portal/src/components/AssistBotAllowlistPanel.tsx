"use client";

import { useCallback, useEffect, useState } from "react";

type Entry = {
  id: string;
  telegramUserId: string;
  note: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export function AssistBotAllowlistPanel({ projectSlug }: { projectSlug: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [hint, setHint] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [newId, setNewId] = useState("");
  const [newNote, setNewNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    setLoading(true);
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/assist-allowlist`, {
        credentials: "include",
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error ?? `HTTP ${r.status}`);
        setEntries([]);
        return;
      }
      setEntries(j.entries ?? []);
      setHint(j.hint ?? "");
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [projectSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    setSaving(true);
    setErr("");
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/assist-allowlist`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramUserId: newId.trim(), note: newNote.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setNewId("");
      setNewNote("");
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  const patch = async (id: string, patchBody: Partial<Pick<Entry, "enabled" | "note" | "telegramUserId">>) => {
    setErr("");
    try {
      const r = await fetch(
        `/api/projects/${encodeURIComponent(projectSlug)}/assist-allowlist/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        },
      );
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error ?? `HTTP ${r.status}`);
        return;
      }
      await load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Удалить запись из списка?")) return;
    setErr("");
    try {
      const r = await fetch(
        `/api/projects/${encodeURIComponent(projectSlug)}/assist-allowlist/${encodeURIComponent(id)}`,
        { method: "DELETE", credentials: "include" },
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr((j as { error?: string }).error ?? `HTTP ${r.status}`);
        return;
      }
      await load();
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900/30 p-4 sm:p-5">
      <h2 className="mb-1 text-lg font-semibold text-white">Пользователи Telegram-бота (allowlist)</h2>
      <p className="mb-4 text-sm text-slate-400">
        Управление доступом к боту <strong className="text-slate-200">Shectory Assist</strong> на hoster. В
        поле — numeric <code className="text-emerald-300/90">user id</code> из Telegram (узнать можно у{" "}
        <a className="text-blue-400 underline" href="https://t.me/userinfobot" target="_blank" rel="noreferrer">
          @userinfobot
        </a>
        ).
      </p>
      {hint ? <p className="mb-4 text-xs text-slate-500">{hint}</p> : null}
      {err ? (
        <p className="mb-3 rounded border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">{err}</p>
      ) : null}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-slate-400">
          Telegram user id
          <input
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            inputMode="numeric"
            placeholder="например 123456789"
            className="min-h-[44px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white outline-none focus:border-blue-500"
          />
        </label>
        <label className="flex min-w-0 flex-[2] flex-col gap-1 text-xs text-slate-400">
          Заметка (опционально)
          <input
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="ФИО / роль"
            className="min-h-[44px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white outline-none focus:border-blue-500"
          />
        </label>
        <button
          type="button"
          disabled={saving || !newId.trim()}
          onClick={() => void add()}
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50 touch-manipulation"
        >
          Добавить
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Загрузка…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-slate-500">Список пуст — бот доступен всем в Telegram.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full min-w-[320px] text-left text-sm text-slate-200">
            <thead className="border-b border-slate-800 bg-slate-950/80 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">User id</th>
                <th className="px-3 py-2">Заметка</th>
                <th className="px-3 py-2">Вкл.</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-slate-800/80 last:border-0">
                  <td className="px-3 py-2 font-mono text-xs sm:text-sm">{e.telegramUserId}</td>
                  <td className="max-w-[200px] truncate px-3 py-2 text-slate-400" title={e.note ?? ""}>
                    {e.note ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => void patch(e.id, { enabled: !e.enabled })}
                      className="min-h-[44px] min-w-[44px] rounded border border-slate-600 px-2 text-xs hover:bg-slate-800 touch-manipulation"
                    >
                      {e.enabled ? "да" : "нет"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void remove(e.id)}
                      className="min-h-[44px] rounded px-2 text-xs text-red-400 hover:underline touch-manipulation"
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-slate-600">
        На hoster в <code className="text-slate-400">.env</code> бота задайте{" "}
        <code className="text-slate-400">PORTAL_ALLOWLIST_BASE_URL=https://shectory.ru</code> и тот же{" "}
        <code className="text-slate-400">SHECTORY_AUTH_BRIDGE_SECRET</code>, что в <code className="text-slate-400">.env</code>{" "}
        портала — иначе бот не подтянет список и останется открытым для всех.
      </p>
    </section>
  );
}
