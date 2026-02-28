#!/bin/bash
# CStrike v2 — VirtualBox OVA Import Helper
# Imports a CStrike v2 OVA appliance into VirtualBox with recommended settings.
#
# Usage:
#   ./import-ova.sh cstrike-v2.ova
#   ./import-ova.sh --name "My CStrike" --cpus 8 --memory 16384 cstrike-v2.ova
#   ./import-ova.sh --start cstrike-v2.ova
#
# Options:
#   --name NAME    Override VM name (default: from OVA metadata)
#   --cpus N       Override CPU count (default: 4)
#   --memory MB    Override RAM in MB (default: 8192)
#   --start        Start the VM after import
#   --headless     Start in headless mode (no GUI window)

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────
VM_NAME=""
CPUS=""
MEMORY=""
OVA_FILE=""
START_VM=false
HEADLESS=false

# ── Parse arguments ───────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case $1 in
        --name)     VM_NAME="$2"; shift 2 ;;
        --cpus)     CPUS="$2"; shift 2 ;;
        --memory)   MEMORY="$2"; shift 2 ;;
        --start)    START_VM=true; shift ;;
        --headless) HEADLESS=true; START_VM=true; shift ;;
        --help|-h)
            echo "Usage: ./import-ova.sh [OPTIONS] <ova-file>"
            echo ""
            echo "Options:"
            echo "  --name NAME    Override VM name"
            echo "  --cpus N       Override CPU count (default: 4)"
            echo "  --memory MB    Override RAM in MB (default: 8192)"
            echo "  --start        Start VM after import"
            echo "  --headless     Start in headless mode"
            echo "  --help         Show this message"
            exit 0
            ;;
        -*)
            echo "Unknown option: $1"; exit 1 ;;
        *)
            OVA_FILE="$1"; shift ;;
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

echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  CStrike v2 — VirtualBox OVA Import${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════════${RESET}"
echo ""

# ── Validate ──────────────────────────────────────────────────
if [[ -z "$OVA_FILE" ]]; then
    # Auto-detect OVA in current directory
    for candidate in cstrike-v2.ova cstrike*.ova; do
        if [[ -f "$candidate" ]]; then
            OVA_FILE="$candidate"
            break
        fi
    done
fi

if [[ -z "$OVA_FILE" ]] || [[ ! -f "$OVA_FILE" ]]; then
    fail "OVA file not found. Usage: ./import-ova.sh [OPTIONS] <ova-file>"
fi

command -v VBoxManage &>/dev/null || fail "VBoxManage not found. Install VirtualBox first."

ok "OVA file: ${OVA_FILE} ($(ls -lh "$OVA_FILE" | awk '{print $5}'))"

# ── Preview OVA contents ─────────────────────────────────────
info "OVA appliance info:"
VBoxManage import "$OVA_FILE" --dry-run 2>&1 | grep -E '(Virtual system|Product|Description|CPU|Memory|Disk)' | sed 's/^/    /' || true
echo ""

# ── Build import command ──────────────────────────────────────
IMPORT_ARGS=("$OVA_FILE")

# Apply overrides
VSYS_ARGS=()
if [[ -n "$VM_NAME" ]]; then
    VSYS_ARGS+=(--vsys 0 --vmname "$VM_NAME")
fi
if [[ -n "$CPUS" ]]; then
    VSYS_ARGS+=(--vsys 0 --cpus "$CPUS")
fi
if [[ -n "$MEMORY" ]]; then
    VSYS_ARGS+=(--vsys 0 --memory "$MEMORY")
fi

# ── Import ────────────────────────────────────────────────────
info "Importing OVA (this may take a few minutes)..."
VBoxManage import "${IMPORT_ARGS[@]}" "${VSYS_ARGS[@]}"
ok "OVA imported successfully"

# ── Detect imported VM name ───────────────────────────────────
if [[ -z "$VM_NAME" ]]; then
    # Try to get the VM name from the OVA
    VM_NAME=$(VBoxManage import "$OVA_FILE" --dry-run 2>&1 | grep -oP 'Suggested VM name "\K[^"]+' || echo "CStrike v2")
fi

# ── Configure networking ─────────────────────────────────────
info "Configuring network adapters..."

# NIC 1: NAT (internet access)
# This should already be set from the OVA, but ensure it
VBoxManage modifyvm "$VM_NAME" --nic1 nat --nictype1 virtio 2>/dev/null || true

# NIC 2: Host-only (lab access from host)
# Create host-only network if it doesn't exist
HOSTONLY_IF=$(VBoxManage list hostonlyifs 2>/dev/null | head -1 | awk '{print $2}' || true)
if [[ -z "$HOSTONLY_IF" ]]; then
    info "Creating host-only network..."
    HOSTONLY_IF=$(VBoxManage hostonlyif create 2>&1 | grep -oP "Interface '\K[^']+" || true)
    if [[ -n "$HOSTONLY_IF" ]]; then
        VBoxManage hostonlyif ipconfig "$HOSTONLY_IF" --ip 192.168.56.1 --netmask 255.255.255.0 2>/dev/null || true
    fi
fi

if [[ -n "$HOSTONLY_IF" ]]; then
    VBoxManage modifyvm "$VM_NAME" --nic2 hostonly --nictype2 virtio --hostonlyadapter2 "$HOSTONLY_IF" 2>/dev/null || true
    ok "NIC 2: Host-only (${HOSTONLY_IF})"
else
    warn "Could not configure host-only network. VM will only have NAT access."
fi

ok "NIC 1: NAT (internet)"

# ── Apply overrides ──────────────────────────────────────────
if [[ -n "$CPUS" ]]; then
    VBoxManage modifyvm "$VM_NAME" --cpus "$CPUS"
    ok "CPUs: ${CPUS}"
fi
if [[ -n "$MEMORY" ]]; then
    VBoxManage modifyvm "$VM_NAME" --memory "$MEMORY"
    ok "Memory: ${MEMORY} MB"
fi

# ── Start VM (optional) ──────────────────────────────────────
if $START_VM; then
    echo ""
    if $HEADLESS; then
        info "Starting VM in headless mode..."
        VBoxManage startvm "$VM_NAME" --type headless
    else
        info "Starting VM..."
        VBoxManage startvm "$VM_NAME"
    fi
    ok "VM '${VM_NAME}' started"
    echo ""
    info "Waiting for VM to boot and acquire IP (30s)..."
    sleep 30

    # Try to get the VM's IP
    VM_IP=$(VBoxManage guestproperty get "$VM_NAME" "/VirtualBox/GuestInfo/Net/0/V4/IP" 2>/dev/null | awk '{print $2}' || true)
    if [[ -n "$VM_IP" ]] && [[ "$VM_IP" != "No" ]]; then
        ok "VM IP: ${VM_IP}"
    fi
fi

# ── Summary ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  Import Complete: ${VM_NAME}${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${BOLD}VM Management:${RESET}"
echo "    Start:    VBoxManage startvm \"${VM_NAME}\""
echo "    Headless: VBoxManage startvm \"${VM_NAME}\" --type headless"
echo "    Stop:     VBoxManage controlvm \"${VM_NAME}\" acpipowerbutton"
echo "    Status:   VBoxManage showvminfo \"${VM_NAME}\" --machinereadable | grep VMState"
echo ""
echo -e "  ${BOLD}First Boot:${RESET}"
echo "    The VM will automatically expand the disk, regenerate SSH keys,"
echo "    randomize passwords, and start the Docker stack."
echo ""
echo -e "  ${BOLD}Access (after boot):${RESET}"
echo "    Dashboard:    https://<vm-ip>/"
echo "    Kasm VNC:     https://<vm-ip>:6901/"
echo "    SSH:          ssh soulofall@<vm-ip>"
echo "    Credentials:  /opt/cstrike/.env"
echo ""
echo -e "  ${BOLD}NAT Port Forwarding (if using NAT only):${RESET}"
echo "    VBoxManage modifyvm \"${VM_NAME}\" --natpf1 \"ssh,tcp,,2222,,22\""
echo "    VBoxManage modifyvm \"${VM_NAME}\" --natpf1 \"https,tcp,,8443,,443\""
echo "    VBoxManage modifyvm \"${VM_NAME}\" --natpf1 \"kasm,tcp,,6901,,6901\""
echo ""
