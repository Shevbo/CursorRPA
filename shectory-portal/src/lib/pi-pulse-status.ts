/** Расчёт статуса пульса Pi (как в /api/health/pi). */
export function piPulseOverallStatus(payload: {
  cpu?: { load1?: number; load5?: number; load15?: number };
  ram?: { free_pct?: number };
  hdd?: { free_pct?: number };
  services?: { ok?: boolean }[];
}): "ok" | "warn" | "critical" {
  const ramFree = Number(payload.ram?.free_pct ?? 100);
  const hddFree = Number(payload.hdd?.free_pct ?? 100);
  const svcList = Array.isArray(payload.services) ? payload.services : [];
  const anySvcDown = svcList.some((s) => !s?.ok);

  if (ramFree < 8 || hddFree < 5) return "critical";
  if (ramFree < 15 || hddFree < 12) return "warn";
  if (anySvcDown) return "warn";
  return "ok";
}
