#!/bin/bash
echo "[~] Stopping Metasploit, ZAP, and Burp Suite..."

# Stop Metasploit RPC daemon
if pgrep -f msfrpcd > /dev/null; then
    pkill -f msfrpcd
    echo "[✓] Stopped Metasploit RPC"
else
    echo "[!] Metasploit RPC not running"
fi

# Stop OWASP ZAP daemon (detects both zap.sh and direct jar execution)
if pgrep -f 'zap.*\.jar' > /dev/null; then
    pkill -f 'zap.*\.jar'
    echo "[✓] Stopped OWASP ZAP"
else
    echo "[!] ZAP not running"
fi

# Stop Burp Suite
if pgrep -f burpsuite_community.jar > /dev/null; then
    pkill -f burpsuite_community.jar
    echo "[✓] Stopped Burp Suite"
else
    echo "[!] Burp Suite not running"
fi

echo "[✓] All services stopped."
