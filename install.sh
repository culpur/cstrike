#!/bin/bash
# CStrike v2 — Master Installer
# Takes a fresh Debian 12 system to a fully working CStrike stack.
#
# Usage:
#   sudo bash install.sh              # Full install (tools + Docker + hardening + VPN)
#   sudo bash install.sh --no-vpn     # Skip VPN client installation
#   sudo bash install.sh --no-harden  # Skip security hardening (dev/test)
#   sudo bash install.sh --skip-tools # Docker stack only (host tools must be pre-installed)
#
# Requirements:
#   - Debian 12 (Bookworm) — fresh install
#   - Root access
#   - Internet connectivity
#   - 4 CPU cores, 8 GB RAM, 50 GB disk (minimum)

set -euo pipefail

# ── Parse flags ─────────────────────────────────────────────
SKIP_VPN=false
SKIP_HARDEN=false
SKIP_TOOLS=false

for arg in "$@"; do
    case "$arg" in
        --no-vpn)     SKIP_VPN=true ;;
        --no-harden)  SKIP_HARDEN=true ;;
        --skip-tools) SKIP_TOOLS=true ;;
        --help|-h)
            echo "Usage: sudo bash install.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --no-vpn      Skip VPN client installation"
            echo "  --no-harden   Skip security hardening (dev/test only)"
            echo "  --skip-tools  Skip host tool installation (Docker stack only)"
            echo "  --help        Show this message"
            exit 0
            ;;
        *) echo "Unknown option: $arg"; exit 1 ;;
    esac
done

export DEBIAN_FRONTEND=noninteractive

# ── Colors ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

INSTALL_DIR="/opt/cstrike"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STEP=0
TOTAL_STEPS=10

step() {
    STEP=$((STEP + 1))
    echo ""
    echo -e "${CYAN}${BOLD}[${STEP}/${TOTAL_STEPS}]${RESET} ${BOLD}$1${RESET}"
    echo "────────────────────────────────────────────────────────"
}

ok()   { echo -e "  ${GREEN}[+]${RESET} $1"; }
warn() { echo -e "  ${YELLOW}[!]${RESET} $1"; }
fail() { echo -e "  ${RED}[x]${RESET} $1"; exit 1; }

START_TIME=$(date +%s)

