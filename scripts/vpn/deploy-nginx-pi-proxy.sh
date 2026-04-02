#!/usr/bin/env bash
# Deploy updated nginx proxy config for Pi services (4444/4555).
# Run as root on VDS after WireGuard is up.
#
# Usage:
#   sudo bash deploy-nginx-pi-proxy.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGINX_CONF_SRC="${SCRIPT_DIR}/nginx-pi-4444-4555.conf"
NGINX_CONF_DST="/etc/nginx/conf.d/pi-services.conf"
OLD_CONF="/etc/nginx/conf.d/syslog-pi-4444.conf"

echo "=== Testing WireGuard connectivity to Pi ==="
if ping -c2 -W2 10.66.0.2 &>/dev/null; then
  echo "OK: 10.66.0.2 is reachable via WireGuard"
else
  echo "WARNING: 10.66.0.2 is NOT reachable. nginx will use autossh fallback."
  echo "  Make sure autossh-pi-reverse-tunnel.service is running on Pi."
fi

echo "=== Removing old syslog-pi-4444.conf ==="
if [[ -f "$OLD_CONF" ]]; then
  mv "$OLD_CONF" "${OLD_CONF}.bak"
  echo "Backed up to ${OLD_CONF}.bak"
fi

echo "=== Installing new nginx config ==="
cp "$NGINX_CONF_SRC" "$NGINX_CONF_DST"

echo "=== Testing nginx config ==="
nginx -t

echo "=== Reloading nginx ==="
systemctl reload nginx

echo ""
echo "=== Testing proxy endpoints ==="
echo -n "Port 4444: "
curl -s --max-time 5 http://127.0.0.1:4444/ | head -c 100 || echo "(no response - Pi service may be down)"
echo ""
echo -n "Port 4555: "
curl -s --max-time 5 http://127.0.0.1:4555/ | head -c 100 || echo "(no response - Pi service may be down)"
echo ""

echo "=== Done ==="
