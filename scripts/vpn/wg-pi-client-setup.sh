#!/usr/bin/env bash
# WireGuard client setup on Raspberry Pi
# Run as root on the Pi.
#
# Usage:
#   sudo bash wg-pi-client-setup.sh --vds-pubkey <BASE64_KEY> --vds-endpoint <IP_OR_DOMAIN>:51820
#
# After running, copy the printed Pi public key to the VDS and update
# /etc/wireguard/wg0.conf [Peer] PublicKey there.

set -euo pipefail

WG_IFACE="wg0"
PI_WG_IP="10.66.0.2/24"
WG_CONF="/etc/wireguard/${WG_IFACE}.conf"

VDS_PUBKEY=""
VDS_ENDPOINT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --vds-pubkey)   VDS_PUBKEY="$2";   shift 2 ;;
    --vds-endpoint) VDS_ENDPOINT="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$VDS_PUBKEY" || -z "$VDS_ENDPOINT" ]]; then
  echo "Usage: $0 --vds-pubkey <KEY> --vds-endpoint <IP>:<PORT>"
  exit 1
fi

echo "=== Installing wireguard-tools ==="
apt-get update -qq
apt-get install -y wireguard-tools

echo "=== Generating Pi client keys ==="
PI_PRIVKEY=$(wg genkey)
PI_PUBKEY=$(echo "$PI_PRIVKEY" | wg pubkey)

echo ""
echo "Pi public key: $PI_PUBKEY"
echo "(Copy this to VDS: update /etc/wireguard/wg0.conf [Peer] PublicKey)"
echo ""

echo "=== Writing $WG_CONF ==="
cat > "$WG_CONF" <<EOF
[Interface]
Address = ${PI_WG_IP}
PrivateKey = ${PI_PRIVKEY}

[Peer]
# VDS Shectory
PublicKey = ${VDS_PUBKEY}
Endpoint = ${VDS_ENDPOINT}
AllowedIPs = 10.66.0.0/24
PersistentKeepalive = 25
EOF

chmod 600 "$WG_CONF"

echo "=== Starting WireGuard ==="
systemctl enable --now "wg-quick@${WG_IFACE}"

echo ""
echo "=== WireGuard client is up ==="
wg show

echo ""
echo "=== Next steps ==="
echo "1. On VDS, update /etc/wireguard/wg0.conf [Peer] PublicKey = ${PI_PUBKEY}"
echo "2. On VDS, run: wg set wg0 peer ${PI_PUBKEY} allowed-ips 10.66.0.2/32"
echo "   OR: systemctl restart wg-quick@wg0"
echo "3. Test: ping 10.66.0.1 (from Pi) and ping 10.66.0.2 (from VDS)"
