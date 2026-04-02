"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PORTAL_USER_ROLES } from "@/lib/portal-settings-registry";

type SettingRow = {
  key: string;
  value: string;
  label: string;
  description: string;
  group: string;
  isSecret: boolean;
  secretSet: boolean;
};

type UserRow = {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  emailVerifiedAt: string | null;
  fullName: string;
};

export function PortalSettingsClient() {
  const [groups, setGroups] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<UserRow[]>([]);
  const [canEditSecrets, setCanEditSecrets] = useState(false);
  const [secretGemini, setSecretGemini] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    setLoading(true);
    try {
      const [sRes, uRes] = await Promise.all([
        fetch("/api/admin/settings", { credentials: "include" }),
        fetch("/api/admin/users", { credentials: "include" }),
      ]);
      const sj = await sRes.json().catch(() => ({}));
      const uj = await uRes.json().catch(() => ({}));
      if (!sRes.ok) throw new Error(sj.error || "settings");
      if (!uRes.ok) throw new Error(uj.error || "users");
      setGroups(sj.groups || {});
      const rows = (sj.settings || []) as SettingRow[];
      setSettings(rows);
      const d: Record<string, string> = {};
      for (const r of rows) {
        if (!r.isSecret) d[r.key] = r.value;
      }
      setDraft(d);
      setCanEditSecrets(!!sj.canEditSecrets);
      setUsers(uj.users || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byGroup = useMemo(() => {
    const m = new Map<string, SettingRow[]>();
    for (const s of settings) {
      if (s.isSecret) continue;
      const g = s.group || "general";
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(s);
    }
    return m;
  }, [settings]);

  async function saveConstants() {
    setSaving(true);
    setMsg("");
    setErr("");
    try {
      const r = await fetch("/api/admin/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: draft }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "save");
      setMsg("Сохранено. Раннеры агентов подхватят значения из data/portal-runtime-env.json.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveGeminiSecret() {
    if (!canEditSecrets) return;
    setSaving(true);
    setMsg("");
    setErr("");
    try {
      const r = await fetch("/api/admin/settings/secrets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "GEMINI_API_KEY", value: secretGemini }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "secret");
      setSecretGemini("");
      setMsg("Ключ Gemini сохранён (не отображается).");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function changeUserRole(userId: string, role: string) {
    setErr("");
    try {
      const r = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "role");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function uploadSound(file: File | null) {
    if (!file) return;
    setErr("");
    const fd = new FormData();
    fd.set("file", file);
    const r = await fetch("/api/auth/notifications/sound", { method: "POST", credentials: "include", body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr(j.error || "upload sound");
      return;
    }
    setMsg(`Звук загружен (${j.size} байт).`);
  }

  async function clearSound() {
    setErr("");
    const r = await fetch("/api/auth/notifications/sound", { method: "DELETE", credentials: "include" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error || "delete sound");
      return;
    }
    setMsg("Пользовательский звук удалён (будет fallback).");
  }

  if (loading) {
    return <div className="text-slate-400">Загрузка настроек…</div>;
  }

  return (
    <div className="mx-auto min-w-0 max-w-4xl space-y-10 px-3 py-6 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white sm:text-2xl">Настройки портала</h1>
          <p className="mt-1 text-sm text-slate-400">
            Каталог пользователей, параметры агентов и чата, звук уведомлений, ключи внешних API.
          </p>
        </div>
        <Link href="/projects" className="text-sm text-blue-400 hover:underline">
          ← К проектам
        </Link>
      </div>

      {msg ? <p className="rounded border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">{msg}</p> : null}
      {err ? <p className="rounded border border-red-800/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">{err}</p> : null}

      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:p-6">
        <h2 className="text-lg font-medium text-white">Пользователи и роли</h2>
        <p className="mt-1 text-sm text-slate-500">
          Менять роли может только <span className="text-slate-300">superadmin</span>. Роли: user (без доступа к /projects), admin,
          superadmin.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">E-mail</th>
                <th className="py-2 pr-3">Имя</th>
                <th className="py-2 pr-3">Роль</th>
                <th className="py-2">Создан</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-200">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="py-2 pr-3 font-mono text-xs">{u.email}</td>
                  <td className="py-2 pr-3 text-slate-400">{u.fullName || "—"}</td>
                  <td className="py-2 pr-3">
                    <select
                      className="min-h-[40px] rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-sm disabled:opacity-50"
                      value={u.role}
                      disabled={!canEditSecrets}
                      onChange={(e) => void changeUserRole(u.id, e.target.value)}
                      title={canEditSecrets ? "" : "Только superadmin"}
                    >
                      {PORTAL_USER_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 text-xs text-slate-500">{new Date(u.createdAt).toLocaleString("ru-RU")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:p-6">
        <h2 className="text-lg font-medium text-white">Звук колокольчика</h2>
        <p className="mt-1 text-sm text-slate-500">Файл MP3 до 2 МБ. Сохраняется в data/portal-sounds (не в public).</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept="audio/mpeg,audio/mp3,.mp3"
            className="max-w-full text-sm text-slate-300"
            onChange={(e) => void uploadSound(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="min-h-[44px] rounded border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 touch-manipulation"
            onClick={() => void clearSound()}
          >
            Сбросить свой звук
          </button>
        </div>
      </section>

      {canEditSecrets ? (
        <section className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-4 sm:p-6">
          <h2 className="text-lg font-medium text-amber-100">Секрет: Gemini API</h2>
          <p className="mt-1 text-sm text-amber-200/80">
            Ключ для режима бэкенда <code className="text-amber-300">gemini_api</code> (Google AI Studio / Vertex совместимый
            generateContent). Не показывается после сохранения.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Статус ключа:{" "}
            {settings.find((s) => s.key === "GEMINI_API_KEY")?.secretSet ? (
              <span className="text-emerald-400">задан</span>
            ) : (
              <span className="text-amber-400">не задан</span>
            )}
          </p>
          <div className="mt-3 flex max-w-xl flex-col gap-2 sm:flex-row sm:items-end">
            <input
              type="password"
              autoComplete="off"
              className="min-h-[44px] w-full flex-1 rounded border border-slate-600 bg-slate-950 px-3 py-2 text-base text-white"
              placeholder="Новый API-ключ"
              value={secretGemini}
              onChange={(e) => setSecretGemini(e.target.value)}
            />
            <button
              type="button"
              disabled={saving || !secretGemini.trim()}
              className="min-h-[44px] shrink-0 rounded bg-amber-600 px-4 py-2 text-sm font-medium text-black disabled:opacity-50 touch-manipulation"
              onClick={() => void saveGeminiSecret()}
            >
              Сохранить ключ
            </button>
          </div>
        </section>
      ) : null}

      <section className="space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-medium text-white">Параметры системы</h2>
          <button
            type="button"
            disabled={saving}
            className="min-h-[44px] rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 touch-manipulation"
            onClick={() => void saveConstants()}
          >
            {saving ? "Сохранение…" : "Сохранить параметры"}
          </button>
        </div>
        <p className="text-sm text-slate-500">
          Значения записываются в БД и дублируются в <code className="text-slate-400">data/portal-runtime-env.json</code> для
          фоновых Node-скриптов агентов. Секреты и пароли в .env через этот список не дублируются (кроме Gemini выше).
        </p>

        {Array.from(byGroup.entries()).map(([gid, rows]) => (
          <div key={gid} className="rounded-xl border border-slate-800 bg-black/20 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              {groups[gid] || gid}
            </h3>
            <div className="mt-4 grid gap-4">
              {rows.map((s) => {
                const def = settings.find((x) => x.key === s.key);
                const enumVals = [
                  "SHECTORY_EXECUTOR_BACKEND",
                  "SHECTORY_AUDITOR_BACKEND",
                  "SHECTORY_AGENT_ALLOW_COMMANDS",
                ].includes(s.key)
                  ? s.key === "SHECTORY_EXECUTOR_BACKEND"
                    ? ["cursor_cli", "gemini_api"]
                    : s.key === "SHECTORY_AUDITOR_BACKEND"
                      ? ["", "cursor_cli", "gemini_api"]
                      : ["0", "1"]
                  : null;
                return (
                  <label key={s.key} className="block min-w-0">
                    <span className="text-xs font-medium text-slate-400">{def?.label || s.key}</span>
                    {def?.description ? <span className="mt-0.5 block text-xs text-slate-600">{def.description}</span> : null}
                    {enumVals ? (
                      <select
                        className="mt-1 min-h-[44px] w-full max-w-lg rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white"
                        value={draft[s.key] ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                      >
                        {enumVals.map((v) => (
                          <option key={v || "empty"} value={v}>
                            {v === "" ? "(как у исполнителя)" : v}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="mt-1 min-h-[44px] w-full max-w-lg rounded border border-slate-600 bg-slate-950 px-3 py-2 text-base text-white sm:text-sm"
                        value={draft[s.key] ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                      />
                    )}
                    <span className="mt-1 block font-mono text-[10px] text-slate-600">{s.key}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
