# CStrike v2.0.0 — Complete Changelog From Original to Current Build

### What it started as:
> *"An elite, modular offensive security automation framework with full TUI integration, OpenAI-enhanced command chaining, real-time recon, exploitation, and pivoting. Built for serious red team operations with support for split-VPN routing, ZAP/Burp Suite integration, Metasploit RPC automation, and interactive dashboards."*

A Python CLI tool (`cstrike.py`) with a Flask API (`api_server.py`), a Textual TUI, and a React frontend — all running on the developer's machine with no containerization, no database, no VPN isolation, and a flat `requirements.txt` with 200+ broken dependencies.

---

## Architecture Overhaul

| Before | After |
|--------|-------|
| Python Flask API (port 8000) | Express 5 + TypeScript API (port 3001) with Prisma ORM |
| SQLite / JSON files for state | PostgreSQL 16 with 10-table Prisma schema |
| No caching | Redis 7 with 256MB LRU + AOF persistence |
| No reverse proxy | Traefik v3.3 with TLS termination, HTTP→HTTPS redirect |
| No containerization | 6-container Docker Compose stack (all `network_mode: host` except Kasm) |
| Run on developer laptop | Dedicated Proxmox VM (Debian 12 + Kali repos, VM 122) |
| No VPN integration | 5 VPN providers with nftables kill switch |
| No remote access | KasmVNC browser container (port 6901) + Tailscale mesh |
| Single AI provider (OpenAI) | 4 AI providers (OpenAI, Anthropic, Ollama, Grok) with agentic tool loop |
| No MCP server | 16-category MCP tool server with guardrails |

---

## New Backend (api/src/) — 45 TypeScript Files

- **Express 5** with ESM, Zod validation, Helmet security headers, rate limiting
- **Prisma 6.4** with PostgreSQL: 10 models (Target, Scan, ScanResult, LootItem, CredentialPair, AIThought, LogEntry, Service, VpnConnection, ConfigEntry)
- **Socket.IO 4.8** real-time events: scan progress, metrics, AI thoughts, logs
- **9-phase scan pipeline**: Recon → AI Analysis → Web Scans → VulnAPI → Metasploit → AI Analysis 2 → Exploitation → Reporting → Complete
- **35+ tool executor** with host binary resolution from Docker bind mounts
- **MCP bridge** — JSON-RPC 2.0 over stdio to Python MCP server
- **Credential validator** — SSH/FTP/HTTP/SMB testing via hydra
- **Multi-provider AI** — OpenAI (GPT-5.2), Anthropic (Claude Sonnet 4.6), Ollama (Qwen3), Grok (Grok-3)
- **VPN service** with iptables fwmark split routing
- **Real-time metrics** — CPU/RAM from `/proc/stat` + `/proc/meminfo`, VPN IP detection

### Routes (14 REST endpoints)
`/status`, `/services`, `/targets`, `/config`, `/logs`, `/recon`, `/results`, `/loot`, `/loot/credentials`, `/exploit`, `/ai`, `/vulnapi`, `/mcp`, `/vpn`

### Health Endpoint
`/health` — returns DB (Prisma `SELECT 1`) + Redis (`PING`) connectivity, returns 503 when degraded

---

## Frontend (web/src/) — 46 Files, React 19

- **React 19** with Vite 7, TypeScript 5.9
- **Tailwind CSS 4** with custom CSS variables
- **Zustand 5** — 7 stores: system, recon, loot, AI, exploitation, log, UI
- **TanStack Query 5** for server state
- **Socket.IO client** for real-time updates
- **9 view modules**: Dashboard, Targets, Results, Exploitation, Loot, AI Stream, Services, Configuration, Logs
- **Command Center dashboard**: live CPU/RAM metrics, scan launcher, service status, AI feed
- **Exploitation view**: credential lists, vulnerability lists, shell access, timeline
- **Loot heatmap**: credential scoring, sensitivity analysis, export

---

## Docker Stack — 6 Containers

| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| `cstrike-postgres` | postgres:16-alpine | 5432 | Primary database |
| `cstrike-redis` | redis:7-alpine | 6379 | Cache + pub/sub |
| `cstrike-api` | Custom (Node 22 + Python 3.12) | 3001 | REST API + WebSocket |
| `cstrike-frontend` | Custom (Vite build + serve) | 3000 | Web dashboard |
| `cstrike-traefik` | traefik:v3.3 | 80/443 | TLS reverse proxy |
| `cstrike-kasm` | kasmweb/chrome:1.16.0 | 6901 | Remote browser access |

API container mounts host binaries read-only (`/usr/bin`, `/usr/sbin`, `/usr/local/bin`, `/opt`) so containerized API can execute host-installed security tools.

---

## VM Infrastructure (Debian 12 + Kali Rolling)

**1,028 packages installed**, including:

**Security Tools (27 verified)**:
nmap, nikto, sqlmap, hydra, john, hashcat, nuclei, httpx, ffuf, gobuster, feroxbuster, rustscan, masscan, whatweb, wafw00f, wpscan, enum4linux, smbclient, dnsrecon, testssl.sh, sslscan, sslyze, dirb, crackmapexec, xsstrike, commix, arjun

