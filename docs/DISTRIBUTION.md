# CStrike v2.5.1 — Distribution Guide

CStrike v2 can be deployed in seven formats depending on your environment and requirements.

---

## Distribution Formats

| Format | Use Case | Includes Host Tools | Setup Time | Guide |
|--------|----------|:-------------------:|:----------:|-------|
| **Docker Compose** | Existing Debian host with tools | No | ~10 min | [DOCKER_DEPLOYMENT.md](DOCKER_DEPLOYMENT.md) |
| **Bare Metal** (`install.sh`) | Fresh Debian 12 | Yes (80+ tools) | ~45 min | [BARE_METAL_INSTALL.md](BARE_METAL_INSTALL.md) |
| **VM Package** (`.tar.gz`) | Air-gapped / offline / any hypervisor | Yes (pre-built) | ~5 min (import) | Below |
| **VirtualBox OVA** | Lab / training / desktop | Yes (pre-built) | ~5 min (import) | Below |
| **Proxmox/KVM Import** | Homelab / enterprise / KVM | Yes (pre-built) | ~5 min (import) | Below |
| **Cloud-Init** | AWS / GCP / Azure / DO | Yes (provisioned at boot) | ~30 min | Below |
| **Proxmox (Fresh)** | Homelab / enterprise infra | Yes (API-driven) | ~20 min | Below |

---

## Downloads

Pre-built VM images are available for direct download and via BitTorrent from `registry.culpur.net`.

### Direct Download — amd64 (x86_64)

