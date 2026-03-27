import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { execSync } from "node:child_process";

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function msSince(t0: number): number {
  return Math.max(0, Date.now() - t0);
}

export async function GET(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const out: any = {
    ok: true,
    status: "ok",
    hoster: { ok: false },
    db: { ok: false },
    at: new Date().toISOString(),
  };

  // 1) HOSTER via ssh (CPU load + RAM free% + HDD free%)
  const tHoster = Date.now();
  try {
    const cmd =
      "ssh -o BatchMode=yes -o ConnectTimeout=4 hoster " +
      `"python3 - <<'PY'\n` +
      `import os, json\n` +
      `from pathlib import Path\n` +
      `def mem():\n` +
      `  total=avail=0\n` +
      `  for line in Path('/proc/meminfo').read_text().splitlines():\n` +
      `    if line.startswith('MemTotal:'): total=int(line.split()[1])*1024\n` +
      `    if line.startswith('MemAvailable:'): avail=int(line.split()[1])*1024\n` +
      `  return total, avail\n` +
      `def disk_root():\n` +
      `  import shutil\n` +
      `  du=shutil.disk_usage('/')\n` +
      `  return du.total, du.free\n` +
      `t,a=mem(); dt,df=disk_root();\n` +
      `l1,l5,l15=os.getloadavg() if hasattr(os,'getloadavg') else (0.0,0.0,0.0)\n` +
      `ram_free_pct=(a/t*100.0) if t else 0.0\n` +
      `hdd_free_pct=(df/dt*100.0) if dt else 0.0\n` +
      `print(json.dumps({'cpu':{'load1':l1,'load5':l5,'load15':l15}, 'ram':{'free_pct':ram_free_pct}, 'hdd':{'free_pct':hdd_free_pct}}, ensure_ascii=False))\n` +
      `PY"`;
    const raw = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const j = safeJsonParse(raw);
    if (j) {
      out.hoster = { ok: true, ...j, ms: msSince(tHoster) };
    } else {
      out.hoster = { ok: false, error: "bad_json", ms: msSince(tHoster) };
    }
  } catch (e) {
    out.hoster = { ok: false, error: e instanceof Error ? e.message : String(e), ms: msSince(tHoster) };
  }

  // 2) DB health via Prisma (SELECT 1) + latency
  const tDb = Date.now();
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const r = await prisma.$queryRawUnsafe("SELECT 1 as ok");
    out.db = { ok: true, ms: msSince(tDb) };
  } catch (e) {
    out.db = { ok: false, error: e instanceof Error ? e.message : String(e), ms: msSince(tDb) };
  }

  // Aggregate status
  const hosterOk = !!out.hoster?.ok;
  const dbOk = !!out.db?.ok;
  const ramFree = Number(out.hoster?.ram?.free_pct ?? 100);
  const hddFree = Number(out.hoster?.hdd?.free_pct ?? 100);

  if (!hosterOk || !dbOk) out.status = "critical";
  else if (ramFree < 8 || hddFree < 5) out.status = "critical";
  else if (ramFree < 15 || hddFree < 12) out.status = "warn";
  else out.status = "ok";

  return NextResponse.json(out);
}

