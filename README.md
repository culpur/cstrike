# CStrike

An autonomous, modular offensive security framework with AI-driven command chaining, real-time recon, exploitation, API security scanning, and interactive dashboards. Built for authorized red team operations with split-VPN routing, ZAP/Burp Suite integration, Metasploit RPC automation, VulnAPI DAST scanning, and a React web UI.

---

## Key Features

- **9-Phase Autonomous Workflow**: Recon, AI Analysis, ZAP/Burp, Web Exploitation, API Security (VulnAPI), Metasploit, Post-Exploitation, AI Follow-up, Reporting
- **Layered Reconnaissance**: nmap, dig, amass, subfinder, httpx, nikto, wafw00f, and more
- **AI-Augmented Command Chaining**: OpenAI GPT-4o streams decisions in real time
- **API Security Scanning**: VulnAPI integration for endpoint discovery, OpenAPI spec scanning, and DAST
- **Auto-Triggered Exploit Chains**: nuclei, ffuf, sqlmap, hydra, metasploit modules
- **Credential Loot Tracking & Reuse**: Automatic credential harvesting and brute-force reuse
- **Metasploit RPC Automation**: Auto-credentialed via pymetasploit3
- **Burp/ZAP Integration**: Toggle via dashboard or AI
- **Web UI**: React/TypeScript frontend with real-time WebSocket updates
- **TUI Dashboard**: curses-based live status, AI thoughts, log viewer
- **VPN Split Routing**: Isolate scan traffic via wg0/tun0 as redteam user
- **Black Ops Module**: Proxy chaining, agent routing, credential heatmaps

---

## Project Structure

```
cstrike/
├── cstrike.py                 # Main CLI orchestrator (9-phase workflow)
├── api_server.py              # Flask + Socket.IO API backend
├── dashboard.py               # TUI live dashboard (curses)
├── manual_recon_runner.py     # Manual single-target recon trigger
├── run_command.py             # Command allowlist/execution gateway
├── requirements.txt           # Python dependencies (CLI)
├── api_requirements.txt       # Python dependencies (API server)
├── .env                       # JSON config (targets, API keys, tool toggles)
├── .env.example               # Config template
├── setup.sh                   # Quick virtualenv setup
├── setup_redteam_env.sh       # Full redteam user + VPN routing bootstrap
├── setup_anon_env.sh          # Anonymous environment setup
├── start_cstrike_web.sh       # Start web UI + API server
├── START_CSTRIKE.sh           # Quick start script
├── modules/
│   ├── recon.py               # Multi-tool layered reconnaissance
│   ├── exploitation.py        # FFUF, nuclei, brute-force, VulnAPI chains
│   ├── vulnapi.py             # VulnAPI DAST integration (API scanning)
│   ├── zap_burp.py            # ZAP/Burp Suite scanner integration
│   ├── metasploit.py          # Metasploit RPC automation
│   ├── ai_assistant.py        # OpenAI GPT assistant + command parser
│   ├── loot_tracker.py        # Credential/vulnerability loot tracking
│   ├── credential_validator.py # Credential validation
│   ├── black_ops.py           # Proxy chaining, agent management, heatmaps
│   └── utils/
│       ├── __init__.py        # Shared utilities (run commands, save results)
│       ├── command.py         # Command execution helpers
│       └── logger.py          # Logging setup
├── web/                       # React/TypeScript frontend
│   ├── src/
│   │   ├── services/          # API client + WebSocket
│   │   ├── modules/           # UI modules (targets, scans, loot)
│   │   └── types/             # TypeScript interfaces
│   └── package.json
├── docs/                      # User-facing documentation
├── results/                   # Output per target (loot, JSON, reports)
└── logs/                      # Runtime logs
```

---

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/culpur/cstrike.git
cd cstrike
cp .env.example .env
# Edit .env with your targets and API keys
```

### 2. Install dependencies

```bash
bash setup.sh
source venv/bin/activate
```

### 3. Run CStrike

```bash
# CLI mode (9-phase autonomous workflow)
python3 cstrike.py

# Web UI mode (API server + React frontend)
bash start_cstrike_web.sh
```

---

## 9-Phase Workflow

| Phase | Description |
|-------|-------------|
| 1. Recon | Layered reconnaissance (nmap, amass, subfinder, httpx, nikto, etc.) |
| 2. AI Analysis | GPT-4o analyzes recon data, suggests next steps |
| 3. ZAP/Burp | Automated web vulnerability scanning |
| 4. Web Exploitation | nuclei, ffuf, sqlmap, brute-force chains |
| 5. API Security | VulnAPI endpoint discovery + DAST scanning |
| 6. Metasploit | RPC-driven exploit modules |
| 7. Post-Exploitation | Credential reuse, lateral movement |
| 8. AI Follow-up | GPT-4o reviews findings, suggests pivots |
| 9. Reporting | Compile results, loot summary, JSON export |

---

## TUI Dashboard

| Hotkey | Function |
|--------|----------|
| `3` | Toggle live log viewer |
| `4` | Start Metasploit RPC, ZAP, Burp |
| `5` | Stop all services |
| `f` | Filter logs for ERROR/WARN |
| `q` | Quit |

---

## VPN Split Routing

Isolate all scan traffic through a VPN tunnel:

```bash
sudo bash setup_redteam_env.sh
su - redteam
cstrike    # alias for python3 /opt/cstrike/cstrike.py
```

Creates a `redteam` user with iptables + ip rule routing through wg0.

---

## .env Configuration

```json
{
  "target_scope": ["example.com"],
  "openai_api_key": "sk-xxxxxxxxxxxx",
  "allow_exploitation": true,
  "scan_modes": ["http", "dns", "port", "vulnscan", "apiscan"],
  "allowed_tools": [
    "nmap", "ffuf", "httpx", "sqlmap",
    "dig", "subfinder", "amass",
    "nikto", "wafw00f", "smtp-user-enum", "dnsenum",
    "nuclei", "vulnapi"
  ],
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

---

## Legal

This tool is intended only for **authorized red team use**. Use against unauthorized targets is illegal and unethical.

---

## License

MIT License (c) 2025 Culpur Defense Inc.

---

## Credits

Crafted by [Culpur Defense Inc.](https://culpur.net)

- GitHub: [https://github.com/culpur](https://github.com/culpur)
- Website: [https://culpur.net](https://culpur.net)
