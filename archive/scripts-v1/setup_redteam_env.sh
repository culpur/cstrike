#!/bin/bash

set -e

USERNAME="redteam"
GROUPNAME="redteam"
INSTALL_DIR="/opt/cstrike"
SOURCE_DIR="/root/qs"
EXECUTABLES=("cstrike.py" "setup_anon_env.sh")
ZSHRC="/home/$USERNAME/.zshrc"
LOG_DIR="$INSTALL_DIR/logs"

echo "[+] Creating user and group: $USERNAME"

# Create user and group
groupadd -f "$GROUPNAME"
id "$USERNAME" &>/dev/null || useradd -m -s /bin/zsh -g "$GROUPNAME" "$USERNAME"
usermod -aG sudo "$USERNAME"

echo "[+] Creating destination directory: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
mkdir -p "$LOG_DIR"
chown -R "$USERNAME:$GROUPNAME" "$INSTALL_DIR"

echo "[+] Moving project files to $INSTALL_DIR"
cp -a "$SOURCE_DIR/"* "$INSTALL_DIR/"
chown -R "$USERNAME:$GROUPNAME" "$INSTALL_DIR"

echo "[+] Making executables runnable"
for exe in "${EXECUTABLES[@]}"; do
  chmod +x "$INSTALL_DIR/$exe"
done

echo "[+] Updating $ZSHRC with environment paths"
cat <<EOF >> "$ZSHRC"

# cstrike aliases
export CSTRIKE_HOME="$INSTALL_DIR"
alias cstrike="sudo python3 \$CSTRIKE_HOME/cstrike.py"
alias setup_anon="\$CSTRIKE_HOME/setup_anon_env.sh"
EOF

echo "[+] Applying iptables routing rules for redteam VPN traffic"

# Create VPN route table entry
grep -q "wgvpn" /etc/iproute2/rt_tables || echo "200 wgvpn" >> /etc/iproute2/rt_tables

# Add iptables mangle rule to mark redteam traffic
iptables -t mangle -C OUTPUT -m owner --uid-owner "$USERNAME" -j MARK --set-mark 0xca6c 2>/dev/null || \
iptables -t mangle -A OUTPUT -m owner --uid-owner "$USERNAME" -j MARK --set-mark 0xca6c

# Add IP rule for marked packets
ip rule | grep -q "fwmark 0xca6c lookup wgvpn" || ip rule add fwmark 0xca6c table wgvpn

# Ensure default route exists in wgvpn table
ip route show table wgvpn | grep -q '^default' || ip route add default dev wg0 table wgvpn || true

echo "[+] Updating logging paths in Python scripts"

for py in "$INSTALL_DIR"/*.py; do
  sed -i "s|log_file = .*|log_file = os.path.join(os.getenv('CSTRIKE_HOME', '/opt/cstrike'), 'logs', 'cstrike.log')|" "$py"
done

echo "[+] Environment setup complete. Login as '$USERNAME' and use 'cstrike' to start."
