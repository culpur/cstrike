#!/bin/bash
# CStrike v2 — First Boot Setup
# Runs once on first boot of an imported VM image.
# Handles partition expansion, SSH key regeneration, password randomization,
# and Docker stack startup.
#
# Installed by:  package-vm.sh --clean (into the VM before export)
# Triggered by:  /etc/systemd/system/cstrike-firstboot.service
#
# Requirements:
#   - cloud-guest-utils (growpart)
#   - e2fsprogs (resize2fs)
#   - Both are standard on Debian 12

set -euo pipefail

INSTALL_DIR="/opt/cstrike"
MARKER="${INSTALL_DIR}/.firstboot-complete"
LOG="/var/log/cstrike-firstboot.log"

# ── Guard: run only once ────────────────────────────────────
if [[ -f "$MARKER" ]]; then
    echo "First boot already completed (marker exists: ${MARKER}). Exiting."
    exit 0
fi

exec > >(tee -a "$LOG") 2>&1

echo ""
echo "══════════════════════════════════════════════════════"
echo "  CStrike v2 — First Boot Setup"
echo "  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "══════════════════════════════════════════════════════"
echo ""

# ── Step 1: Expand root partition ────────────────────────────
echo "[1/7] Expanding root partition to fill disk..."

ROOT_DEV=$(findmnt -n -o SOURCE /)
if [[ -z "$ROOT_DEV" ]]; then
    echo "  WARNING: Could not detect root device, skipping expansion"
else
    # Extract disk and partition number (e.g., /dev/sda2 → /dev/sda + 2)
    DISK_DEV=$(echo "$ROOT_DEV" | sed 's/[0-9]*$//')
    PART_NUM=$(echo "$ROOT_DEV" | grep -o '[0-9]*$')

    # Handle NVMe naming (e.g., /dev/nvme0n1p2 → /dev/nvme0n1 + 2)
    if [[ "$ROOT_DEV" == *nvme* ]] || [[ "$ROOT_DEV" == *mmcblk* ]]; then
        DISK_DEV=$(echo "$ROOT_DEV" | sed 's/p[0-9]*$//')
        PART_NUM=$(echo "$ROOT_DEV" | grep -o '[0-9]*$')
    fi

    if command -v growpart &>/dev/null; then
        echo "  Expanding partition ${PART_NUM} on ${DISK_DEV}..."
        growpart "$DISK_DEV" "$PART_NUM" 2>/dev/null || echo "  Partition already at maximum size"
    else
        echo "  WARNING: growpart not found (install cloud-guest-utils), skipping partition expansion"
    fi

    # Detect filesystem type and resize
    FS_TYPE=$(findmnt -n -o FSTYPE /)
    case "$FS_TYPE" in
        ext4|ext3|ext2)
            echo "  Resizing ${FS_TYPE} filesystem on ${ROOT_DEV}..."
            resize2fs "$ROOT_DEV" 2>/dev/null || echo "  Filesystem already at maximum size"
            ;;
        xfs)
            echo "  Resizing xfs filesystem..."
            xfs_growfs / 2>/dev/null || echo "  Filesystem already at maximum size"
            ;;
        btrfs)
            echo "  Resizing btrfs filesystem..."
            btrfs filesystem resize max / 2>/dev/null || echo "  Filesystem already at maximum size"
            ;;
        *)
            echo "  WARNING: Unknown filesystem type '${FS_TYPE}', skipping resize"
            ;;
    esac

    # Report final size
    echo "  Root filesystem: $(df -h / | awk 'NR==2 {print $2}') total, $(df -h / | awk 'NR==2 {print $4}') available"
fi

echo "  OK"

# ── Step 2: Regenerate SSH host keys ─────────────────────────
echo ""
echo "[2/7] Regenerating SSH host keys..."

if [[ ! -f /etc/ssh/ssh_host_ed25519_key ]] || [[ ! -f /etc/ssh/ssh_host_rsa_key ]]; then
    rm -f /etc/ssh/ssh_host_*
    dpkg-reconfigure openssh-server 2>/dev/null || ssh-keygen -A
    systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || true
    echo "  SSH host keys regenerated"
