"use client";

import { useMemo } from "react";
import { fmtHealthPct, usePortalHealth } from "@/lib/use-portal-health";

/** Вертикальный блок health (для встраивания на страницах, где нужен не док). */
export function ShectoryHealthWidget({ className = "" }: { className?: string }) {
  const h = usePortalHealth(15_000);
  const shectory = h.shectory;
  const hoster = h.hoster;
  const pi = h.pi;

  const cls = useMemo(() => {
    const s =
      hoster?.status === "critical" || shectory?.status === "critical" || pi?.status === "critical"
        ? "critical"
        : hoster?.status === "warn" || shectory?.status === "warn" || pi?.status === "warn"
          ? "warn"
          : shectory
            ? "ok"
            : "idle";
    if (s === "critical") return "border-red-700/70 bg-red-950/40 text-red-100";
    if (s === "warn") return "border-amber-700/70 bg-amber-950/30 text-amber-100";
    if (s === "ok") return "border-emerald-700/60 bg-emerald-950/20 text-emerald-100";
    return "border-slate-700 bg-slate-950/70 text-slate-200";
  }, [shectory, hoster?.status, pi?.status]);

  return (
    <div className={`rounded-xl border ${cls} px-3 py-2 text-xs shadow-lg ${className}`}>
      <div className="font-semibold tracking-wide">Health (hoster / shectory / pi)</div>
      <div className="mt-1 grid gap-0.5">
        <div className="mt-1 border-t border-white/10 pt-1">
          Shectory:{" "}
          <span className="text-white/90">
            CPU{" "}
            {shectory
              ? `${fmtHealthPct(shectory.cpu.load1)} / ${fmtHealthPct(shectory.cpu.load5)} / ${fmtHealthPct(shectory.cpu.load15)}`
              : "…"}
            {shectory?.cpu?.cores ? ` (${shectory.cpu.cores}c)` : ""}
          </span>
        </div>
        <div>RAM used: {shectory ? `${fmtHealthPct(shectory.ram.usedPct)}%` : "…"} </div>
        <div>HDD used: {shectory ? `${fmtHealthPct(shectory.hdd.usedPct)}%` : "…"} </div>
        <div className="mt-1 border-t border-white/10 pt-1">
          Hoster:{" "}
          {hoster?.hoster?.ok
            ? `CPU ${fmtHealthPct(hoster.hoster.cpu?.load1 ?? 0)} / RAM used ${fmtHealthPct(100 - (hoster.hoster.ram?.free_pct ?? 0))}% / HDD used ${fmtHealthPct(100 - (hoster.hoster.hdd?.free_pct ?? 0))}%`
            : "…"}
        </div>
        <div>DB: {hoster?.db?.ok ? `ok (${hoster.db.ms ?? 0}ms)` : hoster ? "down" : "…"} </div>
        <div className="mt-1 border-t border-white/10 pt-1">
          Pi:{" "}
          {pi?.pi?.ok
            ? `CPU ${fmtHealthPct(pi.pi.cpu?.load1 ?? 0)} / RAM used ${fmtHealthPct(100 - (pi.pi.ram?.free_pct ?? 0))}% / HDD used ${fmtHealthPct(100 - (pi.pi.hdd?.free_pct ?? 0))}%`
            : pi
              ? "down"
              : "…"}
        </div>
        <div className="text-[10px] text-white/60">
          Обновление: {hoster?.at ? new Date(hoster.at).toLocaleTimeString("ru-RU") : "…"} · интервал проверки 5 мин
        </div>
      </div>
    </div>
  );
}