Plus: Metasploit Framework (msfrpcd on port 55552), subfinder, amass, katana, gau, waybackurls, gowitness, impacket-scripts, bloodhound, certipy-ad

**VPN Clients (5 providers)**:

| Provider | Version |
|----------|---------|
| Mullvad | 2025.14 |
| ProtonVPN CLI | 2.2.11 |
| WireGuard | 1.0.20210914 |
| OpenVPN | 2.6.3 |
| Tailscale | 1.94.2 |

**AI Tools**:
- Claude Code 2.1.62
- OpenAI Codex CLI 0.106.0

**Runtime**:
- Node.js 22.22.0, npm 10.9.4
- Python 3.13.11

---

## Firewall & VPN Kill Switch (`/etc/nftables.d/cstrike.conf`)

- `table inet cstrike` with INPUT/OUTPUT/FORWARD chains
- RFC1918 variable: `{ 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 }`
- Management access (SSH, web, Kasm) only from private networks + Tailscale
- **VPN kill switch**: All outbound eth0 traffic to public IPs is DROPPED unless it's VPN establishment (WireGuard 51820, OpenVPN 1194-1198, Mullvad/ProtonVPN 443) or DNS bootstrap
- VPN tunnel interfaces (`tun0`, `wg0`, `wg-mullvad`, `proton0`, `tailscale0`) fully allowed
- Docker bridge forwarding for Kasm container
- Kill switch log prefix `CSTRIKE_KILLSW:` for monitoring

---

## Systemd Services (7 enabled, auto-start on boot)

| Service | Type | Purpose |
|---------|------|---------|
| `docker` | system | Docker daemon |
| `containerd` | system | Container runtime |
| `cstrike.service` | oneshot | `docker compose up -d` on boot |
| `msfrpcd.service` | simple | Metasploit RPC daemon (127.0.0.1:55552) |
| `fail2ban` | system | SSH brute-force protection |
| `auditd` | system | Audit logging |
| `tailscaled` | system | Tailscale daemon |
| `nftables` | system | Firewall persistence |

---

## Redteam Operational Scripts (8 scripts, ~128KB)

| Script | Size | Purpose |
|--------|------|---------|
| `vpn-switch.sh` | 15KB | Quick-switch between 5 VPN providers, Mullvad lockdown toggle |
| `opsec-check.sh` | 18KB | 7-point pre-engagement OPSEC gate (kill switch, VPN, DNS leak, etc.) |
| `cstrike-status.sh` | 20KB | 5-section system dashboard (containers, services, network, security) |
| `engagement.sh` | 18KB | Engagement lifecycle: start/list/archive/resume with MSF workspace + tmux |
| `cleanup.sh` | 22KB | Post-engagement cleanup (history, tmp, logs, Docker, MSF) with dry-run |
| `rotate-ip.sh` | 12KB | VPN exit IP rotation with before/after comparison |
| `manage-access.sh` | 6KB | Add/remove public IPs for management access via nftables |
| `system-wipe.sh` | 17KB | Emergency wipe with passphrase gate ("BURN IT ALL DOWN"), root-only |

---

## MCP Server — 16 Tool Categories, Guardrails

| Category | Tools |
|----------|-------|
| `recon` | nmap, subfinder, amass, httpx, waybackurls, etc. |
| `network_enum` | Network enumeration |
| `web_exploit` | sqlmap, xsstrike, commix, arjun |
| `exploitation` | Exploit automation |
| `metasploit` | Metasploit RPC automation |
| `credentials` | Credential testing |
| `password_crypto` | hashcat, john, hash identification |
| `impacket` | AD/SMB: secretsdump, psexec, wmiexec, GetUserSPNs |
| `ssl_tls` | testssl, sslscan, sslyze |
| `osint` | theHarvester, Shodan, Sherlock |
| `cloud_container` | Trivy, kube-hunter |
| `vulnapi_tools` | VulnAPI DAST |
| `zap_burp` | ZAP/Burp proxy integration |
| `black_ops` | Proxy chaining, agent routing |
| `post_exploit` | Post-exploitation chains |
| `system` | System info, metrics |

**Guardrails**: Target scope enforcement, tool allowlist, scan mode gating, exploitation gate (double-enforced at API middleware + MCP layer)

---

## VM Provisioning Scripts (`scripts/vm/`)

| Script | Purpose |
|--------|---------|
| `cloud-init.yml` | Proxmox/Debian 12 cloud-init config |
| `create-vm.sh` | Proxmox VM creation |
| `provision-host.sh` | Full 7-step host setup: Kali tools, Go/Rust tools, Python security tools, VPN clients, Docker |
| `harden-host.sh` | SSH/sysctl hardening |
| `setup-redteam.sh` | Redteam user creation + iptables fwmark VPN routing |

---

## Database Schema (10 models, PostgreSQL 16)

`Target` → `Scan` → `ScanResult` (polymorphic: 10 result types)
`LootItem` (10 loot types) ← `CredentialPair` (scored, validated)
`AIThought` (8 thought types for reasoning trace)
`Service` (health tracking), `VpnConnection` (5 providers), `ConfigEntry` (versioned KV), `LogEntry` (structured logs)

