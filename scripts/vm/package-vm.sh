#!/bin/bash
# CStrike v2 — VM Distribution Packaging
# Extracts VM 122 from Proxmox, pre-saves Docker images, and produces
# distribution artifacts in multiple formats (.tar.gz, .ova, .vdi, .qcow2).
#
# Runs on the Proxmox host (or any machine with SSH access to the VM).
#
# Usage:
#   ./package-vm.sh                          # Default: VM 122, output to ./dist/
#   ./package-vm.sh --clean                  # Scrub sensitive data before export
#   ./package-vm.sh --vmid 200 --output /tmp # Custom VMID and output dir
#   ./package-vm.sh --no-ova --no-docker-save # Minimal export (qcow2 + raw only)
#
# Prerequisites:
#   - Proxmox API access (PVE_HOST, PVE_TOKEN_ID, PVE_TOKEN_SECRET)
#   - qemu-img installed
#   - SSH access to the target VM
#   - VBoxManage (optional — needed for OVA/VDI generation)

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────
VMID="${VMID:-122}"
OUTPUT_DIR="./dist"
CLEAN=false
SKIP_OVA=false
SKIP_DOCKER_SAVE=false
SSH_USER="soulofall"
SSH_KEY=""
NODE="${PVE_NODE:-proxmox}"
VERSION="2.6.1"
PRODUCT="CStrike v2"
INSTALL_DIR="/opt/cstrike"

# Proxmox API
PVE_HOST="${PVE_HOST:?PVE_HOST must be set (e.g., https://proxmox.local:8006)}"
PVE_TOKEN_ID="${PVE_TOKEN_ID:?PVE_TOKEN_ID must be set (e.g., root@pam!cstrike)}"
PVE_TOKEN_SECRET="${PVE_TOKEN_SECRET:?PVE_TOKEN_SECRET must be set}"

API_BASE="${PVE_HOST}/api2/json"
AUTH_HEADER="Authorization: PVEAPIToken=${PVE_TOKEN_ID}=${PVE_TOKEN_SECRET}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Parse arguments ───────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case $1 in
        --vmid)           VMID="$2"; shift 2 ;;
        --output)         OUTPUT_DIR="$2"; shift 2 ;;
        --clean)          CLEAN=true; shift ;;
        --no-ova)         SKIP_OVA=true; shift ;;
        --no-docker-save) SKIP_DOCKER_SAVE=true; shift ;;
        --ssh-user)       SSH_USER="$2"; shift 2 ;;
        --ssh-key)        SSH_KEY="$2"; shift 2 ;;
        --node)           NODE="$2"; shift 2 ;;
        --help|-h)
            echo "Usage: ./package-vm.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --vmid ID          Proxmox VM ID (default: 122)"
            echo "  --output DIR       Output directory (default: ./dist/)"
            echo "  --clean            Scrub sensitive data before export"
            echo "  --no-ova           Skip OVA/VDI generation"
            echo "  --no-docker-save   Skip Docker image pre-save"
            echo "  --ssh-user USER    SSH user for VM access (default: soulofall)"
            echo "  --ssh-key PATH     SSH private key for VM access"
            echo "  --node NODE        Proxmox node name (default: proxmox)"
            echo "  --help             Show this message"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# ── Colors ────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

ok()   { echo -e "  ${GREEN}[+]${RESET} $1"; }
warn() { echo -e "  ${YELLOW}[!]${RESET} $1"; }
fail() { echo -e "  ${RED}[x]${RESET} $1"; exit 1; }
info() { echo -e "  ${CYAN}[*]${RESET} $1"; }

STEP=0
TOTAL_STEPS=10
if $SKIP_OVA; then TOTAL_STEPS=$((TOTAL_STEPS - 1)); fi
if $SKIP_DOCKER_SAVE; then TOTAL_STEPS=$((TOTAL_STEPS - 1)); fi
if ! $CLEAN; then TOTAL_STEPS=$((TOTAL_STEPS - 1)); fi

step() {
    STEP=$((STEP + 1))
    echo ""
    echo -e "${CYAN}${BOLD}[${STEP}/${TOTAL_STEPS}]${RESET} ${BOLD}$1${RESET}"
    echo "────────────────────────────────────────────────────────"
}

START_TIME=$(date +%s)

