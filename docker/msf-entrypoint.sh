#!/bin/bash
# Metasploit Framework entrypoint for CStrike
# Starts msfrpcd (RPC daemon) for API access + keeps container alive

MSF_PASSWORD="${MSF_PASSWORD:-msf}"
MSF_HOST="0.0.0.0"
MSF_PORT="55553"

echo "[MSF] Starting Metasploit RPC daemon on ${MSF_HOST}:${MSF_PORT}"

# Remove any auto-generated database.yml to prevent PostgreSQL connection errors
# MSF RPC works fine without a database for our use case (auxiliary scanning)
rm -f /root/.msf4/database.yml /usr/share/metasploit-framework/config/database.yml 2>/dev/null

# Start msfrpcd in foreground (-f) with:
#   -P password  -S (disable SSL for internal network)
#   -a bind address  -p port
#   -U msf (username)
#   -n (no database)
exec msfrpcd -P "$MSF_PASSWORD" -U msf -S -a "$MSF_HOST" -p "$MSF_PORT" -n -f
