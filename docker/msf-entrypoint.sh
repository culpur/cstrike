#!/bin/bash
# Metasploit Framework entrypoint for CStrike
# Starts msfrpcd (RPC daemon) for API access
# Uses the CStrike PostgreSQL instance for MSF database

MSF_PASSWORD="${MSF_PASSWORD:-msf}"
MSF_HOST="0.0.0.0"
MSF_PORT="55553"

# PostgreSQL connection (uses CStrike's PostgreSQL on the host network)
PG_HOST="${POSTGRES_HOST:-127.0.0.1}"
PG_PORT="${POSTGRES_PORT:-5432}"
PG_USER="${POSTGRES_USER:-msf}"
PG_PASS="${POSTGRES_PASSWORD:-msf}"
PG_DB="${POSTGRES_DB:-msf}"

echo "[MSF] Starting Metasploit RPC daemon on ${MSF_HOST}:${MSF_PORT}"
echo "[MSF] Database: postgresql://${PG_USER}@${PG_HOST}:${PG_PORT}/${PG_DB}"

# Create the MSF database role and database if they don't exist
# Uses the CStrike admin credentials to bootstrap
PGPASSWORD="${PG_ADMIN_PASSWORD:-cstrike}" psql -h "$PG_HOST" -p "$PG_PORT" -U "${PG_ADMIN_USER:-cstrike}" -d "${PG_ADMIN_DB:-cstrike}" -tc \
  "SELECT 1 FROM pg_roles WHERE rolname='${PG_USER}'" 2>/dev/null | grep -q 1 || {
    echo "[MSF] Creating PostgreSQL role '${PG_USER}'..."
    PGPASSWORD="${PG_ADMIN_PASSWORD:-cstrike}" psql -h "$PG_HOST" -p "$PG_PORT" -U "${PG_ADMIN_USER:-cstrike}" -d "${PG_ADMIN_DB:-cstrike}" -c \
      "CREATE ROLE ${PG_USER} WITH LOGIN PASSWORD '${PG_PASS}' CREATEDB;" 2>/dev/null || true
  }

PGPASSWORD="${PG_ADMIN_PASSWORD:-cstrike}" psql -h "$PG_HOST" -p "$PG_PORT" -U "${PG_ADMIN_USER:-cstrike}" -tc \
  "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" 2>/dev/null | grep -q 1 || {
    echo "[MSF] Creating database '${PG_DB}'..."
    PGPASSWORD="${PG_ADMIN_PASSWORD:-cstrike}" psql -h "$PG_HOST" -p "$PG_PORT" -U "${PG_ADMIN_USER:-cstrike}" -c \
      "CREATE DATABASE ${PG_DB} OWNER ${PG_USER};" 2>/dev/null || true
  }

# Write MSF database configuration
mkdir -p /root/.msf4
cat > /root/.msf4/database.yml << YAML
production:
  adapter: postgresql
  database: ${PG_DB}
  username: ${PG_USER}
  password: ${PG_PASS}
  host: ${PG_HOST}
  port: ${PG_PORT}
  pool: 5
  timeout: 5
YAML

echo "[MSF] Database configuration written"

# Start msfrpcd in foreground (-f) with:
#   -P password  -S (disable SSL for internal network)
#   -a bind address  -p port
#   -U msf (username)
exec msfrpcd -P "$MSF_PASSWORD" -U msf -S -a "$MSF_HOST" -p "$MSF_PORT" -f
