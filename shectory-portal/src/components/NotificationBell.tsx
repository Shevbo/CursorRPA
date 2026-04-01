"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

function fmtTime(iso: string) {
  try {
    return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function NotificationBell({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/auth/notifications?limit=50", { credentials: "include" });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        items?: NotificationRow[];
        unread?: number;
      };
      if (r.ok && j.items) {
        setItems(j.items);
        setUnread(typeof j.unread === "number" ? j.unread : j.items.filter((x) => !x.readAt).length);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 12_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const el = wrapRef.current;
      if (!el?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  async function markRead(ids: string[]) {
    if (!ids.length) return;
    await fetch("/api/auth/notifications", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markRead: true, ids }),
    });
    await load();
  }

  async function markAllRead() {
    await fetch("/api/auth/notifications", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markRead: true, all: true }),
    });
    await load();
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex size-10 items-center justify-center rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 touch-manipulation"
        aria-expanded={open}
        aria-label="Уведомления"
        title="Уведомления"
      >
        <span className="text-lg leading-none" aria-hidden>
          🔔
        </span>
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(100vw-1.5rem,22rem)] rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
            <span className="text-xs font-medium text-slate-300">Уведомления</span>
            <button
              type="button"
              className="text-[11px] text-blue-400 hover:underline disabled:opacity-40"
              disabled={loading || unread === 0}
              onClick={() => void markAllRead()}
            >
              Прочитать все
            </button>
          </div>
          <div className="max-h-[min(70vh,24rem)] overflow-y-auto overscroll-contain">
            {items.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-slate-500">{loading ? "Загрузка…" : "Пока пусто"}</div>
            ) : (
              <ul className="divide-y divide-slate-800">
                {items.map((n) => (
                  <li key={n.id} className={n.readAt ? "bg-transparent" : "bg-slate-800/30"}>
                    {n.href ? (
                      <Link
                        href={n.href}
                        className="block px-3 py-2.5 text-left hover:bg-slate-800/60"
                        onClick={() => void markRead([n.id])}
                      >
                        <div className="text-xs font-medium text-slate-100">{n.title}</div>
                        <div className="mt-0.5 line-clamp-3 text-[11px] text-slate-400">{n.body}</div>
                        <div className="mt-1 text-[10px] text-slate-600">{fmtTime(n.createdAt)}</div>
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="w-full px-3 py-2.5 text-left hover:bg-slate-800/60"
                        onClick={() => void markRead([n.id])}
                      >
                        <div className="text-xs font-medium text-slate-100">{n.title}</div>
                        <div className="mt-0.5 line-clamp-3 text-[11px] text-slate-400">{n.body}</div>
                        <div className="mt-1 text-[10px] text-slate-600">{fmtTime(n.createdAt)}</div>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