# ── Preflight checks ───────────────────────────────────────
echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  CStrike v2 — Master Installer${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════════${RESET}"

[[ $EUID -ne 0 ]] && fail "This script must be run as root (sudo bash install.sh)"

# Verify Debian 12
if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    if [[ "$ID" != "debian" ]] || [[ "${VERSION_ID:-}" != "12" ]]; then
        warn "Expected Debian 12, detected ${PRETTY_NAME:-unknown}. Proceeding anyway."
    fi
else
    warn "Cannot detect OS. Proceeding anyway."
fi

echo ""
echo "  Install directory: ${INSTALL_DIR}"
echo "  Skip tools:        ${SKIP_TOOLS}"
echo "  Skip VPN:          ${SKIP_VPN}"
echo "  Skip hardening:    ${SKIP_HARDEN}"
echo ""

# Adjust step count based on flags
if $SKIP_TOOLS; then TOTAL_STEPS=$((TOTAL_STEPS - 1)); fi
if $SKIP_HARDEN; then TOTAL_STEPS=$((TOTAL_STEPS - 1)); fi

# ── Step 1: Install CStrike ────────────────────────────────
step "Installing CStrike to ${INSTALL_DIR}"

if [[ -d "${INSTALL_DIR}/.git" ]]; then
    ok "CStrike repo already exists at ${INSTALL_DIR}, pulling latest..."
    cd "${INSTALL_DIR}" && git pull origin main 2>/dev/null || true
elif [[ -d "${INSTALL_DIR}" ]]; then
    warn "${INSTALL_DIR} exists but is not a git repo"
    if [[ -f "${INSTALL_DIR}/docker-compose.yml" ]]; then
        ok "Existing CStrike installation detected, using as-is"
    else
        fail "${INSTALL_DIR} exists but does not contain CStrike"
    fi
else
    git clone https://github.com/culpur/cstrike.git "${INSTALL_DIR}"
    ok "Cloned CStrike to ${INSTALL_DIR}"
fi

cd "${INSTALL_DIR}"

# ── Step 2: Host tool provisioning ─────────────────────────
if ! $SKIP_TOOLS; then
    step "Provisioning host (Kali tools, Go tools, Python tools, Docker)"

    if [[ -f "${INSTALL_DIR}/scripts/vm/provision-host.sh" ]]; then
        if $SKIP_VPN; then
            export SKIP_VPN=true
        fi
        bash "${INSTALL_DIR}/scripts/vm/provision-host.sh"
        ok "Host provisioning complete"
    else
        fail "provision-host.sh not found at ${INSTALL_DIR}/scripts/vm/"
    fi
else
    # Verify Docker is available even if skipping tools
    if ! command -v docker &>/dev/null; then
        step "Installing Docker (required for --skip-tools)"
        apt-get update -qq
        apt-get install -y -qq ca-certificates curl gnupg
        install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null
        chmod a+r /etc/apt/keyrings/docker.gpg
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list
        apt-get update -qq
        apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
        systemctl enable --now docker
        ok "Docker installed"
    else
        ok "Docker already installed"
    fi
fi

# ── Step 3: Security hardening ─────────────────────────────
if ! $SKIP_HARDEN; then
    step "Applying security hardening (kernel, SSH, PAM, auditd, fail2ban)"

    if [[ -f "${INSTALL_DIR}/scripts/vm/harden-host.sh" ]]; then
        bash "${INSTALL_DIR}/scripts/vm/harden-host.sh"
        ok "Security hardening complete"
    else
        warn "harden-host.sh not found, skipping hardening"
    fi
fi

# ── Step 4: Redteam user setup ─────────────────────────────
step "Creating redteam user and VPN routing"

if [[ -f "${INSTALL_DIR}/scripts/vm/setup-redteam.sh" ]]; then
    bash "${INSTALL_DIR}/scripts/vm/setup-redteam.sh"
    ok "Redteam user configured"
else
    warn "setup-redteam.sh not found, skipping redteam user creation"
fi

# ── Step 5: Generate TLS certificates ──────────────────────
step "Generating TLS certificates"

if [[ -f "${INSTALL_DIR}/docker/certs/cstrike.crt" ]]; then
    ok "TLS certificates already exist, skipping"
else
    if [[ -f "${INSTALL_DIR}/docker/generate-certs.sh" ]]; then
        bash "${INSTALL_DIR}/docker/generate-certs.sh"
        ok "Self-signed TLS certificate generated"
    else
        fail "generate-certs.sh not found"
    fi
fi

# ── Step 6: Generate .env with random passwords ────────────
step "Configuring environment"

if [[ -f "${INSTALL_DIR}/.env" ]]; then
    ok ".env already exists, preserving existing configuration"
else
    PG_PASS=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 40)
    REDIS_PASS=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 40)
    KASM_PASS=$(openssl rand -base64 16 | tr -dc 'A-Za-z0-9!@#' | head -c 16)

    cat > "${INSTALL_DIR}/.env" << EOF
# CStrike v2 — Generated by install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
# AI provider keys and scan config are managed via the web UI.

POSTGRES_DB=cstrike
POSTGRES_USER=cstrike
POSTGRES_PASSWORD=${PG_PASS}

REDIS_PASSWORD=${REDIS_PASS}

KASM_PASSWORD=${KASM_PASS}

CORS_ORIGINS=http://localhost:3000,https://cstrike,https://cstrike.local

LOG_LEVEL=info
METRICS_INTERVAL=2000
EOF

    chmod 600 "${INSTALL_DIR}/.env"
    ok "Generated .env with random passwords"
fi

# ── Step 7: Build and start Docker stack ───────────────────
step "Building and starting Docker stack"

cd "${INSTALL_DIR}"

# Detect ARM64 and use neko override (Kasm is x86-only)
COMPOSE_CMD="docker compose"
if [[ "$(uname -m)" == "aarch64" ]] && [[ -f docker-compose.arm64.yml ]]; then
    COMPOSE_CMD="docker compose -f docker-compose.yml -f docker-compose.arm64.yml"
    echo "  ARM64 detected — using linuxserver/chromium instead of Kasm (port 6902)"
