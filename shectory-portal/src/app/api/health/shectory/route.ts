import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { cachedHealth } from "@/lib/health-cache";
import os from "node:os";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";

function pct(used: number, total: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, (used / total) * 100));
}

async function memInfo(): Promise<{ total: number; available: number }> {
  try {
    const raw = await readFile("/proc/meminfo", "utf8");
    const mTotal = raw.match(/^MemTotal:\s+(\d+)\s+kB/im);
    const mAvail = raw.match(/^MemAvailable:\s+(\d+)\s+kB/im);
    const total = (mTotal ? Number(mTotal[1]) : 0) * 1024;
    const available = (mAvail ? Number(mAvail[1]) : 0) * 1024;
    if (total > 0) return { total, available };
  } catch {
    /* non-Linux or no /proc */
  }
  const total = os.totalmem();
  const available = os.freemem();
  return { total, available };
}

function systemctlActive(scope: "user" | "system", unit: string): boolean {
  try {
    const prefix = scope === "user" ? "systemctl --user " : "systemctl ";
    const out = execSync(`${prefix}is-active ${unit}`, {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return out === "active";
  } catch {
    return false;
  }
}

function diskRoot(): { total: number; free: number; used: number } {
  try {
    const out = execSync("df -k /", { encoding: "utf8" });
    const lines = out.trim().split("\n");
    const last = lines[lines.length - 1] || "";
    const parts = last.trim().split(/\s+/);
    const totalKb = Number(parts[1] ?? 0);
    const usedKb = Number(parts[2] ?? 0);
    const availKb = Number(parts[3] ?? 0);
    const total = totalKb * 1024;
    const used = usedKb * 1024;
    const free = availKb * 1024;
    if (total > 0) return { total, used, free };
  } catch {
    /* df missing or unexpected output */
  }
  return { total: 0, used: 0, free: 0 };
}

export async function GET(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await cachedHealth("shectory", 5 * 60_000, async () => {
    const cpu = {
      cores: os.cpus()?.length ?? 0,
      load1: os.loadavg?.()[0] ?? 0,
      load5: os.loadavg?.()[1] ?? 0,
      load15: os.loadavg?.()[2] ?? 0,
    };

    const mem = await memInfo();
    const memUsed = Math.max(0, mem.total - mem.available);
    const disk = diskRoot();

    const ramUsedPct = pct(memUsed, mem.total);
    const diskUsedPct = pct(disk.used, disk.total);

    const services = [
      { name: "shectory-portal.service", ok: systemctlActive("user", "shectory-portal.service") },
      { name: "nginx", ok: systemctlActive("system", "nginx") },
    ];

    const portalSvc = services[0]?.ok ?? true;
    const anySvcDown = services.some((s) => !s.ok);

    // Simple health heuristic
    let status: "ok" | "warn" | "critical" =
      disk.total > 0 && disk.free / disk.total < 0.05
        ? "critical"
        : mem.total > 0 && mem.available / mem.total < 0.08
          ? "critical"
          : disk.total > 0 && disk.free / disk.total < 0.12
            ? "warn"
            : mem.total > 0 && mem.available / mem.total < 0.15
              ? "warn"
              : "ok";

    if (!portalSvc) status = "critical";
    else if (anySvcDown && status === "ok") status = "warn";

    return {
      ok: true,
      status,
      cpu,
      ram: {
        total: mem.total,
        available: mem.available,
        used: memUsed,
        usedPct: ramUsedPct,
      },
      hdd: {
        total: disk.total,
        free: disk.free,
        used: disk.used,
        usedPct: diskUsedPct,
      },
      services,
      at: new Date().toISOString(),
      intervalSec: 300,
    };
  });
  return NextResponse.json(payload);
}

