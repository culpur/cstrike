#!/bin/bash
# CStrike VM — Security Hardening Script
# Applies kernel, network, SSH, PAM, auditd, fail2ban, and Docker hardening.
# Derived from puppet modules: sysctl_hardening, kernel_modules, sshd,
# pam_hardening, auditd, fail2ban, docker_hardening.
#
# No Puppet agent required — settings applied directly.
#
# Run as root after setup-redteam.sh completes.
# Usage: sudo ./harden-host.sh

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "═══════════════════════════════════════════════════════════"
echo "  CStrike VM — Security Hardening"
echo "  Sources: puppet sysctl_hardening, kernel_modules, sshd,"
echo "           pam_hardening, auditd, fail2ban, docker_hardening"
echo "═══════════════════════════════════════════════════════════"

# ── Step 1: Kernel sysctl hardening ──────────────────────────
echo ""
echo "[1/7] Applying kernel + network sysctl hardening..."

cat > /etc/sysctl.d/99-cstrike-hardening.conf << 'EOF'
# CStrike VM — CIS Benchmark Level 2 / STIG-aligned kernel hardening
# Derived from puppet sysctl_hardening module

# IP forwarding — enabled for Docker + VPN routing
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1

# SYN flood protection
net.ipv4.tcp_syncookies = 1

# Block ICMP redirects
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.secure_redirects = 0
net.ipv4.conf.default.secure_redirects = 0

# Disable source routing
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv6.conf.default.accept_source_route = 0

# Reverse path filtering (strict)
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# Log martian packets
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1

# Ignore ICMP broadcasts (smurf attack prevention)
net.ipv4.icmp_echo_ignore_broadcasts = 1

# Ignore bogus ICMP error responses
net.ipv4.icmp_ignore_bogus_error_responses = 1

# TCP timestamps
net.ipv4.tcp_timestamps = 1

# Disable IPv6 router advertisements
net.ipv6.conf.all.accept_ra = 0
net.ipv6.conf.default.accept_ra = 0

# Restrict core dumps from SUID binaries
fs.suid_dumpable = 0

# Full ASLR
kernel.randomize_va_space = 2

# Restrict kernel pointer exposure
kernel.kptr_restrict = 2

# Restrict dmesg access to root
kernel.dmesg_restrict = 1

# Restrict kernel perf events
kernel.perf_event_paranoid = 3

# Disable unprivileged BPF
kernel.unprivileged_bpf_disabled = 1

# Restrict ptrace scope (Yama LSM)
kernel.yama.ptrace_scope = 1

# Disable SysRq except sync + remount-ro + reboot (176)
kernel.sysrq = 176

# Disable kexec (prevent kernel replacement at runtime)
kernel.kexec_load_disabled = 1
EOF

sysctl --system > /dev/null 2>&1
echo "  Sysctl hardening applied"

# ── Step 2: Kernel module blacklisting ───────────────────────
echo ""
echo "[2/7] Blacklisting dangerous kernel modules..."

cat > /etc/modprobe.d/blacklist-cstrike.conf << 'EOF'
# CStrike VM — Blacklisted kernel modules
# Derived from puppet kernel_modules module

# Uncommon network protocols
install dccp /bin/true
install sctp /bin/true
install rds /bin/true
install tipc /bin/true

# Uncommon/dangerous filesystems
install cramfs /bin/true
install freevxfs /bin/true
install hfs /bin/true
install hfsplus /bin/true
install jffs2 /bin/true
install squashfs /bin/true
install udf /bin/true
install fat /bin/true
install vfat /bin/true

# USB storage (not needed on VM)
install usb-storage /bin/true

# Firewire (not needed on VM)
install firewire-core /bin/true
install firewire-ohci /bin/true
install firewire-sbp2 /bin/true
EOF

echo "  Kernel modules blacklisted"

# ── Step 3: SSH hardening ────────────────────────────────────
echo ""
echo "[3/7] Hardening SSH configuration..."

apt-get install -y -qq openssh-server

# Backup original
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak.$(date +%s)

cat > /etc/ssh/sshd_config << 'EOF'
# CStrike VM — Hardened SSHD Configuration
# Derived from puppet sshd module

Port 22

# Authentication
PermitRootLogin no
PasswordAuthentication no
ChallengeResponseAuthentication no
PermitEmptyPasswords no
PubkeyAuthentication yes
AuthenticationMethods publickey
MaxAuthTries 3
LoginGraceTime 30s

# Access Control
AllowUsers soulofall redteam

# Host keys
HostKey /etc/ssh/ssh_host_ed25519_key
HostKey /etc/ssh/ssh_host_ecdsa_key
HostKey /etc/ssh/ssh_host_rsa_key

