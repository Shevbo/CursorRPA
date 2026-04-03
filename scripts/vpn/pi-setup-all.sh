#!/usr/bin/env bash
# One-shot setup script for Raspberry Pi:
#   1. Install WireGuard and connect to VDS
#   2. Install autossh reverse tunnel (TCP/443 fallback)
#   3. Install pi-pulse systemd timer (health push to portal)
#
# Run as root on Pi (no repo clone needed):
#   curl -fsSL https://raw.githubusercontent.com/Shevbo/CursorRPA/main/scripts/vpn/pi-setup-all.sh | sudo bash
# OR download and run:
#   curl -fsSL https://raw.githubusercontent.com/Shevbo/CursorRPA/main/scripts/vpn/pi-setup-all.sh -o pi-setup-all.sh
#   sudo bash pi-setup-all.sh
#
# Required env vars (or edit defaults below):
#   VDS_WG_PUBKEY  - WireGuard public key of VDS server
#   VDS_ENDPOINT   - VDS address:port for WireGuard (default: shectory.ru:51820)
#   VDS_SSH_HOST   - VDS hostname for autossh tunnel (default: shectory.ru)
#   VDS_SSH_USER   - VDS SSH user (default: shectory)
#   VDS_SSH_PORT   - VDS SSH port for tunnel (default: 443)
#   PI_PULSE_URL   - Portal pulse endpoint
#   PI_PULSE_TOKEN - Portal pulse bearer token

set -euo pipefail

VDS_WG_PUBKEY="${VDS_WG_PUBKEY:-JdKgwjy7e8m16fpGL5K5+ZO9e3T47rfH7QotZQiqJ3U=}"
VDS_ENDPOINT="${VDS_ENDPOINT:-shectory.ru:51820}"
VDS_SSH_HOST="${VDS_SSH_HOST:-shectory.ru}"
VDS_SSH_USER="${VDS_SSH_USER:-shectory}"
VDS_SSH_PORT="${VDS_SSH_PORT:-2222}"
PI_PULSE_URL="${PI_PULSE_URL:-https://shectory.ru/api/health/pi/pulse}"
PI_PULSE_TOKEN="${PI_PULSE_TOKEN:-36ea9a230155b1a9c20e854ba197eda00c639c22207b1d77}"
PI_PULSE_DEVICE_KEY="${PI_PULSE_DEVICE_KEY:-default}"

# pulse.py install dir (no repo needed)
PULSE_INSTALL_DIR="/opt/shectory-pi-pulse"

echo "================================================================"
echo " Shectory Pi Setup: WireGuard + autossh + pi-pulse"
echo "================================================================"
echo ""

# Репозиторий pkgs.tailscale.com для Debian testing/sid (trixie и т.п.) часто даёт 403 / «no longer signed».
# Для этого скрипта Tailscale не нужен — временно отключаем .list, чтобы прошёл apt-get update.
if [[ -d /etc/apt/sources.list.d ]]; then
  shopt -s nullglob
  for f in /etc/apt/sources.list.d/tailscale*.list; do
    [[ -f "$f" ]] || continue
    mv "$f" "${f}.disabled" && echo "Note: отключён репозиторий Tailscale (мешал apt update): ${f}.disabled"
  done
  shopt -u nullglob
fi

# ── 1. WireGuard ──────────────────────────────────────────────────
echo "=== [1/3] WireGuard client ==="

apt-get update -qq
apt-get install -y wireguard-tools

WG_CONF="/etc/wireguard/wg0.conf"
NEED_NEW_WG_CONF=false

