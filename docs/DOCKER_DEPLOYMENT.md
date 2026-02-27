# CStrike v2 — Docker Deployment Guide

Deploy the CStrike Docker stack on an existing Debian host with security tools pre-installed.

---

## Prerequisites

| Dependency | Version | Check |
|-----------|---------|-------|
| Docker Engine | 24+ | `docker --version` |
| Docker Compose | v2 (plugin) | `docker compose version` |
| OpenSSL | any | `openssl version` |

**OS:** Debian 12 recommended. Ubuntu 22.04+ and other Linux distributions work but are untested.

**Hardware:** 4 CPU cores, 8 GB RAM, 50 GB disk minimum.

---

## Host Tool Requirement

The CStrike API container executes security tools via read-only bind mounts from the host filesystem:

```yaml
volumes:
  - /usr/bin:/host/usr/bin:ro
  - /usr/sbin:/host/usr/sbin:ro
  - /usr/local/bin:/host/usr/local/bin:ro
  - /opt:/host/opt:ro
  - /usr/share/wordlists:/usr/share/wordlists:ro
```

**Without these tools installed on the host, scans will fail.** At minimum, install:

```bash
# Essential scanning tools
sudo apt-get install -y nmap nikto whatweb wafw00f dnsutils

# Or run the full provisioning script for 80+ tools:
sudo bash scripts/vm/provision-host.sh
```

See [BARE_METAL_INSTALL.md](BARE_METAL_INSTALL.md) for the complete tool list.

---

## Step 1: Clone the Repository

```bash
git clone https://github.com/culpur/cstrike.git
cd cstrike
```

---

## Step 2: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set strong passwords:

| Variable | Description | Default |
|----------|-------------|---------|
| `POSTGRES_PASSWORD` | PostgreSQL password | `changeme` |
| `REDIS_PASSWORD` | Redis password | `changeme` |
| `KASM_PASSWORD` | KasmVNC remote browser password | `CStr1k3!` |
| `CORS_ORIGINS` | Allowed frontend origins | `http://localhost:3000,...` |
| `LOG_LEVEL` | API log level (`debug`, `info`, `warn`, `error`) | `info` |
| `METRICS_INTERVAL` | Metrics emission interval (ms) | `2000` |

**Note:** AI provider API keys, target scope, scan modes, and tool allowlists are configured through the **web UI** (Configuration tab) or the `/api/v1/config` REST endpoints. These are stored in the PostgreSQL `ConfigEntry` table, not in `.env`.

---

## Step 3: Generate TLS Certificates

```bash
bash docker/generate-certs.sh
```

This generates a self-signed certificate for `cstrike`, `cstrike.local`, `localhost`, and `127.0.0.1` at `docker/certs/`.

**Bring your own cert:** Place your certificate at `docker/certs/cstrike.crt` and key at `docker/certs/cstrike.key`.

---

## Step 4: Start the Stack

```bash
docker compose up -d
```

### Container Startup Order

Docker Compose handles the dependency chain automatically:

```
PostgreSQL + Redis (health checks pass)
    └─→ API (waits for DB + Redis healthy)
        └─→ Frontend (waits for API healthy)
            ├─→ Traefik (starts after API + Frontend)
            └─→ Kasm Browser (waits for Frontend healthy)
```

### Verify All Containers

```bash
docker compose ps
```

Expected output:

| Container | Status | Port |
|-----------|--------|------|
| `cstrike-postgres` | healthy | 5432 |
| `cstrike-redis` | healthy | 6379 |
| `cstrike-api` | healthy | 3001 |
| `cstrike-frontend` | healthy | 3000 |
| `cstrike-traefik` | running | 80, 443 |
| `cstrike-kasm` | healthy | 6901 |

### Health Check

```bash
curl -sk https://localhost/health | jq
```

```json
{
  "status": "ok",
  "checks": {
    "database": "ok",
    "redis": "ok"
  },
  "uptime": 42,
  "timestamp": 1709000000000
}
```

---

## Step 5: Seed the Database

On first run, seed the database with default configuration:

```bash
docker exec cstrike-api npx prisma db seed
```

This creates:
- 5 Service records (api_server, frontend, metasploit, zap, burp)
- 25 ConfigEntry records (AI providers, scan settings, tool allowlists)
- 5 VpnConnection records (wireguard, openvpn, tailscale, nordvpn, mullvad)

---

## Access Points

| Service | URL | Notes |
|---------|-----|-------|
| **Dashboard** | `https://<ip>/` | Accept the self-signed cert warning |
| **Remote Browser** | `https://<ip>:6901/` | Password from `KASM_PASSWORD` in `.env` |
| **TUI** | `docker exec -it cstrike-api python -m tui` | Terminal UI inside the API container |
| **API Health** | `https://<ip>/health` | JSON health check |
| **API Endpoints** | `https://<ip>/api/v1/...` | REST API (14 route groups) |

---

## Traefik Routing

All external traffic flows through the Traefik reverse proxy:

```
Client → :443 (Traefik)
    ├─ /api/*        → API (:3001)     + security headers + rate limit
    ├─ /socket.io/*  → API (:3001)     (WebSocket passthrough)
    ├─ /health       → API (:3001)
    └─ /*            → Frontend (:3000) + security headers
```

HTTP (:80) redirects to HTTPS (:443) automatically.

**Security middleware** applied by Traefik:
- HSTS (1 year, includeSubdomains)
- X-Frame-Options: DENY
- Content-Type: nosniff
- CSP: `default-src 'self'`
- Rate limiting: 100 req/s average, 50 burst
- X-Powered-By and Server headers stripped

---

## Volumes & Persistence

| Volume | Mount | Purpose |
|--------|-------|---------|
| `pgdata` | PostgreSQL data | Targets, scans, results, config, credentials |
| `redisdata` | Redis AOF | Cache, session data |
| `apidata` | `/opt/cstrike/data` | Runtime data, agent registry |

Data persists across `docker compose down` / `up` cycles. To wipe everything:

```bash
docker compose down -v   # Removes containers AND volumes
```

---

## Upgrading

```bash
cd /path/to/cstrike
git pull origin main
docker compose build
docker compose up -d
docker exec cstrike-api npx prisma migrate deploy  # Apply schema changes
```

---

## Logs

```bash
# All containers
docker compose logs -f

# Specific container
docker compose logs -f api
docker compose logs -f frontend

# API application logs
docker exec cstrike-api cat /opt/cstrike/data/cstrike.log
```

---

## Troubleshooting

### API health check fails

```bash
# Check if PostgreSQL and Redis are up
docker compose ps postgres redis

# Check API logs for connection errors
docker compose logs api --tail 50
```

### Kasm browser shows "page not found"

The Kasm container connects to the frontend via `host.docker.internal:3000`. Verify the frontend is running:

```bash
curl -s http://127.0.0.1:3000/ | head -5
```

### Scans fail with "tool not found"

The API container looks for tools at `/host/usr/bin/`, `/host/usr/local/bin/`, etc. Verify the bind mounts are working:

```bash
docker exec cstrike-api ls /host/usr/bin/nmap
```

If missing, install the tool on the host and restart the container.

### Permission denied on host tool execution

Security tools may need elevated privileges. The API container runs as root by default for host tool access.

### TLS certificate errors

Regenerate certificates:

```bash
rm docker/certs/cstrike.{crt,key}
bash docker/generate-certs.sh
docker compose restart traefik
```

### Database migration errors

```bash
docker exec cstrike-api npx prisma migrate reset --force  # WARNING: Drops all data
docker exec cstrike-api npx prisma db seed
```