# ── Build SSH command ─────────────────────────────────────────
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"
if [[ -n "$SSH_KEY" ]]; then
    SSH_OPTS="${SSH_OPTS} -i ${SSH_KEY}"
fi

# Resolve VM IP from Proxmox agent or QEMU guest agent
get_vm_ip() {
    local ip
    ip=$(pve_api GET "/nodes/${NODE}/qemu/${VMID}/agent/network-get-interfaces" 2>/dev/null \
        | jq -r '.data.result[]? | select(.name != "lo") | .["ip-addresses"][]? | select(.["ip-address-type"] == "ipv4") | .["ip-address"]' \
        | head -1 || true)
    if [[ -z "$ip" ]]; then
        # Fallback: try cloud-init config
        ip=$(pve_api GET "/nodes/${NODE}/qemu/${VMID}/config" 2>/dev/null \
            | jq -r '.data.ipconfig0 // ""' | grep -oP 'ip=\K[^/]+' || true)
    fi
    echo "$ip"
}

vm_ssh() {
    local VM_IP
    VM_IP=$(get_vm_ip)
    [[ -z "$VM_IP" ]] && fail "Cannot determine VM IP. Is the QEMU guest agent running?"
    # shellcheck disable=SC2086
    ssh ${SSH_OPTS} "${SSH_USER}@${VM_IP}" "$@"
}

vm_scp() {
    local VM_IP
    VM_IP=$(get_vm_ip)
    [[ -z "$VM_IP" ]] && fail "Cannot determine VM IP."
    # shellcheck disable=SC2086
    scp ${SSH_OPTS} "$@"
}

# ── Helper: Proxmox API call ─────────────────────────────────
pve_api() {
    local method="$1"
    local endpoint="$2"
    shift 2
    curl -sSk -X "${method}" \
        -H "${AUTH_HEADER}" \
        "${API_BASE}${endpoint}" \
        "$@"
}

# ── Banner ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  CStrike v2 — VM Distribution Packaging${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════════${RESET}"
echo ""
echo "  VMID:           ${VMID}"
echo "  Node:           ${NODE}"
echo "  Output:         ${OUTPUT_DIR}"
echo "  Clean mode:     ${CLEAN}"
echo "  Skip OVA:       ${SKIP_OVA}"
echo "  Skip Docker:    ${SKIP_DOCKER_SAVE}"
echo "  SSH user:       ${SSH_USER}"
echo "  Version:        ${VERSION}"
echo ""

# ── Step 1: Validate prerequisites ───────────────────────────
step "Validating prerequisites"

command -v qemu-img &>/dev/null || fail "qemu-img not found. Install qemu-utils."
command -v jq &>/dev/null       || fail "jq not found. Install jq."
command -v curl &>/dev/null     || fail "curl not found."
command -v gzip &>/dev/null     || fail "gzip not found."
command -v ssh &>/dev/null      || fail "ssh not found."
ok "Required tools: qemu-img, jq, curl, gzip, ssh"

if ! $SKIP_OVA; then
    if command -v VBoxManage &>/dev/null; then
        ok "VBoxManage found — OVA/VDI generation enabled"
    else
        warn "VBoxManage not found — OVA/VDI generation will be skipped"
        SKIP_OVA=true
        TOTAL_STEPS=$((TOTAL_STEPS - 1))
    fi
fi

# Verify Proxmox API connectivity
CLUSTER_STATUS=$(pve_api GET "/version" 2>/dev/null | jq -r '.data.version // empty' || true)
if [[ -z "$CLUSTER_STATUS" ]]; then
    fail "Cannot connect to Proxmox API at ${PVE_HOST}"
fi
ok "Proxmox API reachable (version: ${CLUSTER_STATUS})"

# Verify VM exists
VM_STATUS=$(pve_api GET "/nodes/${NODE}/qemu/${VMID}/status/current" 2>/dev/null | jq -r '.data.status // empty' || true)
if [[ -z "$VM_STATUS" ]]; then
    fail "VM ${VMID} not found on node ${NODE}"
fi
ok "VM ${VMID} found (status: ${VM_STATUS})"

# Create output directory
mkdir -p "${OUTPUT_DIR}"
ok "Output directory: ${OUTPUT_DIR}"

