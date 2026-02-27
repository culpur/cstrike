# CStrike v2 — Bare Metal Installation Guide

Complete walkthrough from a fresh Debian 12 system to a fully operational CStrike stack with 80+ security tools, Docker containers, VPN routing, and security hardening.

---

## System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 4 cores | 8 cores |
| RAM | 8 GB | 16 GB |
| Disk | 50 GB | 100 GB |
| OS | Debian 12 (Bookworm) | Debian 12 |
| Network | 1 NIC | 2 NICs (mgmt + scan) |
| Internet | Required during install | Required |

---

## Quick Install

The master installer handles everything — tools, Docker, hardening, and stack startup:

```bash
git clone https://github.com/culpur/cstrike.git /opt/cstrike
cd /opt/cstrike
sudo bash install.sh
```

Flags:

| Flag | Effect |
|------|--------|
| `--no-vpn` | Skip VPN client installation (WireGuard, Mullvad, NordVPN, etc.) |
| `--no-harden` | Skip security hardening (for dev/test environments) |
| `--skip-tools` | Skip host tool installation (Docker stack only) |

The installer auto-generates random passwords for PostgreSQL, Redis, and KasmVNC, saves them to `.env`, and prints them at completion.

---

## Manual Installation

If you prefer to run each step individually, here is what `install.sh` does.

### Step 1: Base System

```bash
sudo apt-get update && sudo apt-get upgrade -y

sudo apt-get install -y \
    net-tools curl wget jq git zsh tmux htop vim unzip \
    gnupg ca-certificates apt-transport-https lsb-release \
    python3 python3-pip python3-venv python3-dev \
    build-essential libssl-dev libffi-dev \
    rsyslog sudo dnsutils iputils-ping iproute2 \
    iptables nftables
```

### Step 2: Kali Rolling Repository

