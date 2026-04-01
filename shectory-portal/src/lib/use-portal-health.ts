"use client";

import { useEffect, useState } from "react";

export type HealthServiceRow = { name: string; ok: boolean };

export type ShectoryHealth = {
  ok: boolean;
  status: "ok" | "warn" | "critical";
  cpu: { cores: number; load1: number; load5: number; load15: number };
  ram: { usedPct: number };
  hdd: { usedPct: number };
  services?: HealthServiceRow[];
  at: string;
};

export type HosterHealth = {
  ok: boolean;
  status: "ok" | "warn" | "critical";
  hoster: {
    ok: boolean;
    cpu?: { load1: number; load5: number; load15: number };
    ram?: { free_pct: number };
    hdd?: { free_pct: number };
    services?: HealthServiceRow[];
  };
  db: { ok: boolean; ms?: number };
  at: string;
};

export type PiHealth = {
  ok: boolean;
  status: "ok" | "warn" | "critical";
  pi: {
    ok: boolean;
    cpu?: { load1: number; load5: number; load15: number };
    ram?: { free_pct: number };
    hdd?: { free_pct: number };
    services?: HealthServiceRow[];
  };
  at: string;
};

export function usePortalHealth(pollMs = 15_000) {
  const [shectory, setShectory] = useState<ShectoryHealth | null>(null);
  const [hoster, setHoster] = useState<HosterHealth | null>(null);
  const [pi, setPi] = useState<PiHealth | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await fetch("/api/health/shectory", { credentials: "include", cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as ShectoryHealth;
        if (alive) setShectory(j);
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
      try {
        const r3 = await fetch("/api/health/pi", { credentials: "include", cache: "no-store" });
        if (!r3.ok) return;
        const j3 = (await r3.json()) as PiHealth;
        if (alive) setPi(j3);
      } catch {
        // noop
      }
    }
    void tick();
    const t = setInterval(tick, pollMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pollMs]);

  return { shectory, hoster, pi };
}

export function fmtHealthPct(n: number): string {
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(1);
}
