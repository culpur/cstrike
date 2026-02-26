#!/bin/bash
# CStrike VM — Proxmox VM Creation Script
# Creates a Debian 12 VM with the required specs via Proxmox API
#
# Usage: ./create-vm.sh [--vmid ID] [--storage STORAGE]
#
# Prerequisites:
#   - Proxmox API access configured (PVE_HOST, PVE_TOKEN_ID, PVE_TOKEN_SECRET)
#   - Debian 12 cloud image available on Proxmox storage
#   - vmbr1 bridge configured on the Proxmox host

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────
VMID="${VMID:-200}"
VM_NAME="cstrike"
STORAGE="${STORAGE:-local-lvm}"
ISO_STORAGE="${ISO_STORAGE:-local}"
CLOUD_IMAGE="${CLOUD_IMAGE:-debian-12-genericcloud-amd64.qcow2}"
NODE="${PVE_NODE:-proxmox}"

# VM Specs
CORES=4
SOCKETS=1
MEMORY=8192    # 8GB
DISK_SIZE="50G"
BRIDGE="vmbr1"

# Proxmox API
PVE_HOST="${PVE_HOST:?PVE_HOST must be set (e.g., https://proxmox.local:8006)}"
PVE_TOKEN_ID="${PVE_TOKEN_ID:?PVE_TOKEN_ID must be set (e.g., root@pam!cstrike)}"
PVE_TOKEN_SECRET="${PVE_TOKEN_SECRET:?PVE_TOKEN_SECRET must be set}"

API_BASE="${PVE_HOST}/api2/json"
AUTH_HEADER="Authorization: PVEAPIToken=${PVE_TOKEN_ID}=${PVE_TOKEN_SECRET}"

# ── Parse arguments ───────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case $1 in
        --vmid) VMID="$2"; shift 2 ;;
        --storage) STORAGE="$2"; shift 2 ;;
        --node) NODE="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLOUD_INIT_FILE="${SCRIPT_DIR}/cloud-init.yml"

echo "═══════════════════════════════════════════════════════════"
echo "  CStrike VM Creation — Proxmox API"
echo "═══════════════════════════════════════════════════════════"
echo "  VMID:     ${VMID}"
echo "  Name:     ${VM_NAME}"
echo "  Node:     ${NODE}"
echo "  Specs:    ${SOCKETS}s/${CORES}c, ${MEMORY}MB RAM, ${DISK_SIZE} disk"
echo "  Storage:  ${STORAGE}"
echo "  Network:  2x NIC on ${BRIDGE}"
echo "═══════════════════════════════════════════════════════════"

# ── Helper: API call ──────────────────────────────────────────
pve_api() {
    local method="$1"
    local endpoint="$2"
    shift 2
    curl -sSk -X "${method}" \
        -H "${AUTH_HEADER}" \
        "${API_BASE}${endpoint}" \
        "$@"
}

# ── Step 1: Check if VM already exists ────────────────────────
echo ""
echo "[1/6] Checking if VMID ${VMID} already exists..."
EXISTING=$(pve_api GET "/nodes/${NODE}/qemu/${VMID}/status/current" 2>/dev/null || true)
if echo "${EXISTING}" | jq -e '.data.vmid' &>/dev/null; then
    echo "  ERROR: VM ${VMID} already exists. Use a different VMID or delete it first."
    exit 1
fi
echo "  OK — VMID ${VMID} is available"

# ── Step 2: Create the VM ────────────────────────────────────
echo ""
echo "[2/6] Creating VM ${VM_NAME} (VMID: ${VMID})..."
pve_api POST "/nodes/${NODE}/qemu" \
    -d "vmid=${VMID}" \
    -d "name=${VM_NAME}" \
    -d "ostype=l26" \
    -d "sockets=${SOCKETS}" \
    -d "cores=${CORES}" \
    -d "memory=${MEMORY}" \
    -d "balloon=0" \
    -d "cpu=host" \
    -d "scsihw=virtio-scsi-single" \
    -d "bios=ovmf" \
    -d "machine=q35" \
    -d "agent=1" \
    -d "onboot=1" \
    -d "net0=virtio,bridge=${BRIDGE},firewall=0,tag=70" \
    -d "net1=virtio,bridge=${BRIDGE},firewall=0,tag=71" \
    -d "serial0=socket" \
    -d "vga=serial0" \
    | jq .
echo "  VM created"

# ── Step 3: Import cloud image as disk ────────────────────────
echo ""
echo "[3/6] Importing cloud image and attaching disk..."

# Import the cloud image to the VM's storage
pve_api POST "/nodes/${NODE}/qemu/${VMID}/config" \
    -d "scsi0=${STORAGE}:0,import-from=${ISO_STORAGE}:iso/${CLOUD_IMAGE},discard=on,iothread=1,ssd=1" \
    | jq .

# Resize to target size
pve_api PUT "/nodes/${NODE}/qemu/${VMID}/resize" \
    -d "disk=scsi0" \
    -d "size=${DISK_SIZE}" \
    | jq .

echo "  Disk imported and resized to ${DISK_SIZE}"

# ── Step 4: Add EFI disk + cloud-init drive ───────────────────
echo ""
echo "[4/6] Configuring EFI disk and cloud-init drive..."
pve_api PUT "/nodes/${NODE}/qemu/${VMID}/config" \
    -d "efidisk0=${STORAGE}:1,efitype=4m,pre-enrolled-keys=0" \
    -d "ide2=${STORAGE}:cloudinit" \
    -d "boot=order=scsi0" \
    | jq .
echo "  EFI + cloud-init configured"

# ── Step 5: Apply cloud-init settings ─────────────────────────
echo ""
echo "[5/6] Applying cloud-init configuration..."
if [[ -f "${CLOUD_INIT_FILE}" ]]; then
    # Upload cicustom snippet if storage supports it
    pve_api PUT "/nodes/${NODE}/qemu/${VMID}/config" \
        -d "ciuser=soulofall" \
        -d "citype=nocloud" \
        -d "ipconfig0=ip=dhcp" \
        -d "ipconfig1=ip=dhcp" \
        -d "nameserver=1.1.1.1 8.8.8.8" \
        -d "searchdomain=local" \
        -d "sshkeys=$(python3 -c "import urllib.parse; print(urllib.parse.quote('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINxbkRVj+GuR6+l0TfQa97TosRkiwDn2/EtFCC1migB+ soulofall@guard'))")" \
        | jq .
    echo "  Cloud-init applied"
else
    echo "  WARNING: ${CLOUD_INIT_FILE} not found, using API defaults only"
    pve_api PUT "/nodes/${NODE}/qemu/${VMID}/config" \
        -d "ciuser=soulofall" \
        -d "citype=nocloud" \
        -d "ipconfig0=ip=dhcp" \
        -d "ipconfig1=ip=dhcp" \
        | jq .
fi

# ── Step 6: Summary ──────────────────────────────────────────
echo ""
echo "[6/6] VM creation complete!"
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  VM Ready: ${VM_NAME} (VMID: ${VMID})"
echo ""
echo "  Next steps:"
echo "    1. Start VM:    qm start ${VMID}"
echo "    2. Wait for cloud-init to complete"
echo "    3. SSH in:      ssh soulofall@<vm-ip>"
echo "    4. Run:         ./provision-host.sh"
echo "    5. Run:         ./setup-redteam.sh"
echo "    6. Run:         ./harden-host.sh"
echo "═══════════════════════════════════════════════════════════"
