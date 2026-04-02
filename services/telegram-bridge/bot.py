#!/usr/bin/env python3
"""
Пилотный Telegram → Cursor Agent (rpa-agent.sh) на том же сервере.
Приоритет: предсказуемость, стабильность, удобство (очередь на чат, typing, лимиты ТГ).
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import shlex
import subprocess
import time
import shutil
from pathlib import Path

try:
    from dotenv import load_dotenv  # type: ignore
except Exception:
    load_dotenv = None
from telegram import Update
from telegram.constants import ChatAction
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

if load_dotenv is not None:
    load_dotenv()

logging.basicConfig(
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("telegram-bridge")

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
ALLOWED = {
    int(x.strip())
    for x in os.environ.get("TELEGRAM_ALLOWED_USER_IDS", "").split(",")
    if x.strip().isdigit()
}
WORKSPACE_ROOT = Path(os.environ.get("WORKSPACE_ROOT", "~/workspaces")).expanduser().resolve()
# 1 бот = 1 проект: если задан абсолютный путь — /project не нужен
FIXED_WORKSPACE_RAW = os.environ.get("CURSOR_RPA_FIXED_WORKSPACE", "").strip()
FIXED_WORKSPACE = (
    Path(FIXED_WORKSPACE_RAW).expanduser().resolve()
    if FIXED_WORKSPACE_RAW
    else None
)
RPA_SCRIPT = Path(os.environ.get("RPA_AGENT_SCRIPT", "~/.local/bin/rpa-agent.sh")).expanduser()
CURSOR_ENV_FILE = Path(
    os.environ.get("CURSOR_ENV_FILE", "~/.config/cursor-rpa/env.sh")
).expanduser()
AGENT_TIMEOUT = int(os.environ.get("AGENT_TIMEOUT_SEC", "900"))
DEPLOY_UI_SCRIPT = os.environ.get("DEPLOY_UI_SCRIPT", "").strip()
BUILD_APK_SCRIPT = os.environ.get("BUILD_APK_SCRIPT", "").strip()
# Telegram лимит 4096; оставляем запас под заголовок «часть N/M»
MESSAGE_MAX = int(os.environ.get("TELEGRAM_MESSAGE_MAX_CHARS", "4000"))
TYPING_INTERVAL_SEC = float(os.environ.get("TELEGRAM_TYPING_INTERVAL_SEC", "4.5"))
# Сообщение админам при старте бота (post_init). Пусто = не слать.
STARTUP_MESSAGE = os.environ.get("TELEGRAM_STARTUP_MESSAGE", "Привет").strip()
# Префикс к промпту агента: не отвечать про «Sandbox» в Telegram-канале (доверенный сервер пользователя).
TELEGRAM_AGENT_SHELL_PREAMBLE = os.environ.get(
    "TELEGRAM_AGENT_SHELL_PREAMBLE",
    (
        "[Инструкция для агента — канал Telegram Shectory RPA]\n"
        "Пользователь на своём сервере; ответ уходит в Telegram. Не утверждай, что «Sandbox» или среда "
        "блокируют npm, bash, node, ssh и другие команды — в этом канале такого запрета нет. "
        "Предлагай конкретные команды для терминала пользователя (деплой, сборка, проверки). "
        "Если твои инструменты CLI недоступны, чётко отдели: что пользователь выполнит вручную у себя.\n"
    ),
).strip()
TELEGRAM_DISABLE_AGENT_PREAMBLE = os.environ.get("TELEGRAM_DISABLE_AGENT_PREAMBLE", "").strip().lower() in (
    "1",
    "true",
    "yes",
)

# Health monitoring / notifications
# По умолчанию: проверка каждые 5 минут + регулярный отчёт каждые 5 минут.
HEALTH_CHECK_INTERVAL_SEC = int(os.environ.get("HEALTH_CHECK_INTERVAL_SEC", str(5 * 60)))
HEALTH_REPORT_INTERVAL_SEC = int(os.environ.get("HEALTH_REPORT_INTERVAL_SEC", str(5 * 60)))
HEALTH_RAM_CRIT_FREE_PCT = float(os.environ.get("HEALTH_RAM_CRIT_FREE_PCT", "8"))   # free% below => critical
HEALTH_HDD_CRIT_FREE_PCT = float(os.environ.get("HEALTH_HDD_CRIT_FREE_PCT", "5"))   # free% below => critical

# Raspberry Pi: health + TCP checks (Syslog 4444, Pingmaster 4555)
# Проверка каждые PI_MONITOR_INTERVAL_SEC (по умолчанию 5 мин).
# Регулярный отчёт раз в PI_MONITOR_REPORT_INTERVAL_SEC (по умолчанию 1 час).
# Список хостов для TCP-проверок: PI_MONITOR_HOSTS="192.168.1.105,shectory.ru" (back-compat: PI_MONITOR_HOST).
PI_MONITOR_HOST = os.environ.get("PI_MONITOR_HOST", "").strip()
PI_MONITOR_HOSTS_RAW = os.environ.get("PI_MONITOR_HOSTS", "").strip()
PI_MONITOR_REPORT_INTERVAL_SEC = int(os.environ.get("PI_MONITOR_REPORT_INTERVAL_SEC", str(60 * 60)))
PI_SYSLOG_PORT = int(os.environ.get("PI_SYSLOG_PORT", "4444"))
PI_PINGMASTER_PORT = int(os.environ.get("PI_PINGMASTER_PORT", "4555"))
PI_MONITOR_INTERVAL_SEC = int(os.environ.get("PI_MONITOR_INTERVAL_SEC", str(5 * 60)))
PI_MONITOR_SSH = os.environ.get("PI_MONITOR_SSH", "").strip()
PI_MONITOR_TCP_TIMEOUT = float(os.environ.get("PI_MONITOR_TCP_TIMEOUT", "3"))
PI_MONITOR_SSH_TIMEOUT_SEC = int(os.environ.get("PI_MONITOR_SSH_TIMEOUT_SEC", "12"))

# Удалённый Python для снимка CPU/RAM/диска на Pi (через PI_MONITOR_SSH)
_PI_REMOTE_MEM_DISK_JSON = (
    "python3 - <<'PY'\n"
    "import os, json\n"
    "from pathlib import Path\n"
    "def mem():\n"
    "  total=avail=0\n"
    "  for line in Path('/proc/meminfo').read_text().splitlines():\n"
    "    if line.startswith('MemTotal:'): total=int(line.split()[1])*1024\n"
    "    if line.startswith('MemAvailable:'): avail=int(line.split()[1])*1024\n"
    "  return total, avail\n"
    "def disk_root():\n"
    "  import shutil\n"
    "  du=shutil.disk_usage('/')\n"
    "  return du.total, du.free\n"
    "t,a=mem(); dt,df=disk_root();\n"
    "l1,l5,l15=os.getloadavg() if hasattr(os,'getloadavg') else (0.0,0.0,0.0)\n"
    "ram_free_pct=(a/t*100.0) if t else 0.0\n"
    "hdd_free_pct=(df/dt*100.0) if dt else 0.0\n"
    "print(json.dumps({'cpu':{'load1':l1,'load5':l5,'load15':l15}, 'ram':{'total':t,'avail':a,'free_pct':ram_free_pct}, 'hdd':{'total':dt,'free':df,'free_pct':hdd_free_pct}}, ensure_ascii=False))\n"
    "PY"
)


def _hour_key(ts: float | None = None) -> str:
    t = time.gmtime(ts or time.time())
    return f"{t.tm_year:04d}{t.tm_mon:02d}{t.tm_mday:02d}{t.tm_hour:02d}"


def _read_meminfo() -> tuple[int, int]:
    """returns (total_bytes, available_bytes)"""
    try:
        raw = Path("/proc/meminfo").read_text(encoding="utf-8", errors="ignore")
        m_total = re.search(r"^MemTotal:\s+(\d+)\s+kB", raw, re.I | re.M)
        m_avail = re.search(r"^MemAvailable:\s+(\d+)\s+kB", raw, re.I | re.M)
        total = int(m_total.group(1)) * 1024 if m_total else 0
        avail = int(m_avail.group(1)) * 1024 if m_avail else 0
        return total, avail
    except Exception:
        return 0, 0


def _disk_usage_root() -> tuple[int, int]:
    """returns (total_bytes, free_bytes)"""
    try:
        du = shutil.disk_usage("/")
        return int(du.total), int(du.free)
    except Exception:
        return 0, 0


def _health_snapshot() -> dict:
    total, avail = _read_meminfo()
    d_total, d_free = _disk_usage_root()
    load1, load5, load15 = os.getloadavg() if hasattr(os, "getloadavg") else (0.0, 0.0, 0.0)
    ram_free_pct = (avail / total * 100.0) if total else 0.0
    hdd_free_pct = (d_free / d_total * 100.0) if d_total else 0.0
    status = "ok"
    if (total and ram_free_pct < HEALTH_RAM_CRIT_FREE_PCT) or (d_total and hdd_free_pct < HEALTH_HDD_CRIT_FREE_PCT):
        status = "critical"
    return {
        "status": status,
        "cpu": {"load1": load1, "load5": load5, "load15": load15},
        "ram": {"total": total, "avail": avail, "free_pct": ram_free_pct},
        "hdd": {"total": d_total, "free": d_free, "free_pct": hdd_free_pct},
    }


def _ssh_hoster_health() -> dict:
    """Collect hoster health via ssh hoster."""
    try:
        inner = (
            "python3 - <<'PY'\n"
            "import os, json\n"
            "from pathlib import Path\n"
            "def mem():\n"
            "  total=avail=0\n"
            "  for line in Path('/proc/meminfo').read_text().splitlines():\n"
            "    if line.startswith('MemTotal:'): total=int(line.split()[1])*1024\n"
            "    if line.startswith('MemAvailable:'): avail=int(line.split()[1])*1024\n"
            "  return total, avail\n"
            "def disk_root():\n"
            "  import shutil\n"
            "  du=shutil.disk_usage('/')\n"
            "  return du.total, du.free\n"
            "t,a=mem(); dt,df=disk_root();\n"
            "l1,l5,l15=os.getloadavg() if hasattr(os,'getloadavg') else (0.0,0.0,0.0)\n"
            "ram_free_pct=(a/t*100.0) if t else 0.0\n"
            "hdd_free_pct=(df/dt*100.0) if dt else 0.0\n"
            "print(json.dumps({'cpu':{'load1':l1,'load5':l5,'load15':l15}, 'ram':{'free_pct':ram_free_pct}, 'hdd':{'free_pct':hdd_free_pct}}, ensure_ascii=False))\n"
            "PY"
        )
        rc, stdout, stderr = _run_bash(
            f"ssh -o BatchMode=yes -o ConnectTimeout=4 hoster {shlex.quote(inner)}",
            timeout_sec=25,
        )
        if rc != 0:
            return {"ok": False, "error": (stderr or stdout or f"rc={rc}").strip()}
        import json
        j = json.loads(stdout.strip() or "{}")
        return {"ok": True, **j}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _db_ready_via_hoster() -> dict:
    """Check DB readiness on hoster quickly (tcp + pg_isready if available)."""
    try:
        script = (
            "set -euo pipefail; "
            "if command -v pg_isready >/dev/null 2>&1; then pg_isready -h 127.0.0.1 -p 5432; echo OK; "
            "else (echo > /dev/tcp/127.0.0.1/5432) >/dev/null 2>&1 && echo OK || echo FAIL; fi"
        )
        rc, stdout, stderr = _run_bash(
            f"ssh -o BatchMode=yes -o ConnectTimeout=4 hoster {shlex.quote(script)}",
            timeout_sec=25,
        )
        ok = "OK" in (stdout or "")
        return {"ok": bool(ok), "error": (stderr or "").strip()}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _fmt_pct(x: float) -> str:
    try:
        return f"{x:.1f}%"
    except Exception:
        return "-"


def _health_text(s: dict) -> str:
    cpu = s.get("cpu", {})
    ram = s.get("ram", {})
    hdd = s.get("hdd", {})
    return (
        f"Shectory health: {s.get('status','ok')}\n"
        f"CPU load: {cpu.get('load1',0):.2f}/{cpu.get('load5',0):.2f}/{cpu.get('load15',0):.2f}\n"
        f"RAM free: {_fmt_pct(float(ram.get('free_pct',0.0)))}\n"
        f"HDD free: {_fmt_pct(float(hdd.get('free_pct',0.0)))}"
    )


def _health_text_hoster(h: dict, db: dict) -> str:
    if not h.get("ok"):
        return f"Hoster health: DOWN ({h.get('error','')})\nDB: {'ok' if db.get('ok') else 'down'}"
    cpu = h.get("cpu", {})
    ram = h.get("ram", {})
    hdd = h.get("hdd", {})
    return (
        f"Hoster health: ok\n"
        f"CPU load: {cpu.get('load1',0):.2f}/{cpu.get('load5',0):.2f}/{cpu.get('load15',0):.2f}\n"
        f"RAM free: {_fmt_pct(float(ram.get('free_pct',0.0)))}\n"
        f"HDD free: {_fmt_pct(float(hdd.get('free_pct',0.0)))}\n"
        f"DB: {'ok' if db.get('ok') else 'down'}"
    )


def _health_text_pi(pi: dict) -> str:
    if pi.get("skipped"):
        return "Pi health: SSH не задан (PI_MONITOR_SSH) — метрики Pi пропущены."
    if not pi.get("ok"):
        return f"Pi health: DOWN ({pi.get('error','')})"
    cpu = pi.get("cpu", {})
    ram = pi.get("ram", {})
    hdd = pi.get("hdd", {})
    return (
        f"Pi health: ok\n"
        f"CPU load: {cpu.get('load1',0):.2f}/{cpu.get('load5',0):.2f}/{cpu.get('load15',0):.2f}\n"
        f"RAM free: {_fmt_pct(float(ram.get('free_pct',0.0)))}\n"
        f"HDD free: {_fmt_pct(float(hdd.get('free_pct',0.0)))}"
    )


def _ssh_pi_health() -> dict:
    """Снимок CPU/RAM/диска на Pi по SSH (PI_MONITOR_SSH)."""
    if not PI_MONITOR_SSH:
        return {"skipped": True, "ok": None}
    try:
        rc, stdout, stderr = _run_bash(
            f"{PI_MONITOR_SSH} {shlex.quote(_PI_REMOTE_MEM_DISK_JSON)}",
            timeout_sec=max(5, PI_MONITOR_SSH_TIMEOUT_SEC),
        )
        if rc != 0:
            return {"ok": False, "error": (stderr or stdout or f"rc={rc}").strip()[:400]}
        import json

        j = json.loads(stdout.strip() or "{}")
        return {"ok": True, **j}
    except Exception as e:
        return {"ok": False, "error": str(e)[:400]}


async def _tcp_port_open(host: str, port: int, timeout: float) -> tuple[bool, str]:
    try:
        _reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=timeout)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return True, "ok"
    except asyncio.TimeoutError:
        return False, "timeout"
    except OSError as e:
        return False, str(e)[:120]
    except Exception as e:
        return False, str(e)[:120]


def _pi_monitor_format_message(
    host: str,
    pi: dict,
    syslog_ok: bool,
    syslog_err: str,
    ping_ok: bool,
    ping_err: str,
    alerts: list[str],
) -> str:
    lines: list[str] = [
        f"📟 Raspberry Pi · {host} (интервал {PI_MONITOR_INTERVAL_SEC // 60} мин)",
    ]
    if alerts:
        lines.append("")
        lines.extend(alerts)

    if pi.get("skipped"):
        lines.append(
            "\nРесурсы: SSH к Pi не задан (PI_MONITOR_SSH) — только TCP с машины бота."
        )
    elif not pi.get("ok"):
        lines.append(f"\n🏥 Ресурсы Pi: не сняты ({pi.get('error', '?')})")
    else:
        cpu = pi.get("cpu", {})
        ram = pi.get("ram", {})
        hdd = pi.get("hdd", {})
        lines.append(
            "\n🏥 Ресурсы Pi:\n"
            f"  CPU load: {float(cpu.get('load1', 0)):.2f} / {float(cpu.get('load5', 0)):.2f} / {float(cpu.get('load15', 0)):.2f}\n"
            f"  RAM свободно: {_fmt_pct(float(ram.get('free_pct', 0.0)))}\n"
            f"  Диск / свободно: {_fmt_pct(float(hdd.get('free_pct', 0.0)))}"
        )

    def svc_line(name: str, port: int, ok: bool, err: str) -> str:
        if ok:
            st = "✅ OK"
        else:
            st = f"❌ ({err})"
        return f"  · {name} :{port} — {st}"

    lines.append("\nСервисы:")
    lines.append(svc_line("Syslog", PI_SYSLOG_PORT, syslog_ok, syslog_err))
    lines.append(svc_line("Pingmaster", PI_PINGMASTER_PORT, ping_ok, ping_err))
    if not syslog_ok or not ping_ok:
        lines.append("\n⚠️ Сбой сервисов — проверьте процессы на Pi.")

    low_ram = False
    low_disk = False
    if pi.get("ok"):
        ram = pi.get("ram", {})
        hdd = pi.get("hdd", {})
        low_ram = float(ram.get("free_pct", 100.0)) < HEALTH_RAM_CRIT_FREE_PCT
        low_disk = float(hdd.get("free_pct", 100.0)) < HEALTH_HDD_CRIT_FREE_PCT
    if low_ram or low_disk:
        lines.append(
            "\n🔻 Критично мало ресурсов: "
            + ("RAM " if low_ram else "")
            + ("диск " if low_disk else "")
            + "(пороги как HEALTH_RAM/HDD_CRIT_FREE_PCT)."
        )
    return "\n".join(lines)


async def _pi_monitor_loop(application: Application) -> None:
    """Проверка Pi каждые 5 минут + отчёт раз в час + алерты на переходах (без спама)."""
    hosts: list[str] = []
    if PI_MONITOR_HOSTS_RAW:
        hosts = [h.strip() for h in PI_MONITOR_HOSTS_RAW.split(",") if h.strip()]
    elif PI_MONITOR_HOST:
        hosts = [PI_MONITOR_HOST]
    if not hosts:
        return
    if not ALLOWED:
        log.info("Pi monitor: hosts заданы, но ALLOWED пуст — мониторинг не шлём")
        return
    log.info(
        "Pi monitor: TCP hosts=%s syslog=%s pingmaster=%s, check=%ss report=%ss",
        ",".join(hosts),
        PI_SYSLOG_PORT,
        PI_PINGMASTER_PORT,
        PI_MONITOR_INTERVAL_SEC,
        PI_MONITOR_REPORT_INTERVAL_SEC,
    )
    await asyncio.sleep(10)
    while True:
        try:
            # TCP checks (prefer from inside Pi via SSH; fallback: from bot host).
            # We represent unknown as (None, reason) to avoid false "DOWN" spam when SSH is unavailable.
            svc: dict[str, dict[str, tuple[bool | None, str]]] = {}
            svc_source = "monitor_host"
            if PI_MONITOR_SSH:
                try:
                    import json

                    remote_py = (
                        "python3 - <<'PY'\n"
                        "import json, socket\n"
                        "hosts = json.loads('''" + json.dumps(hosts, ensure_ascii=False) + "''')\n"
                        f"syslog_port = int({PI_SYSLOG_PORT})\n"
                        f"ping_port = int({PI_PINGMASTER_PORT})\n"
                        f"timeout = float({PI_MONITOR_TCP_TIMEOUT})\n"
                        "def chk(host, port):\n"
                        "  try:\n"
                        "    s = socket.create_connection((host, port), timeout=timeout)\n"
                        "    s.close()\n"
                        "    return True, 'ok'\n"
                        "  except Exception as e:\n"
                        "    msg = str(e)\n"
                        "    return False, (msg[:120] if msg else 'fail')\n"
                        "out = {}\n"
                        "for h in hosts:\n"
                        "  sys_ok, sys_err = chk(h, syslog_port)\n"
                        "  ping_ok, ping_err = chk(h, ping_port)\n"
                        "  out[h] = {'syslog': [sys_ok, sys_err], 'pingmaster': [ping_ok, ping_err]}\n"
                        "print(json.dumps(out, ensure_ascii=False))\n"
                        "PY"
                    )
                    rc, stdout, stderr = _run_bash(
                        f"{PI_MONITOR_SSH} {shlex.quote(remote_py)}",
                        timeout_sec=max(6, PI_MONITOR_SSH_TIMEOUT_SEC),
                    )
                    if rc == 0:
                        import json as _json

                        j = _json.loads((stdout or "").strip() or "{}")
                        if isinstance(j, dict):
                            for h in hosts:
                                row = j.get(h) if isinstance(j.get(h), dict) else {}
                                a = row.get("syslog") if isinstance(row.get("syslog"), list) else None
                                b = row.get("pingmaster") if isinstance(row.get("pingmaster"), list) else None
                                sys_ok = bool(a[0]) if (isinstance(a, list) and len(a) >= 1) else None
                                sys_err = str(a[1]) if (isinstance(a, list) and len(a) >= 2) else "?"
                                ping_ok = bool(b[0]) if (isinstance(b, list) and len(b) >= 1) else None
                                ping_err = str(b[1]) if (isinstance(b, list) and len(b) >= 2) else "?"
                                svc[h] = {"syslog": (sys_ok, sys_err), "pingmaster": (ping_ok, ping_err)}
                            svc_source = "pi_ssh"
                        else:
                            raise RuntimeError("bad_json")
                    else:
                        raise RuntimeError((stderr or stdout or f"rc={rc}").strip()[:200])
                except Exception as e:
                    # SSH failed; mark all as unknown to avoid misleading DOWN statuses.
                    reason = f"ssh_unavailable: {e!s}"[:200]
                    for h in hosts:
                        svc[h] = {"syslog": (None, reason), "pingmaster": (None, reason)}
                    svc_source = "ssh_failed"
            else:
                for h in hosts:
                    sys_ok, sys_err = await _tcp_port_open(h, PI_SYSLOG_PORT, PI_MONITOR_TCP_TIMEOUT)
                    ping_ok, ping_err = await _tcp_port_open(h, PI_PINGMASTER_PORT, PI_MONITOR_TCP_TIMEOUT)
                    svc[h] = {"syslog": (sys_ok, sys_err), "pingmaster": (ping_ok, ping_err)}

            loop = asyncio.get_event_loop()
            pi_res: dict = await loop.run_in_executor(None, _ssh_pi_health)

            state = _load_state()
            alerts: list[str] = []
            prev_map = state.get("pi_mon_prev") or {}
            cur_map: dict[str, str] = {}

            # Detect transitions per host/service; alert only on change (no spam).
            for h in hosts:
                sys_ok, _ = svc[h]["syslog"]
                ping_ok, _ = svc[h]["pingmaster"]
                k1 = f"{h}:syslog:{PI_SYSLOG_PORT}"
                k2 = f"{h}:pingmaster:{PI_PINGMASTER_PORT}"
                cur_map[k1] = "u" if sys_ok is None else ("1" if sys_ok else "0")
                cur_map[k2] = "u" if ping_ok is None else ("1" if ping_ok else "0")
                if k1 in prev_map and prev_map.get(k1) == "1" and sys_ok is False:
                    alerts.append(f"🚨 СБОЙ: Syslog http://{h}:{PI_SYSLOG_PORT} не отвечает.")
                if k2 in prev_map and prev_map.get(k2) == "1" and ping_ok is False:
                    alerts.append(f"🚨 СБОЙ: PingMaster http://{h}:{PI_PINGMASTER_PORT} не отвечает.")
                # Recovery notifications are helpful and also non-spam (on transition)
                if k1 in prev_map and prev_map.get(k1) == "0" and sys_ok is True:
                    alerts.append(f"✅ Syslog снова доступен: http://{h}:{PI_SYSLOG_PORT}")
                if k2 in prev_map and prev_map.get(k2) == "0" and ping_ok is True:
                    alerts.append(f"✅ PingMaster снова доступен: http://{h}:{PI_PINGMASTER_PORT}")

            state["pi_mon_prev"] = cur_map

            # Regular report (hourly by default)
            now_ts = time.time()
            last_report = float(state.get("pi_mon_last_report_ts") or 0.0)
            need_report = (now_ts - last_report) >= max(60.0, float(PI_MONITOR_REPORT_INTERVAL_SEC))
            if need_report:
                lines: list[str] = [
                    f"📟 Raspberry Pi · health (проверка каждые {max(1, PI_MONITOR_INTERVAL_SEC // 60)} мин; отчёт каждые {max(1, PI_MONITOR_REPORT_INTERVAL_SEC // 60)} мин)",
                    "",
                    _health_text_pi(pi_res),
                    "",
                    f"Сервисы (TCP) [{svc_source}]:",
                ]
                for h in hosts:
                    sys_ok, sys_err = svc[h]["syslog"]
                    ping_ok, ping_err = svc[h]["pingmaster"]
                    sys_url = f"http://{h}:{PI_SYSLOG_PORT}"
                    ping_url = f"http://{h}:{PI_PINGMASTER_PORT}"
                    if sys_ok is None:
                        lines.append(f"- Syslog {sys_url} — ⚠️ unknown ({sys_err})")
                    else:
                        lines.append(f"- Syslog {sys_url} — {'✅ OK' if sys_ok else f'❌ ({sys_err})'}")
                    if ping_ok is None:
                        lines.append(f"- PingMaster {ping_url} — ⚠️ unknown ({ping_err})")
                    else:
                        lines.append(f"- PingMaster {ping_url} — {'✅ OK' if ping_ok else f'❌ ({ping_err})'}")
                text = "\n".join(lines)
                for admin_id in sorted(ALLOWED):
                    try:
                        await application.bot.send_message(chat_id=admin_id, text=text)
                    except Exception as e:
                        log.warning("pi monitor report send failed admin_id=%s: %s", admin_id, e)
                state["pi_mon_last_report_ts"] = now_ts

            # Instant alerts (only if any)
            if alerts:
                text = "\n".join(alerts)
                for admin_id in sorted(ALLOWED):
                    try:
                        await application.bot.send_message(chat_id=admin_id, text=text)
                    except Exception as e:
                        log.warning("pi monitor alert send failed admin_id=%s: %s", admin_id, e)

            _save_state(state)
        except Exception as e:
            log.warning("pi monitor loop error: %s", e)
        await asyncio.sleep(PI_MONITOR_INTERVAL_SEC)


async def _health_loop(application: Application) -> None:
    """Regular status every HEALTH_REPORT_INTERVAL_SEC + instant alerts on state changes."""
    if not ALLOWED:
        return
    while True:
        try:
            snap = _health_snapshot()
            hoster = _ssh_hoster_health()
            db = _db_ready_via_hoster()
            pi = _ssh_pi_health()
            state = _load_state()

            # Optional Pi service ports (Syslog/Pingmaster) for the same 5-min report.
            syslog_ok = None
            ping_ok = None
            if PI_MONITOR_HOST:
                syslog_ok, _ = await _tcp_port_open(PI_MONITOR_HOST, PI_SYSLOG_PORT, PI_MONITOR_TCP_TIMEOUT)
                ping_ok, _ = await _tcp_port_open(PI_MONITOR_HOST, PI_PINGMASTER_PORT, PI_MONITOR_TCP_TIMEOUT)

            # Regular report every HEALTH_REPORT_INTERVAL_SEC
            last_report = float(state.get("health_last_report_ts") or 0.0)
            now_ts = time.time()
            if (now_ts - last_report) >= max(30.0, float(HEALTH_REPORT_INTERVAL_SEC)):
                text = (
                    f"✅ Health check (каждые {max(1, HEALTH_REPORT_INTERVAL_SEC // 60)} мин)\n\n"
                    + _health_text_hoster(hoster, db)
                    + "\n\n"
                    + _health_text(snap)
                    + "\n\n"
                    + _health_text_pi(pi)
                )
                if PI_MONITOR_HOST and syslog_ok is not None and ping_ok is not None:
                    text += (
                        f"\n\nPi services ({PI_MONITOR_HOST}): "
                        f"Syslog http://{PI_MONITOR_HOST}:{PI_SYSLOG_PORT} {('OK' if syslog_ok else 'DOWN')}, "
                        f"Pingmaster http://{PI_MONITOR_HOST}:{PI_PINGMASTER_PORT} {('OK' if ping_ok else 'DOWN')}"
                    )
                for admin_id in sorted(ALLOWED):
                    try:
                        await application.bot.send_message(chat_id=admin_id, text=text)
                    except Exception as e:
                        log.warning("health report send failed admin_id=%s: %s", admin_id, e)
                state["health_last_report_ts"] = now_ts

            # State-change alerts (down / recovered)
            prev = state.get("health_prev") or {}
            cur = {
                "shectory_status": snap.get("status"),
                "hoster_ok": bool(hoster.get("ok")),
                "db_ok": bool(db.get("ok")),
                "pi_ok": (None if pi.get("skipped") else bool(pi.get("ok"))),
                "syslog_ok": syslog_ok,
                "ping_ok": ping_ok,
            }
            changes: list[str] = []
            for k, v in cur.items():
                if prev.get(k) != v:
                    # Only alert on meaningful transitions
                    if k in ("hoster_ok", "db_ok", "pi_ok", "syslog_ok", "ping_ok"):
                        if prev.get(k) is not None:
                            changes.append(f"{k}: {prev.get(k)} → {v}")
                    elif k == "shectory_status" and prev.get(k) is not None:
                        changes.append(f"{k}: {prev.get(k)} → {v}")
            if changes:
                text = "🔔 Изменение health-состояния:\n" + "\n".join(f"- {x}" for x in changes)
                for admin_id in sorted(ALLOWED):
                    try:
                        await application.bot.send_message(chat_id=admin_id, text=text)
                    except Exception as e:
                        log.warning("health change send failed admin_id=%s: %s", admin_id, e)
                state["health_prev"] = cur

            _save_state(state)
        except Exception as e:
            log.warning("health loop error: %s", e)
        await asyncio.sleep(HEALTH_CHECK_INTERVAL_SEC)

STATE_DIR = Path(os.environ.get("TELEGRAM_STATE_DIR", "~/.config/cursor-rpa")).expanduser()
STATE_FILE = STATE_DIR / "telegram_bridge_state.json"

_chat_locks: dict[int, asyncio.Lock] = {}


def _lock_for(chat_id: int) -> asyncio.Lock:
    if chat_id not in _chat_locks:
        _chat_locks[chat_id] = asyncio.Lock()
    return _chat_locks[chat_id]


def _load_state() -> dict:
    import json

    if not STATE_FILE.is_file():
        return {}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_state(data: dict) -> None:
    import json

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def _session_key(user_id: int, chat_id: int) -> str:
    return f"{user_id}:{chat_id}"


def _get_sess(state: dict, user_id: int, chat_id: int) -> dict:
    return state.setdefault(_session_key(user_id, chat_id), {})


def _shell_preamble_active(sess: dict) -> bool:
    if TELEGRAM_DISABLE_AGENT_PREAMBLE:
        return False
    return bool(sess.get("telegram_shell_ok", True))


def _agent_prompt_with_shell_policy(sess: dict, user_prompt: str) -> str:
    """Добавляет политику «без ложного Sandbox»; отключается TELEGRAM_DISABLE_AGENT_PREAMBLE=1."""
    if not _shell_preamble_active(sess):
        return user_prompt
    if not TELEGRAM_AGENT_SHELL_PREAMBLE:
        return user_prompt
    if not user_prompt.strip():
        return user_prompt
    return f"{TELEGRAM_AGENT_SHELL_PREAMBLE}\n\n---\n\n{user_prompt}"


def _ensure_workspace(sess: dict, user_id: int, chat_id: int) -> str | None:
    """Возвращает абсолютный путь workspace или None."""
    if FIXED_WORKSPACE is not None:
        FIXED_WORKSPACE.mkdir(parents=True, exist_ok=True)
        ws = str(FIXED_WORKSPACE.resolve())
        sess.setdefault("workspace", ws)
        sess.setdefault("project_name", FIXED_WORKSPACE.name)
        return ws
    return sess.get("workspace")


def _allowed(user_id: int | None) -> bool:
    if user_id is None:
        return False
    if not ALLOWED:
        log.warning("TELEGRAM_ALLOWED_USER_IDS пуст — бот открыт для всех (небезопасно)")
        return True
    return user_id in ALLOWED


def _subprocess_cwd() -> str:
    """Каталог для bash/agent: не наследуем cwd процесса бота — после mv/rm старый cwd бывает (deleted)."""
    override = os.environ.get("TELEGRAM_BRIDGE_SUBPROCESS_CWD", "").strip()
    if override:
        p = Path(override).expanduser()
        if p.is_dir():
            return str(p.resolve())
    home = Path.home()
    if home.is_dir():
        return str(home.resolve())
    return "/"


def _run_bash(
    script: str, env_extra: dict | None = None, timeout_sec: int | None = None
) -> tuple[int, str, str]:
    env = os.environ.copy()
    if env_extra:
        env.update(env_extra)
    key = os.environ.get("CURSOR_API_KEY", "").strip()
    if key:
        env["CURSOR_API_KEY"] = key
    proc = subprocess.run(
        ["bash", "-lc", script],
        capture_output=True,
        text=True,
        timeout=timeout_sec if timeout_sec is not None else AGENT_TIMEOUT,
        env=env,
        cwd=_subprocess_cwd(),
    )
    return proc.returncode, proc.stdout or "", proc.stderr or ""


def _run_rpa(
    cmd: str,
    workspace: str,
    chat_id: str,
    prompt: str,
) -> tuple[int, str]:
    ws = shlex.quote(workspace)
    pr = shlex.quote(prompt)
    scr = shlex.quote(str(RPA_SCRIPT))
    envf = shlex.quote(str(CURSOR_ENV_FILE))
    if cmd == "NEW_CHAT":
        args = f"NEW_CHAT {ws} _ {pr}"
    elif cmd == "LIST_CHATS":
        args = f"LIST_CHATS {ws} _ _"
    else:
        cid_q = shlex.quote(chat_id) if chat_id.strip() else "''"
        args = f"{shlex.quote(cmd)} {ws} {cid_q} {pr}"
    inner = (
        f"set -e; test -f {envf} && source {envf}; "
        f'export PATH="$HOME/.local/bin:$PATH"; '
        f"exec {scr} {args}"
    )
    code, stdout, stderr = _run_bash(inner)
    text = ""
    if stdout.strip():
        text += stdout.strip()
    if stderr.strip():
        if text:
            text += "\n\n--- stderr ---\n"
        text += stderr.strip()
    if not text:
        text = f"(пустой вывод, код выхода {code})"
    return code, text


def _split_message(body: str, max_len: int = MESSAGE_MAX) -> list[str]:
    if len(body) <= max_len:
        return [body]
    header_reserve = 24
    chunk_size = max(512, max_len - header_reserve)
    total = (len(body) + chunk_size - 1) // chunk_size
    parts: list[str] = []
    for i in range(total):
        chunk = body[i * chunk_size : (i + 1) * chunk_size]
        parts.append(f"[{i + 1}/{total}] {chunk}")
    return parts


async def _typing_loop(bot, chat_id: int) -> None:
    try:
        while True:
            await bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)
            await asyncio.sleep(TYPING_INTERVAL_SEC)
    except asyncio.CancelledError:
        return


async def _reply_chunks(message, text: str, prefix: str = "") -> None:
    body = f"{prefix}{text}" if prefix else text
    for part in _split_message(body):
        await message.reply_text(part)


async def _post_init(application: Application) -> None:
    """Личное сообщение админам из TELEGRAM_ALLOWED_USER_IDS при старте."""
    if not STARTUP_MESSAGE:
        return
    if not ALLOWED:
        log.info("TELEGRAM_ALLOWED_USER_IDS пуст — привет при старте не отправляем")
        return
    for admin_id in sorted(ALLOWED):
        try:
            await application.bot.send_message(chat_id=admin_id, text=STARTUP_MESSAGE)
            log.info("Привет при старте отправлен admin_id=%s", admin_id)
        except Exception as e:
            log.warning("Не удалось отправить привет admin_id=%s: %s", admin_id, e)

    # фон: Shectory/hoster health + опционально Pi (Syslog/Pingmaster)
    asyncio.create_task(_health_loop(application))
    if PI_MONITOR_HOST or PI_MONITOR_HOSTS_RAW:
        asyncio.create_task(_pi_monitor_loop(application))


def _help_text() -> str:
    fixed = (
        "Режим 1 бот = 1 проект: workspace задан в CURSOR_RPA_FIXED_WORKSPACE.\n"
        if FIXED_WORKSPACE is not None
        else "Сначала: /project <имя>, затем /newchat.\n"
    )
    pi_note = ""
    if PI_MONITOR_HOST:
        pi_note = (
            f"\nМонитор Pi: {PI_MONITOR_HOST} — Syslog :{PI_SYSLOG_PORT}, Pingmaster :{PI_PINGMASTER_PORT} "
            f"(отчёт каждые {max(1, PI_MONITOR_INTERVAL_SEC // 60)} мин админам).\n"
        )
    return (
        "Пилот Cursor RPA\n\n"
        f"{fixed}"
        f"{pi_note}"
        "/newchat [текст] — новый чат Cursor (сохраняю UUID)\n"
        "/status — workspace и активный chat id\n"
        "/ping — жив ли бот и путь workspace\n"
        "/deploy_ui — DEPLOY_UI_SCRIPT из .env\n"
        "/build_apk — BUILD_APK_SCRIPT из .env\n"
        "/shellok — подтвердить разрешение на предложение команд терминала (без отговорок про Sandbox)\n"
        "Любой текст — запрос в текущий чат (QUERY)\n\n"
        "Пока идёт ответ агента, новые сообщения в этом чате ждут очереди (не теряются порядок)."
    )


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    uid = update.effective_user.id if update.effective_user else None
    if not _allowed(uid):
        await update.message.reply_text("Доступ запрещён.")
        return
    state = _load_state()
    sess = _get_sess(state, uid, update.effective_chat.id)
    _ensure_workspace(sess, uid, update.effective_chat.id)
    _save_state(state)
    log.info("start user_id=%s chat_id=%s fixed_ws=%s", uid, update.effective_chat.id, FIXED_WORKSPACE)
    await update.message.reply_text(_help_text())


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await cmd_start(update, context)


async def cmd_ping(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    uid = update.effective_user.id if update.effective_user else None
    if not _allowed(uid):
        await update.message.reply_text("Доступ запрещён.")
        return
    state = _load_state()
    sess = _get_sess(state, uid, update.effective_chat.id)
    ws = _ensure_workspace(sess, uid, update.effective_chat.id)
    _save_state(state)
    ok = ws and Path(ws).is_dir()
    await update.message.reply_text(
        f"pong\nworkspace: {ws or 'не задан'}\n"
        f"каталог существует: {ok}\n"
        f"rpa script: {RPA_SCRIPT} ({'ok' if RPA_SCRIPT.is_file() else 'нет файла'})\n"
        f"timeout агента: {AGENT_TIMEOUT}s"
    )


async def cmd_project(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    uid = update.effective_user.id if update.effective_user else None
    if not _allowed(uid):
        await update.message.reply_text("Доступ запрещён.")
        return
    if FIXED_WORKSPACE is not None:
        await update.message.reply_text(
            f"Проект зафиксирован в CURSOR_RPA_FIXED_WORKSPACE:\n{FIXED_WORKSPACE}\n"
            "/project отключён."
        )
        return
    if not context.args:
        await update.message.reply_text("Использование: /project <имя>")
        return
    name = context.args[0].strip()
    if not re.match(r"^[a-zA-Z0-9._-]+$", name):
        await update.message.reply_text("Имя проекта: только буквы, цифры, ._-")
        return
    root = WORKSPACE_ROOT / name
    root.mkdir(parents=True, exist_ok=True)
    state = _load_state()
    sess = _get_sess(state, uid, update.effective_chat.id)
    sess["project_name"] = name
    sess["workspace"] = str(root.resolve())
    sess["cursor_chat_id"] = ""
    _save_state(state)
    log.info("project user_id=%s name=%s path=%s", uid, name, root)
    await update.message.reply_text(f"Проект: {name}\nWorkspace:\n{root}")


async def cmd_newchat(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    uid = update.effective_user.id if update.effective_user else None
    chat = update.effective_chat.id
    if not _allowed(uid):
        await update.message.reply_text("Доступ запрещён.")
        return
    lock = _lock_for(chat)
    if lock.locked():
        await update.message.reply_text("Подождите: в этом чате уже выполняется запрос к агенту.")
        return
    state = _load_state()
    sess = _get_sess(state, uid, chat)
    ws = _ensure_workspace(sess, uid, chat)
    if not ws:
        await update.message.reply_text("Сначала /project <имя> (или задайте CURSOR_RPA_FIXED_WORKSPACE).")
        return
    _save_state(state)
    prompt = " ".join(context.args).strip() or "Кратко подтверди: чат создан, готов к задачам."
    prompt = _agent_prompt_with_shell_policy(sess, prompt)

    async with lock:
        typing_task = asyncio.create_task(_typing_loop(context.bot, chat))
        try:
            await update.message.reply_text("Создаю чат Cursor… (до нескольких минут)")
            loop = asyncio.get_event_loop()
            code, text = await loop.run_in_executor(
                None, lambda w=ws, p=prompt: _run_rpa("NEW_CHAT", w, "", p)
            )
        except subprocess.TimeoutExpired:
            typing_task.cancel()
            await update.message.reply_text(
                f"Таймаут ({AGENT_TIMEOUT}s). Повторите или увеличьте AGENT_TIMEOUT_SEC в .env"
            )
            return
        except Exception as e:
            typing_task.cancel()
            log.exception("newchat failed: %s", e)
            await update.message.reply_text(f"Ошибка: {e!s}")
            return
        finally:
            typing_task.cancel()
            try:
                await typing_task
            except asyncio.CancelledError:
                pass

    lines = text.strip().splitlines()
    new_id = lines[0].strip() if lines else ""
    uuid_like = re.match(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        new_id,
        re.I,
    )
    prefix = "" if code == 0 else f"⚠️ Код агента {code}\n\n"
    if uuid_like:
        sess["cursor_chat_id"] = new_id
        _save_state(state)
        rest = "\n".join(lines[1:]).strip()
        msg = f"{prefix}Новый chat id:\n{new_id}"
        if rest:
            msg += f"\n\nОтвет агента:\n{rest}"
        await _reply_chunks(update.message, msg)
    else:
        await _reply_chunks(update.message, text, prefix=prefix)
    log.info("newchat user_id=%s code=%s chat_uuid=%s", uid, code, new_id if uuid_like else "?")


async def cmd_shellok(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    uid = update.effective_user.id if update.effective_user else None
    if not _allowed(uid):
        await update.message.reply_text("Доступ запрещён.")
        return
    state = _load_state()
    sess = _get_sess(state, uid, update.effective_chat.id)
    _ensure_workspace(sess, uid, update.effective_chat.id)
    sess["telegram_shell_ok"] = True
    _save_state(state)
    await update.message.reply_text(
        "Shell OK: к следующим запросам агенту добавляется инструкция не ссылаться на ограничение Sandbox "
        "и предлагать команды для вашего терминала. Отключить префикс: TELEGRAM_DISABLE_AGENT_PREAMBLE=1 в .env."
    )


async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    uid = update.effective_user.id if update.effective_user else None
    if not _allowed(uid):
        await update.message.reply_text("Доступ запрещён.")
        return
    state = _load_state()
    sess = _get_sess(state, uid, update.effective_chat.id)
    ws = _ensure_workspace(sess, uid, update.effective_chat.id) or sess.get("workspace", "—")
    cid = sess.get("cursor_chat_id", "—")
    _save_state(state)
    mode = "fixed workspace" if FIXED_WORKSPACE else "multi /project"
    await update.message.reply_text(
        f"Режим: {mode}\n"
        f"Проект: {sess.get('project_name', '—')}\n"
        f"Workspace:\n{ws}\n"
        f"Cursor chat:\n{cid}\n"
        f"Префикс Shell/Sandbox для агента: {'вкл' if _shell_preamble_active(sess) else 'выкл'} (/shellok)\n"
        f"Очередь: {'занята' if _lock_for(update.effective_chat.id).locked() else 'свободна'}"
    )


async def _run_hook(update: Update, label: str, script: str) -> None:
    uid = update.effective_user.id if update.effective_user else None
    chat = update.effective_chat.id
    if not _allowed(uid):
        await update.message.reply_text("Доступ запрещён.")
        return
    if not script:
        await update.message.reply_text(f"{label} не настроен в .env")
        return
    lock = _lock_for(chat)
    if lock.locked():
        await update.message.reply_text("Подождите: сейчас выполняется другой запрос.")
        return
    state = _load_state()
    sess = _get_sess(state, uid, chat)
    ws = _ensure_workspace(sess, uid, chat) or sess.get("workspace")
    if not ws:
        await update.message.reply_text("Сначала workspace: /project или CURSOR_RPA_FIXED_WORKSPACE.")
        return
    env = {
        "WORKSPACE": ws,
        "PROJECT_NAME": sess.get("project_name", ""),
    }

    async with lock:
        typing_task = asyncio.create_task(_typing_loop(context.bot, chat))
        await update.message.reply_text(f"Запускаю {label}…")
        loop = asyncio.get_event_loop()

        def run():
            return _run_bash(script, env_extra=env)

        try:
            code, out, err = await loop.run_in_executor(None, run)
        except subprocess.TimeoutExpired:
            typing_task.cancel()
            await update.message.reply_text("Таймаут.")
            return
        except Exception as e:
            typing_task.cancel()
            await update.message.reply_text(f"Ошибка: {e!s}")
            return
        finally:
            typing_task.cancel()
            try:
                await typing_task
            except asyncio.CancelledError:
                pass

    tail = (out + "\n" + err).strip()[-12000:]
    prefix = f"⚠️ Код {code}\n\n" if code != 0 else f"Код {code}\n\n"
    await _reply_chunks(update.message, tail, prefix=prefix)
    log.info("hook %s user_id=%s code=%s", label, uid, code)


async def cmd_deploy_ui(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await _run_hook(update, "DEPLOY_UI_SCRIPT", DEPLOY_UI_SCRIPT)


async def cmd_build_apk(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await _run_hook(update, "BUILD_APK_SCRIPT", BUILD_APK_SCRIPT)


async def on_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    uid = update.effective_user.id if update.effective_user else None
    chat = update.effective_chat.id
    if not _allowed(uid):
        return
    text = (update.message.text or "").strip()
    if not text or text.startswith("/"):
        return
    lock = _lock_for(chat)
    if lock.locked():
        await update.message.reply_text(
            "Сейчас обрабатывается предыдущий запрос. Дождитесь ответа — очередь строго последовательная."
        )
        return
    state = _load_state()
    sess = _get_sess(state, uid, chat)
    ws = _ensure_workspace(sess, uid, chat)
    cid = sess.get("cursor_chat_id", "")
    if not ws:
        await update.message.reply_text(
            "Workspace не задан: /project <имя> или переменная CURSOR_RPA_FIXED_WORKSPACE."
        )
        return
    if not cid:
        await update.message.reply_text("Сначала /newchat — нужен активный чат Cursor.")
        return
    _save_state(state)

    prompt = _agent_prompt_with_shell_policy(sess, text)

    async with lock:
        typing_task = asyncio.create_task(_typing_loop(context.bot, chat))
        await update.message.reply_text("Агент работает… (до нескольких минут, без параллельных запросов)")
        loop = asyncio.get_event_loop()
        try:
            code, resp = await loop.run_in_executor(
                None, lambda w=ws, c=cid, t=prompt: _run_rpa("QUERY", w, c, t)
            )
        except subprocess.TimeoutExpired:
            typing_task.cancel()
            await update.message.reply_text(
                f"Таймаут ({AGENT_TIMEOUT}s). Упростите запрос или увеличьте AGENT_TIMEOUT_SEC."
            )
            return
        except Exception as e:
            typing_task.cancel()
            log.exception("query failed: %s", e)
            await update.message.reply_text(f"Ошибка: {e!s}")
            return
        finally:
            typing_task.cancel()
            try:
                await typing_task
            except asyncio.CancelledError:
                pass

    prefix = "" if code == 0 else f"⚠️ Код агента {code}\n\n"
    await _reply_chunks(update.message, resp, prefix=prefix)
    log.info("query user_id=%s code=%s len=%s", uid, code, len(resp))


def main() -> None:
    if not BOT_TOKEN:
        raise SystemExit("Задайте TELEGRAM_BOT_TOKEN")
    if not RPA_SCRIPT.is_file():
        log.warning("Нет файла RPA_SCRIPT: %s", RPA_SCRIPT)
    if FIXED_WORKSPACE is not None:
        log.info("Режим фиксированного workspace: %s", FIXED_WORKSPACE)
    app = Application.builder().token(BOT_TOKEN).post_init(_post_init).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("ping", cmd_ping))
    app.add_handler(CommandHandler("project", cmd_project))
    app.add_handler(CommandHandler("newchat", cmd_newchat))
    app.add_handler(CommandHandler("status", cmd_status))
    app.add_handler(CommandHandler("shellok", cmd_shellok))
    app.add_handler(CommandHandler("ShellOK", cmd_shellok))
    app.add_handler(CommandHandler("deploy_ui", cmd_deploy_ui))
    app.add_handler(CommandHandler("build_apk", cmd_build_apk))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_text))
    # Reliability is handled by systemd Restart=always in the unit.
    app.run_polling(allowed_updates=Update.ALL_TYPES, drop_pending_updates=True)


if __name__ == "__main__":
    main()