else
    echo "  SSH host keys already exist, skipping"
fi

echo "  OK"

# ── Step 3: Randomize passwords ──────────────────────────────
echo ""
echo "[3/7] Checking .env passwords..."

ENV_FILE="${INSTALL_DIR}/.env"
if [[ -f "$ENV_FILE" ]]; then
    CHANGED=false

    # Check each password field for placeholder values
    for FIELD in POSTGRES_PASSWORD REDIS_PASSWORD KASM_PASSWORD; do
        CURRENT=$(grep "^${FIELD}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true)
        if [[ "$CURRENT" == "changeme" ]] || [[ "$CURRENT" == "cstrike" ]] || [[ -z "$CURRENT" ]]; then
            NEW_PASS=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 40)
            sed -i "s|^${FIELD}=.*|${FIELD}=${NEW_PASS}|" "$ENV_FILE"
            echo "  Randomized ${FIELD}"
            CHANGED=true
        fi
    done

    if $CHANGED; then
        chmod 600 "$ENV_FILE"
        echo "  Passwords updated in ${ENV_FILE}"
    else
        echo "  All passwords already set, no changes needed"
    fi
else
    echo "  WARNING: ${ENV_FILE} not found — run install.sh to generate"
fi

echo "  OK"

# ── Step 4: Set hostname ──────────────────────────────────────
echo ""
echo "[4/7] Configuring hostname..."

# Check kernel cmdline for hostname override (cloud-init compatible)
CMDLINE_HOSTNAME=$(cat /proc/cmdline 2>/dev/null | grep -oP 'hostname=\K\S+' || true)
if [[ -n "$CMDLINE_HOSTNAME" ]]; then
    hostnamectl set-hostname "$CMDLINE_HOSTNAME" 2>/dev/null || hostname "$CMDLINE_HOSTNAME"
    echo "  Hostname set to: ${CMDLINE_HOSTNAME} (from kernel cmdline)"
else
    CURRENT_HOSTNAME=$(hostname)
    echo "  Keeping hostname: ${CURRENT_HOSTNAME}"
fi

echo "  OK"

# ── Step 5: Reset network for user configuration ─────────────
echo ""
echo "[5/7] Preparing network interfaces for configuration..."

# Detect the two network interfaces (excluding lo)
IFACES=($(ip -o link show | awk -F': ' '{print $2}' | grep -v '^lo$' | head -2))

# Reset interfaces to unconfigured (remove cloud-init static IPs)
# The user will configure them on first login via cstrike-netsetup
if [[ -f /etc/network/interfaces ]]; then
    # Backup original config
    cp /etc/network/interfaces /etc/network/interfaces.bak.firstboot

    # Write minimal config — loopback only, interfaces left for user to configure
    cat > /etc/network/interfaces << 'NETCFG'
# CStrike v2 — Network Configuration
# Run 'sudo cstrike-netsetup' to configure interfaces.
#
# This file was reset by first-boot setup.
# Original config saved to /etc/network/interfaces.bak.firstboot

auto lo
iface lo inet loopback
NETCFG
fi

# Create the network setup helper script
cat > /usr/local/bin/cstrike-netsetup << 'NETSETUP'
#!/bin/bash
# CStrike v2 — Network Interface Setup
# Configures both network interfaces with static IPs or DHCP.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  CStrike v2 — Network Setup${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════════${RESET}"
echo ""

# Detect interfaces
IFACES=($(ip -o link show | awk -F': ' '{print $2}' | grep -v '^lo$' | head -2))