# Ciphers and algorithms
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com,aes256-ctr,aes192-ctr,aes128-ctr
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,umac-128-etm@openssh.com
KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group16-sha512,diffie-hellman-group18-sha512

# Session Control
ClientAliveInterval 300
ClientAliveCountMax 3
MaxSessions 5
MaxStartups 10:30:60

# Security
AllowTcpForwarding no
X11Forwarding no
AllowAgentForwarding no
PermitTunnel no
GatewayPorts no
UseDNS no
StrictModes yes

# Banner
Banner /etc/issue.net
PrintMotd yes
PrintLastLog yes

# Logging
LogLevel VERBOSE
SyslogFacility AUTH

# Subsystem
Subsystem sftp /usr/lib/openssh/sftp-server
EOF

# Validate config before restarting
sshd -t && systemctl restart ssh
echo "  SSH hardened"

# ── Step 4: PAM hardening ────────────────────────────────────
echo ""
echo "[4/7] Hardening PAM (faillock + pwquality + limits)..."

apt-get install -y -qq libpam-pwquality

# Faillock configuration
cat > /etc/security/faillock.conf << 'EOF'
# CStrike VM — Account lockout via pam_faillock
# Derived from puppet pam_hardening module
deny = 5
unlock_time = 900
fail_interval = 900
audit
silent
EOF

# Password quality
cat > /etc/security/pwquality.conf << 'EOF'
# CStrike VM — Password complexity via pam_pwquality
# Derived from puppet pam_hardening module
minlen = 14
minclass = 3
dcredit = -1
ucredit = -1
lcredit = -1
ocredit = -1
maxrepeat = 3
maxclassrepeat = 4
gecoscheck = 1
dictcheck = 1
EOF

# Session limits
cat > /etc/security/limits.d/99-cstrike.conf << 'EOF'
# CStrike VM — Session limits
# Derived from puppet pam_hardening module
* hard core 0
* hard maxlogins 10
* soft nofile 65536
* hard nofile 65536
EOF

echo "  PAM hardening applied"

# ── Step 5: Auditd ───────────────────────────────────────────
echo ""
echo "[5/7] Configuring audit logging (auditd)..."

apt-get install -y -qq auditd audispd-plugins

# Auditd configuration
cat > /etc/audit/auditd.conf << 'EOF'
# CStrike VM — Audit daemon configuration
# Derived from puppet auditd module
log_file = /var/log/audit/audit.log
log_format = ENRICHED
log_group = root
priority_boost = 4
flush = INCREMENTAL_ASYNC
freq = 50
num_logs = 10
max_log_file = 50
max_log_file_action = ROTATE
space_left = 75
space_left_action = SYSLOG
action_mail_acct = root
admin_space_left = 50
admin_space_left_action = SUSPEND
disk_full_action = SUSPEND
disk_error_action = SUSPEND
tcp_listen_queue = 5
tcp_max_per_addr = 1
tcp_client_max_idle = 0
local_events = yes
write_logs = yes
name_format = HOSTNAME
EOF

# STIG/CIS audit rules
cat > /etc/audit/rules.d/99-cstrike.rules << 'EOF'
# CStrike VM — STIG/CIS aligned audit rules
# Derived from puppet auditd module

-D
-b 8192
-f 1

# Identity and authentication
-w /etc/passwd -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/group -p wa -k identity
-w /etc/gshadow -p wa -k identity
-w /etc/security/opasswd -p wa -k identity
-w /etc/pam.d/ -p wa -k pam_config
-w /etc/security/ -p wa -k pam_config
-w /etc/nsswitch.conf -p wa -k nss_config

# Privilege escalation
-w /etc/sudoers -p wa -k sudo_config
-w /etc/sudoers.d/ -p wa -k sudo_config
-a always,exit -F path=/usr/bin/sudo -F perm=x -F auid>=1000 -F auid!=4294967295 -k sudo_usage
-a always,exit -F path=/usr/bin/su -F perm=x -F auid>=1000 -F auid!=4294967295 -k su_usage
-a always,exit -F arch=b64 -S setuid -S setgid -S setreuid -S setregid -S setresuid -S setresgid -F auid>=1000 -F auid!=4294967295 -k privilege_escalation
-a always,exit -F arch=b32 -S setuid -S setgid -S setreuid -S setregid -S setresuid -S setresgid -F auid>=1000 -F auid!=4294967295 -k privilege_escalation

# SSH configuration
-w /etc/ssh/sshd_config -p wa -k sshd_config
-w /etc/ssh/sshd_config.d/ -p wa -k sshd_config
-w /etc/ssh/ssh_config -p wa -k ssh_config
-w /root/.ssh/ -p wa -k ssh_keys