| Format | Use Case | Size | Download |
|--------|----------|------|----------|
| **QCOW2** | Proxmox / KVM / libvirt | ~21 GB | [cstrikev2.5.1_amd64.qcow2](https://registry.culpur.net/dist/cstrikev2.5.1_amd64.qcow2) |
| **VDI** | VirtualBox (native) | ~49 GB | [cstrikev2.5.1_amd64.vdi](https://registry.culpur.net/dist/cstrikev2.5.1_amd64.vdi) |

### Direct Download — aarch64 (ARM64)

| Format | Use Case | Size | Download |
|--------|----------|------|----------|
| **QCOW2** | QEMU / UTM / Parallels | ~21 GB | [cstrikev2.5_aarch64.qcow2](https://registry.culpur.net/dist/cstrikev2.5_aarch64.qcow2) |
| **OVA** | VMware Fusion / UTM | ~20 GB | [cstrikev2.5_aarch64.ova](https://registry.culpur.net/dist/cstrikev2.5_aarch64.ova) |
| **VDI** | VirtualBox (native) | ~49 GB | [cstrikev2.5_aarch64.vdi](https://registry.culpur.net/dist/cstrikev2.5_aarch64.vdi) |

### Checksums

| Arch | File | Download |
|------|------|----------|
| amd64 | SHA256 checksums | [checksums-amd64-v2.5.1.sha256](https://registry.culpur.net/dist/checksums-amd64-v2.5.1.sha256) |
| aarch64 | SHA256 checksums | [checksums-aarch64.sha256](https://registry.culpur.net/dist/checksums-aarch64.sha256) |

### BitTorrent (recommended for large files)

Torrents include [webseed](https://www.bittorrent.org/beps/bep_0019.html) — downloads work immediately even with zero peers via HTTP fallback.

#### amd64

| Format | Torrent |
|--------|---------|
| QCOW2 | [cstrikev2.5.1_amd64.qcow2.torrent](https://registry.culpur.net/dist/torrents/cstrikev2.5.1_amd64.qcow2.torrent) |
| VDI | [cstrikev2.5.1_amd64.vdi.torrent](https://registry.culpur.net/dist/torrents/cstrikev2.5.1_amd64.vdi.torrent) |

#### aarch64

| Format | Torrent |
|--------|---------|
| QCOW2 | [cstrikev2.5_aarch64.qcow2.torrent](https://registry.culpur.net/dist/torrents/cstrikev2.5_aarch64.qcow2.torrent) |
| OVA | [cstrikev2.5_aarch64.ova.torrent](https://registry.culpur.net/dist/torrents/cstrikev2.5_aarch64.ova.torrent) |
| VDI | [cstrikev2.5_aarch64.vdi.torrent](https://registry.culpur.net/dist/torrents/cstrikev2.5_aarch64.vdi.torrent) |

```bash
# Download with any BitTorrent client, or use aria2:
aria2c https://registry.culpur.net/dist/torrents/cstrikev2.5.1_amd64.qcow2.torrent
```

### Verify Integrity

```bash
# amd64
curl -O https://registry.culpur.net/dist/checksums-amd64-v2.5.1.sha256
sha256sum -c checksums-amd64-v2.5.1.sha256

# aarch64
curl -O https://registry.culpur.net/dist/checksums-aarch64.sha256
sha256sum -c checksums-aarch64.sha256
```

---

## Architecture Layers

Every CStrike deployment consists of three layers:

```
┌──────────────────────────────────────────────────────┐
│  Layer 3 — Configuration & Hardening                  │
│  .env passwords, TLS certs, nftables kill switch,     │
│  SSH hardening, auditd, fail2ban, systemd services    │
├──────────────────────────────────────────────────────┤
│  Layer 2 — Docker Stack (9 containers)                │
│  PostgreSQL 16, Redis 7, Express API, React frontend, │
│  Traefik v3.3, KasmVNC, OWASP ZAP, Metasploit, VulnBox│
├──────────────────────────────────────────────────────┤
│  Layer 1 — Host Tools & Runtime                       │
│  Debian 12, Kali tools (35+), Go/Rust binaries,       │
│  Python security tools, VPN clients, Docker Engine     │
└──────────────────────────────────────────────────────┘
```

- **Docker Compose** deploys Layer 2 only — you provide Layer 1 and Layer 3.
- **Bare Metal / OVA / Cloud-Init** deploy all three layers.

---

## Minimum Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 4 cores | 8 cores |
| RAM | 8 GB | 16 GB |
| Disk | 50 GB | 100 GB |
| OS | Debian 12 (Bookworm) | Debian 12 |
| Network | 1 NIC | 2 NICs (management + scan traffic) |

### Ports

| Port | Service | Exposure |
|------|---------|----------|
| 22 | SSH | Management |
| 80 | HTTP (redirect) | Traefik → HTTPS |
| 443 | HTTPS | Traefik (dashboard + API) |
| 6901 | KasmVNC | Remote browser |
| 3000 | Frontend | Internal (behind Traefik) |
| 3001 | API | Internal (behind Traefik) |
| 5432 | PostgreSQL | Loopback only |
| 6379 | Redis | Loopback only |

---

## Docker Compose (Quick Deploy)

For hosts that already have security tools installed. See [DOCKER_DEPLOYMENT.md](DOCKER_DEPLOYMENT.md).

```bash
git clone https://github.com/culpur/cstrike.git && cd cstrike
cp .env.example .env && vim .env          # Set strong passwords
bash docker/generate-certs.sh             # Generate TLS certs
docker compose up -d                      # Start the stack
docker exec cstrike-api npx prisma db seed  # Seed the database
```

---

## Bare Metal Install

Full provisioning from a fresh Debian 12 system. See [BARE_METAL_INSTALL.md](BARE_METAL_INSTALL.md).

```bash
git clone https://github.com/culpur/cstrike.git /opt/cstrike
cd /opt/cstrike
sudo bash install.sh
```

The installer handles everything: Kali tools, Go/Rust binaries, Python security tools, VPN clients, Docker, hardening, and Docker stack startup.

---

## VM Distribution Packaging

Package a live, working CStrike VM into multiple distribution formats for offline deployment.

### Packaging from Proxmox

Run `package-vm.sh` on the Proxmox host to extract a VM and produce all distribution artifacts:

```bash
# Set Proxmox credentials
export PVE_HOST=https://proxmox.local:8006
export PVE_TOKEN_ID="user@pam!token"
export PVE_TOKEN_SECRET="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# Package VM 122 with sensitive data scrubbed
bash scripts/vm/package-vm.sh --vmid 122 --clean --output ./dist/

# Minimal export (no OVA, no Docker pre-save)
bash scripts/vm/package-vm.sh --no-ova --no-docker-save
```

### Distribution Artifacts

The `.tar.gz` distribution package contains:

| File | Description |
|------|-------------|
| `cstrike-v2.raw.gz` | Compressed raw disk image |
| `cstrike-v2.qcow2` | QEMU/KVM/Proxmox-ready disk |
| `cstrike-docker-images.tar.gz` | Pre-saved Docker images (offline mode) |
| `import-raw.sh` | Proxmox/KVM import helper |
| `import-ova.sh` | VirtualBox import helper |
| `cloud-init-generic.yml` | Cloud-init configuration |
| `cstrike-firstboot.sh` | First-boot setup script |
| `install.sh` | Bare-metal installer (fallback) |
| `checksums.sha256` | SHA256 integrity verification |

### Compact Disk Images

Exported images contain only used blocks — a 50GB disk with ~15GB used compresses to ~5-8GB. The `--clean` flag zero-fills free space before export for even better compression.

On import, the first-boot service automatically expands the partition to fill whatever disk size the user allocates (50GB, 100GB, 200GB, etc.).

---

## VirtualBox OVA

Download the pre-built OVA: [cstrikev2.5_aarch64.ova](https://registry.culpur.net/dist/cstrikev2.5_aarch64.ova) (~20 GB, aarch64 only)

### Export from an existing VirtualBox VM

```bash
./scripts/vm/export-ova.sh --vm-name "CStrike v2" --output cstrike-v2.ova
```

### Import an OVA

```bash
# Using the import helper (recommended)
./scripts/vm/import-ova.sh cstrike-v2.ova

# With overrides
./scripts/vm/import-ova.sh --name "My CStrike" --cpus 8 --memory 16384 --start cstrike-v2.ova

# Manual import
VBoxManage import cstrike-v2.ova
```

The import helper configures host-only networking for lab access and prints connection instructions.

### Build an OVA from scratch

1. Create a Debian 12 VirtualBox VM (4 CPU, 8 GB RAM, 50 GB disk)
2. Install Debian 12 with SSH server
3. Clone CStrike and run `install.sh`
4. Clean up: `sudo rm -f /etc/ssh/ssh_host_* ~/.bash_history`
5. Export: `./scripts/vm/export-ova.sh --vm-name "CStrike v2"`

---

## Proxmox / KVM / QEMU Import

Download the pre-built QCOW2: [cstrikev2.5.1_amd64.qcow2](https://registry.culpur.net/dist/cstrikev2.5.1_amd64.qcow2) (~21 GB)

Import from the `.tar.gz` distribution package or standalone disk images.

### Proxmox Import

```bash
# Using the import helper (recommended — run on Proxmox host)
./import-raw.sh --proxmox --vmid 300 --storage local-lvm

# With custom specs
./import-raw.sh --proxmox --vmid 300 --storage local-lvm --cpus 8 --memory 16384
```

### KVM/libvirt Import

```bash
./import-raw.sh --kvm --name cstrike --cpus 4 --memory 8192
```

### QEMU Direct Boot

```bash
# Prints the qemu-system-x86_64 command with port forwarding
./import-raw.sh --qemu
```

---

## Offline / Air-Gapped Deployment

The distribution package supports fully offline deployment:

1. **Docker images pre-built**: Pre-built VM images include all 9 Docker containers already built — `docker compose up -d` starts immediately without `--build`
2. **First-boot auto-starts**: The first-boot service starts the Docker stack automatically — no internet required
3. **Cloud-init support**: `cloud-init-generic.yml` checks for the pre-saved archive and loads images if present, falling back to `docker compose build` if not

To deploy offline:
1. Transfer the `.tar.gz` distribution to the target machine
2. Import the disk image using `import-raw.sh` or `import-ova.sh`
3. Boot — the first-boot service handles everything automatically

---

## Cloud-Init

Deploy CStrike on any cloud provider that supports cloud-init with a Debian 12 base image.

### AWS EC2

```bash
aws ec2 run-instances \
    --image-id ami-0xxxxx            # Debian 12 AMI \
    --instance-type t3.xlarge        # 4 vCPU, 16 GB RAM \
    --key-name your-keypair \
    --user-data file://scripts/vm/cloud-init-generic.yml \
    --security-group-ids sg-xxxxx    # Ports 22, 80, 443, 6901
```

### GCP Compute Engine

```bash
gcloud compute instances create cstrike \
    --image-family=debian-12 --image-project=debian-cloud \
    --machine-type=e2-standard-4 \
    --metadata-from-file user-data=scripts/vm/cloud-init-generic.yml
```

### DigitalOcean

```bash
doctl compute droplet create cstrike \
    --image debian-12-x64 \
    --size s-4vcpu-8gb \
    --user-data "$(cat scripts/vm/cloud-init-generic.yml)"
```

### Azure

```bash
az vm create --name cstrike \
    --image Debian:debian-12:12:latest \
    --size Standard_D4s_v3 \
    --custom-data scripts/vm/cloud-init-generic.yml
```

**Important:** Edit `scripts/vm/cloud-init-generic.yml` first to replace the SSH key placeholder with your public key.

Monitor provisioning: `ssh cstrike@<ip> tail -f /var/log/cstrike-install.log`

---

## Proxmox (Fresh VM)

API-driven VM creation on Proxmox VE from a Debian 12 cloud image. Use this for fresh installs; for importing a pre-built VM image, see [Proxmox / KVM / QEMU Import](#proxmox--kvm--qemu-import) above.

```bash
# Set Proxmox credentials
export PVE_HOST=https://proxmox.local:8006
export PVE_TOKEN_ID="user@pam!token"
export PVE_TOKEN_SECRET="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
export PVE_NODE=pve

# Create VM (VMID 200, Debian 12 cloud image)
bash scripts/vm/create-vm.sh

# SSH in after cloud-init completes, then provision
ssh soulofall@<vm-ip>
sudo bash /opt/cstrike/install.sh
```

---

## Post-Deployment

Regardless of deployment method:

1. **Access the dashboard** at `https://<ip>/` (accept the self-signed cert)
2. **Configure AI providers** in the Configuration tab (OpenAI, Anthropic, Ollama, or Grok API keys)
3. **Add targets** in the Targets module
4. **Launch your first scan** — the 9-phase pipeline runs automatically
5. **Remote browser** at `https://<ip>:6901/` for isolated browsing

### Post-Import Checklist

For VM imports (OVA, raw, qcow2), the first-boot service automatically handles:

- [x] Partition expansion to fill available disk space
- [x] SSH host key regeneration
- [x] .env password randomization
- [x] Docker image loading (from pre-saved archive)
- [x] Docker Compose stack startup
- [x] Self-disabling (runs only once)

Verify with: `cat /opt/cstrike/.firstboot-complete`

---

## Legal

CStrike v2.5.1 is intended exclusively for authorized penetration testing and red team operations. You must have explicit written authorization before scanning any target.

MIT License (c) 2025-2026 Culpur Defense Inc.
