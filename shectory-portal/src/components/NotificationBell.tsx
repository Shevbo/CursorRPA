"use client";

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

/** Короткий звук уведомления через Web Audio API (fallback если MP3 не загружен). */
function playBeepFallback() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
    setTimeout(() => ctx.close(), 600);
  } catch {
    // ignore — audio not available
  }
}

const SOUND_URL = "/sounds/notification.mp3";

function playNotificationSound(audioRef: React.MutableRefObject<HTMLAudioElement | null>) {
  try {
    if (!audioRef.current) {
      const a = new Audio(SOUND_URL);
      a.volume = 0.7;
      audioRef.current = a;
    }
    const a = audioRef.current;
    a.currentTime = 0;
    const p = a.play();
    if (p) {
      p.catch(() => playBeepFallback());
    }
  } catch {
    playBeepFallback();
  }
}

/** Иконка вида уведомления. */
function kindIcon(kind: string): string {
  if (kind.includes("failed") || kind.includes("error")) return "❌";
  if (kind.includes("idle") || kind.includes("waiting")) return "⏸️";
  if (kind.includes("done") || kind.includes("ready")) return "✅";
  if (kind.includes("engineering_prompt")) return "📝";
  return "🔔";
}

export function NotificationBell({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [soundUploading, setSoundUploading] = useState(false);
  const [soundStatus, setSoundStatus] = useState<"ok" | "none" | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const didMountRef = useRef(false);

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
        const newUnread = typeof j.unread === "number" ? j.unread : j.items.filter((x) => !x.readAt).length;
        setUnread((prev) => {
          // Play sound when unread count increases (not on first load)
          if (didMountRef.current && newUnread > prev) {
            playNotificationSound(audioRef);
          }
          return newUnread;
        });
      }
    } finally {
      setLoading(false);
      didMountRef.current = true;
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

  // Check if custom sound file exists on server
  useEffect(() => {
    fetch(SOUND_URL, { method: "HEAD" })
      .then((r) => setSoundStatus(r.ok ? "ok" : "none"))
      .catch(() => setSoundStatus("none"));
  }, []);

  // Preload audio on first user interaction to bypass autoplay restrictions
  useEffect(() => {
    function onFirstInteract() {
      if (!audioRef.current) {
        const a = new Audio(SOUND_URL);
        a.volume = 0.7;
        a.load();
        audioRef.current = a;
      }
      document.removeEventListener("click", onFirstInteract);
      document.removeEventListener("keydown", onFirstInteract);
    }
    document.addEventListener("click", onFirstInteract, { once: true });
    document.addEventListener("keydown", onFirstInteract, { once: true });
    return () => {
      document.removeEventListener("click", onFirstInteract);
      document.removeEventListener("keydown", onFirstInteract);
    };
  }, []);

  async function uploadSound(file: File) {
    setSoundUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file, "notification.mp3");
      const r = await fetch("/api/auth/notifications/sound", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (r.ok) {
        setSoundStatus("ok");
        audioRef.current = null; // reset so it reloads
      } else {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        alert(j.error ?? "Ошибка загрузки звука");
      }
    } finally {
      setSoundUploading(false);
    }
  }

  async function removeSound() {
    await fetch("/api/auth/notifications/sound", { method: "DELETE", credentials: "include" });
    setSoundStatus("none");
    audioRef.current = null;
  }

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

  // Pulse animation when there are unread notifications
  const hasUnread = unread > 0;

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
        <span className={`text-lg leading-none ${hasUnread ? "animate-bounce" : ""}`} aria-hidden>
          🔔
        </span>
        {hasUnread ? (
          <span className="absolute -right-0.5 -top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(100vw-1.5rem,26rem)] rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
            <span className="text-xs font-medium text-slate-300">
              Уведомления{unread > 0 ? <span className="ml-1.5 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">{unread}</span> : null}
            </span>
            <button
              type="button"
              className="text-[11px] text-blue-400 hover:underline disabled:opacity-40"
              disabled={loading || unread === 0}
              onClick={() => void markAllRead()}
            >
              Прочитать все
            </button>
          </div>
          {/* Sound settings row */}
          <div className="flex items-center gap-2 border-b border-slate-800/60 bg-slate-950/40 px-3 py-1.5">
            <span className="text-[10px] text-slate-500">🔊 Звук:</span>
            {soundStatus === "ok" ? (
              <>
                <span className="text-[10px] text-emerald-400">загружен</span>
                <button
                  type="button"
                  className="text-[10px] text-slate-500 hover:text-slate-300"
                  onClick={() => { audioRef.current = null; playNotificationSound(audioRef); }}
                  title="Проверить звук"
                >
                  ▶ тест
                </button>
                <button
                  type="button"
                  className="ml-auto text-[10px] text-red-500 hover:text-red-300"
                  onClick={() => void removeSound()}
                  title="Удалить звук"
                >
                  удалить
                </button>
              </>
            ) : (
              <>
                <span className="text-[10px] text-slate-600">{soundStatus === "none" ? "не загружен (beep)" : "…"}</span>
                <button
                  type="button"
                  className="ml-auto text-[10px] text-blue-400 hover:text-blue-300 disabled:opacity-40"
                  disabled={soundUploading}
                  onClick={() => fileInputRef.current?.click()}
                  title="Загрузить MP3 файл уведомления"
                >
                  {soundUploading ? "загрузка…" : "загрузить MP3"}
                </button>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/mpeg,audio/mp3,.mp3"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadSound(f);
                e.target.value = "";
              }}
            />
          </div>
          <div className="max-h-[min(70vh,28rem)] overflow-y-auto overscroll-contain">
            {items.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-slate-500">{loading ? "Загрузка…" : "Пока пусто"}</div>
            ) : (
              <ul className="divide-y divide-slate-800">
                {items.map((n) => {
                  const isUnread = !n.readAt;
                  const icon = kindIcon(n.kind);
                  const content = (
                    <div className={`px-3 py-2.5 ${isUnread ? "bg-slate-800/40" : ""}`}>
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 shrink-0 text-sm leading-none" aria-hidden>{icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <span className={`text-xs font-semibold leading-snug ${isUnread ? "text-white" : "text-slate-300"}`}>
                              {n.title}
                            </span>
                            {isUnread && (
                              <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-rose-500" aria-hidden />
                            )}
                          </div>
                          <div className="mt-0.5 line-clamp-3 text-[11px] leading-relaxed text-slate-400">{n.body}</div>
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <span className="text-[10px] text-slate-600">{fmtTime(n.createdAt)}</span>
                            {n.href && (
                              <span className="text-[10px] text-blue-500">→ открыть</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );

                  return (
                    <li key={n.id} className="hover:bg-slate-800/30 transition-colors">
                      {n.href ? (
                        <a
                          href={n.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                          onClick={() => void markRead([n.id])}
                        >
                          {content}
                        </a>
                      ) : (
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={() => void markRead([n.id])}
                        >
                          {content}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
