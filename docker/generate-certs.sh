#!/bin/bash
# Generate self-signed TLS certificates for CStrike VM
# Usage: ./generate-certs.sh

set -euo pipefail

CERT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/certs"
mkdir -p "${CERT_DIR}"

echo "[+] Generating self-signed TLS certificate for cstrike..."

openssl req -x509 -nodes -days 365 \
    -newkey rsa:2048 \
    -keyout "${CERT_DIR}/cstrike.key" \
    -out "${CERT_DIR}/cstrike.crt" \
    -subj "/C=US/ST=Ops/L=RedTeam/O=CStrike/CN=cstrike" \
    -addext "subjectAltName=DNS:cstrike,DNS:cstrike.local,DNS:localhost,IP:127.0.0.1"

chmod 600 "${CERT_DIR}/cstrike.key"
chmod 644 "${CERT_DIR}/cstrike.crt"

echo "[+] Certificates generated:"
echo "    ${CERT_DIR}/cstrike.crt"
echo "    ${CERT_DIR}/cstrike.key"
