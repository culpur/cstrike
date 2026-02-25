#!/bin/bash

set -e

echo "[+] Installing WireGuard and Tor..."
apt update && apt install -y wireguard tor torsocks curl traceroute jq

echo "[+] Enabling Tor service..."
systemctl enable --now tor

echo "[+] Setting up WireGuard config..."
WG_CONFIG="/etc/wireguard/wg0.conf"
if [ ! -f "$WG_CONFIG" ]; then
  echo "WireGuard config $WG_CONFIG not found. Aborting."
  exit 1
fi

echo "[+] Registering custom routing table..."
echo "51820 wgvpn" >> /etc/iproute2/rt_tables || true

# Extract endpoint from config
ENDPOINT=$(grep Endpoint "$WG_CONFIG" | awk '{print $3}' | cut -d: -f1)

# Replace eth1 and eth0 with your actual interface names if different
VPN_IFACE="eth1"
MGMT_IFACE="eth0"
GATEWAY_IP="10.0.0.1"

echo "[+] Adding custom route to VPN endpoint ($ENDPOINT) via $VPN_IFACE..."
ip route add "$ENDPOINT" via "$GATEWAY_IP" dev "$VPN_IFACE" || true

echo "[+] Starting WireGuard..."
wg-quick up wg0

echo "[+] Confirming routes:"
ip route get 1.1.1.1
ip route get "$ENDPOINT"

echo "[+] Testing VPN anonymity:"
echo "External IP (VPN expected):"
curl -s https://api.ipify.org && echo

echo "[+] DNS Leak Test:"
dig +short whoami.akamai.net @ns1-1.akamaitech.net
dig +short txt ch whoami.cloudflare @1.1.1.1

echo "[+] Testing Tor anonymity with torsocks:"
torsocks curl -s https://check.torproject.org | grep -i "congratulations" || echo "[-] Tor routing test failed."

echo
echo "[✔] WireGuard VPN and Tor have been configured."
echo "[💡] Use torsocks for DNS/OSINT tools like:"
echo "     torsocks theHarvester -d example.com -b bing"
echo "     torsocks curl https://example.com"
