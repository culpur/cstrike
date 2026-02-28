#!/bin/bash
set -e

# Load config from .env
if ! [ -f .env ]; then
    echo "[✗] .env file not found. Aborting."
    exit 1
fi

if ! command -v jq &>/dev/null; then
    echo "[✗] jq is required but not installed. Run: sudo apt install jq"
    exit 1
fi

# Metasploit config
MSF_USER=$(jq -r '.msf_username' .env)
MSF_PASS=$(jq -r '.msf_password' .env)
MSF_HOST=$(jq -r '.msf_host' .env)
MSF_PORT=$(jq -r '.msf_port' .env)

# ZAP config
ZAP_HOST=$(jq -r '.zap_host // "127.0.0.1"' .env)
ZAP_PORT=$(jq -r '.zap_port // 8090' .env)
ZAP_BIN="/usr/local/bin/zap.sh"
ZAP_LOG="/tmp/zap.log"

# Start Metasploit RPC
echo "[+] Starting Metasploit RPC daemon..."
msfrpcd -P "$MSF_PASS" -S -U "$MSF_USER" -a "$MSF_HOST" -p "$MSF_PORT" > /tmp/msfrpcd.log 2>&1 &
sleep 3

if pgrep -f "msfrpcd" > /dev/null; then
    echo "[✓] Metasploit RPC running on $MSF_HOST:$MSF_PORT as $MSF_USER"
else
    echo "[✗] Metasploit RPC failed to start"
fi

# Start ZAP
echo "[+] Starting OWASP ZAP in daemon mode..."
"$ZAP_BIN" -daemon -port "$ZAP_PORT" -host "$ZAP_HOST" -config api.disablekey=true > "$ZAP_LOG" 2>&1 &

# Wait for ZAP to be ready
echo -n "[~] Waiting for ZAP to become ready"
ZAP_READY_LINE="[ZAP-daemon] INFO  org.zaproxy.addon.network.ExtensionNetwork - ZAP is now listening on $ZAP_HOST:$ZAP_PORT"

for i in {1..20}; do
    if grep -qF "$ZAP_READY_LINE" "$ZAP_LOG"; then
        echo -e "\n[✓] OWASP ZAP is ready at $ZAP_HOST:$ZAP_PORT"
        break
    else
        echo -n "."
        sleep 1
    fi
done

if ! grep -qF "$ZAP_READY_LINE" "$ZAP_LOG"; then
    echo -e "\n[✗] ZAP failed to report readiness within timeout."
    tail -n 10 "$ZAP_LOG"
fi

# Start Burp Suite Community
BURP_JAR="/opt/BurpSuitePro/burpsuite_community.jar"
if [ -f "$BURP_JAR" ]; then
    echo "[+] Starting Burp Suite Community..."
    java -jar "$BURP_JAR" > /tmp/burp.log 2>&1 &
    sleep 5
    if pgrep -f "burpsuite_community.jar" > /dev/null; then
        echo "[✓] Burp Suite Community launched"
    else
        echo "[✗] Burp Suite Community failed to launch"
    fi
else
    echo "[!] Burp Suite jar not found at $BURP_JAR"
fi

echo "[✓] All services initialized (Metasploit, ZAP, Burp Suite)"
