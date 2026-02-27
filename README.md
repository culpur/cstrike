<p align="center">
  <img src="assets/cstrike-banner-800.png" alt="CStrike v2" width="800" />
</p>

<p align="center">
  <strong>Autonomous Offensive Security Platform</strong><br>
  <sub>Containerized Docker stack | 35+ integrated tools | AI-driven 9-phase attack pipeline</sub>
</p>

<p align="center">
  <img src="assets/cstrike-icon-100.png" alt="" width="40" />
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> |
  <a href="#web-ui">Web UI</a> |
  <a href="#cli-mode">CLI Mode</a> |
  <a href="#api-reference">API</a> |
  <a href="#documentation">Docs</a>
</p>

---

CStrike v2 is an autonomous offensive security platform with a containerized Docker stack, real-time web dashboard, and AI-driven scan orchestration across 35+ integrated tools. Features a 9-phase attack pipeline (recon through exploitation), multi-provider AI reasoning (OpenAI, Anthropic, Ollama, Grok) with MCP tool server, nftables VPN kill switch across 5 providers, Metasploit RPC automation, and remote browser access via KasmVNC. Built for red team operations on isolated infrastructure with engagement lifecycle management, OPSEC gating, and emergency wipe capability.

Built for authorized red team engagements. Requires explicit scope authorization before use.

---

## Prerequisites

| Dependency | Version | Purpose |
|-----------|---------|---------|
| Python | 3.11+ | Backend runtime |
| Node.js | 20+ | Web UI frontend |
| nmap | 7.x | Port scanning / service detection |
| OpenAI API key | GPT-4o | AI-driven command chaining |
| Metasploit Framework | 6.x | Exploit automation (optional) |
| OWASP ZAP | 2.14+ | Web app scanning (optional) |
| VulnAPI | latest | API security scanning (optional) |

**Recon tools** (install as needed): `amass`, `subfinder`, `httpx`, `nikto`, `wafw00f`, `whatweb`, `dnsrecon`, `dnsenum`, `nuclei`, `ffuf`, `sqlmap`, `hydra`, `masscan`, `theHarvester`, `wpscan`, `enum4linux-ng`

---

## Quick Start

```bash
# Clone
git clone https://github.com/culpur/cstrike.git
cd cstrike

# Configure
cp .env.example .env
# Edit .env — set target_scope and openai_api_key at minimum

# Install Python dependencies
bash setup.sh
source venv/bin/activate

# Run (choose one)
python3 cstrike.py                  # CLI — headless 9-phase pipeline
bash START_CSTRIKE.sh               # Web — API server + React frontend
```

The web UI launches at **http://localhost:3000** with the API backend on **http://localhost:8000**.

---

## Architecture

```
                          ┌──────────────────────────────────┐
                          │          React Web UI             │
                          │  localhost:3000 (Vite dev server) │
                          └──────────┬───────────────────────┘
                                     │ REST + WebSocket
                          ┌──────────▼───────────────────────┐
                          │   Flask + Socket.IO API Server    │
                          │        localhost:8000              │
                          └──────────┬───────────────────────┘
                                     │
          ┌──────────┬───────────┬───┴───┬───────────┬──────────┐
          ▼          ▼           ▼       ▼           ▼          ▼
       recon.py  zap_burp.py vulnapi.py metasploit.py exploit.py ai_assistant.py
          │          │           │       │           │          │
          ▼          ▼           ▼       ▼           ▼          ▼
       nmap,dig   ZAP/Burp   VulnAPI  msfrpcd   nuclei,    OpenAI
       amass...   proxies    DAST      RPC      ffuf,hydra  GPT-4o
```

**CLI mode** (`cstrike.py`) runs the same module stack directly without the API layer.

---

## Workflow

CStrike executes a 9-phase pipeline per target. Each phase feeds results forward.

| # | Phase | Modules | Output |
|---|-------|---------|--------|
| 1 | **Reconnaissance** | nmap, dig, amass, subfinder, httpx, nikto, wafw00f, whatweb, dnsrecon | Port map, subdomains, tech stack, headers |
| 2 | **AI Analysis** | OpenAI GPT-4o | Suggested commands, attack vectors |
| 3 | **Web Scanning** | OWASP ZAP, Burp Suite | Web vulnerabilities, injection points |
| 4 | **Web Exploitation** | nuclei, ffuf, sqlmap, hydra | CVEs, directory findings, SQLi, brute-force |
| 5 | **API Security** | VulnAPI (discover, curl, openapi) | API endpoints, OWASP API Top 10 findings |
| 6 | **Metasploit** | msfrpcd RPC | Exploit sessions, post-exploitation data |
| 7 | **Exploitation Chains** | Auto-chained from phases 2-6 | Credential reuse, lateral movement |
| 8 | **AI Follow-up** | OpenAI GPT-4o | Pivot suggestions, missed vectors |
| 9 | **Reporting** | loot_tracker, results compiler | JSON results, loot summary, credentials |

