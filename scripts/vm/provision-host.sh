#!/bin/bash
# CStrike VM — Host Provisioning Script
# Installs Kali tools, VPN clients, Docker, and Python on Debian 12
#
# Run as root on the cstrike VM after cloud-init completes.
# Usage: sudo ./provision-host.sh

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "═══════════════════════════════════════════════════════════"
echo "  CStrike Host Provisioning — Debian 12"
echo "═══════════════════════════════════════════════════════════"

# ── Step 1: Base system ───────────────────────────────────────
echo ""
echo "[1/7] Updating base system..."
apt-get update -qq
apt-get upgrade -y -qq

# Essential base packages
apt-get install -y -qq \
    net-tools curl wget jq git zsh tmux htop vim unzip \
    gnupg ca-certificates apt-transport-https lsb-release \
    python3 python3-pip python3-venv python3-dev \
    build-essential libssl-dev libffi-dev \
    rsyslog sudo dnsutils iputils-ping iproute2 \
    iptables nftables

echo "  Base system ready"

# ── Step 2: Kali repository + tools ──────────────────────────
echo ""
echo "[2/7] Adding Kali repository and installing tools..."

# Add Kali GPG key and repo
curl -fsSL https://archive.kali.org/archive-key.asc | gpg --dearmor -o /usr/share/keyrings/kali-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/kali-archive-keyring.gpg] https://http.kali.org/kali kali-rolling main non-free non-free-firmware" \
    > /etc/apt/sources.list.d/kali.list

# Pin Kali packages lower priority so Debian packages aren't replaced
cat > /etc/apt/preferences.d/kali.pref << 'EOF'
Package: *
Pin: release a=kali-rolling
Pin-Priority: 50
EOF

apt-get update -qq

# Kali metapackages — security tools
apt-get install -y -qq -t kali-rolling \
    kali-tools-top10 \
    kali-tools-web \
    kali-tools-exploitation \
    kali-tools-information-gathering \
    kali-tools-vulnerability \
    kali-tools-passwords \
    2>/dev/null || echo "  Some Kali metapackages may not be available, installing individual tools..."

# Individual tools that may not be in metapackages
for tool in nmap nikto sqlmap dirb gobuster wfuzz hydra john hashcat \
    whatweb wafw00f sslscan sslyze testssl.sh masscan \
    enum4linux smbclient nbtscan onesixtyone snmpwalk \
    wpscan commix; do
    apt-get install -y -qq -t kali-rolling "$tool" 2>/dev/null || \
        echo "  $tool: not available in repos, will install separately"
done

echo "  Kali tools installed"

# ── Step 3: Go-based and Rust-based tools ────────────────────
echo ""
echo "[3/7] Installing Go/Rust-based reconnaissance tools..."

# Install Go (needed for some tools)
if ! command -v go &>/dev/null; then
    GO_VERSION="1.22.5"
    GO_ARCH=$(dpkg --print-architecture 2>/dev/null || echo "amd64")
    curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz" | tar -C /usr/local -xz
    echo 'export PATH=$PATH:/usr/local/go/bin:/root/go/bin' >> /etc/profile.d/go.sh
    export PATH=$PATH:/usr/local/go/bin:/root/go/bin
fi

# Go tools
export GOPATH=/root/go
for gotool in \
    "github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest" \
    "github.com/projectdiscovery/httpx/cmd/httpx@latest" \
    "github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest" \
    "github.com/projectdiscovery/katana/cmd/katana@latest" \
    "github.com/owasp-amass/amass/v4/...@master" \
    "github.com/lc/gau/v2/cmd/gau@latest" \
    "github.com/tomnomnom/waybackurls@latest" \
    "github.com/ffuf/ffuf/v2@latest" \
    "github.com/sensepost/gowitness@latest"; do
    echo "  Installing $(basename "${gotool%%@*}")..."
    go install "$gotool" 2>/dev/null || echo "    failed: $gotool"
done

# Move Go binaries to /usr/local/bin for PATH accessibility
cp /root/go/bin/* /usr/local/bin/ 2>/dev/null || true

# Rust tools (RustScan, feroxbuster)
if ! command -v cargo &>/dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

cargo install rustscan 2>/dev/null || echo "  RustScan: install from GitHub releases"
cargo install feroxbuster 2>/dev/null || echo "  feroxbuster: install from GitHub releases"
cp "$HOME/.cargo/bin/"* /usr/local/bin/ 2>/dev/null || true

echo "  Go/Rust tools installed"

# ── Step 4: Python security tools ────────────────────────────
echo ""
echo "[4/7] Installing Python security tools..."

pip3 install --break-system-packages \
    impacket \
    xsstrike \
    dnsrecon \
    pwntools \
    crackmapexec \
    bloodhound \
    certipy-ad \
    roadrecon \
    2>/dev/null || echo "  Some Python tools failed"

echo "  Python tools installed"

# ── Step 5: Additional tools from releases ───────────────────
echo ""
echo "[5/7] Installing binary releases..."

# Chisel (tunneling)
CHISEL_VERSION="1.9.1"
curl -fsSL "https://github.com/jpillora/chisel/releases/download/v${CHISEL_VERSION}/chisel_${CHISEL_VERSION}_linux_amd64.gz" \
    | gunzip > /usr/local/bin/chisel && chmod +x /usr/local/bin/chisel || echo "  chisel: failed"

# Trivy (container scanning)
curl -fsSL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin || echo "  trivy: failed"

echo "  Binary releases installed"

# ── Step 6: VPN clients ──────────────────────────────────────
echo ""
echo "[6/7] Installing VPN clients..."

# WireGuard
apt-get install -y -qq wireguard-tools

# OpenVPN
apt-get install -y -qq openvpn

# Tailscale
curl -fsSL https://tailscale.com/install.sh | sh

# NordVPN
curl -fsSL https://repo.nordvpn.com/deb/nordvpn/debian/pool/main/nordvpn-release_1.0.0_all.deb -o /tmp/nordvpn-release.deb
dpkg -i /tmp/nordvpn-release.deb || true
apt-get update -qq
apt-get install -y -qq nordvpn || echo "  NordVPN: manual install may be required"
rm -f /tmp/nordvpn-release.deb

# Mullvad VPN
curl -fsSL https://repository.mullvad.net/deb/mullvad-keyring.asc | gpg --dearmor -o /usr/share/keyrings/mullvad-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/mullvad-keyring.gpg] https://repository.mullvad.net/deb/stable $(lsb_release -cs) main" \
    > /etc/apt/sources.list.d/mullvad.list
apt-get update -qq
apt-get install -y -qq mullvad-vpn || echo "  Mullvad VPN: manual install may be required"

echo "  VPN clients installed"

# ── Step 7: Docker Engine + Docker Compose ───────────────────
echo ""
echo "[7/7] Installing Docker Engine..."

# Docker official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

# Docker repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list

apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Enable Docker
systemctl enable --now docker
systemctl enable --now containerd

echo "  Docker installed and running"

# ── Summary ──────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Host provisioning complete!"
echo ""
echo "  Installed:"
echo "    - Kali security tools (top10, web, exploitation, info-gathering)"
echo "    - Go tools (subfinder, httpx, nuclei, amass, ffuf, katana, etc.)"
echo "    - Python tools (impacket, xsstrike, crackmapexec, etc.)"
echo "    - VPN clients (WireGuard, OpenVPN, Tailscale, NordVPN, Mullvad)"
echo "    - Docker Engine + Compose v2"
echo ""
echo "  Next: Run ./setup-redteam.sh to create the redteam user"
echo "═══════════════════════════════════════════════════════════"
