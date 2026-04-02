#!/usr/bin/env bash
# One-shot setup script for Raspberry Pi:
#   1. Install WireGuard and connect to VDS
#   2. Install autossh reverse tunnel (TCP/443 fallback)
#   3. Install pi-pulse systemd timer (health push to portal)
#
# Run as root on Pi:
#   curl -fsSL https://raw.githubusercontent.com/... | sudo bash
# OR copy this file to Pi and run:
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
VDS_SSH_PORT="${VDS_SSH_PORT:-443}"
PI_PULSE_URL="${PI_PULSE_URL:-https://shectory.ru/api/health/pi/pulse}"
PI_PULSE_TOKEN="${PI_PULSE_TOKEN:-}"
PI_PULSE_DEVICE_KEY="${PI_PULSE_DEVICE_KEY:-default}"

REPO_DIR="${REPO_DIR:-/home/shevbo/workspaces/CursorRPA}"
SCRIPTS_DIR="${REPO_DIR}/scripts"

echo "================================================================"
echo " Shectory Pi Setup: WireGuard + autossh + pi-pulse"
echo "================================================================"
echo ""

# ── 1. WireGuard ──────────────────────────────────────────────────
echo "=== [1/3] WireGuard client ==="

apt-get update -qq
apt-get install -y wireguard-tools

WG_CONF="/etc/wireguard/wg0.conf"
if [[ -f "$WG_CONF" ]]; then
  echo "WireGuard config already exists, skipping key generation."
  PI_PUBKEY=$(cat "$WG_CONF" | grep -A1 '\[Interface\]' | grep PrivateKey | awk '{print $3}' | wg pubkey)
else
  PI_PRIVKEY=$(wg genkey)
  PI_PUBKEY=$(echo "$PI_PRIVKEY" | wg pubkey)

  cat > "$WG_CONF" <<EOF
[Interface]
Address = 10.66.0.2/24
PrivateKey = ${PI_PRIVKEY}
DNS = 1.1.1.1

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

# Install service
cat > /etc/systemd/system/autossh-pi-reverse-tunnel.service <<'SVCEOF'
[Unit]
Description=Autossh reverse tunnel Pi -> VDS (TCP/443 fallback)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=shevbo
EnvironmentFile=/etc/shectory/autossh-tunnel.env
ExecStart=/usr/bin/autossh \
  -M 0 \
  -N \
  -o "ServerAliveInterval=30" \
  -o "ServerAliveCountMax=3" \
  -o "ExitOnForwardFailure=yes" \
  -o "StrictHostKeyChecking=no" \
  -o "IdentityFile=${TUNNEL_SSH_KEY}" \
  -p ${TUNNEL_SSH_PORT:-443} \
  -R 127.0.0.1:${TUNNEL_SYSLOG_PORT:-24444}:localhost:4444 \
  -R 127.0.0.1:${TUNNEL_PINGMASTER_PORT:-24555}:localhost:4555 \
  -R 127.0.0.1:${TUNNEL_SSH_RPORT:-22022}:localhost:22 \
  ${TUNNEL_USER}@${TUNNEL_HOST}
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

PULSE_SCRIPT_DIR="${SCRIPTS_DIR}/pi-pulse"
if [[ ! -d "$PULSE_SCRIPT_DIR" ]]; then
  echo "WARNING: $PULSE_SCRIPT_DIR not found. Skipping pi-pulse setup."
  echo "  Make sure the repo is cloned to $REPO_DIR"
else
  # Write env file if token provided
  if [[ -n "$PI_PULSE_TOKEN" ]]; then
    cat > /etc/shectory/pi-pulse.env <<EOF
PI_PULSE_URL=${PI_PULSE_URL}
PI_PULSE_TOKEN=${PI_PULSE_TOKEN}
PI_PULSE_DEVICE_KEY=${PI_PULSE_DEVICE_KEY}
PI_SYSLOG_PORT=4444
PI_PINGMASTER_PORT=4555
EOF
    chmod 600 /etc/shectory/pi-pulse.env
    echo "pi-pulse env written to /etc/shectory/pi-pulse.env"
  else
    echo "WARNING: PI_PULSE_TOKEN not set. Set it and create /etc/shectory/pi-pulse.env manually."
  fi

  # Install systemd units
  cp "${PULSE_SCRIPT_DIR}/shectory-pi-pulse.service" /etc/systemd/system/
  cp "${PULSE_SCRIPT_DIR}/shectory-pi-pulse.timer" /etc/systemd/system/

  # Update service to use /etc/shectory/pi-pulse.env
  sed -i 's|EnvironmentFile=.*|EnvironmentFile=/etc/shectory/pi-pulse.env|' \
    /etc/systemd/system/shectory-pi-pulse.service

  systemctl daemon-reload
  systemctl enable --now shectory-pi-pulse.timer
  echo "pi-pulse timer enabled"
fi

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
