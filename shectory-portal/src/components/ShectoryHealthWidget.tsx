"use client";

import { useEffect, useMemo, useState } from "react";

type Health = {
  ok: boolean;
  status: "ok" | "warn" | "critical";
  cpu: { cores: number; load1: number; load5: number; load15: number };
  ram: { usedPct: number };
  hdd: { usedPct: number };
  at: string;
};
type HosterHealth = {
  ok: boolean;
  status: "ok" | "warn" | "critical";
  hoster: { ok: boolean; cpu?: { load1: number; load5: number; load15: number }; ram?: { free_pct: number }; hdd?: { free_pct: number } };
  db: { ok: boolean; ms?: number };
  at: string;
};

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(1);
}

export function ShectoryHealthWidget() {
  const [h, setH] = useState<Health | null>(null);
  const [hoster, setHoster] = useState<HosterHealth | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await fetch("/api/health/shectory", { credentials: "include", cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as Health;
        if (alive) setH(j);
      } catch {
        // noop
      }
      try {
        const r2 = await fetch("/api/health/hoster", { credentials: "include", cache: "no-store" });
        if (!r2.ok) return;
        const j2 = (await r2.json()) as HosterHealth;
        if (alive) setHoster(j2);
      } catch {
        // noop
      }
    }
    void tick();
    const t = setInterval(tick, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const cls = useMemo(() => {
    const s = hoster?.status === "critical" || h?.status === "critical" ? "critical" : hoster?.status === "warn" || h?.status === "warn" ? "warn" : h ? "ok" : "idle";
    if (s === "critical") return "border-red-700/70 bg-red-950/40 text-red-100";
    if (s === "warn") return "border-amber-700/70 bg-amber-950/30 text-amber-100";
    if (s === "ok") return "border-emerald-700/60 bg-emerald-950/20 text-emerald-100";
    return "border-slate-700 bg-slate-950/70 text-slate-200";
  }, [h, hoster?.status]);

  return (
    <div className={`fixed bottom-4 left-4 z-40 rounded-xl border ${cls} px-3 py-2 text-xs shadow-lg`}>
      <div className="font-semibold tracking-wide">Shectory health</div>
      <div className="mt-1 grid gap-0.5">
        <div>
          CPU load: {h ? `${fmt(h.cpu.load1)} / ${fmt(h.cpu.load5)} / ${fmt(h.cpu.load15)}` : "…"}
          {h?.cpu?.cores ? ` (${h.cpu.cores}c)` : ""}
        </div>
        <div>RAM used: {h ? `${fmt(h.ram.usedPct)}%` : "…"} </div>
        <div>HDD used: {h ? `${fmt(h.hdd.usedPct)}%` : "…"} </div>
        <div className="mt-1 border-t border-white/10 pt-1">
          Hoster:{" "}
          {hoster?.hoster?.ok
            ? `CPU ${fmt(hoster.hoster.cpu?.load1 ?? 0)} / RAM used ${fmt(100 - (hoster.hoster.ram?.free_pct ?? 0))}% / HDD used ${fmt(100 - (hoster.hoster.hdd?.free_pct ?? 0))}%`
            : "…"}
        </div>
        <div>DB: {hoster?.db?.ok ? `ok (${hoster.db.ms ?? 0}ms)` : hoster ? "down" : "…"} </div>
      </div>
    </div>
  );
}