fi

${COMPOSE_CMD} build --quiet 2>&1 | tail -5
ok "Docker images built"

${COMPOSE_CMD} up -d
ok "Docker stack started"

# ── Step 8: Wait for healthy containers ────────────────────
step "Waiting for containers to become healthy"

MAX_WAIT=120
ELAPSED=0
while [[ $ELAPSED -lt $MAX_WAIT ]]; do
    UNHEALTHY=$(${COMPOSE_CMD} ps --format json 2>/dev/null | grep -c '"starting"' || true)
    if [[ "$UNHEALTHY" -eq 0 ]]; then
        break
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    echo -ne "\r  Waiting... ${ELAPSED}s / ${MAX_WAIT}s"
done
echo ""

# Check final state
HEALTHY=$(docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null)
ok "Container status:"
echo "$HEALTHY" | sed 's/^/    /'

# ── Step 9: Seed database ─────────────────────────────────
step "Seeding database"

# Wait for API to be ready
for i in $(seq 1 30); do
    if curl -sf http://127.0.0.1:3001/health &>/dev/null; then
        break
    fi
    sleep 2
done

docker exec cstrike-api npx prisma db push --skip-generate 2>/dev/null || true
docker exec cstrike-api npx prisma db seed 2>/dev/null && ok "Database seeded" || warn "Database may already be seeded"

# ── Step 10: Create systemd services ───────────────────────
step "Creating systemd services"

# CStrike Docker Compose auto-start
cat > /etc/systemd/system/cstrike.service << EOF
[Unit]
Description=CStrike v2 Docker Stack
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable cstrike.service
ok "cstrike.service enabled (auto-start on boot)"

# Metasploit RPC (if msfrpcd is installed)
if command -v msfrpcd &>/dev/null; then
    cat > /etc/systemd/system/msfrpcd.service << 'EOF'
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

    systemctl daemon-reload
    systemctl enable msfrpcd.service
    systemctl start msfrpcd.service 2>/dev/null || true
    ok "msfrpcd.service enabled"
else
    warn "msfrpcd not found, skipping Metasploit service"
fi

# ── Summary ─────────────────────────────────────────────────
END_TIME=$(date +%s)
DURATION=$(( END_TIME - START_TIME ))
MINUTES=$(( DURATION / 60 ))
SECONDS_REMAINING=$(( DURATION % 60 ))

# Read generated passwords from .env
source <(grep -E '^(POSTGRES_PASSWORD|REDIS_PASSWORD|KASM_PASSWORD)=' "${INSTALL_DIR}/.env" 2>/dev/null || true)

echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  CStrike v2 — Installation Complete${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${BOLD}Access Points:${RESET}"
echo -e "    HTTPS Dashboard:  ${CYAN}https://$(hostname)/${RESET}  or  ${CYAN}https://$(hostname -I | awk '{print $1}')/${RESET}"
echo -e "    Remote Browser:   ${CYAN}https://$(hostname -I | awk '{print $1}'):6901/${RESET}"
echo -e "    TUI:              ${CYAN}docker exec -it cstrike-api python -m tui${RESET}"
echo -e "    Health Check:     ${CYAN}curl -k https://localhost/health${RESET}"
echo ""
echo -e "  ${BOLD}Generated Credentials (saved in ${INSTALL_DIR}/.env):${RESET}"
echo -e "    PostgreSQL:  cstrike / ${POSTGRES_PASSWORD:-<see .env>}"
echo -e "    Redis:       ${REDIS_PASSWORD:-<see .env>}"
echo -e "    Kasm VNC:    ${KASM_PASSWORD:-<see .env>}"
echo ""
echo -e "  ${BOLD}Next Steps:${RESET}"
echo -e "    1. Configure AI providers in the web UI (Configuration tab)"
echo -e "    2. Add targets in the Targets module"
echo -e "    3. Launch your first scan"
echo ""
echo -e "  Installed in ${MINUTES}m ${SECONDS_REMAINING}s"
echo ""
