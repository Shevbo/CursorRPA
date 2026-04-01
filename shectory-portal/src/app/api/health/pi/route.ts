import { NextResponse } from "next/server";
import { adminAuthOk } from "@/lib/admin-auth";
import { cachedHealth } from "@/lib/health-cache";
import { execSync } from "node:child_process";

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await cachedHealth("pi", 5 * 60_000, async () => {
    const out: any = {
      ok: true,
      status: "ok",
      pi: { ok: false },
      at: new Date().toISOString(),
      intervalSec: 300,
    };

    const ssh =
      (process.env.PI_MONITOR_SSH || "").trim() ||
      (process.env.PI_HEALTH_SSH || "").trim() ||
      "ssh -o BatchMode=yes -o ConnectTimeout=4 pi";

    try {
      const cmd =
        `${ssh} ` +
        `"python3 - <<'PY'\n` +
        `import os, json, socket\n` +
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
        `t,a=mem(); dt,df=disk_root();\n` +
        `l1,l5,l15=os.getloadavg() if hasattr(os,'getloadavg') else (0.0,0.0,0.0)\n` +
        `ram_free_pct=(a/t*100.0) if t else 0.0\n` +
        `hdd_free_pct=(df/dt*100.0) if dt else 0.0\n` +
        `services=[\n` +
        `  {'name':'syslog-srv :4444','ok':port_ok(4444)},\n` +
        `  {'name':'PingMaster :4555','ok':port_ok(4555)},\n` +
        `]\n` +
        `print(json.dumps({'cpu':{'load1':l1,'load5':l5,'load15':l15},'ram':{'free_pct':ram_free_pct},'hdd':{'free_pct':hdd_free_pct},'services':services}, ensure_ascii=False))\n` +
        `PY"`;
      const raw = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      const j = safeJsonParse(raw);
      if (j) {
        out.pi = { ok: true, ...j };
      } else {
        out.pi = { ok: false, error: "bad_json" };
      }
    } catch (e) {
      out.pi = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    const piOk = !!out.pi?.ok;
    const ramFree = Number(out.pi?.ram?.free_pct ?? 100);
    const hddFree = Number(out.pi?.hdd?.free_pct ?? 100);
    const svcList = Array.isArray(out.pi?.services) ? out.pi.services : [];
    const anySvcDown = svcList.some((s: { ok?: boolean }) => !s?.ok);
    if (!piOk) out.status = "critical";
    else if (ramFree < 8 || hddFree < 5) out.status = "critical";
    else if (ramFree < 15 || hddFree < 12) out.status = "warn";
    else if (anySvcDown) out.status = "warn";
    else out.status = "ok";

    return out;
  });

  return NextResponse.json(payload);
}

