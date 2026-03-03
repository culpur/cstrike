#!/bin/bash
# CStrike VM — Red Team User Provisioning
# Creates the redteam user with Docker access, VPN routing, and CStrike aliases.
# Adapted from setup_redteam_env.sh for the containerized architecture.
#
# Run as root after provision-host.sh completes.
# Usage: sudo ./setup-redteam.sh

set -euo pipefail

USERNAME="redteam"
GROUPNAME="redteam"
CSTRIKE_DIR="/opt/cstrike"

echo "═══════════════════════════════════════════════════════════"
echo "  CStrike — Red Team User Provisioning"
echo "═══════════════════════════════════════════════════════════"

# ── Step 1: Create user and group ────────────────────────────
echo ""
echo "[1/5] Creating user: ${USERNAME}"

groupadd -f "${GROUPNAME}"
id "${USERNAME}" &>/dev/null || useradd -m -s /bin/zsh -g "${GROUPNAME}" "${USERNAME}"

# Add to required groups
usermod -aG sudo "${USERNAME}"
usermod -aG docker "${USERNAME}"

# Create CStrike working directory
mkdir -p "${CSTRIKE_DIR}"/{logs,data,config}
chown -R "${USERNAME}:${GROUPNAME}" "${CSTRIKE_DIR}"

echo "  User ${USERNAME} created with docker + sudo groups"

# ── Step 2: Configure sudo permissions ───────────────────────
echo ""
echo "[2/5] Configuring sudo rules..."

cat > /etc/sudoers.d/redteam << 'EOF'
# CStrike red team user — limited sudo for service management
redteam ALL=(ALL) NOPASSWD: /usr/bin/docker, /usr/bin/docker-compose
redteam ALL=(ALL) NOPASSWD: /usr/bin/systemctl start *, /usr/bin/systemctl stop *, /usr/bin/systemctl restart *, /usr/bin/systemctl status *
redteam ALL=(ALL) NOPASSWD: /usr/sbin/ip, /usr/sbin/iptables, /usr/sbin/nft
redteam ALL=(ALL) NOPASSWD: /usr/bin/wg, /usr/bin/wg-quick
redteam ALL=(ALL) NOPASSWD: /usr/sbin/openvpn
redteam ALL=(ALL) NOPASSWD: /usr/bin/nordvpn
redteam ALL=(ALL) NOPASSWD: /usr/bin/mullvad
redteam ALL=(ALL) NOPASSWD: /usr/bin/tailscale, /usr/bin/tailscaled
EOF

chmod 440 /etc/sudoers.d/redteam
visudo -cf /etc/sudoers.d/redteam

echo "  Sudo rules configured"

# ── Step 3: Split VPN routing ────────────────────────────────
echo ""
echo "[3/5] Configuring split VPN routing..."

# Create VPN route table
grep -q "wgvpn" /etc/iproute2/rt_tables 2>/dev/null || echo "200 wgvpn" >> /etc/iproute2/rt_tables

# Create persistent iptables rules for redteam traffic marking
cat > /etc/iptables-redteam.rules << EOF
# CStrike — Mark redteam user traffic for VPN routing
# Applied at boot via systemd service
*mangle
-A OUTPUT -m owner --uid-owner ${USERNAME} -j MARK --set-mark 0xca6c
COMMIT
EOF

# Create systemd service for persistent routing
cat > /etc/systemd/system/cstrike-vpn-routing.service << EOF
[Unit]
Description=CStrike VPN Split Routing for redteam user
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes

# Mark redteam user traffic
ExecStart=/usr/sbin/iptables -t mangle -A OUTPUT -m owner --uid-owner ${USERNAME} -j MARK --set-mark 0xca6c

# Add routing rule for marked packets
ExecStart=/usr/sbin/ip rule add fwmark 0xca6c table wgvpn

# Cleanup on stop
ExecStop=/usr/sbin/iptables -t mangle -D OUTPUT -m owner --uid-owner ${USERNAME} -j MARK --set-mark 0xca6c
ExecStop=/usr/sbin/ip rule del fwmark 0xca6c table wgvpn

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable cstrike-vpn-routing.service

echo "  VPN routing configured (fwmark 0xca6c → table wgvpn)"

# ── Step 4: Shell environment ────────────────────────────────
echo ""
echo "[4/5] Configuring shell environment..."

ZSHRC="/home/${USERNAME}/.zshrc"

# Install oh-my-zsh for redteam (non-interactive)
if [[ ! -d "/home/${USERNAME}/.oh-my-zsh" ]]; then
    su - "${USERNAME}" -c 'sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended' || true
fi

cat >> "${ZSHRC}" << 'EOF'

# ── CStrike Environment ──────────────────────────────────────
export CSTRIKE_HOME="/opt/cstrike"
export PATH="$PATH:/usr/local/go/bin:/root/go/bin"

# Docker shortcuts
alias cs-up="docker compose -f /opt/cstrike/docker-compose.yml up -d"
alias cs-down="docker compose -f /opt/cstrike/docker-compose.yml down"
alias cs-logs="docker compose -f /opt/cstrike/docker-compose.yml logs -f"
alias cs-ps="docker compose -f /opt/cstrike/docker-compose.yml ps"
alias cs-restart="docker compose -f /opt/cstrike/docker-compose.yml restart"
alias cs-tui="docker exec -it cstrike-api python -m tui"

# VPN shortcuts
alias vpn-wg-up="sudo wg-quick up wg0"
alias vpn-wg-down="sudo wg-quick down wg0"
alias vpn-status="sudo wg show; sudo ip route show table wgvpn"
alias vpn-check="curl -s https://api.ipify.org && echo"

# Network shortcuts
alias ports="sudo ss -tlnp"
alias connections="sudo ss -tp"
EOF

chown "${USERNAME}:${GROUPNAME}" "${ZSHRC}"

echo "  Shell environment configured"

# ── Step 5: SSH key setup ────────────────────────────────────
echo ""
echo "[5/5] Setting up SSH access..."

SSH_DIR="/home/${USERNAME}/.ssh"
mkdir -p "${SSH_DIR}"

# Copy cstrike's authorized_keys to redteam
if [[ -f /home/cstrike/.ssh/authorized_keys ]]; then
    cp /home/cstrike/.ssh/authorized_keys "${SSH_DIR}/authorized_keys"
fi

chmod 700 "${SSH_DIR}"
chmod 600 "${SSH_DIR}/authorized_keys" 2>/dev/null || true
chown -R "${USERNAME}:${GROUPNAME}" "${SSH_DIR}"

echo "  SSH access configured"

# ── Summary ──────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Red team user provisioning complete!"
echo ""
echo "  User:     ${USERNAME}"
echo "  Groups:   ${GROUPNAME}, sudo, docker"
echo "  Home:     /home/${USERNAME}"
echo "  CStrike:  ${CSTRIKE_DIR}"
echo "  Shell:    zsh (oh-my-zsh)"
echo ""
echo "  VPN Routing:"
echo "    - fwmark 0xca6c on redteam traffic"
echo "    - Routed via table wgvpn → wg0/tun0"
echo "    - Persistent via systemd service"
echo ""
echo "  Docker aliases: cs-up, cs-down, cs-logs, cs-ps, cs-tui"
echo "  VPN aliases:    vpn-wg-up, vpn-wg-down, vpn-status, vpn-check"
echo ""
echo "  Next: Run ./harden-host.sh to apply security hardening"
echo "═══════════════════════════════════════════════════════════"
