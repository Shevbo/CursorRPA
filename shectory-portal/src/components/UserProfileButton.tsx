"use client";

import { useEffect, useMemo, useState } from "react";

type ProfilePayload = {
  ok: boolean;
  user?: { email: string; role: string; fullName: string; phone: string; avatarUrl: string };
  stats?: { projectsCount: number; messagesCount: number; lastActivityAt: string | null; rating: number | null };
  history?: { type: string; at: string; label: string; href: string }[];
  error?: string;
};

function fmtDt(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "medium" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function UserProfileButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const avatar = useMemo(() => avatarUrl.trim(), [avatarUrl]);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/auth/profile", { credentials: "include" });
      const j = (await r.json().catch(() => ({}))) as ProfilePayload;
      setData(j);
      if (j.user) {
        setFullName(j.user.fullName || "");
        setPhone(j.user.phone || "");
        setAvatarUrl(j.user.avatarUrl || "");
      }
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const r = await fetch("/api/auth/profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, phone, avatarUrl }),
      });
      const j = (await r.json().catch(() => ({}))) as ProfilePayload;
      setData((prev) => ({ ...(prev || {}), ...j }));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 touch-manipulation"
      >
        Профиль
      </button>

      {open ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-950 p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-white">Профиль</div>
                <div className="text-xs text-slate-500">Каталог пользователей Shectory</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-900"
              >
                Закрыть
              </button>
            </div>

            {loading ? (
              <div className="mt-4 text-sm text-slate-400">Загрузка…</div>
            ) : data?.ok === false ? (
              <div className="mt-4 text-sm text-red-300">{data.error || "Ошибка загрузки профиля"}</div>
            ) : (
              <div className="mt-4 grid gap-4 md:grid-cols-[1fr_220px]">
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="mb-1 text-[11px] text-slate-400">Логин / e-mail</div>
                      <input
                        value={data?.user?.email || ""}
                        disabled
                        className="w-full rounded border border-slate-800 bg-slate-900/40 px-2 py-1.5 text-sm text-slate-300 disabled:opacity-80"
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] text-slate-400">Телефон</div>
                      <input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full rounded border border-slate-800 bg-slate-900/40 px-2 py-1.5 text-sm text-slate-100"
                        placeholder="+7…"
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="mb-1 text-[11px] text-slate-400">ФИО</div>
                      <input
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full rounded border border-slate-800 bg-slate-900/40 px-2 py-1.5 text-sm text-slate-100"
                        placeholder="Фамилия Имя"
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] text-slate-400">Фото (URL)</div>
                      <input
                        value={avatarUrl}
                        onChange={(e) => setAvatarUrl(e.target.value)}
                        className="w-full rounded border border-slate-800 bg-slate-900/40 px-2 py-1.5 text-sm text-slate-100"
                        placeholder="https://…"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3 rounded-lg border border-slate-800 bg-black/20 p-3 text-xs text-slate-300">
                    <div>
                      <div className="text-slate-500">Роль доступа</div>
                      <div className="font-mono">{data?.user?.role || "—"}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Кол-во проектов</div>
                      <div className="font-mono">{data?.stats?.projectsCount ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Кол-во сообщений</div>
                      <div className="font-mono">{data?.stats?.messagesCount ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Последняя активность</div>
                      <div className="font-mono">{fmtDt(data?.stats?.lastActivityAt ?? null)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Рейтинг</div>
                      <div className="font-mono">{data?.stats?.rating ?? "—"}</div>
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">История операций</div>
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-800 bg-black/10">
                      <ul className="divide-y divide-slate-800">
                        {(data?.history || []).map((h, idx) => (
                          <li key={idx} className="px-3 py-2 text-xs text-slate-300">
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate">{h.label}</span>
                              <span className="shrink-0 font-mono text-slate-500">{fmtDt(h.at)}</span>
                            </div>
                          </li>
                        ))}
                        {data?.history?.length ? null : <li className="px-3 py-2 text-xs text-slate-500">—</li>}
                      </ul>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void save()}
                      disabled={saving}
                      className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                      {saving ? "…" : "Сохранить"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void load()}
                      disabled={loading}
                      className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900 disabled:opacity-60"
                    >
                      Обновить
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-3">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Фото</div>
                  <div className="mt-2 flex items-center justify-center rounded-lg border border-slate-800 bg-black/30 p-3">
                    {avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatar} alt="" className="max-h-44 w-auto rounded" />
                    ) : (
                      <div className="text-xs text-slate-500">—</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

