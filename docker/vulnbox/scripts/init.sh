#!/bin/bash
echo "[VulnBox] Starting initialization..."

# Ensure MySQL socket directory exists
mkdir -p /run/mysqld && chown mysql:mysql /run/mysqld

# Initialize MySQL data directory if needed
if [ ! -d /var/lib/mysql/mysql ]; then
    echo "[VulnBox] Initializing MariaDB..."
    mysql_install_db --user=mysql --datadir=/var/lib/mysql 2>/dev/null
fi

# Start MySQL temporarily to seed
/usr/bin/mysqld_safe --port=3306 &
echo "[VulnBox] Waiting for MariaDB..."
for i in $(seq 1 60); do
    if mysqladmin ping --silent 2>/dev/null; then
        echo "[VulnBox] MariaDB ready after ${i}s"
        break
    fi
    sleep 1
done

# Seed database — try with password first (existing data), then without (fresh install)
SEED_SQL=$(cat <<'EOSQL'
ALTER USER 'root'@'localhost' IDENTIFIED BY 'root';
CREATE USER IF NOT EXISTS 'root'@'%' IDENTIFIED BY 'root';
GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;
CREATE USER IF NOT EXISTS 'admin'@'%' IDENTIFIED BY 'password123';
GRANT ALL PRIVILEGES ON *.* TO 'admin'@'%';
FLUSH PRIVILEGES;
SOURCE /docker-entrypoint-initdb.d/seed.sql;
EOSQL
)
echo "$SEED_SQL" | mysql -u root -proot 2>/dev/null || echo "$SEED_SQL" | mysql -u root 2>/dev/null || echo "[VulnBox] DB seed skipped (already configured)"

# Kill temporary MySQL (supervisor manages it)
mysqladmin -u root -proot shutdown 2>/dev/null || true
sleep 2

# SSH host keys
ssh-keygen -A 2>/dev/null || true

# Writable .ssh dirs for persistence testing
for user in admin deploy backup; do
    home="/home/$user"
    mkdir -p "$home/.ssh"
    chmod 700 "$home/.ssh"
    touch "$home/.ssh/authorized_keys"
    chmod 600 "$home/.ssh/authorized_keys"
    chown -R "$user:$user" "$home/.ssh"
done
mkdir -p /root/.ssh && chmod 700 /root/.ssh
touch /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys

# Create supervisor log dir
mkdir -p /var/log/supervisor

echo "[VulnBox] Initialization complete, starting supervisord..."
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/vulnbox.conf