**Seeded data**: 5 services, 25 config entries, 5 VPN connections

---

## Security Hardening

- nftables kill switch (all clearnet blocked unless VPN tunnel active)
- fail2ban on SSH
- auditd logging
- Mullvad lockdown mode (toggled only when Mullvad is active provider)
- Self-signed TLS via Traefik
- Rate limiting (100 req/min per IP)
- Helmet security headers
- Zod request validation
- Path traversal prevention (`safeTargetPath.ts`)
- Guardrails at API + MCP layers

---

## What Changed Across 73 Commits

| Category | Count | Scope |
|----------|-------|-------|
| Architecture rewrites | 3 | Python→Node.js API, DB migration, Docker stack |
| Feature additions | 15 | VulnAPI, MCP server, Kasm, multi-provider AI, concurrent scanning |
| Bug fixes | 25 | Metrics, WebSocket, ports, dependencies, health checks |
| Security hardening | 4 | Credential scrub, guardrails, PII removal, remediation |
| Documentation | 5 | README rewrite, API reference, deployment docs |
| Dependency fixes | 18 | Python 3.13 compat, pip resolution, version pins |
| DevOps/infra | 3 | Docker Compose, Traefik, VM provisioning scripts |

---

## VM Distribution & Release (February 2026)

| Category | Scope |
|----------|-------|
| VM packaging | `package-vm.sh` — export Proxmox VM to QCOW2/VDI/VMDK/OVA with data scrubbing |
| First-boot service | `cstrike-firstboot.sh` — partition expansion, SSH key regen, password randomization, Docker stack startup |
| OVF descriptor | `cstrike-v2.ovf` — standard VM metadata for cross-platform import |
| Static hosting | nginx `/dist/` endpoint on registry.culpur.net for direct HTTP downloads |
| BitTorrent | 4 `.torrent` files with webseed (BEP19), aria2 seeder daemon |
| Network setup | `cstrike-netsetup` — interactive interface configuration on first login |
| Cloud-init | `cloud-init-generic.yml` — deploy on AWS, GCP, Azure, DigitalOcean |
| Documentation | README, DISTRIBUTION.md, and deployment guides updated for v2.0 release |

---

## v2.5.0 (March 2026)

### New Features

| Feature | Details |
|---------|---------|
| AI Thinking Mode | Toggle for all providers — Ollama native `think` parameter, OpenAI/Anthropic/Grok via CoT system prompt injection |
| Service Host Indicators | REDIS and OLLAMA indicators on Command Center display configured host:port from env/config |
| AI Feed Dynamic Layout | Fills remaining viewport height on dashboard, scrollable, auto-resizes with window |
| Exploitation Tracks Growth | Fills available dashboard space matching AI Feed behavior with flex layout |
| AI Feed Expanded | 50 thought entries (up from 5), content truncation threshold 300 chars (up from 100) |
| TaskMapFooter Error Boundary | React error boundary wrapping task pipeline footer for crash recovery |
| VulnBox Container | Deliberately vulnerable target with 30+ vulnerabilities across 12 services (SSH, Apache, FTP, MySQL, SNMP, Flask API, Samba, Redis, BIND9, LDAP, Postfix, HTTPS) |
| Metasploit RPC Container | `metasploitframework/metasploit-framework` with msfrpcd daemon and dedicated PostgreSQL database |
| OWASP ZAP Daemon | `zaproxy/zap-stable` running in daemon mode for automated web scanning |
| 9-Container Stack | Up from 6 — added ZAP, Metasploit, VulnBox to Docker Compose |
| ARM64 Support | `docker-compose.arm64.yml` override (linuxserver/chromium instead of Kasm), native aarch64 VM images |
| Enable/Disable All | Bulk toggle buttons for Scan Modes and Allowed Tools in Configuration |
| Early Exploitation | Task materialization during recon, persistence payloads, task map footer |
| Full-Auto Mode | Exploitation gate bypass for automated attack chains |

### Bug Fixes

| Fix | Details |
|-----|---------|
| Strict TypeScript Build | Resolved all strict-mode errors for Docker `tsc -b` builds |
| Target Deletion | URL vs ID parsing fix for target removal |
| Scan Stop/Target Status | Proper sync of scan cancellation and target status updates |
| AI Timeout | Increased to 3 minutes, reduced prompt size to prevent timeouts |
| Credential Validation | Phase 5 re-validation dedup, Hydra `-I` flag for validation skip |
| startRecon Parsing | Correct response field extraction from recon start API |

### Infrastructure

| Change | Details |
|--------|---------|
| Dual Architecture | amd64 + aarch64 pre-built VM images (QCOW2, OVA, VDI) |
| Per-Format Torrents | Individual webseed torrents per image format per architecture |
| Host Hardening | `harden-host.sh` additions for SSH, PAM, auditd |
| Registry Distribution | Dual-arch downloads at `registry.culpur.net/dist/` |
| VulnBox Standalone | Separate GitHub release at `culpur/vulnbox` with git bundle for offline distribution |
