import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { cachedHealth } from "@/lib/health-cache";
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

  const out = await cachedHealth("hoster", 5 * 60_000, async () => {
    const payload: any = {
      ok: true,
      status: "ok",
      hoster: { ok: false },
      db: { ok: false },
      at: new Date().toISOString(),
      intervalSec: 300,
    };

    // 1) HOSTER via ssh (CPU load + RAM free% + HDD free%)
    const tHoster = Date.now();
    try {
      const cmd =
        "ssh -o BatchMode=yes -o ConnectTimeout=4 hoster " +
        `"python3 - <<'PY'\n` +
        `import os, json, socket, subprocess\n` +
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
        `def port_ok(port):\n` +
        `  s=socket.socket()\n` +
        `  s.settimeout(2)\n` +
        `  try:\n` +
        `    s.connect(('127.0.0.1', port))\n` +
        `    return True\n` +
        `  except OSError:\n` +
        `    return False\n` +
        `  finally:\n` +
        `    try: s.close()\n` +
        `    except: pass\n` +
        `def unit_active(name):\n` +
        `  try:\n` +
        `    r=subprocess.run(['systemctl','is-active',name],capture_output=True,text=True,timeout=4)\n` +
        `    return r.returncode==0 and r.stdout.strip()=='active'\n` +
        `  except Exception:\n` +
        `    return False\n` +
        `t,a=mem(); dt,df=disk_root();\n` +
        `l1,l5,l15=os.getloadavg() if hasattr(os,'getloadavg') else (0.0,0.0,0.0)\n` +
        `ram_free_pct=(a/t*100.0) if t else 0.0\n` +
        `hdd_free_pct=(df/dt*100.0) if dt else 0.0\n` +
        `services=[\n` +
        `  {'name':'PostgreSQL :5432','ok':port_ok(5432)},\n` +
        `  {'name':'nginx','ok':unit_active('nginx')},\n` +
        `  {'name':'docker','ok':unit_active('docker')},\n` +
        `]\n` +
        `print(json.dumps({'cpu':{'load1':l1,'load5':l5,'load15':l15},'ram':{'free_pct':ram_free_pct},'hdd':{'free_pct':hdd_free_pct},'services':services}, ensure_ascii=False))\n` +
        `PY"`;
      const raw = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      const j = safeJsonParse(raw);
      if (j) {
        const base = { ok: true, ...j, ms: msSince(tHoster) };
        payload.hoster = base;
      } else {
        payload.hoster = { ok: false, error: "bad_json", ms: msSince(tHoster) };
      }
    } catch (e) {
      payload.hoster = { ok: false, error: e instanceof Error ? e.message : String(e), ms: msSince(tHoster) };
    }

    // 2) DB health via Prisma (SELECT 1) + latency — в список служб Hoster как «БД портала»
    const tDb = Date.now();
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const r = await prisma.$queryRawUnsafe("SELECT 1 as ok");
      payload.db = { ok: true, ms: msSince(tDb) };
    } catch (e) {
      payload.db = { ok: false, error: e instanceof Error ? e.message : String(e), ms: msSince(tDb) };
    }

    if (payload.hoster?.ok && Array.isArray(payload.hoster.services)) {
      payload.hoster.services = [
        ...payload.hoster.services,
        { name: "БД портала (Prisma)", ok: !!payload.db?.ok },
      ];
    } else if (payload.hoster && !payload.hoster.ok) {
      payload.hoster = {
        ...payload.hoster,
        services: [{ name: "БД портала (Prisma)", ok: !!payload.db?.ok }],
      };
    }

    // Aggregate status
    const hosterOk = !!payload.hoster?.ok;
    const dbOk = !!payload.db?.ok;
    const ramFree = Number(payload.hoster?.ram?.free_pct ?? 100);
    const hddFree = Number(payload.hoster?.hdd?.free_pct ?? 100);

    if (!hosterOk || !dbOk) payload.status = "critical";
    else if (ramFree < 8 || hddFree < 5) payload.status = "critical";
    else if (ramFree < 15 || hddFree < 12) payload.status = "warn";
    else payload.status = "ok";

    return payload;
  });

  return NextResponse.json(out);
}