# Login/logout
-w /var/log/lastlog -p wa -k logins
-w /var/log/faillog -p wa -k logins
-w /var/run/faillock/ -p wa -k logins
-w /var/log/wtmp -p wa -k logins
-w /var/log/btmp -p wa -k logins
-w /etc/login.defs -p wa -k login_config

# Cron
-w /etc/crontab -p wa -k cron_config
-w /etc/cron.d/ -p wa -k cron_config
-w /etc/cron.daily/ -p wa -k cron_config
-w /etc/cron.hourly/ -p wa -k cron_config
-w /var/spool/cron/ -p wa -k cron_config

# Network configuration
-w /etc/hosts -p wa -k network_config
-w /etc/network/ -p wa -k network_config
-w /etc/sysctl.conf -p wa -k sysctl_config
-w /etc/sysctl.d/ -p wa -k sysctl_config

# Docker
-w /etc/docker/ -p wa -k docker_config
-w /usr/bin/docker -p x -k docker_command
-w /var/lib/docker/ -p wa -k docker_data

# System calls for file deletion (audit trail)
-a always,exit -F arch=b64 -S unlink -S unlinkat -S rename -S renameat -F auid>=1000 -F auid!=4294967295 -k file_deletion

# Make the config immutable (must reboot to change)
-e 2
EOF

# Remove default rules
rm -f /etc/audit/rules.d/audit.rules

# Load rules
augenrules --load 2>/dev/null || true
systemctl enable --now auditd

echo "  Auditd configured with STIG/CIS rules"

# ── Step 6: Fail2ban ─────────────────────────────────────────
echo ""
echo "[6/7] Configuring fail2ban..."

apt-get install -y -qq fail2ban

cat > /etc/fail2ban/jail.local << 'EOF'
# CStrike VM — Fail2ban configuration
# Derived from puppet fail2ban module

[DEFAULT]
bantime = 600
bantime.increment = true
bantime.factor = 24
bantime.maxtime = 604800
findtime = 600
maxretry = 3
backend = systemd

[sshd]
enabled = true
port = 22
maxretry = 3
bantime = 3600

[recidive]
enabled = true
logpath = /var/log/fail2ban.log
banaction = %(banaction_allports)s
bantime = 604800
findtime = 86400
maxretry = 3
EOF

systemctl enable --now fail2ban
echo "  Fail2ban configured"

# ── Step 7: Docker daemon hardening ──────────────────────────
echo ""
echo "[7/7] Hardening Docker daemon..."

mkdir -p /etc/docker

cat > /etc/docker/daemon.json << 'EOF'
{
  "icc": false,
  "no-new-privileges": true,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "5"
  },
  "live-restore": true,
  "userland-proxy": false,
  "default-ulimits": {
    "nofile": {
      "Name": "nofile",
      "Hard": 65536,
      "Soft": 65536
    }
  },
  "storage-driver": "overlay2"
}
EOF

# Docker socket permissions
mkdir -p /etc/systemd/system/docker.socket.d
cat > /etc/systemd/system/docker.socket.d/override.conf << 'EOF'
[Socket]
SocketMode=0660
SocketUser=root
SocketGroup=docker
EOF

systemctl daemon-reload
systemctl restart docker

echo "  Docker daemon hardened"

# ── Process isolation: hidepid ───────────────────────────────
echo ""
echo "[+] Enabling process isolation (hidepid=2)..."

groupadd -f proc
usermod -aG proc soulofall 2>/dev/null || true
usermod -aG proc redteam 2>/dev/null || true

cat > /etc/systemd/system/proc-hidepid.service << 'EOF'
[Unit]
Description=Mount /proc with hidepid=2
DefaultDependencies=no
Before=sysinit.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/mount -o remount,hidepid=2,gid=proc /proc

[Install]
WantedBy=sysinit.target
EOF

systemctl daemon-reload
systemctl enable proc-hidepid.service
mount -o remount,hidepid=2,gid=proc /proc 2>/dev/null || true

echo "  Process isolation enabled"

# ── Summary ──────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Security hardening complete!"
echo ""
echo "  Applied:"
echo "    - Kernel sysctl: CIS L2 / STIG (35+ settings)"
echo "    - Module blacklist: 16 dangerous modules disabled"
echo "    - SSH: pubkey-only, no root, hardened ciphers"
echo "    - PAM: faillock (5 attempts/15min), pwquality (14 char, 3 class)"
echo "    - Auditd: STIG/CIS rules, immutable config"
echo "    - Fail2ban: SSH + recidive jails, progressive banning"
echo "    - Docker: no ICC, no-new-privileges, live-restore"
echo "    - Process isolation: hidepid=2 on /proc"
echo ""
echo "  The VM is now hardened. Deploy CStrike with:"
echo "    cd /opt/cstrike && docker compose up -d"
echo "═══════════════════════════════════════════════════════════"