Add the Kali repo at priority 50 (won't replace Debian packages):

```bash
curl -fsSL https://archive.kali.org/archive-key.asc | sudo gpg --dearmor -o /etc/apt/keyrings/kali-archive-keyring.gpg

echo "deb [signed-by=/etc/apt/keyrings/kali-archive-keyring.gpg] http://http.kali.org/kali kali-rolling main non-free non-free-firmware" | sudo tee /etc/apt/sources.list.d/kali.list

cat <<'EOF' | sudo tee /etc/apt/preferences.d/kali-priority
Package: *
Pin: release o=Kali
Pin-Priority: 50
EOF

sudo apt-get update
```

Install Kali tool packages:

```bash
sudo apt-get install -y -t kali-rolling \
    kali-tools-top10 kali-tools-web kali-tools-exploitation \
    kali-tools-information-gathering kali-tools-vulnerability \
    kali-tools-passwords

# Individual tools
sudo apt-get install -y -t kali-rolling \
    nmap nikto sqlmap dirb gobuster wfuzz hydra john hashcat \
    whatweb wafw00f sslscan sslyze testssl.sh masscan \
    enum4linux smbclient nbtscan onesixtyone snmpwalk \
    wpscan commix
```

### Step 3: Go Security Tools

```bash
# Install Go 1.22.5
wget -q https://go.dev/dl/go1.22.5.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.22.5.linux-amd64.tar.gz
export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin

# Install Go tools
go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest
go install github.com/projectdiscovery/httpx/cmd/httpx@latest
go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest
go install github.com/projectdiscovery/katana/cmd/katana@latest
go install github.com/owasp-amass/amass/v4/...@master
go install github.com/lc/gau/v2/cmd/gau@latest
go install github.com/tomnomnom/waybackurls@latest
go install github.com/ffuf/ffuf/v2@latest
go install github.com/sensepost/gowitness@latest

# Copy to system path
sudo cp ~/go/bin/* /usr/local/bin/
```

### Step 4: Rust Security Tools

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source ~/.cargo/env

cargo install rustscan
cargo install feroxbuster
sudo cp ~/.cargo/bin/{rustscan,feroxbuster} /usr/local/bin/
```

### Step 5: Python Security Tools

```bash
sudo pip3 install --break-system-packages \
    impacket xsstrike dnsrecon pwntools \
    crackmapexec bloodhound certipy-ad roadrecon
```

### Step 6: Binary Releases

```bash
# Chisel (tunneling)
wget -q https://github.com/jpillora/chisel/releases/download/v1.9.1/chisel_1.9.1_linux_amd64.gz
gunzip chisel_1.9.1_linux_amd64.gz
chmod +x chisel_1.9.1_linux_amd64
sudo mv chisel_1.9.1_linux_amd64 /usr/local/bin/chisel

# Trivy (container scanning)
curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sudo sh -s -- -b /usr/local/bin
```

### Step 7: VPN Clients

```bash
# WireGuard
sudo apt-get install -y wireguard-tools

# OpenVPN
sudo apt-get install -y openvpn

# Tailscale
curl -fsSL https://tailscale.com/install.sh | sudo sh

# NordVPN
wget -q https://repo.nordvpn.com/deb/nordvpn/debian/pool/main/nordvpn-release_1.0.0_all.deb
sudo dpkg -i nordvpn-release_1.0.0_all.deb
sudo apt-get update && sudo apt-get install -y nordvpn

# Mullvad
sudo curl -fsSLo /usr/share/keyrings/mullvad-keyring.asc https://repository.mullvad.net/deb/mullvad-keyring.asc
echo "deb [signed-by=/usr/share/keyrings/mullvad-keyring.asc] https://repository.mullvad.net/deb/stable bookworm main" | sudo tee /etc/apt/sources.list.d/mullvad.list
sudo apt-get update && sudo apt-get install -y mullvad-vpn
```

### Step 8: Docker Engine

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" | sudo tee /etc/apt/sources.list.d/docker.list

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

### Step 9: CStrike Stack

```bash
cd /opt/cstrike

# Configure
cp .env.example .env
# Edit .env — set POSTGRES_PASSWORD, REDIS_PASSWORD, KASM_PASSWORD

# Generate TLS certs
bash docker/generate-certs.sh

# Build and start
docker compose up -d

# Seed database
docker exec cstrike-api npx prisma db seed
```

### Step 10: Redteam User

```bash
sudo bash scripts/vm/setup-redteam.sh
```

Creates a `redteam` user with:
- Docker and sudo access
- VPN split routing via iptables fwmark
- oh-my-zsh with CStrike shell aliases (`cs-up`, `cs-down`, `cs-logs`, etc.)

### Step 11: Security Hardening

```bash
sudo bash scripts/vm/harden-host.sh
```

Applies:
- Kernel sysctl hardening (CIS L2 / STIG-aligned)
- SSH hardening (pubkey-only, MaxAuthTries 3, hardened ciphers)
- PAM faillock (5 attempts, 15-min lockout) + password quality
- Auditd rules (identity, logins, sudo, Docker events)
- Fail2ban (SSH: 3 retries → 1hr ban; recidive: 7-day ban)
- Docker daemon hardening (no ICC, no new privileges, limited logging)

---

## Post-Install Configuration

### Systemd Services

Create the CStrike auto-start service:

```bash
sudo tee /etc/systemd/system/cstrike.service << 'EOF'
[Unit]
Description=CStrike v2 Docker Stack
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/cstrike
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable cstrike.service
```

### Metasploit RPC (if installed)

```bash
sudo tee /etc/systemd/system/msfrpcd.service << 'EOF'
[Unit]
Description=Metasploit RPC Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/msfrpcd -P msf -S -a 127.0.0.1 -p 55552 -f
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now msfrpcd.service
```

### First Login

1. Open `https://<ip>/` in your browser (accept the self-signed cert)
2. Go to **Configuration** tab
3. Set your AI provider API key (OpenAI, Anthropic, Ollama, or Grok)
4. Go to **Targets** tab
5. Add an authorized target
6. Launch a scan

---

## Verification Checklist

```bash
# All 6 containers healthy
docker compose ps

# Health endpoint returns ok
curl -sk https://localhost/health | jq .status

# CPU/RAM metrics are non-zero
curl -sk https://localhost/api/v1/status | jq '.data.metrics'

# Host tools accessible from API container
docker exec cstrike-api /host/usr/bin/nmap --version

# Systemd services enabled
systemctl is-enabled cstrike.service
systemctl is-enabled msfrpcd.service 2>/dev/null

# Security hardening applied
sudo sysctl net.ipv4.tcp_syncookies   # Should be 1
sudo sshd -T | grep passwordauthentication  # Should be no
sudo systemctl is-active fail2ban
sudo systemctl is-active auditd

# Reboot test
sudo reboot
# After reboot, verify: docker compose ps shows all healthy
```

---

## Installed Tool Summary

| Category | Tools |
|----------|-------|
| **Port Scanning** | nmap, masscan, rustscan |
| **Web Recon** | nikto, whatweb, wafw00f, httpx, gowitness |
| **Subdomain Enum** | subfinder, amass, dnsrecon |
| **Directory Fuzzing** | ffuf, gobuster, feroxbuster, dirb, wfuzz |
| **Vulnerability Scanning** | nuclei, sqlmap, xsstrike, commix |
| **Credential Attacks** | hydra, john, hashcat, cewl |
| **Network Enum** | enum4linux, smbclient, ldapsearch, snmpwalk |
| **SSL/TLS** | testssl.sh, sslscan, sslyze |
| **Post-Exploitation** | impacket suite, chisel, bloodhound |
| **Container Security** | trivy, kube-hunter |
| **OSINT** | theHarvester, sherlock, gau, waybackurls |
| **Exploitation Frameworks** | Metasploit, OWASP ZAP |
| **VPN** | WireGuard, OpenVPN, Tailscale, NordVPN, Mullvad |
