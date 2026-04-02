#!/usr/bin/env bash
# WireGuard server setup on VDS (Shectory)
# Run as root on the VDS.
# After running, copy the printed Pi client config to Pi.
#
# Usage:
#   sudo bash wg-server-setup.sh [--pi-pubkey <BASE64_KEY>]
#
# If --pi-pubkey is not provided, the script will generate a placeholder
# and you must replace it with the actual Pi public key later.

set -euo pipefail

WG_IFACE="wg0"
WG_PORT="51820"
VDS_WG_IP="10.66.0.1/24"
PI_WG_IP="10.66.0.2/32"
WG_CONF="/etc/wireguard/${WG_IFACE}.conf"

PI_PUBKEY="${PI_PUBKEY:-}"

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pi-pubkey) PI_PUBKEY="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "=== Installing wireguard-tools ==="
apt-get update -qq
apt-get install -y wireguard-tools

echo "=== Generating server keys ==="
SERVER_PRIVKEY=$(wg genkey)
SERVER_PUBKEY=$(echo "$SERVER_PRIVKEY" | wg pubkey)

echo ""
echo "Server public key: $SERVER_PUBKEY"
echo "(Share this with Pi when generating its client config)"
echo ""

if [[ -z "$PI_PUBKEY" ]]; then
  PI_PUBKEY="REPLACE_WITH_PI_PUBLIC_KEY"
  echo "WARNING: Pi public key not provided. Edit $WG_CONF after generating Pi keys."
fi

echo "=== Writing $WG_CONF ==="
cat > "$WG_CONF" <<EOF
[Interface]
Address = ${VDS_WG_IP}
ListenPort = ${WG_PORT}
PrivateKey = ${SERVER_PRIVKEY}

# Enable IP forwarding for VPN traffic
PostUp   = sysctl -w net.ipv4.ip_forward=1
PostDown = sysctl -w net.ipv4.ip_forward=0

[Peer]
# Raspberry Pi
PublicKey = ${PI_PUBKEY}
AllowedIPs = ${PI_WG_IP}
EOF

chmod 600 "$WG_CONF"

echo "=== Enabling IP forwarding persistently ==="
grep -q 'net.ipv4.ip_forward' /etc/sysctl.conf \
  && sed -i 's/^#\?net.ipv4.ip_forward.*/net.ipv4.ip_forward=1/' /etc/sysctl.conf \
  || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
sysctl -p /etc/sysctl.conf

echo "=== Opening firewall port ${WG_PORT}/udp ==="
if command -v ufw &>/dev/null; then
  ufw allow "${WG_PORT}/udp" || true
fi
if command -v iptables &>/dev/null; then
  iptables -C INPUT -p udp --dport "${WG_PORT}" -j ACCEPT 2>/dev/null \
    || iptables -A INPUT -p udp --dport "${WG_PORT}" -j ACCEPT
fi

echo "=== Starting WireGuard ==="
systemctl enable --now "wg-quick@${WG_IFACE}"

echo ""
echo "=== WireGuard server is up ==="
wg show

echo ""
echo "=== Next steps ==="
echo "1. On Pi, run: bash wg-pi-client-setup.sh --vds-pubkey ${SERVER_PUBKEY} --vds-endpoint <VDS_IP_OR_DOMAIN>:${WG_PORT}"
echo "2. After Pi generates its public key, update $WG_CONF [Peer] PublicKey and run: wg syncconf ${WG_IFACE} <(wg-quick strip ${WG_IFACE})"