---

## Web UI

The frontend is a React 19 / TypeScript / Tailwind CSS application with a dark theme.

| Module | Description |
|--------|-------------|
| **Dashboard** | System metrics (CPU, RAM, VPN IP), service status, phase progress |
| **Targets** | Add/manage targets, launch scans, view results per target |
| **AI Stream** | Real-time GPT-4o thought stream and command decisions |
| **Exploitation** | Web vuln exploitation controls, brute-force configuration |
| **Loot** | Credential tracker with sensitivity heatmaps and export |
| **Live Logs** | Streaming log viewer with ERROR/WARN filtering |
| **Configuration** | Scan mode toggles, tool allowlist, service connections |

### WebSocket Events

The frontend receives real-time updates via Socket.IO:

| Event | Payload |
|-------|---------|
| `recon_output` | Tool progress, output previews, completion status |
| `ai_thought` | AI reasoning stream |
| `phase_change` | Pipeline phase transitions |
| `vulnapi_output` | API scan progress and findings |
| `loot_item` | New credential/vulnerability discoveries |
| `log_entry` | Runtime log lines |

### Starting the Web UI

```bash
# Option 1: Combined startup with health checks
bash START_CSTRIKE.sh

# Option 2: Dev servers with log tailing
./START_DEV_SERVERS.sh              # both
./START_DEV_SERVERS.sh backend      # API only
./START_DEV_SERVERS.sh frontend     # React only
./START_DEV_SERVERS.sh stop         # stop all

# Option 3: Manual
python3 api_server.py &             # API on :8000
cd web && npm run dev               # React on :3000
```

---

## CLI Mode

The CLI pipeline runs all 9 phases headless with a curses TUI dashboard.

```bash
python3 cstrike.py
```

The TUI shows live phase progress, AI thoughts, service status, and system metrics.

| Key | Action |
|-----|--------|
| `3` | Toggle live log viewer |
| `4` | Start Metasploit RPC, ZAP, Burp |
| `5` | Stop all services |
| `f` | Filter logs (ERROR/WARN) |
| `q` | Quit |

For single-target recon without the full pipeline:

```bash
python3 manual_recon_runner.py <target>
```

---

## Configuration

CStrike uses a JSON `.env` file (not dotenv format).

```json
{
  "target_scope": ["example.com"],
  "openai_api_key": "sk-...",
  "allow_exploitation": true,
  "scan_modes": ["port", "http", "dirbusting", "dns", "subdomain", "osint", "vulnscan", "apiscan"],
  "allowed_tools": ["nmap", "ffuf", "httpx", "sqlmap", "dig", "subfinder", "amass", "nikto", "wafw00f", "nuclei", "hydra", "vulnapi"],
  "max_threads": 10,
  "max_runtime": 300,
  "msf_username": "msf",
  "msf_password": "",
  "msf_host": "127.0.0.1",
  "msf_port": 55552,
  "zap_host": "127.0.0.1",
  "zap_port": 8090
}
```

| Field | Description |
|-------|-------------|
| `target_scope` | Authorized target domains/IPs |
| `openai_api_key` | OpenAI API key for AI phases |
| `allow_exploitation` | Enable/disable active exploitation |
| `scan_modes` | Which scan categories to run |
| `allowed_tools` | Allowlist of permitted external tools |
| `max_runtime` | Per-tool timeout in seconds |
| `msf_*` | Metasploit RPC connection settings |
| `zap_*` | OWASP ZAP proxy connection settings |

---

## API Reference

The Flask API server exposes REST endpoints and WebSocket events.

### Scan Control

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/scan/start` | Start full pipeline for a target |
| GET | `/api/v1/scan/status` | Current scan status |
| POST | `/api/v1/vulnapi/scan` | Start VulnAPI scan (modes: full, curl, openapi) |
| GET | `/api/v1/vulnapi/results/<target>` | VulnAPI results for target |

### Targets & Results

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/targets` | List all scanned targets |
| GET | `/api/v1/results/<target>` | Compiled results for target |
| GET | `/api/v1/loot/<target>` | Loot (credentials, vulns) for target |

### Services

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/services/status` | Metasploit/ZAP/Burp status |
| POST | `/api/v1/services/<name>/start` | Start a service |
| POST | `/api/v1/services/<name>/stop` | Stop a service |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/system/metrics` | CPU, RAM, VPN IP |
| GET | `/api/v1/logs` | Recent log entries |