# ── Step 2: Pre-save Docker images ───────────────────────────
if ! $SKIP_DOCKER_SAVE; then
    step "Pre-saving Docker images from VM ${VMID}"

    if [[ "$VM_STATUS" != "running" ]]; then
        warn "VM is not running — starting it for Docker image export..."
        pve_api POST "/nodes/${NODE}/qemu/${VMID}/status/start" | jq -r '.data // empty'
        info "Waiting for VM to boot (60s)..."
        sleep 60
    fi

    info "Saving Docker images inside VM..."
    vm_ssh "sudo bash -s" << 'REMOTE_DOCKER_SAVE'
set -euo pipefail
cd /opt/cstrike

# Get list of all images used by the compose stack
IMAGES=$(docker compose images --format json 2>/dev/null \
    | jq -r '.[]? | .Repository + ":" + .Tag' \
    | sort -u)

if [[ -z "$IMAGES" ]]; then
    # Fallback: get all local images
    IMAGES=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -v '<none>' | sort -u)
fi

echo "Images to save:"
echo "$IMAGES"

# Save all images to a single archive
# shellcheck disable=SC2086
docker save $IMAGES | gzip > /tmp/cstrike-docker-images.tar.gz
ls -lh /tmp/cstrike-docker-images.tar.gz
REMOTE_DOCKER_SAVE

    info "Downloading Docker image archive from VM..."
    VM_IP=$(get_vm_ip)
    # shellcheck disable=SC2086
    scp ${SSH_OPTS} "${SSH_USER}@${VM_IP}:/tmp/cstrike-docker-images.tar.gz" "${OUTPUT_DIR}/cstrike-docker-images.tar.gz"
    ok "Docker images saved: $(ls -lh "${OUTPUT_DIR}/cstrike-docker-images.tar.gz" | awk '{print $5}')"

    # Clean up remote temp file
    vm_ssh "rm -f /tmp/cstrike-docker-images.tar.gz" 2>/dev/null || true
fi

# ── Step 3: Clean sensitive data (optional) ───────────────────
if $CLEAN; then
    step "Cleaning sensitive data from VM ${VMID}"

    if [[ "$VM_STATUS" != "running" ]]; then
        warn "VM is not running — starting it for cleanup..."
        pve_api POST "/nodes/${NODE}/qemu/${VMID}/status/start" | jq -r '.data // empty'
        info "Waiting for VM to boot (60s)..."
        sleep 60
    fi

    info "Scrubbing sensitive data..."
    vm_ssh "sudo bash -s" << 'REMOTE_CLEAN'
set -euo pipefail

echo "Truncating shell history..."
truncate -s 0 /root/.bash_history 2>/dev/null || true
truncate -s 0 /root/.zsh_history 2>/dev/null || true
for h in /home/*/.bash_history /home/*/.zsh_history; do
    truncate -s 0 "$h" 2>/dev/null || true
done

echo "Removing SSH host keys (regenerated on first boot)..."
rm -f /etc/ssh/ssh_host_*

echo "Removing authorized_keys (user adds their own)..."
rm -f /root/.ssh/authorized_keys
for ak in /home/*/.ssh/authorized_keys; do
    rm -f "$ak" 2>/dev/null || true
done

echo "Resetting .env passwords to placeholder..."
if [[ -f /opt/cstrike/.env ]]; then
    sed -i 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=changeme/' /opt/cstrike/.env
    sed -i 's/^REDIS_PASSWORD=.*/REDIS_PASSWORD=changeme/' /opt/cstrike/.env
    sed -i 's/^KASM_PASSWORD=.*/KASM_PASSWORD=changeme/' /opt/cstrike/.env
fi

echo "Clearing Docker logs..."
find /var/lib/docker/containers/ -name '*-json.log' -exec truncate -s 0 {} \; 2>/dev/null || true

