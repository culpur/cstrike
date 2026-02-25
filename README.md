# CStrike (Formally Ai-Driver)

An elite, modular offensive security automation framework with full TUI integration, OpenAI-enhanced command chaining, real-time recon, exploitation, and pivoting. Built for serious red team operations with support for split-VPN routing, ZAP/Burp Suite integration, Metasploit RPC automation, and interactive dashboards.

---

## 🚀 Key Features

- **Layered Reconnaissance** with tools like `nmap`, `dig`, `amass`, `subfinder`, `httpx`, `nikto`, `wafw00f`, etc.
- **AI-Augmented Command Chaining** using OpenAI (GPT-4o), streaming decisions in real time.
- **Auto-Triggered Exploit Chains**: nuclei, ffuf, sqlmap, metasploit modules, smtp-user-enum, dnsenum.
- **Credential Loot Tracking & Reuse** for brute-forcing (`hydra`, etc).
- **Metasploit RPC Automation** via `pymetasploit3` (auto-credentialed).
- **Burp/ZAP Integration** with toggles via dashboard or AI.
- **TUI Dashboard** (curses):

  - Live stream of current recon/exploit status
  - System metrics (CPU, RAM, VPN IP)
  - Service statuses
  - AI thought window
  - Split-screen log viewer with `ERROR`/`WARN` filters
  - Hotkeys to start/stop tools or view live logs

- **VPN Split Routing**: Run tools as `redteam` user → traffic isolated via `wg0` or `tun0`
- **Mission-Ready Modular Design**: Easily add more tools or scan logic

---

## 📁 Project Structure

```bash
ai_driver/
├── ai_driver.py              # Main orchestrator
├── dashboard.py              # TUI live dashboard
├── setup_redteam_env.sh      # Environment + routing bootstrap
├── requirements.txt
├── .env                      # JSON config file (not dotenv)
├── modules/
│   ├── recon.py              # Multi-tool recon logic
│   ├── exploitation.py       # FFUF, nuclei, brute-force logic
│   ├── zap_burp.py           # ZAP/Burp scanner integration
│   ├── metasploit.py         # RPC control logic
│   ├── loot_tracker.py       # Tracks discovered usernames, creds, etc.
│   ├── ai_assistant.py       # OpenAI GPT assistant + command parser
│   └── utils.py              # Support utilities
├── results/                  # Output per target (loot, json, markdown)
└── logs/driver.log           # Global log (used by dashboard)
```

---

## 🧠 AI Features

| Feature                      | Description                                                            |
|-----------------------------|------------------------------------------------------------------------|
| 🧠 Thought Streaming         | Dashboard shows real-time AI decisions as they are generated          |
| ⚡ Auto-Triggered Exploits   | AI can auto-run chains like nuclei, hydra, metasploit modules          |
| 🤖 AI Post-Exploitation Loop | Follows up after initial exploit chain to suggest lateral moves       |
| 🧼 Safe Command Parser       | Extracts only shell-safe commands from OpenAI replies                  |
| 💾 Logs & Outputs Persisted | Stored in `results/<target>/ai_suggestions*.json` + logs               |

---

## 📡 Dashboard (TUI)

| Hotkey | Function                                 |
|--------|------------------------------------------|
| `3`    | Toggle Live Logs                         |
| `4`    | Start Metasploit RPC, ZAP, Burp          |
| `5`    | Stop all services                        |
| `f`    | Filter logs for `[ERROR]` / `[WARN]`     |
| `q`    | Quit the dashboard                       |

Includes:

- VPN IP detection via `tun0` / `wg0`
- CPU/RAM % usage
- Current target
- Phase progress (recon → AI → zap → metasploit → exploit)
- AI "thought" log viewer
- Log filter, scroll, highlight

---

## 🧪 Setup

### 1. Clone and configure

```bash
mkdir /opt/ai_driver
cd /opt
git clone https://github.com/culpur/cstrike.git
cd ai_driver
cp .env.example .env
```

### 2. Create virtualenv

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

---

## ⚙️ Split VPN Setup: redteam User

To isolate all scanning traffic through a VPN tunnel:

### Step 1: Bootstrap with `setup_redteam_env.sh`

```bash
sudo bash setup_redteam_env.sh
```

Creates:

- `redteam` user w/ `/bin/zsh`
- Project files in `/opt/ai_driver`
- ZSH aliases (`ai_driver`, `setup_anon`)
- `iptables` + `ip rule` VPN routing (via `wg0`)
- Default route in table `wgvpn`

### Step 2: Test isolation

```bash
su - redteam
curl --interface wg0 https://ifconfig.me
ai_driver
```

All commands as `redteam` will now use the VPN route.

---

## 🧵 .env Example

```json
{
  "target_scope": ["culpur.net"],
  "openai_api_key": "sk-xxxxxxxxxxxx",
  "allow_exploitation": true,
  "scan_modes": ["http", "dns", "port", "vulnscan"],
  "allowed_tools": [
    "nmap", "ffuf", "httpx", "sqlmap",
    "dig", "subfinder", "amass",
    "nikto", "wafw00f", "smtp-user-enum", "dnsenum"
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

## 🎯 Example Usage

```bash
# Launch full pipeline with live dashboard
python3 ai_driver.py
```

- Will open curses dashboard
- Shows status of recon/exploitation per target
- Auto-invokes AI twice: post-recon + post-exploitation
- Auto-triggers all exploit logic if `allow_exploitation = true`

---

## 🔮 Coming Soon

These features are already scaffolded or partially integrated:

- ✅ Proxy chaining logic for agent routing
- ✅ Pivot interface in TUI
- ✅ Credential heatmaps in dashboard
- 🔄 Remote agent registration
- 🔍 AI-driven lateral movement planner
- 📂 Export full report: Markdown + JSON

---

## 🔐 Legal

This tool is intended only for **authorized red team use**. Use against unauthorized targets is illegal and unethical.

---

## 📜 License

MIT License © 2025 Culpur Defense Inc.

---

## 🙌 Credits & Contact

Crafted by [Culpur Defense Inc.](https://culpur.net)

- GitHub: [https://github.com/culpur](https://github.com/culpur)
- Website: [https://culpur.net](https://culpur.net)
