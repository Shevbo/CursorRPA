import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { adminAuthOk } from "@/lib/admin-auth";
import { tcpPortOpen } from "@/lib/tcp-port-open";
import { cachedHealth } from "@/lib/health-cache";
import { execSync } from "node:child_process";

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function applyDotenvLineForPi(key: string, valRaw: string): void {
  if (!key.startsWith("PI_")) return;
  if (process.env[key] !== undefined && String(process.env[key]).trim() !== "") return;
  let val = valRaw.trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }
  if (val === "") return;
  process.env[key] = val;
}

function mergePiKeysFromFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  try {
    const raw = readFileSync(filePath, "utf8");
    for (const line of raw.split(/\n/)) {
      let t = line.trim().replace(/\r$/, "");
      if (!t || t.startsWith("#")) continue;
      if (t.startsWith("export ")) t = t.slice(7).trim();
      const eq = t.indexOf("=");
      if (eq < 1) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1);
      applyDotenvLineForPi(key, val);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Подтягивает PI_* как у telegram-bridge: все подходящие файлы по очереди (раньше брался только первый .env,
 * из-за чего игнорировался project-envs/cursor-rpa.env с реальными PI_MONITOR_*).
 */
function mergeTelegramBridgePiEnv(): void {
  const roots = new Set<string>();
  const hr = homedir();
  roots.add(join(hr, "workspaces", "CursorRPA"));
  if (process.env.CURSOR_RPA_ROOT?.trim()) roots.add(process.env.CURSOR_RPA_ROOT.trim());
  if (process.env.CURSOR_RPA_FIXED_WORKSPACE?.trim()) roots.add(process.env.CURSOR_RPA_FIXED_WORKSPACE.trim());

  const candidates: string[] = [];
  for (const root of Array.from(roots)) {
    candidates.push(
      join(root, "services", "telegram-bridge", "project-envs", "cursor-rpa.env"),
      join(root, "services", "telegram-bridge", ".env")
    );
  }
  candidates.push(
    join(process.cwd(), "..", "services", "telegram-bridge", "project-envs", "cursor-rpa.env"),
    join(process.cwd(), "..", "services", "telegram-bridge", ".env"),
    join(process.cwd(), "services", "telegram-bridge", "project-envs", "cursor-rpa.env"),
    join(process.cwd(), "services", "telegram-bridge", ".env")
  );

  const seen = new Set<string>();
  for (const p of candidates) {
    if (seen.has(p)) continue;
    seen.add(p);
    mergePiKeysFromFile(p);
  }
}

function parseMonitorHosts(): string[] {
  const raw = (process.env.PI_MONITOR_HOSTS || "").trim();
  const fromList = raw ? raw.split(",").map((h) => h.trim()).filter(Boolean) : [];
  const one = (process.env.PI_MONITOR_HOST || "").trim();
  const merged = one && !fromList.includes(one) ? [...fromList, one] : fromList;
  return Array.from(new Set(merged));
}

async function tcpChecksFromPortalHost(
  hosts: string[],
  syslogPort: number,
  pingPort: number,
  timeoutSec: number
): Promise<{ name: string; ok: boolean }[]> {
  const timeoutMs = Math.max(100, Math.round(timeoutSec * 1000));
  const out: { name: string; ok: boolean }[] = [];
  for (const h of hosts) {
    const sOk = await tcpPortOpen(h, syslogPort, timeoutMs);
    const pOk = await tcpPortOpen(h, pingPort, timeoutMs);
    out.push({ name: `Syslog ${h}:${syslogPort}`, ok: sOk });
    out.push({ name: `PingMaster ${h}:${pingPort}`, ok: pOk });
  }
  return out;
}

/** Один вызов SSH: метрики + TCP по списку хостов (как _pi_monitor_loop в bot.py). */
function buildRemoteCombinedScript(
  hosts: string[],
  syslogPort: number,
  pingPort: number,
  tcpTimeout: number
): string {
  const hostsB64 = Buffer.from(JSON.stringify(hosts), "utf8").toString("base64");
  return [
    "import base64, json, os, socket, shutil",
    "from pathlib import Path",
    `hosts = json.loads(base64.b64decode("${hostsB64}").decode("utf-8"))`,
    `syslog_port = int(${syslogPort})`,
    `ping_port = int(${pingPort})`,
    `timeout = float(${tcpTimeout})`,
    "",
    "def mem():",
    "  total=avail=0",
    "  for line in Path('/proc/meminfo').read_text().splitlines():",
    "    if line.startswith('MemTotal:'): total=int(line.split()[1])*1024",
    "    if line.startswith('MemAvailable:'): avail=int(line.split()[1])*1024",
    "  return total, avail",
    "",
    "def disk_root():",
    "  du = shutil.disk_usage('/')",
    "  return du.total, du.free",
    "",
    "def chk(host, port):",
    "  try:",
    "    s = socket.create_connection((host, port), timeout=timeout)",
    "    s.close()",
    "    return True, 'ok'",
    "  except Exception as e:",
    "    msg = str(e)",
    "    return False, (msg[:120] if msg else 'fail')",
    "",
    "t,a=mem(); dt,df=disk_root()",
    "l1,l5,l15=os.getloadavg() if hasattr(os,'getloadavg') else (0.0,0.0,0.0)",
    "ram_free_pct=(a/t*100.0) if t else 0.0",
    "hdd_free_pct=(df/dt*100.0) if dt else 0.0",
    "out_tcp = {}",
    "for h in hosts:",
    "  s1, e1 = chk(h, syslog_port)",
    "  s2, e2 = chk(h, ping_port)",
    "  out_tcp[h] = {'syslog': [s1, e1], 'pingmaster': [s2, e2]}",
    "services = []",
    "for h in hosts:",
    "  row = out_tcp[h]",
    "  services.append({'name': 'Syslog %s:%s' % (h, syslog_port), 'ok': row['syslog'][0]})",
    "  services.append({'name': 'PingMaster %s:%s' % (h, ping_port), 'ok': row['pingmaster'][0]})",
    "print(json.dumps({",
    "  'cpu': {'load1': l1, 'load5': l5, 'load15': l15},",
    "  'ram': {'free_pct': ram_free_pct},",
    "  'hdd': {'free_pct': hdd_free_pct},",
    "  'services': services,",
    "}, ensure_ascii=False))",
  ].join("\n");
}

export async function GET(req: Request) {
  if (!adminAuthOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await cachedHealth("pi_v2", 5 * 60_000, async () => {
    mergeTelegramBridgePiEnv();

    const sshCmd = (process.env.PI_MONITOR_SSH || process.env.PI_HEALTH_SSH || "").trim();
    const syslogPort = parseInt(process.env.PI_SYSLOG_PORT || "4444", 10);
    const pingPort = parseInt(process.env.PI_PINGMASTER_PORT || "4555", 10);
    const tcpTimeout = parseFloat(process.env.PI_MONITOR_TCP_TIMEOUT || "3");
    const sshTimeoutMs = Math.max(5000, (parseInt(process.env.PI_MONITOR_SSH_TIMEOUT_SEC || "12", 10) || 12) * 1000);

    let hosts = parseMonitorHosts();
    if (hosts.length === 0 && sshCmd) hosts = ["127.0.0.1"];

    const out: any = {
      ok: true,
      status: "ok" as const,
      pi: {
        ok: false,
        metricsOk: false,
        services: [] as { name: string; ok: boolean }[],
        source: "none" as string,
      },
      at: new Date().toISOString(),
      intervalSec: 300,
    };

    if (!sshCmd && hosts.length === 0) {
      out.pi = {
        ok: false,
        metricsOk: false,
        error: "Задайте PI_MONITOR_HOST или PI_MONITOR_SSH (как у telegram-bridge).",
        services: [
          {
            name: "Pi: задайте PI_MONITOR_HOST(S) или PI_MONITOR_SSH в .env портала / services/telegram-bridge/.env",
            ok: false,
          },
        ],
        source: "unconfigured",
      };
      out.status = "critical";
      return out;
    }

    let services: { name: string; ok: boolean }[] = [];

    if (sshCmd && hosts.length > 0) {
      try {
        const py = buildRemoteCombinedScript(hosts, syslogPort, pingPort, tcpTimeout);
        const remote = `python3 - <<'PY'\n${py}\nPY`;
        const cmd = `${sshCmd} ${JSON.stringify(remote)}`;
        const raw = execSync(cmd, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: sshTimeoutMs,
          env: { ...process.env, HOME: process.env.HOME || homedir() },
        }).trim();
        const j = safeJsonParse(raw);
        if (j && typeof j === "object") {
          services = Array.isArray(j.services) ? j.services : [];
          out.pi = {
            ok: true,
            metricsOk: true,
            cpu: j.cpu,
            ram: j.ram,
            hdd: j.hdd,
            services,
            source: "pi_ssh",
          };
        } else {
          throw new Error("bad_json");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        out.pi = {
          ok: false,
          metricsOk: false,
          error: msg.slice(0, 400),
          services: [],
          source: "ssh_failed",
        };
        if (hosts.length > 0) {
          services = await tcpChecksFromPortalHost(hosts, syslogPort, pingPort, tcpTimeout);
          out.pi.services = services;
          out.pi.source = "portal_host_fallback";
        }
      }
    } else if (!sshCmd && hosts.length > 0) {
      services = await tcpChecksFromPortalHost(hosts, syslogPort, pingPort, tcpTimeout);
      out.pi = {
        ok: false,
        metricsOk: false,
        skippedMetrics: true,
        services,
        source: "portal_host",
      };
    }

    const metricsOk = !!out.pi.metricsOk;
    const ramFree = Number(out.pi?.ram?.free_pct ?? 100);
    const hddFree = Number(out.pi?.hdd?.free_pct ?? 100);
    const svcList = Array.isArray(out.pi?.services) ? out.pi.services : [];
    const anySvcDown = svcList.some((s: { ok?: boolean }) => !s?.ok);

    if (!metricsOk && svcList.length === 0) out.status = "critical";
    else if (metricsOk && (ramFree < 8 || hddFree < 5)) out.status = "critical";
    else if (metricsOk && (ramFree < 15 || hddFree < 12)) out.status = "warn";
    else if (anySvcDown) out.status = "warn";
    else out.status = "ok";

    return out;
  });

  return NextResponse.json(payload);
}