extract_privkey_from_wg_conf() {
  grep -iE '^[[:space:]]*PrivateKey[[:space:]]*=' "$WG_CONF" 2>/dev/null | head -1 \
    | sed -E 's/^[[:space:]]*[Pp]rivate[Kk]ey[[:space:]]*=[[:space:]]*//;s/[[:space:]]+$//;s/#.*$//' \
    | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

if [[ -f "$WG_CONF" ]]; then
  echo "WireGuard config already exists, skipping key generation."
  PI_PRIVKEY=$(extract_privkey_from_wg_conf)
  PI_PUBKEY=""
  if [[ -n "$PI_PRIVKEY" ]] && PI_PUBKEY=$(printf '%s\n' "$PI_PRIVKEY" | wg pubkey 2>/dev/null); then
    :
  elif command -v wg >/dev/null && wg show wg0 public-key &>/dev/null; then
    PI_PUBKEY=$(wg show wg0 public-key)
  fi
  if [[ -z "${PI_PUBKEY:-}" ]]; then
    echo "WARN: из $WG_CONF не получается восстановить ключ (битый/пустой PrivateKey?) — делаю бэкап и создаю новую пару." >&2
    cp -a "$WG_CONF" "${WG_CONF}.bad.$(date +%Y%m%d%H%M%S)"
    rm -f "$WG_CONF"
    NEED_NEW_WG_CONF=true
  fi
else
  NEED_NEW_WG_CONF=true
fi

if [[ "$NEED_NEW_WG_CONF" == true ]]; then
  PI_PRIVKEY=$(wg genkey)
  PI_PUBKEY=$(printf '%s\n' "$PI_PRIVKEY" | wg pubkey)

  cat > "$WG_CONF" <<EOF
[Interface]
Address = 10.66.0.2/24
PrivateKey = ${PI_PRIVKEY}

[Peer]
# VDS Shectory
PublicKey = ${VDS_WG_PUBKEY}
Endpoint = ${VDS_ENDPOINT}
AllowedIPs = 10.66.0.0/24
PersistentKeepalive = 25
EOF
  chmod 600 "$WG_CONF"
fi

systemctl enable wg-quick@wg0
systemctl restart wg-quick@wg0 || true
sleep 2

echo ""
echo "Pi WireGuard public key: ${PI_PUBKEY}"
echo "(Send this to VDS: sudo bash wg-vds-add-pi-peer.sh --pi-pubkey ${PI_PUBKEY})"
echo ""

# Test WG
if ping -c2 -W3 10.66.0.1 &>/dev/null; then
  echo "✅ WireGuard: 10.66.0.1 reachable"
else
  echo "⚠️  WireGuard: 10.66.0.1 not reachable yet (VDS peer may not have Pi key yet)"
fi

# ── 2. autossh fallback ───────────────────────────────────────────
echo ""
echo "=== [2/3] autossh reverse tunnel (TCP/443 fallback) ==="

apt-get install -y autossh

# Generate tunnel SSH key if not exists
TUNNEL_KEY="/home/shevbo/.ssh/id_ed25519_tunnel"
if [[ ! -f "$TUNNEL_KEY" ]]; then
  sudo -u shevbo ssh-keygen -t ed25519 -f "$TUNNEL_KEY" -N "" -C "pi-tunnel@shevbo-pi"
  echo ""
  echo "Tunnel SSH public key (add to VDS ~/.ssh/authorized_keys):"
  cat "${TUNNEL_KEY}.pub"
  echo ""
fi

# Write env file
mkdir -p /etc/shectory
cat > /etc/shectory/autossh-tunnel.env <<EOF
TUNNEL_HOST=${VDS_SSH_HOST}
TUNNEL_USER=${VDS_SSH_USER}
TUNNEL_SSH_PORT=${VDS_SSH_PORT}
TUNNEL_SSH_KEY=${TUNNEL_KEY}
TUNNEL_SYSLOG_PORT=24444
TUNNEL_PINGMASTER_PORT=24555
TUNNEL_SSH_RPORT=22022
EOF
chmod 600 /etc/shectory/autossh-tunnel.env

# Install wrapper script (systemd doesn't expand env vars in ExecStart args)
cat > /usr/local/bin/autossh-pi-tunnel.sh <<EOF
#!/usr/bin/env bash
exec /usr/bin/autossh \\
  -M 0 \\
  -N \\
  -o "ServerAliveInterval=30" \\
  -o "ServerAliveCountMax=3" \\
  -o "ExitOnForwardFailure=yes" \\
  -o "StrictHostKeyChecking=no" \\
  -o "IdentityFile=${TUNNEL_KEY}" \\
  -p ${VDS_SSH_PORT} \\
  -R 127.0.0.1:24444:localhost:4444 \\
  -R 127.0.0.1:24555:localhost:4555 \\
  -R 127.0.0.1:22022:localhost:22 \\
  ${VDS_SSH_USER}@${VDS_SSH_HOST}
EOF
chmod +x /usr/local/bin/autossh-pi-tunnel.sh

# Install service
cat > /etc/systemd/system/autossh-pi-reverse-tunnel.service <<'SVCEOF'
[Unit]
Description=Autossh reverse tunnel Pi -> VDS (TCP fallback)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=shevbo
ExecStart=/usr/local/bin/autossh-pi-tunnel.sh
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable autossh-pi-reverse-tunnel.service
# Don't start yet - VDS needs to have the tunnel key first
echo "autossh service installed (not started - add tunnel key to VDS first)"
echo "  Tunnel public key: $(cat ${TUNNEL_KEY}.pub)"
echo "  On VDS: echo '$(cat ${TUNNEL_KEY}.pub)' >> /home/${VDS_SSH_USER}/.ssh/authorized_keys"
echo "  Then: systemctl start autossh-pi-reverse-tunnel.service"

# ── 3. pi-pulse ───────────────────────────────────────────────────
echo ""
echo "=== [3/3] pi-pulse health timer ==="

mkdir -p "$PULSE_INSTALL_DIR"

# Download pulse.py from GitHub (no repo clone needed)
PULSE_PY_URL="https://raw.githubusercontent.com/Shevbo/CursorRPA/main/scripts/pi-pulse/pulse.py"
echo "Downloading pulse.py from GitHub..."
curl -fsSL "$PULSE_PY_URL" -o "${PULSE_INSTALL_DIR}/pulse.py"
chmod +x "${PULSE_INSTALL_DIR}/pulse.py"
echo "pulse.py installed to ${PULSE_INSTALL_DIR}/pulse.py"

# Write env file
mkdir -p /etc/shectory
cat > /etc/shectory/pi-pulse.env <<EOF
PI_PULSE_URL=${PI_PULSE_URL}
PI_PULSE_TOKEN=${PI_PULSE_TOKEN}
PI_PULSE_DEVICE_KEY=${PI_PULSE_DEVICE_KEY}
PI_SYSLOG_PORT=4444
PI_PINGMASTER_PORT=4555
EOF
chmod 600 /etc/shectory/pi-pulse.env
echo "pi-pulse env written to /etc/shectory/pi-pulse.env"

# Install systemd service
cat > /etc/systemd/system/shectory-pi-pulse.service <<EOF
[Unit]
Description=Shectory Pi health pulse to portal (HTTPS)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/etc/shectory/pi-pulse.env
ExecStart=/usr/bin/python3 ${PULSE_INSTALL_DIR}/pulse.py
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Install systemd timer (every 5 minutes)
cat > /etc/systemd/system/shectory-pi-pulse.timer <<'TIMEREOF'
[Unit]
Description=Run Pi health pulse every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Unit=shectory-pi-pulse.service

[Install]
WantedBy=timers.target
TIMEREOF

systemctl daemon-reload
systemctl enable --now shectory-pi-pulse.timer
echo "pi-pulse timer enabled"

# Run once immediately to verify
echo "Running pulse once to test..."
systemctl start shectory-pi-pulse.service && echo "✅ Pulse sent successfully" \
  || echo "⚠️  Pulse failed - check: journalctl -u shectory-pi-pulse.service"

echo ""
echo "================================================================"
echo " Setup complete!"
echo ""
echo " REQUIRED MANUAL STEPS:"
echo ""
echo " 1. Send Pi WireGuard key to VDS:"
echo "    On VDS: sudo bash scripts/vpn/wg-vds-add-pi-peer.sh --pi-pubkey ${PI_PUBKEY}"
echo ""
echo " 2. Add tunnel SSH key to VDS authorized_keys:"
echo "    $(cat ${TUNNEL_KEY}.pub 2>/dev/null || echo '(key not generated)')"
echo "    On VDS: echo '<key>' >> ~/.ssh/authorized_keys"
echo "    Then on Pi: systemctl start autossh-pi-reverse-tunnel.service"
echo ""
echo " 3. Test WireGuard:"
echo "    ping -c3 10.66.0.1"
echo "================================================================"
