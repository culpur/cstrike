#!/bin/bash
# CStrike v2 — Raw Disk Import Helper
# Imports a CStrike v2 raw/qcow2 disk image into Proxmox, KVM/libvirt, or QEMU.
#
# Usage:
#   Proxmox:     ./import-raw.sh --proxmox --vmid 300 --storage local-lvm
#   KVM/libvirt: ./import-raw.sh --kvm --name cstrike
#   QEMU:        ./import-raw.sh --qemu
#
# Options:
#   --proxmox          Import into Proxmox VE
#   --kvm              Import into KVM/libvirt
#   --qemu             Print qemu-system-x86_64 command for direct boot
#   --vmid ID          Proxmox VM ID (default: 300)
#   --storage STORE    Proxmox storage target (default: local-lvm)
#   --name NAME        VM name (default: cstrike)
#   --cpus N           CPU cores (default: 4)
#   --memory MB        RAM in MB (default: 8192)
#   --disk FILE        Disk image path (auto-detected from current directory)
#   --load-docker      After import + boot, load pre-saved Docker images via SSH

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────
MODE=""
VMID="300"
STORAGE="local-lvm"
VM_NAME="cstrike"
CPUS=4
MEMORY=8192
DISK_FILE=""
LOAD_DOCKER=false
SSH_USER="soulofall"

# Proxmox API (optional, can use qm CLI instead)
PVE_HOST="${PVE_HOST:-}"
PVE_TOKEN_ID="${PVE_TOKEN_ID:-}"
PVE_TOKEN_SECRET="${PVE_TOKEN_SECRET:-}"
NODE="${PVE_NODE:-proxmox}"

# ── Parse arguments ───────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case $1 in
        --proxmox)     MODE="proxmox"; shift ;;
        --kvm)         MODE="kvm"; shift ;;
        --qemu)        MODE="qemu"; shift ;;
        --vmid)        VMID="$2"; shift 2 ;;
        --storage)     STORAGE="$2"; shift 2 ;;
        --name)        VM_NAME="$2"; shift 2 ;;
        --cpus)        CPUS="$2"; shift 2 ;;
        --memory)      MEMORY="$2"; shift 2 ;;
        --disk)        DISK_FILE="$2"; shift 2 ;;
        --load-docker) LOAD_DOCKER=true; shift ;;
        --ssh-user)    SSH_USER="$2"; shift 2 ;;
        --help|-h)
            echo "Usage: ./import-raw.sh --proxmox|--kvm|--qemu [OPTIONS]"
            echo ""
            echo "Modes:"
            echo "  --proxmox    Import into Proxmox VE"
            echo "  --kvm        Import into KVM/libvirt (virt-install)"
            echo "  --qemu       Print qemu-system-x86_64 boot command"
            echo ""
            echo "Options:"
            echo "  --vmid ID          Proxmox VM ID (default: 300)"
            echo "  --storage STORE    Proxmox storage (default: local-lvm)"
            echo "  --name NAME        VM name (default: cstrike)"
            echo "  --cpus N           CPU cores (default: 4)"
            echo "  --memory MB        RAM in MB (default: 8192)"
            echo "  --disk FILE        Disk image path (auto-detected)"
            echo "  --load-docker      Load pre-saved Docker images after boot"
            echo "  --ssh-user USER    SSH user (default: soulofall)"
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

echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  CStrike v2 — Raw Disk Import${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════════${RESET}"
echo ""

# ── Validate mode ─────────────────────────────────────────────
if [[ -z "$MODE" ]]; then
    fail "Specify a mode: --proxmox, --kvm, or --qemu. Run with --help for usage."
fi

# ── Auto-detect disk image ────────────────────────────────────
if [[ -z "$DISK_FILE" ]]; then
    # Search for disk images in current directory
    for candidate in cstrike-v2.qcow2 cstrike-v2.raw.gz cstrike-v2.raw; do
        if [[ -f "$candidate" ]]; then
            DISK_FILE="$candidate"
            break
        fi
    done
fi

if [[ -z "$DISK_FILE" ]] || [[ ! -f "$DISK_FILE" ]]; then
    fail "No disk image found. Specify --disk PATH or run from the distribution directory."
fi

ok "Disk image: ${DISK_FILE}"

# Decompress if needed
if [[ "$DISK_FILE" == *.gz ]]; then
    info "Decompressing ${DISK_FILE}..."
    gunzip -k "$DISK_FILE"
    DISK_FILE="${DISK_FILE%.gz}"
    ok "Decompressed to: ${DISK_FILE}"
fi

# Detect format
DISK_FORMAT="raw"
if [[ "$DISK_FILE" == *.qcow2 ]]; then
    DISK_FORMAT="qcow2"
fi

# Auto-detect Docker images archive
DOCKER_ARCHIVE=""
for candidate in cstrike-docker-images.tar.gz; do
    if [[ -f "$candidate" ]]; then
        DOCKER_ARCHIVE="$candidate"
        break
    fi
done

# ══════════════════════════════════════════════════════════════
# Mode A: Proxmox Import
# ══════════════════════════════════════════════════════════════
if [[ "$MODE" == "proxmox" ]]; then
    echo -e "  ${BOLD}Mode: Proxmox Import${RESET}"
    echo "  VMID:    ${VMID}"
    echo "  Storage: ${STORAGE}"
    echo "  Specs:   ${CPUS} CPU, ${MEMORY}MB RAM"
    echo ""

    # Prefer qm CLI (running on Proxmox host)
    if command -v qm &>/dev/null; then
        info "Using qm CLI (running on Proxmox host)..."

        # Check if VMID already exists
        if qm status "$VMID" &>/dev/null; then
            fail "VM ${VMID} already exists. Choose a different --vmid or delete it first."
        fi

        # Create the VM
        info "Creating VM ${VMID}..."
        qm create "$VMID" \
            --name "$VM_NAME" \
            --ostype l26 \
            --sockets 1 --cores "$CPUS" \
            --memory "$MEMORY" \
            --balloon 0 \
            --cpu host \
            --scsihw virtio-scsi-single \
            --bios ovmf \
            --machine q35 \
            --agent 1 \
            --onboot 1 \
            --net0 "virtio,bridge=vmbr0,firewall=0" \
            --net1 "virtio,bridge=vmbr0,firewall=0" \
            --serial0 socket

        ok "VM ${VMID} created"

        # Import the disk
        info "Importing disk image (this may take a few minutes)..."
        IMPORT_DISK="$DISK_FILE"

        # Convert qcow2 to raw if needed for importdisk
        if [[ "$DISK_FORMAT" == "qcow2" ]]; then
            info "Converting qcow2 to raw for import..."
            RAW_FILE="${DISK_FILE%.qcow2}.raw"
            if [[ ! -f "$RAW_FILE" ]]; then
                qemu-img convert -f qcow2 -O raw "$DISK_FILE" "$RAW_FILE"
            fi
            IMPORT_DISK="$RAW_FILE"
        fi

        qm importdisk "$VMID" "$IMPORT_DISK" "$STORAGE"
        ok "Disk imported"

        # Attach the imported disk
        info "Configuring VM..."
        qm set "$VMID" \
            --scsi0 "${STORAGE}:vm-${VMID}-disk-0,discard=on,iothread=1,ssd=1" \
            --boot order=scsi0

        # Add EFI disk
        qm set "$VMID" \
            --efidisk0 "${STORAGE}:1,efitype=4m,pre-enrolled-keys=0"

        ok "VM configured"

        # Start the VM
        info "Starting VM ${VMID}..."
        qm start "$VMID"
        ok "VM ${VMID} started"

    # Fallback to Proxmox API
    elif [[ -n "$PVE_HOST" ]] && [[ -n "$PVE_TOKEN_ID" ]]; then
        info "Using Proxmox API..."
        API_BASE="${PVE_HOST}/api2/json"
        AUTH_HEADER="Authorization: PVEAPIToken=${PVE_TOKEN_ID}=${PVE_TOKEN_SECRET}"

        pve_api() {
            curl -sSk -X "$1" -H "$AUTH_HEADER" "${API_BASE}$2" "${@:3}"
        }

        # Create VM via API
        info "Creating VM ${VMID} via API..."
        pve_api POST "/nodes/${NODE}/qemu" \
            -d "vmid=${VMID}" \
            -d "name=${VM_NAME}" \
            -d "ostype=l26" \
            -d "sockets=1" \
            -d "cores=${CPUS}" \
            -d "memory=${MEMORY}" \
            -d "balloon=0" \
            -d "cpu=host" \
            -d "scsihw=virtio-scsi-single" \
            -d "bios=ovmf" \
            -d "machine=q35" \
            -d "agent=1" \
            -d "onboot=1" \
            -d "net0=virtio,bridge=vmbr0,firewall=0" \
            -d "net1=virtio,bridge=vmbr0,firewall=0" \
            | jq .

        ok "VM ${VMID} created"

        warn "Disk import via API requires manual step:"
        echo "  1. Copy ${DISK_FILE} to the Proxmox host"
        echo "  2. Run: qm importdisk ${VMID} ${DISK_FILE} ${STORAGE}"
        echo "  3. Run: qm set ${VMID} --scsi0 ${STORAGE}:vm-${VMID}-disk-0,discard=on"
        echo "  4. Run: qm set ${VMID} --boot order=scsi0"
        echo "  5. Run: qm start ${VMID}"
    else
        fail "Neither qm CLI nor Proxmox API credentials found. Run on the Proxmox host or set PVE_HOST/PVE_TOKEN_ID/PVE_TOKEN_SECRET."
    fi

# ══════════════════════════════════════════════════════════════
# Mode B: KVM/libvirt Import
# ══════════════════════════════════════════════════════════════
elif [[ "$MODE" == "kvm" ]]; then
    echo -e "  ${BOLD}Mode: KVM/libvirt Import${RESET}"
    echo ""

    command -v virt-install &>/dev/null || fail "virt-install not found. Install libvirt + virtinst."

    # Convert to qcow2 if raw
    QCOW2_FILE="$DISK_FILE"
    if [[ "$DISK_FORMAT" == "raw" ]]; then
        QCOW2_FILE="${DISK_FILE%.raw}.qcow2"
        if [[ ! -f "$QCOW2_FILE" ]]; then
            info "Converting raw to qcow2..."
            qemu-img convert -f raw -O qcow2 -c "$DISK_FILE" "$QCOW2_FILE"
        fi
    fi

    # Copy to libvirt images directory
    LIBVIRT_DIR="/var/lib/libvirt/images"
    DEST="${LIBVIRT_DIR}/${VM_NAME}.qcow2"

    info "Copying disk to ${DEST}..."
    cp "$QCOW2_FILE" "$DEST"
    chmod 644 "$DEST"

    info "Creating VM with virt-install..."
    virt-install \
        --name "$VM_NAME" \
        --memory "$MEMORY" \
        --vcpus "$CPUS" \
        --disk "path=${DEST},format=qcow2,bus=scsi" \
        --controller scsi,model=virtio-scsi \
        --os-variant debian12 \
        --network network=default,model=virtio \
        --boot uefi \
        --import \
        --noautoconsole

    ok "VM '${VM_NAME}' created and started"
    echo ""
    echo "  Console:  virsh console ${VM_NAME}"
    echo "  Status:   virsh dominfo ${VM_NAME}"
    echo "  Stop:     virsh shutdown ${VM_NAME}"

# ══════════════════════════════════════════════════════════════
# Mode C: QEMU Direct Boot
# ══════════════════════════════════════════════════════════════
elif [[ "$MODE" == "qemu" ]]; then
    echo -e "  ${BOLD}Mode: QEMU Direct Boot${RESET}"
    echo ""

    # Find OVMF firmware
    OVMF=""
    for candidate in \
        /usr/share/OVMF/OVMF_CODE.fd \
        /usr/share/edk2/ovmf/OVMF_CODE.fd \
        /usr/share/qemu/OVMF_CODE.fd \
        /opt/homebrew/share/qemu/edk2-x86_64-code.fd; do
        if [[ -f "$candidate" ]]; then
            OVMF="$candidate"
            break
        fi
    done

    echo "Run the following command to boot the image:"
    echo ""

    if [[ -n "$OVMF" ]]; then
        echo "  qemu-system-x86_64 \\"
        echo "    -drive if=pflash,format=raw,readonly=on,file=${OVMF} \\"
        echo "    -drive file=${DISK_FILE},format=${DISK_FORMAT},if=virtio \\"
        echo "    -m ${MEMORY} -smp ${CPUS} \\"
        echo "    -cpu host -enable-kvm \\"
        echo "    -netdev user,id=net0,hostfwd=tcp::2222-:22,hostfwd=tcp::8443-:443,hostfwd=tcp::6901-:6901 \\"
        echo "    -device virtio-net-pci,netdev=net0 \\"
        echo "    -display gtk"
    else
        echo "  qemu-system-x86_64 \\"
        echo "    -drive file=${DISK_FILE},format=${DISK_FORMAT},if=virtio \\"
        echo "    -m ${MEMORY} -smp ${CPUS} \\"
        echo "    -cpu host -enable-kvm \\"
        echo "    -netdev user,id=net0,hostfwd=tcp::2222-:22,hostfwd=tcp::8443-:443,hostfwd=tcp::6901-:6901 \\"
        echo "    -device virtio-net-pci,netdev=net0 \\"
        echo "    -display gtk"
        echo ""
        warn "OVMF firmware not found — UEFI boot may not work without it."
        echo "  Install: apt install ovmf (Debian/Ubuntu) or dnf install edk2-ovmf (Fedora)"
    fi

    echo ""
    echo "  Port forwarding:"
    echo "    SSH:        ssh -p 2222 ${SSH_USER}@localhost"
    echo "    Dashboard:  https://localhost:8443/"
    echo "    Kasm VNC:   https://localhost:6901/"
fi

# ── Docker image loading (all modes) ──────────────────────────
if $LOAD_DOCKER && [[ -n "$DOCKER_ARCHIVE" ]]; then
    echo ""
    echo -e "${BOLD}── Docker Image Loading ──────────────────────────────${RESET}"
    echo ""
    info "Waiting for VM to boot (60s)..."
    sleep 60

    # Determine SSH target
    if [[ "$MODE" == "qemu" ]]; then
        SSH_TARGET="-p 2222 ${SSH_USER}@localhost"
    else
        echo "  Enter VM IP address:"
        read -r VM_IP
        SSH_TARGET="${SSH_USER}@${VM_IP}"
    fi

    info "Uploading Docker images to VM..."
    # shellcheck disable=SC2086
    scp -o StrictHostKeyChecking=no "$DOCKER_ARCHIVE" ${SSH_TARGET}:/tmp/cstrike-docker-images.tar.gz

    info "Loading Docker images inside VM..."
    # shellcheck disable=SC2086
    ssh -o StrictHostKeyChecking=no ${SSH_TARGET} "sudo bash -c 'docker load < /tmp/cstrike-docker-images.tar.gz && docker compose -f /opt/cstrike/docker-compose.yml up -d && rm -f /tmp/cstrike-docker-images.tar.gz'"

    ok "Docker images loaded and stack started"
fi

# ── Summary ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  Import Complete${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════════${RESET}"
echo ""
echo "  The first-boot service will automatically:"
echo "    1. Expand the disk partition to fill available space"
echo "    2. Regenerate SSH host keys"
echo "    3. Randomize .env passwords"
echo "    4. Start the Docker Compose stack"
echo ""
echo "  After boot, access:"
echo "    Dashboard:    https://<vm-ip>/"
echo "    Kasm VNC:     https://<vm-ip>:6901/"
echo "    SSH:          ssh ${SSH_USER}@<vm-ip>"
echo "    Credentials:  /opt/cstrike/.env"
echo ""
