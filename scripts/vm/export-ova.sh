#!/bin/bash
# CStrike v2 — VirtualBox OVA Export
# Exports a configured CStrike VM as a portable OVA appliance.
#
# Usage:
#   Mode A — Export an existing VirtualBox VM:
#     ./export-ova.sh --vm-name "CStrike v2"
#
#   Mode B — Export a Proxmox VM disk (convert first):
#     ./export-ova.sh --disk /path/to/vm-disk.qcow2
#
#   Options:
#     --vm-name NAME    VirtualBox VM name to export
#     --disk PATH       Raw/qcow2 disk image to convert and package
#     --output PATH     Output OVA file (default: cstrike-v2.ova)
#     --clean           Remove SSH keys and bash history before export

set -euo pipefail

# ── Defaults ────────────────────────────────────────────────
VM_NAME=""
DISK_PATH=""
OUTPUT="cstrike-v2.ova"
CLEAN=false

for arg in "$@"; do
    case "$arg" in
        --vm-name)  shift; VM_NAME="$1"; shift ;;
        --disk)     shift; DISK_PATH="$1"; shift ;;
        --output)   shift; OUTPUT="$1"; shift ;;
        --clean)    CLEAN=true; shift ;;
        --help|-h)
            echo "Usage: ./export-ova.sh [--vm-name NAME | --disk PATH] [OPTIONS]"
            echo ""
            echo "Modes:"
            echo "  --vm-name NAME   Export an existing VirtualBox VM"
            echo "  --disk PATH      Convert a qcow2/raw disk image to OVA"
            echo ""
            echo "Options:"
            echo "  --output PATH    Output file (default: cstrike-v2.ova)"
            echo "  --clean          Remove SSH keys and history before export"
            echo "  --help           Show this message"
            exit 0
            ;;
    esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

ok()   { echo -e "${GREEN}[+]${RESET} $1"; }
fail() { echo -e "${RED}[x]${RESET} $1"; exit 1; }
info() { echo -e "${CYAN}[*]${RESET} $1"; }

echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  CStrike v2 — VirtualBox OVA Export${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════════${RESET}"
echo ""

# ── Mode A: Export existing VirtualBox VM ──────────────────
if [[ -n "$VM_NAME" ]]; then
    command -v VBoxManage &>/dev/null || fail "VBoxManage not found. Install VirtualBox first."

    # Verify VM exists
    VBoxManage showvminfo "$VM_NAME" &>/dev/null || fail "VM '$VM_NAME' not found in VirtualBox"

    # Check if VM is running
    VM_STATE=$(VBoxManage showvminfo "$VM_NAME" --machinereadable | grep "VMState=" | cut -d'"' -f2)
    if [[ "$VM_STATE" != "poweroff" ]]; then
        info "VM is ${VM_STATE}. Shutting down gracefully..."
        VBoxManage controlvm "$VM_NAME" acpipowerbutton
        sleep 30
        VM_STATE=$(VBoxManage showvminfo "$VM_NAME" --machinereadable | grep "VMState=" | cut -d'"' -f2)
        if [[ "$VM_STATE" != "poweroff" ]]; then
            fail "VM did not shut down. Power off manually: VBoxManage controlvm '$VM_NAME' poweroff"
        fi
    fi

    ok "VM is powered off"

    # Clean up if requested
    if $CLEAN; then
        info "Cleaning VM before export (removing SSH keys, history)..."
        # Mount the disk and clean — requires guestfish or similar
        # For now, warn the user to clean manually
        echo "  NOTE: Run these commands inside the VM before exporting:"
        echo "    sudo rm -f /etc/ssh/ssh_host_*"
        echo "    sudo rm -f /root/.bash_history /home/*/.bash_history"
        echo "    sudo rm -f /home/*/.ssh/authorized_keys"
        echo "    sudo apt-get clean && sudo rm -rf /var/cache/apt/archives/*"
        echo "    sudo truncate -s 0 /var/log/*.log"
        echo "    history -c"
        echo ""
    fi

    info "Exporting VM '${VM_NAME}' to ${OUTPUT}..."

    VBoxManage export "$VM_NAME" \
        --output "$OUTPUT" \
        --ovf20 \
        --manifest \
        --vsys 0 \
        --product "CStrike v2" \
        --producturl "https://github.com/culpur/cstrike" \
        --vendor "Culpur Defense Inc." \
        --vendorurl "https://culpur.net" \
        --description "CStrike v2 — Autonomous Offensive Security Platform. Debian 12 with 35+ security tools, 9-container Docker stack, AI-driven 9-phase attack pipeline, and VPN IP rotation." \
        --version "2.6"

    ok "OVA exported to: ${OUTPUT}"
    ls -lh "$OUTPUT"

# ── Mode B: Convert disk image to OVA ─────────────────────
elif [[ -n "$DISK_PATH" ]]; then
    [[ -f "$DISK_PATH" ]] || fail "Disk image not found: $DISK_PATH"
    command -v VBoxManage &>/dev/null || fail "VBoxManage not found. Install VirtualBox first."

    WORK_DIR=$(mktemp -d)
    VDI_PATH="${WORK_DIR}/cstrike.vdi"

    # Convert to VDI
    info "Converting disk image to VDI format..."
    if [[ "$DISK_PATH" == *.qcow2 ]]; then
        command -v qemu-img &>/dev/null || fail "qemu-img not found. Install qemu-utils."
        RAW_PATH="${WORK_DIR}/disk.raw"
        qemu-img convert -f qcow2 -O raw "$DISK_PATH" "$RAW_PATH"
        VBoxManage convertfromraw "$RAW_PATH" "$VDI_PATH" --format VDI
        rm -f "$RAW_PATH"
    elif [[ "$DISK_PATH" == *.raw ]] || [[ "$DISK_PATH" == *.img ]]; then
        VBoxManage convertfromraw "$DISK_PATH" "$VDI_PATH" --format VDI
    else
        fail "Unsupported disk format. Use .qcow2, .raw, or .img"
    fi

    ok "Converted to VDI"

    # Create temporary VM
    TEMP_VM="cstrike-export-$$"
    info "Creating temporary VM for OVA packaging..."

    VBoxManage createvm --name "$TEMP_VM" --ostype Debian_64 --register
    VBoxManage modifyvm "$TEMP_VM" \
        --cpus 4 --memory 8192 \
        --firmware efi \
        --nic1 nat --nictype1 virtio \
        --audio-enabled off \
        --description "CStrike v2 — Autonomous Offensive Security Platform"

    VBoxManage storagectl "$TEMP_VM" --name "SATA" --add sata --controller IntelAhci
    VBoxManage storageattach "$TEMP_VM" --storagectl "SATA" --port 0 --device 0 --type hdd --medium "$VDI_PATH"

    # Export
    info "Exporting to OVA..."
    VBoxManage export "$TEMP_VM" \
        --output "$OUTPUT" \
        --ovf20 \
        --manifest \
        --vsys 0 \
        --product "CStrike v2" \
        --vendor "Culpur Defense Inc." \
        --version "2.6"

    # Cleanup
    VBoxManage unregistervm "$TEMP_VM" --delete 2>/dev/null || true
    rm -rf "$WORK_DIR"

    ok "OVA exported to: ${OUTPUT}"
    ls -lh "$OUTPUT"

else
    fail "Specify --vm-name or --disk. Run with --help for usage."
fi

echo ""
echo -e "${BOLD}Import Instructions:${RESET}"
echo "  VirtualBox GUI:  File → Import Appliance → select ${OUTPUT}"
echo "  CLI:             VBoxManage import ${OUTPUT}"
echo ""
echo -e "${BOLD}After Import:${RESET}"
echo "  1. Start the VM"
echo "  2. Login as 'soulofall' (SSH key) or 'redteam' (SSH key)"
echo "  3. Access dashboard at https://<vm-ip>/"
echo "  4. Remote browser at https://<vm-ip>:6901/"
echo ""