if [[ ${#IFACES[@]} -lt 1 ]]; then
    echo -e "${RED}No network interfaces found.${RESET}"
    exit 1
fi

CONFIG="/etc/network/interfaces"
# Start with loopback
cat > "$CONFIG" << 'EOF'
auto lo
iface lo inet loopback
EOF

for i in "${!IFACES[@]}"; do
    IFACE="${IFACES[$i]}"
    NUM=$((i + 1))

    if [[ $NUM -eq 1 ]]; then
        LABEL="Management / Scan traffic"
    else
        LABEL="Secondary / VPN traffic"
    fi

    echo ""
    echo -e "${CYAN}Interface ${NUM}: ${BOLD}${IFACE}${RESET} (${LABEL})"
    echo -e "  Current: $(ip -4 addr show "$IFACE" 2>/dev/null | grep -oP 'inet \K[\d./]+' || echo 'unconfigured')"
    echo ""
    echo "  1) DHCP (automatic)"
    echo "  2) Static IP"
    echo "  3) Skip (leave unconfigured)"
    echo ""
    read -rp "  Choice [1/2/3]: " CHOICE

    case "$CHOICE" in
        1)
            cat >> "$CONFIG" << EOF

auto ${IFACE}
iface ${IFACE} inet dhcp
EOF
            echo -e "  ${GREEN}[+]${RESET} ${IFACE} set to DHCP"
            ;;
        2)
            read -rp "  IP address (e.g., 10.0.70.100/24): " STATIC_IP
            read -rp "  Gateway (e.g., 10.0.70.1, or blank for none): " GATEWAY
            read -rp "  DNS servers (e.g., 1.1.1.1 8.8.8.8, or blank): " DNS

            IP_ADDR=$(echo "$STATIC_IP" | cut -d/ -f1)
            NETMASK_CIDR=$(echo "$STATIC_IP" | cut -d/ -f2)

            # Convert CIDR to netmask
            case "$NETMASK_CIDR" in
                8)  NETMASK="255.0.0.0" ;;
                16) NETMASK="255.255.0.0" ;;
                24) NETMASK="255.255.255.0" ;;
                25) NETMASK="255.255.255.128" ;;
                *)  NETMASK="255.255.255.0" ;;
            esac

            cat >> "$CONFIG" << EOF

auto ${IFACE}
iface ${IFACE} inet static
    address ${IP_ADDR}
    netmask ${NETMASK}
EOF
            [[ -n "$GATEWAY" ]] && echo "    gateway ${GATEWAY}" >> "$CONFIG"
            [[ -n "$DNS" ]] && echo "    dns-nameservers ${DNS}" >> "$CONFIG"

            echo -e "  ${GREEN}[+]${RESET} ${IFACE} set to ${STATIC_IP}"
            ;;
        3)
            echo -e "  Skipped ${IFACE}"
            ;;
        *)
            echo "  Invalid choice, skipping ${IFACE}"
            ;;
    esac
done

echo ""
echo -e "${BOLD}Applying network configuration...${RESET}"
systemctl restart networking 2>/dev/null || ifdown -a && ifup -a 2>/dev/null || true

echo ""
echo -e "${GREEN}${BOLD}Network configured.${RESET}"
echo ""
for IFACE in "${IFACES[@]}"; do
    IP=$(ip -4 addr show "$IFACE" 2>/dev/null | grep -oP 'inet \K[\d./]+' || echo 'none')
    echo "  ${IFACE}: ${IP}"
done
echo ""
echo "  Config saved to: ${CONFIG}"
echo "  Re-run anytime:  sudo cstrike-netsetup"
echo ""
NETSETUP
chmod +x /usr/local/bin/cstrike-netsetup

# Create MOTD banner that tells the user to configure networking
cat > /etc/motd << 'MOTD'

  ╔══════════════════════════════════════════════════════╗
  ║           CStrike v2 — First Login Setup            ║
  ╠══════════════════════════════════════════════════════╣
  ║                                                      ║
  ║  Network interfaces are UNCONFIGURED.                ║
  ║  Run the following command to set up networking:      ║
  ║                                                      ║
  ║    sudo cstrike-netsetup                             ║
  ║                                                      ║
  ║  Dashboard:    https://<your-ip>/                     ║
  ║  Kasm VNC:     https://<your-ip>:6901/               ║
  ║  Credentials:  /opt/cstrike/.env                     ║
  ║                                                      ║
  ╚══════════════════════════════════════════════════════╝

