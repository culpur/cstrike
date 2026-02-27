# CStrike v2 — Distribution Guide

CStrike v2 can be deployed in five formats depending on your environment and requirements.

---

## Distribution Formats

| Format | Use Case | Includes Host Tools | Setup Time | Guide |
|--------|----------|:-------------------:|:----------:|-------|
| **Docker Compose** | Existing Debian host with tools | No | ~10 min | [DOCKER_DEPLOYMENT.md](DOCKER_DEPLOYMENT.md) |
| **Bare Metal** (`install.sh`) | Fresh Debian 12 | Yes (80+ tools) | ~45 min | [BARE_METAL_INSTALL.md](BARE_METAL_INSTALL.md) |
| **VirtualBox OVA** | Lab / training / air-gapped | Yes (pre-built) | ~5 min (import) | Below |
| **Cloud-Init** | AWS / GCP / Azure / DO | Yes (provisioned at boot) | ~30 min | Below |
| **Proxmox** | Homelab / enterprise infra | Yes (API-driven) | ~20 min | Below |

---

## Architecture Layers

Every CStrike deployment consists of three layers:

```
┌──────────────────────────────────────────────────────┐
│  Layer 3 — Configuration & Hardening                  │
│  .env passwords, TLS certs, nftables kill switch,     │
│  SSH hardening, auditd, fail2ban, systemd services    │
├──────────────────────────────────────────────────────┤
│  Layer 2 — Docker Stack (6 containers)                │
│  PostgreSQL 16, Redis 7, Express API, React frontend, │
│  Traefik v3.3 reverse proxy, KasmVNC remote browser   │
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

## VirtualBox OVA

Export a configured CStrike VM as a portable OVA appliance.

### Export an existing VirtualBox VM

```bash
./scripts/vm/export-ova.sh --vm-name "CStrike v2" --output cstrike-v2.ova
```

### Import the OVA

```
VirtualBox GUI:  File → Import Appliance → select cstrike-v2.ova
CLI:             VBoxManage import cstrike-v2.ova
```

### Build an OVA from scratch

1. Create a Debian 12 VirtualBox VM (4 CPU, 8 GB RAM, 50 GB disk)
2. Install Debian 12 with SSH server
3. Clone CStrike and run `install.sh`
4. Clean up: `sudo rm -f /etc/ssh/ssh_host_* ~/.bash_history`
5. Export: `./scripts/vm/export-ova.sh --vm-name "CStrike v2"`

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

## Proxmox

API-driven VM creation on Proxmox VE. Requires a Proxmox API token.

```bash
# Set Proxmox credentials
export PVE_HOST=proxmox.local
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

---

## Legal

CStrike v2 is intended exclusively for authorized penetration testing and red team operations. You must have explicit written authorization before scanning any target.

MIT License (c) 2025 Culpur Defense Inc.
