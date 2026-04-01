"use client";

import { useMemo, type ReactNode } from "react";
import { fmtHealthPct, usePortalHealth, type HealthServiceRow } from "@/lib/use-portal-health";

function serviceListBlock(items: HealthServiceRow[] | undefined, opts: { idle?: boolean; offline?: boolean }) {
  if (opts.idle) {
    return <div className="text-slate-500">…</div>;
  }
  if (opts.offline) {
    return <div className="text-slate-500">нет связи</div>;
  }
  if (!items?.length) {
    return <div className="text-slate-500">—</div>;
  }
  return (
    <>
      {items.map((s) => (
        <div key={s.name} className="flex flex-wrap items-baseline gap-x-1 break-words">
          <span className="text-slate-400">{s.name}</span>
          <span className={s.ok ? "font-medium text-emerald-300/90" : "font-medium text-red-300/90"}>
            {s.ok ? "ok" : "нет"}
          </span>
        </div>
      ))}
    </>
  );
}

function stripTile(
  title: string,
  left: ReactNode,
  right: ReactNode,
  tone: "ok" | "warn" | "critical" | "idle"
) {
  const border =
    tone === "critical"
      ? "border-red-700/70 bg-red-950/50"
      : tone === "warn"
        ? "border-amber-700/60 bg-amber-950/35"
        : tone === "ok"
          ? "border-emerald-700/50 bg-emerald-950/25"
          : "border-slate-700 bg-slate-950/80";
  return (
    <div
      className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-[11px] leading-snug text-slate-200 shadow-sm ${border}`}
    >
      <div className="truncate font-semibold tracking-wide text-slate-100">{title}</div>
      <div className="mt-1 flex min-h-[4.25rem] gap-2">
        <div className="min-w-0 flex-1 space-y-0.5 text-slate-300">{left}</div>
        <div className="w-px shrink-0 self-stretch bg-slate-600/45" aria-hidden />
        <div className="flex min-w-[7rem] max-w-[10.5rem] shrink-0 flex-col gap-0.5">
          <div className="text-[9px] font-medium uppercase tracking-wide text-slate-500">Службы</div>
          <div className="space-y-0.5 text-[10px] leading-snug">{right}</div>
        </div>
      </div>
    </div>
  );
}

export function HealthDiagnosticDock() {
  const { shectory, hoster, pi } = usePortalHealth(15_000);

  const overall = useMemo(() => {
    const s =
      hoster?.status === "critical" || shectory?.status === "critical" || pi?.status === "critical"
        ? "critical"
        : hoster?.status === "warn" || shectory?.status === "warn" || pi?.status === "warn"
          ? "warn"
          : shectory
            ? "ok"
            : "idle";
    return s;
  }, [shectory, hoster?.status, pi?.status]);

  const barBorder =
    overall === "critical"
      ? "border-red-800/80"
      : overall === "warn"
        ? "border-amber-800/70"
        : overall === "ok"
          ? "border-emerald-800/60"
          : "border-slate-700";

  const hosterTone =
    hoster?.status === "critical"
      ? "critical"
      : hoster?.status === "warn"
        ? "warn"
        : hoster?.hoster?.ok
          ? "ok"
          : "idle";

  const shectoryTone =
    shectory?.status === "critical"
      ? "critical"
      : shectory?.status === "warn"
        ? "warn"
        : shectory
          ? "ok"
          : "idle";

  const piTone =
    pi?.status === "critical"
      ? "critical"
      : pi?.status === "warn"
        ? "warn"
        : pi?.status === "ok"
          ? "ok"
          : pi?.pi?.ok
            ? "ok"
            : pi
              ? "warn"
              : "idle";

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-2 pb-2 pt-1"
      role="region"
      aria-label="Витрина диагностики"
    >
      <div
        className={`pointer-events-auto flex w-full max-w-7xl flex-col gap-1 rounded-t-xl border bg-slate-950/95 px-2 py-2 shadow-[0_-8px_32px_rgba(0,0,0,0.45)] backdrop-blur-sm ${barBorder}`}
      >
        <div className="px-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
          Диагностика · интервал опроса ~5 мин (кэш)
        </div>
        <div className="flex flex-wrap gap-2 sm:flex-nowrap">
          {stripTile(
            "Hoster",
            <>
              <div>
                CPU{" "}
                {hoster?.hoster?.ok
                  ? `${fmtHealthPct(hoster.hoster.cpu?.load1 ?? 0)} / ${fmtHealthPct(hoster.hoster.cpu?.load5 ?? 0)} / ${fmtHealthPct(hoster.hoster.cpu?.load15 ?? 0)}`
                  : "…"}
              </div>
              <div>
                RAM used:{" "}
                {hoster?.hoster?.ok
                  ? `${fmtHealthPct(100 - (hoster.hoster.ram?.free_pct ?? 0))}%`
                  : "…"}
              </div>
              <div>
                HDD used:{" "}
                {hoster?.hoster?.ok
                  ? `${fmtHealthPct(100 - (hoster.hoster.hdd?.free_pct ?? 0))}%`
                  : "…"}
              </div>
              <div className="text-[10px] text-slate-500">
                {hoster?.at ? new Date(hoster.at).toLocaleTimeString("ru-RU") : ""}
              </div>
            </>,
            serviceListBlock(hoster?.hoster?.services, {
              idle: !hoster,
              offline: !!(hoster && !hoster.hoster?.ok && !(hoster.hoster.services?.length)),
            }),
            hosterTone
          )}
          {stripTile(
            "Shectory",
            <>
              <div>
                CPU{" "}
                {shectory
                  ? `${fmtHealthPct(shectory.cpu.load1)} / ${fmtHealthPct(shectory.cpu.load5)} / ${fmtHealthPct(shectory.cpu.load15)}`
                  : "…"}
                {shectory?.cpu?.cores ? ` (${shectory.cpu.cores}c)` : ""}
              </div>
              <div>RAM used: {shectory ? `${fmtHealthPct(shectory.ram.usedPct)}%` : "…"}</div>
              <div>HDD used: {shectory ? `${fmtHealthPct(shectory.hdd.usedPct)}%` : "…"}</div>
              <div className="text-[10px] text-slate-500">
                {shectory?.at ? new Date(shectory.at).toLocaleTimeString("ru-RU") : ""}
              </div>
            </>,
            serviceListBlock(shectory?.services, { idle: !shectory }),
            shectoryTone
          )}
          {stripTile(
            "Pi",
            <>
              <div>
                CPU{" "}
                {pi?.pi?.ok
                  ? `${fmtHealthPct(pi.pi.cpu?.load1 ?? 0)} / ${fmtHealthPct(pi.pi.cpu?.load5 ?? 0)} / ${fmtHealthPct(pi.pi.cpu?.load15 ?? 0)}`
                  : pi?.pi?.services?.length
                    ? "—"
                    : pi
                      ? "down"
                      : "…"}
              </div>
              <div>
                RAM used:{" "}
                {pi?.pi?.ok ? `${fmtHealthPct(100 - (pi.pi.ram?.free_pct ?? 0))}%` : pi ? "—" : "…"}
              </div>
              <div>
                HDD used:{" "}
                {pi?.pi?.ok ? `${fmtHealthPct(100 - (pi.pi.hdd?.free_pct ?? 0))}%` : pi ? "—" : "…"}
              </div>
              {pi?.pi?.metricsOk !== true && (pi?.pi?.services?.length ?? 0) > 0 ? (
                <div className="text-[10px] text-slate-500">
                  {pi?.pi?.skippedMetrics
                    ? "CPU/RAM: нужен рабочий PI_MONITOR_SSH (ключ доступен процессу портала)"
                    : "CPU/RAM: SSH к Pi не ответил"}
                </div>
              ) : null}
              <div className="text-[10px] text-slate-500">
                {pi?.at ? new Date(pi.at).toLocaleTimeString("ru-RU") : ""}
              </div>
            </>,
            serviceListBlock(pi?.pi?.services, {
              idle: !pi,
              offline: !!(pi && !pi.pi?.ok && !(pi.pi.services?.length)),
            }),
            piTone
          )}
        </div>
      </div>
    </div>
  );
}
