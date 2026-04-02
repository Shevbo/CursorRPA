#!/usr/bin/env python3
"""Pi health pulse to Shectory portal over HTTPS (stdlib only)."""
from __future__ import annotations

import json
import os
import socket
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path


def mem():
    total = avail = 0
    for line in Path("/proc/meminfo").read_text().splitlines():
        if line.startswith("MemTotal:"):
            total = int(line.split()[1]) * 1024
        if line.startswith("MemAvailable:"):
            avail = int(line.split()[1]) * 1024
    return total, avail


def disk_root():
    import shutil
    du = shutil.disk_usage("/")
    return du.total, du.free


def port_ok(port):
    s = socket.socket()
    s.settimeout(2)
    try:
        s.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        try:
            s.close()
        except OSError:
            pass


def endpoint_url():
    raw = os.environ.get("PI_PULSE_URL", "").strip().rstrip("/")
    if not raw:
        return ""
    if "pi/pulse" in raw:
        return raw
    return f"{raw}/api/health/pi/pulse"


def main():
    url = endpoint_url()
    tok = os.environ.get("PI_PULSE_TOKEN", "").strip()
    if not url or not tok:
        print("Need PI_PULSE_URL and PI_PULSE_TOKEN", file=sys.stderr)
        return 1
    syslog = int(os.environ.get("PI_SYSLOG_PORT", "4444"))
    ping = int(os.environ.get("PI_PINGMASTER_PORT", "4555"))
    t, a = mem()
    dt, df = disk_root()
    l1, l5, l15 = os.getloadavg() if hasattr(os, "getloadavg") else (0.0, 0.0, 0.0)
    ram_free_pct = (a / t * 100.0) if t else 0.0
    hdd_free_pct = (df / dt * 100.0) if dt else 0.0
    body = {
        "deviceKey": os.environ.get("PI_PULSE_DEVICE_KEY", "default").strip() or "default",
        "hostname": socket.gethostname(),
        "cpu": {"load1": l1, "load5": l5, "load15": l15},
        "ram": {"free_pct": ram_free_pct},
        "hdd": {"free_pct": hdd_free_pct},
        "services": [
            {"name": f"Syslog :{syslog}", "ok": port_ok(syslog)},
            {"name": f"PingMaster :{ping}", "ok": port_ok(ping)},
        ],
    }
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {tok}",
            "Content-Type": "application/json",
            "User-Agent": "shectory-pi-pulse/1",
        },
    )
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=45) as r:
            r.read()
            print("pulse_ok", getattr(r, "status", 200))
    except urllib.error.HTTPError as e:
        print(e.read().decode("utf-8", errors="replace")[:500], file=sys.stderr)
        return 1
    except OSError as e:
        print(str(e), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
