#!/bin/bash
# Metasploit Framework entrypoint for CStrike
# Starts msfrpcd (RPC daemon) for API access + keeps container alive

MSF_PASSWORD="${MSF_PASSWORD:-msf}"
MSF_HOST="0.0.0.0"
MSF_PORT="55553"

echo "[MSF] Starting Metasploit RPC daemon on ${MSF_HOST}:${MSF_PORT}"

# Initialize MSF database if PostgreSQL is available
if command -v msfdb &>/dev/null; then
  msfdb init 2>/dev/null || true
fi

# Start msfrpcd in foreground (-f) with:
#   -P password  -S (disable SSL for internal network)
#   -a bind address  -p port
#   -U msf (username)
exec msfrpcd -P "$MSF_PASSWORD" -U msf -S -a "$MSF_HOST" -p "$MSF_PORT" -f
