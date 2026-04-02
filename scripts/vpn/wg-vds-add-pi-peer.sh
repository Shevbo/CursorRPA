#!/usr/bin/env bash
# Update VDS WireGuard config with Pi's public key (run on VDS as root).
# Use after running wg-pi-client-setup.sh on Pi and getting its public key.
#
# Usage:
#   sudo bash wg-vds-add-pi-peer.sh --pi-pubkey <BASE64_KEY>

set -euo pipefail

WG_IFACE="wg0"
WG_CONF="/etc/wireguard/${WG_IFACE}.conf"
PI_PUBKEY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pi-pubkey) PI_PUBKEY="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$PI_PUBKEY" ]]; then
  echo "Usage: $0 --pi-pubkey <KEY>"
  exit 1
fi

echo "=== Updating $WG_CONF with Pi public key ==="
sed -i "s|PublicKey = REPLACE_WITH_PI_PUBLIC_KEY|PublicKey = ${PI_PUBKEY}|" "$WG_CONF"

echo "=== Applying config live (no restart needed) ==="
wg set "$WG_IFACE" peer "$PI_PUBKEY" allowed-ips 10.66.0.2/32

echo ""
echo "=== Current WireGuard status ==="
wg show

echo ""
echo "=== Test from VDS ==="
echo "Run: ping -c3 10.66.0.2"