---

## Project Structure

```
cstrike/
├── cstrike.py                   # CLI orchestrator — 9-phase pipeline
├── api_server.py                # Flask + Socket.IO API server
├── dashboard.py                 # Curses TUI dashboard
├── manual_recon_runner.py       # Single-target recon runner
├── run_command.py               # Tool allowlist gateway
│
├── modules/
│   ├── recon.py                 # Layered reconnaissance (15+ tools)
│   ├── exploitation.py          # Web exploitation chains
│   ├── vulnapi.py               # VulnAPI DAST integration
│   ├── zap_burp.py              # ZAP / Burp Suite integration
│   ├── metasploit.py            # Metasploit RPC automation
│   ├── ai_assistant.py          # OpenAI GPT integration
│   ├── loot_tracker.py          # Credential & vuln loot tracking
│   ├── credential_validator.py  # Credential validation (SSH, FTP)
│   ├── black_ops.py             # Proxy chaining & agent routing
│   └── utils/
│       ├── __init__.py          # Command runner, result storage
│       ├── command.py           # Command execution helpers
│       └── logger.py            # Logging configuration
│
├── web/                         # React 19 / TypeScript / Tailwind frontend
│   ├── src/
│   │   ├── modules/             # dashboard, targets, ai-stream, exploitation,
│   │   │                        # loot, logs, results, configuration
│   │   ├── components/          # Shared UI components
│   │   ├── services/            # API client + WebSocket
│   │   ├── stores/              # Zustand state management
│   │   └── types/               # TypeScript interfaces
│   └── package.json
│
├── docs/                        # User-facing documentation
│   ├── archive/                 # Historical dev docs
│   └── legacy/                  # Deprecated files
│
├── results/                     # Per-target scan output (JSON)
├── logs/                        # Runtime logs
├── data/                        # Agent registry, runtime data
│
├── .env                         # Configuration (JSON format)
├── .env.example                 # Configuration template
├── requirements.txt             # Python dependencies (full)
├── api_requirements.txt         # Python dependencies (API server)
├── setup.sh                     # Python virtualenv setup
├── setup_redteam_env.sh         # Redteam user + VPN routing setup
├── setup_anon_env.sh            # Anonymous environment setup
├── START_CSTRIKE.sh             # Web UI startup script
├── START_DEV_SERVERS.sh         # Dev environment with health checks
├── start_cstrike_web.sh         # Alternative web startup
├── start_services.sh            # Start background services
└── stop_services.sh             # Stop background services
```

---

## VPN Split Routing

CStrike supports isolating all scan traffic through a dedicated VPN tunnel using a separate OS user.

```bash
# Bootstrap the redteam environment (run as root)
sudo bash setup_redteam_env.sh
```

This creates:
- A `redteam` user with zsh shell
- Project files deployed to `/opt/cstrike`
- iptables + ip rule routing through `wg0`
- Shell aliases: `cstrike` launches the CLI pipeline

```bash
su - redteam
cstrike              # all traffic routes through VPN
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [API Concurrent Scanning](docs/API_CONCURRENT_SCANNING.md) | Parallel scan architecture |
| [Concurrent Scanning Guide](docs/CONCURRENT_SCANNING_GUIDE.md) | Multi-target scanning |
| [Credential Validation Setup](docs/CREDENTIAL_VALIDATION_SETUP.md) | SSH/FTP credential testing |
| [Credential Validation System](docs/CREDENTIAL_VALIDATION_SYSTEM.md) | Validator architecture |
| [Heatmap Quick Start](docs/HEATMAP_QUICK_START.md) | Credential sensitivity heatmaps |
| [Loot Heatmap API](docs/LOOT_HEATMAP_API.md) | Heatmap API endpoints |
| [Loot Heatmap Implementation](docs/LOOT_HEATMAP_IMPLEMENTATION_SUMMARY.md) | Heatmap internals |
| [Web UI README](web/README.md) | Frontend architecture and development |

---

## Legal

This software is intended **exclusively for authorized penetration testing** and red team operations. You must have explicit written authorization before scanning or testing any target. Unauthorized access to computer systems is illegal under the Computer Fraud and Abuse Act (CFAA) and equivalent laws in other jurisdictions.

The authors assume no liability for misuse.

---

## License

MIT License (c) 2025 Culpur Defense Inc.

---

<p align="center">
  Built by <a href="https://culpur.net">Culpur Defense Inc.</a><br>
  <a href="https://github.com/culpur">GitHub</a>
</p>