echo "Clearing apt cache..."
apt-get clean 2>/dev/null || true
rm -rf /var/cache/apt/archives/* 2>/dev/null || true

echo "Clearing temp files..."
rm -rf /tmp/* /var/tmp/* 2>/dev/null || true

echo "Installing first-boot service..."
mkdir -p /opt/cstrike/scripts/vm
REMOTE_CLEAN

    # Upload first-boot script and systemd service
    info "Installing first-boot service into VM..."
    VM_IP=$(get_vm_ip)
    # shellcheck disable=SC2086
    scp ${SSH_OPTS} "${SCRIPT_DIR}/cstrike-firstboot.sh" "${SSH_USER}@${VM_IP}:/tmp/cstrike-firstboot.sh"

    vm_ssh "sudo bash -s" << 'REMOTE_FIRSTBOOT'
set -euo pipefail

# Install first-boot script
cp /tmp/cstrike-firstboot.sh /opt/cstrike/scripts/vm/cstrike-firstboot.sh
chmod +x /opt/cstrike/scripts/vm/cstrike-firstboot.sh
rm -f /tmp/cstrike-firstboot.sh

# Remove completion marker so it runs on next boot
rm -f /opt/cstrike/.firstboot-complete

# Create systemd service
cat > /etc/systemd/system/cstrike-firstboot.service << 'UNIT'
[Unit]
Description=CStrike v2 First Boot Setup
After=network-online.target cloud-init.service
Wants=network-online.target
ConditionPathExists=!/opt/cstrike/.firstboot-complete

[Service]
Type=oneshot
ExecStart=/opt/cstrike/scripts/vm/cstrike-firstboot.sh
RemainAfterExit=yes
StandardOutput=journal+console

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable cstrike-firstboot.service

echo "First-boot service installed and enabled"
REMOTE_FIRSTBOOT

    info "Zero-filling free space for better compression..."
    vm_ssh "sudo bash -c 'dd if=/dev/zero of=/tmp/zero bs=1M 2>/dev/null; rm -f /tmp/zero; sync'" 2>/dev/null || true

    ok "VM cleaned and first-boot service installed"
fi

# ── Step 4: Stop VM ───────────────────────────────────────────
step "Stopping VM ${VMID}"

VM_STATUS=$(pve_api GET "/nodes/${NODE}/qemu/${VMID}/status/current" | jq -r '.data.status')
if [[ "$VM_STATUS" == "running" ]]; then
    info "Sending shutdown command..."
    pve_api POST "/nodes/${NODE}/qemu/${VMID}/status/shutdown" | jq -r '.data // empty'

    # Wait for VM to stop (up to 120s)
    WAIT=0
    while [[ $WAIT -lt 120 ]]; do
        STATUS=$(pve_api GET "/nodes/${NODE}/qemu/${VMID}/status/current" | jq -r '.data.status')
        if [[ "$STATUS" == "stopped" ]]; then
            break
        fi
        sleep 5
        WAIT=$((WAIT + 5))
        echo -ne "\r  Waiting for shutdown... ${WAIT}s"
    done
    echo ""

    if [[ "$STATUS" != "stopped" ]]; then
        warn "Graceful shutdown timed out, forcing stop..."
        pve_api POST "/nodes/${NODE}/qemu/${VMID}/status/stop" | jq -r '.data // empty'
        sleep 10
    fi
fi

ok "VM ${VMID} stopped"

# ── Step 5: Detect storage backend and disk path ─────────────
step "Detecting storage backend"

# Get VM config to find disk info
VM_CONFIG=$(pve_api GET "/nodes/${NODE}/qemu/${VMID}/config")

# Find the primary disk (try scsi0, virtio0, ide0, sata0)
DISK_INFO=""
for DISK_KEY in scsi0 virtio0 ide0 sata0; do
    DISK_INFO=$(echo "$VM_CONFIG" | jq -r ".data.${DISK_KEY} // empty" | head -1)
    if [[ -n "$DISK_INFO" ]]; then
        info "Found disk on ${DISK_KEY}: ${DISK_INFO}"
        break
    fi
done

if [[ -z "$DISK_INFO" ]]; then
    fail "No disk found on VM ${VMID}"
fi

# Parse storage:volume format
STORAGE=$(echo "$DISK_INFO" | cut -d: -f1)
VOLUME=$(echo "$DISK_INFO" | cut -d: -f2 | cut -d, -f1)
ok "Storage: ${STORAGE}, Volume: ${VOLUME}"

# Get storage type and path
STORAGE_CONFIG=$(pve_api GET "/nodes/${NODE}/storage/${STORAGE}")
STORAGE_TYPE=$(echo "$STORAGE_CONFIG" | jq -r '.data.type // empty')
STORAGE_PATH=$(echo "$STORAGE_CONFIG" | jq -r '.data.path // empty')
STORAGE_VG=$(echo "$STORAGE_CONFIG" | jq -r '.data.vgname // empty')
STORAGE_POOL=$(echo "$STORAGE_CONFIG" | jq -r '.data.pool // empty')

info "Storage type: ${STORAGE_TYPE}"

# Determine the actual disk device/path
case "$STORAGE_TYPE" in
    lvm|lvmthin)
        DISK_DEVICE="/dev/${STORAGE_VG}/${VOLUME}"
        ok "LVM disk device: ${DISK_DEVICE}"
        ;;
    dir|nfs|cifs)
        DISK_DEVICE="${STORAGE_PATH}/images/${VMID}/${VOLUME}"
        ok "Directory disk path: ${DISK_DEVICE}"
        ;;
    zfspool)
        DISK_DEVICE="/dev/zvol/${STORAGE_POOL}/${VOLUME}"
        ok "ZFS disk device: ${DISK_DEVICE}"
        ;;
    *)
        # Try to find it via the volume API
        VOLUME_INFO=$(pve_api GET "/nodes/${NODE}/storage/${STORAGE}/content/${STORAGE}:${VOLUME}" 2>/dev/null || true)
        DISK_DEVICE=$(echo "$VOLUME_INFO" | jq -r '.data.path // empty')
        if [[ -z "$DISK_DEVICE" ]]; then
            fail "Unknown storage type '${STORAGE_TYPE}'. Cannot determine disk path."
        fi
        ok "Disk path (via API): ${DISK_DEVICE}"
        ;;
esac

# ── Step 6: Export disk images ────────────────────────────────
step "Exporting disk images"

# Compressed qcow2 (smallest, QEMU/KVM/Proxmox-ready)
info "Converting to compressed qcow2..."
qemu-img convert -f raw -O qcow2 -c \
    "${DISK_DEVICE}" "${OUTPUT_DIR}/cstrike-v2.qcow2" 2>&1
QCOW2_SIZE=$(ls -lh "${OUTPUT_DIR}/cstrike-v2.qcow2" | awk '{print $5}')
ok "qcow2: ${OUTPUT_DIR}/cstrike-v2.qcow2 (${QCOW2_SIZE})"

# Sparse raw (for VDI/OVA conversion and tar.gz distribution)
info "Converting to sparse raw..."
qemu-img convert -f raw -O raw -S 4k \
    "${DISK_DEVICE}" "${OUTPUT_DIR}/cstrike-v2.raw" 2>&1
RAW_SIZE=$(ls -lh "${OUTPUT_DIR}/cstrike-v2.raw" | awk '{print $5}')
ok "raw: ${OUTPUT_DIR}/cstrike-v2.raw (${RAW_SIZE})"

# Compressed raw for distribution
info "Compressing raw image..."
gzip -c "${OUTPUT_DIR}/cstrike-v2.raw" > "${OUTPUT_DIR}/cstrike-v2.raw.gz"
RAWGZ_SIZE=$(ls -lh "${OUTPUT_DIR}/cstrike-v2.raw.gz" | awk '{print $5}')
ok "raw.gz: ${OUTPUT_DIR}/cstrike-v2.raw.gz (${RAWGZ_SIZE})"

# ── Step 7: Start VM back up ─────────────────────────────────
step "Restarting VM ${VMID}"

pve_api POST "/nodes/${NODE}/qemu/${VMID}/status/start" | jq -r '.data // empty'
ok "VM ${VMID} start command issued"

# ── Step 8: Generate OVA/VDI (if VBoxManage available) ────────
if ! $SKIP_OVA; then
    step "Generating OVA and VDI"

    # Convert raw → VDI
    info "Converting raw to VDI..."
    VBoxManage convertfromraw "${OUTPUT_DIR}/cstrike-v2.raw" "${OUTPUT_DIR}/cstrike-v2.vdi" --format VDI
    VDI_SIZE=$(ls -lh "${OUTPUT_DIR}/cstrike-v2.vdi" | awk '{print $5}')
    ok "VDI: ${OUTPUT_DIR}/cstrike-v2.vdi (${VDI_SIZE})"

    # Create temp VM for OVA export
    TEMP_VM="cstrike-package-$$"
    info "Creating temporary VirtualBox VM for OVA packaging..."

    VBoxManage createvm --name "$TEMP_VM" --ostype Debian_64 --register
    VBoxManage modifyvm "$TEMP_VM" \
        --cpus 4 --memory 8192 \
        --firmware efi \
        --nic1 nat --nictype1 virtio \
        --nic2 hostonly --nictype2 virtio \
        --audio-enabled off \
        --description "${PRODUCT} — Autonomous Offensive Security Platform. Debian 12 with 35+ security tools, 9-container Docker stack, and VPN IP rotation."

    VBoxManage storagectl "$TEMP_VM" --name "SATA" --add sata --controller IntelAhci
    # Clone VDI so the export doesn't lock our output VDI
    VBoxManage clonemedium disk "${OUTPUT_DIR}/cstrike-v2.vdi" "${OUTPUT_DIR}/cstrike-v2-export.vdi"
    VBoxManage storageattach "$TEMP_VM" --storagectl "SATA" --port 0 --device 0 --type hdd --medium "${OUTPUT_DIR}/cstrike-v2-export.vdi"

    info "Exporting to OVA..."
    VBoxManage export "$TEMP_VM" \
        --output "${OUTPUT_DIR}/cstrike-v2.ova" \
        --ovf20 \
        --manifest \
        --vsys 0 \
        --product "${PRODUCT}" \
        --producturl "https://github.com/culpur/cstrike" \
        --vendor "Culpur Defense Inc." \
        --vendorurl "https://culpur.net" \
        --description "${PRODUCT} — Autonomous Offensive Security Platform. Debian 12 with 35+ security tools, 9-container Docker stack, AI-driven 9-phase attack pipeline, and VPN IP rotation." \
        --version "${VERSION}"

    # Cleanup temp VM
    VBoxManage unregistervm "$TEMP_VM" --delete 2>/dev/null || true
    rm -f "${OUTPUT_DIR}/cstrike-v2-export.vdi"

    OVA_SIZE=$(ls -lh "${OUTPUT_DIR}/cstrike-v2.ova" | awk '{print $5}')
    ok "OVA: ${OUTPUT_DIR}/cstrike-v2.ova (${OVA_SIZE})"
fi

# ── Step 9: Build distribution tar.gz ─────────────────────────
step "Building distribution archive"

DIST_DIR="${OUTPUT_DIR}/cstrike-v2-dist"
mkdir -p "$DIST_DIR"

# Copy artifacts into distribution directory
cp "${OUTPUT_DIR}/cstrike-v2.raw.gz" "$DIST_DIR/"
cp "${OUTPUT_DIR}/cstrike-v2.qcow2" "$DIST_DIR/"

if [[ -f "${OUTPUT_DIR}/cstrike-docker-images.tar.gz" ]]; then
    cp "${OUTPUT_DIR}/cstrike-docker-images.tar.gz" "$DIST_DIR/"
fi

# Copy import scripts
cp "${SCRIPT_DIR}/import-raw.sh" "$DIST_DIR/" 2>/dev/null || warn "import-raw.sh not found"
cp "${SCRIPT_DIR}/import-ova.sh" "$DIST_DIR/" 2>/dev/null || warn "import-ova.sh not found"
cp "${SCRIPT_DIR}/cloud-init-generic.yml" "$DIST_DIR/" 2>/dev/null || true
cp "${SCRIPT_DIR}/cstrike-firstboot.sh" "$DIST_DIR/" 2>/dev/null || true

# Copy install.sh if available (bare-metal fallback)
if [[ -f "${SCRIPT_DIR}/../../install.sh" ]]; then
    cp "${SCRIPT_DIR}/../../install.sh" "$DIST_DIR/"
fi

# Write version file
echo "${VERSION}" > "$DIST_DIR/VERSION"

# Write README
cat > "$DIST_DIR/README.txt" << 'EOF'
CStrike v2 — Distribution Package
══════════════════════════════════

This package contains a pre-built CStrike v2 VM image with:
  - Debian 12 with 35+ security tools on the host
  - 6-container Docker stack (PostgreSQL, Redis, API, Frontend, Traefik, KasmVNC)
  - Security hardening, VPN routing, and redteam user

QUICK START
───────────

  Proxmox / KVM:
    ./import-raw.sh --proxmox --vmid 300 --storage local-lvm

  VirtualBox (if .ova included):
    VBoxManage import cstrike-v2.ova

  QEMU (direct boot):
    ./import-raw.sh --qemu

CONTENTS
────────

  cstrike-v2.raw.gz                Raw disk image (compressed)
  cstrike-v2.qcow2                QEMU/KVM/Proxmox disk image
  cstrike-docker-images.tar.gz    Pre-saved Docker images (offline)
  import-raw.sh                   Proxmox/KVM import helper
  import-ova.sh                   VirtualBox import helper
  cloud-init-generic.yml          Cloud-init config
  cstrike-firstboot.sh            First-boot setup script
  install.sh                      Bare-metal installer (fallback)
  checksums.sha256                SHA256 integrity verification
  VERSION                         Version string

FIRST BOOT
──────────

  The VM auto-expands the disk partition, regenerates SSH keys,
  randomizes .env passwords, and starts the Docker stack.

ACCESS (after boot)
───────────────────

  Dashboard:  https://<vm-ip>/
  Kasm VNC:   https://<vm-ip>:6901/
  SSH:        ssh soulofall@<vm-ip>
  Credentials: /opt/cstrike/.env

EOF

# Generate checksums for all distribution files
info "Generating SHA256 checksums..."
cd "$DIST_DIR"
sha256sum -- * > checksums.sha256 2>/dev/null || true
# Remove self-reference from checksums
sed -i '/checksums.sha256/d' checksums.sha256 2>/dev/null || true
cd - > /dev/null

# Create the distribution tarball
info "Creating distribution archive..."
cd "${OUTPUT_DIR}"
tar czf "cstrike-v2-dist.tar.gz" "cstrike-v2-dist/"
cd - > /dev/null

DIST_SIZE=$(ls -lh "${OUTPUT_DIR}/cstrike-v2-dist.tar.gz" | awk '{print $5}')
ok "Distribution archive: ${OUTPUT_DIR}/cstrike-v2-dist.tar.gz (${DIST_SIZE})"

# ── Step 10: Generate checksums for all output files ──────────
step "Generating checksums"

cd "${OUTPUT_DIR}"
sha256sum cstrike-v2.qcow2 cstrike-v2.raw.gz cstrike-v2-dist.tar.gz > checksums.sha256 2>/dev/null
if [[ -f cstrike-v2.ova ]]; then
    sha256sum cstrike-v2.ova >> checksums.sha256
fi
if [[ -f cstrike-v2.vdi ]]; then
    sha256sum cstrike-v2.vdi >> checksums.sha256
fi
if [[ -f cstrike-docker-images.tar.gz ]]; then
    sha256sum cstrike-docker-images.tar.gz >> checksums.sha256
fi
cd - > /dev/null

ok "Checksums written to ${OUTPUT_DIR}/checksums.sha256"
cat "${OUTPUT_DIR}/checksums.sha256" | sed 's/^/    /'

# ── Summary ──────────────────────────────────────────────────
END_TIME=$(date +%s)
DURATION=$(( END_TIME - START_TIME ))
MINUTES=$(( DURATION / 60 ))
SECS=$(( DURATION % 60 ))

# Clean up intermediate raw file (keep only compressed)
rm -f "${OUTPUT_DIR}/cstrike-v2.raw"

echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  CStrike v2 — Packaging Complete${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${BOLD}Distribution Artifacts:${RESET}"
echo ""

# List all output files with sizes
for f in "${OUTPUT_DIR}"/cstrike-v2.*  "${OUTPUT_DIR}"/cstrike-docker-images.tar.gz "${OUTPUT_DIR}"/cstrike-v2-dist.tar.gz; do
    if [[ -f "$f" ]]; then
        SIZE=$(ls -lh "$f" | awk '{print $5}')
        NAME=$(basename "$f")
        printf "    %-40s %s\n" "$NAME" "$SIZE"
    fi
done

echo ""
echo -e "  ${BOLD}Import Instructions:${RESET}"
echo ""
echo "    Proxmox:     ./import-raw.sh --proxmox --vmid 300 --storage local-lvm"
echo "    KVM/libvirt: ./import-raw.sh --kvm --name cstrike"
echo "    QEMU:        ./import-raw.sh --qemu"
if ! $SKIP_OVA; then
echo "    VirtualBox:  ./import-ova.sh cstrike-v2.ova"
fi
echo ""
echo "    Full package: tar xzf cstrike-v2-dist.tar.gz && cd cstrike-v2-dist"
echo ""
echo -e "  Completed in ${MINUTES}m ${SECS}s"
echo ""