MOTD

# Create profile.d script that runs netsetup on first interactive login
cat > /etc/profile.d/cstrike-firstlogin.sh << 'FIRSTLOGIN'
# CStrike v2 — First login network setup prompt
if [ ! -f /opt/cstrike/.network-configured ] && [ -t 0 ]; then
    echo ""
    echo -e "\033[1;33m[!] Network interfaces are not configured.\033[0m"
    echo -e "\033[1m    Run: sudo cstrike-netsetup\033[0m"
    echo ""
    read -rp "Configure network now? [Y/n] " REPLY
    if [[ "${REPLY:-Y}" =~ ^[Yy]$ ]] || [[ -z "$REPLY" ]]; then
        sudo /usr/local/bin/cstrike-netsetup
        sudo touch /opt/cstrike/.network-configured
        # Clear the MOTD after network is configured
        sudo sh -c 'echo "" > /etc/motd'
    fi
fi
FIRSTLOGIN

if [[ ${#IFACES[@]} -ge 1 ]]; then
    echo "  Interfaces detected: ${IFACES[*]}"
    echo "  Network setup helper installed: /usr/local/bin/cstrike-netsetup"
    echo "  User will be prompted to configure on first login"
else
    echo "  WARNING: No network interfaces detected"
fi

echo "  OK"

# ── Step 6: Load pre-saved Docker images and start stack ──────
echo ""
echo "[6/7] Starting Docker stack..."

DOCKER_ARCHIVE="${INSTALL_DIR}/cstrike-docker-images.tar.gz"

# Ensure Docker is running
if ! systemctl is-active --quiet docker 2>/dev/null; then
    systemctl start docker
    sleep 3
fi

# Load pre-saved images if available (air-gapped/offline mode)
if [[ -f "$DOCKER_ARCHIVE" ]]; then
    echo "  Loading pre-saved Docker images from ${DOCKER_ARCHIVE}..."
    docker load < "$DOCKER_ARCHIVE"
    echo "  Docker images loaded"
else
    echo "  No pre-saved Docker images found, containers will pull/build on first start"
fi

# Start the Docker Compose stack
if [[ -f "${INSTALL_DIR}/docker-compose.yml" ]]; then
    cd "$INSTALL_DIR"
    docker compose up -d 2>&1 | tail -5
    echo "  Docker stack started"

    # Wait for healthy containers (up to 120s)
    MAX_WAIT=120
    ELAPSED=0
    while [[ $ELAPSED -lt $MAX_WAIT ]]; do
        STARTING=$(docker compose ps --format json 2>/dev/null | grep -c '"starting"' || true)
        if [[ "$STARTING" -eq 0 ]]; then
            break
        fi
        sleep 5
        ELAPSED=$((ELAPSED + 5))
    done

    docker compose ps 2>/dev/null | tail -10
else
    echo "  WARNING: docker-compose.yml not found at ${INSTALL_DIR}"
fi

echo "  OK"

# ── Step 7: Self-disable ──────────────────────────────────────
echo ""
echo "[7/7] Marking first boot complete..."

# Create completion marker
cat > "$MARKER" << EOF
CStrike v2 first boot completed at $(date -u +%Y-%m-%dT%H:%M:%SZ)
Hostname: $(hostname)
Root disk: $(df -h / | awk 'NR==2 {print $2}')
Docker images: $(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | wc -l)
EOF

# Disable the systemd service
systemctl disable cstrike-firstboot.service 2>/dev/null || true

echo "  First boot setup complete"
echo ""
echo "══════════════════════════════════════════════════════"
echo "  CStrike v2 is ready"
echo "  Dashboard: https://$(hostname -I 2>/dev/null | awk '{print $1}')/"
echo "  Kasm VNC:  https://$(hostname -I 2>/dev/null | awk '{print $1}'):6901/"
echo "  Credentials: ${INSTALL_DIR}/.env"
echo "══════════════════════════════════════════════════════"
