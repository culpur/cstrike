#!/bin/bash
echo "[VulnBox] Starting initialization..."

# ── MySQL ──────────────────────────────────────────────────────────────────────
mkdir -p /run/mysqld && chown mysql:mysql /run/mysqld

if [ ! -d /var/lib/mysql/mysql ]; then
    echo "[VulnBox] Initializing MariaDB..."
    mysql_install_db --user=mysql --datadir=/var/lib/mysql 2>/dev/null
fi

/usr/bin/mysqld_safe --port=3306 &
echo "[VulnBox] Waiting for MariaDB..."
for i in $(seq 1 60); do
    if mysqladmin ping --silent 2>/dev/null; then
        echo "[VulnBox] MariaDB ready after ${i}s"
        break
    fi
    sleep 1
done

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
echo "$SEED_SQL" | mysql -u root -proot 2>/dev/null || \
    echo "$SEED_SQL" | mysql -u root 2>/dev/null || \
    echo "[VulnBox] DB seed skipped (already configured)"

mysqladmin -u root -proot shutdown 2>/dev/null || true
sleep 2

# ── SSH ────────────────────────────────────────────────────────────────────────
ssh-keygen -A 2>/dev/null || true

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

# ── Vuln #2: Git repo in webroot with secret commit history ───────────────────
WEBROOT="/var/www/vulnbox"
if [ ! -d "$WEBROOT/.git" ]; then
    echo "[VulnBox] Initializing git repo in webroot..."
    cd "$WEBROOT"

    # Configure git identity
    git config --global user.email "dev@vulnbox.local"
    git config --global user.name  "VulnBox Dev"
    git config --global init.defaultBranch main

    git init

    # --- Commit 1: Initial app with hardcoded credentials in config ---
    cat > config.php <<'PHPEOF'
<?php
// Database configuration
define('DB_HOST', 'localhost');
define('DB_NAME', 'vulnbox');
define('DB_USER', 'root');
define('DB_PASS', 'SuperSecret2024!');
define('DB_PORT', 3306);

// AWS credentials
define('AWS_ACCESS_KEY', 'AKIAIOSFODNN7EXAMPLE');
define('AWS_SECRET_KEY', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
define('AWS_REGION',     'us-east-1');
define('S3_BUCKET',      'vulnbox-prod-backups');

// Internal API
define('INTERNAL_API_URL',  'http://10.0.0.50:8080');
define('INTERNAL_API_KEY',  'int-api-secret-key-XyZ9!@#');
define('ADMIN_EMAIL',        'admin@corp.internal');
define('ADMIN_PASSWORD',     'Corp@dmin2024!');

// Establish connection
$conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME, DB_PORT);
if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}
PHPEOF

    git add config.php
    git commit -m "Initial commit — app config and DB setup" \
        --date="2024-01-10T10:00:00"

    # --- Commit 2: Add more app files ---
    git add index.php login.php search.php upload.php 2>/dev/null || true
    git add cmd.php include.php welcome.php api_docs.php 2>/dev/null || true
    git add robots.txt 2>/dev/null || true
    git commit -m "Add webapp pages" \
        --date="2024-01-12T14:30:00" \
        --allow-empty

    # --- Commit 3: Add deployment script with SSH private key ---
    mkdir -p .deploy
    cat > .deploy/deploy.sh <<'SHEOF'
#!/bin/bash
# Deployment script — DO NOT COMMIT
SSH_KEY="-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAA...
AQIDBAUGBwgJCgsMDQ4PEBES
FAKEPRIVATEKEYFORPENTESTING
[this would be a real 256-byte RSA private key in production]
-----END OPENSSH PRIVATE KEY-----"

echo "$SSH_KEY" > /tmp/deploy_key
chmod 600 /tmp/deploy_key
ssh -i /tmp/deploy_key deploy@10.0.70.80 "cd /opt/app && git pull && pm2 restart all"
rm -f /tmp/deploy_key
SHEOF
    chmod 700 .deploy/deploy.sh

    cat > .deploy/production.env <<'ENVEOF'
# Production environment — CONFIDENTIAL
NODE_ENV=production
DATABASE_URL=postgresql://prod_user:Pr0d_DB_P@ss!@db.internal:5432/production
REDIS_URL=redis://:R3d1s_S3cr3t!@cache.internal:6379
JWT_SECRET=prod-jwt-secret-never-share-this-value
SESSION_SECRET=prod-session-secret-xK9mP2nQ8vR
STRIPE_SECRET_KEY=sk_live_FAKE1234567890ABCDEF
SENDGRID_API_KEY=SG.FAKE_KEY.FAKE_VALUE_FOR_PENTEST
SLACK_SIGNING_SECRET=fake_slack_secret_12345
ADMIN_BACKUP_PASSWORD=B@ckup_Adm1n_2024!
ENVEOF

    git add .deploy/
    git commit -m "Add deployment scripts" \
        --date="2024-01-15T09:15:00"

    # --- Commit 4: "Remove credentials from config" (they stay in git history) ---
    cat > config.php <<'PHPEOF'
<?php
// Database configuration — credentials moved to environment variables
define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_NAME', getenv('DB_NAME') ?: 'vulnbox');
define('DB_USER', getenv('DB_USER') ?: 'root');
define('DB_PASS', getenv('DB_PASS') ?: 'root');
define('DB_PORT', (int)(getenv('DB_PORT') ?: 3306));

$conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME, DB_PORT);
if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}
PHPEOF

    git rm -r --cached .deploy/ 2>/dev/null || true
    git add config.php
    git commit -m "Security: remove hardcoded credentials, use env vars instead" \
        --date="2024-01-20T16:45:00"

    # --- Commit 5: Add .gitignore (too late) ---
    cat > .gitignore <<'GIEOF'
.deploy/
*.env
.env*
config.local.php
/uploads/*
!/uploads/.gitkeep
GIEOF

    git add .gitignore
    git commit -m "Add .gitignore to prevent future credential leaks" \
        --date="2024-01-21T08:00:00"

    # Restore the real config.php (with env vars — current state is fine)
    # The secrets live in git history (commit 1 and 3)

    echo "[VulnBox] Git repo initialized with secret commit history"
    echo "[VulnBox] Hint: git log --all --oneline shows 5 commits"
    echo "[VulnBox] Hint: git show HEAD~3:config.php reveals credentials"
fi

# Ensure .git is accessible by Apache (no .htaccess blocking it)
chmod -R o+r "$WEBROOT/.git" 2>/dev/null || true

# ── Vuln #1: Redis — plant sensitive data ─────────────────────────────────────
echo "[VulnBox] Seeding Redis with sensitive data..."
# Wait briefly for redis to come up from supervisord
sleep 3

redis-cli -h 127.0.0.1 -p 6379 SET "session:admin:abc123def456" \
    '{"user_id":1,"username":"admin","role":"admin","logged_in":true}' 2>/dev/null || true

redis-cli -h 127.0.0.1 -p 6379 SET "session:deploy:xyz789abc012" \
    '{"user_id":3,"username":"deploy","role":"admin","logged_in":true}' 2>/dev/null || true

redis-cli -h 127.0.0.1 -p 6379 SET "credentials:db" \
    '{"host":"localhost","port":3306,"user":"root","password":"SuperSecret2024!","database":"vulnbox"}' 2>/dev/null || true

redis-cli -h 127.0.0.1 -p 6379 SET "credentials:aws" \
    '{"access_key":"AKIAIOSFODNN7EXAMPLE","secret_key":"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY","region":"us-east-1"}' 2>/dev/null || true

redis-cli -h 127.0.0.1 -p 6379 SET "api:master_key" \
    "master-key-do-not-share-98765" 2>/dev/null || true

redis-cli -h 127.0.0.1 -p 6379 SET "api:jwt_secret" \
    "secret" 2>/dev/null || true

redis-cli -h 127.0.0.1 -p 6379 SET "config:smtp" \
    '{"host":"mail.corp.internal","port":587,"user":"noreply@corp.internal","pass":"Smtp_P@ss_2024!"}' 2>/dev/null || true

redis-cli -h 127.0.0.1 -p 6379 LPUSH "queue:jobs" \
    '{"type":"email","to":"admin@corp.internal","subject":"Password reset","token":"reset-tok-abc123"}' 2>/dev/null || true

redis-cli -h 127.0.0.1 -p 6379 SET "flag:redis" \
    "CTF{r3d1s_n0_4uth_3xp0s3d}" 2>/dev/null || true

redis-cli -h 127.0.0.1 -p 6379 SET "backup:encryption_key" \
    "AES256:backup-enc-key-do-not-expose-Kp9mN3xQ" 2>/dev/null || true

echo "[VulnBox] Redis seeding complete"

# ── Vuln #8: NFS exports (best-effort in container) ───────────────────────────
# Plant data in the export directories
echo "[VulnBox] Setting up NFS export directories..."
echo "server_ip=10.10.10.100"              >> /export/public/server-info.txt
echo "internal_network=10.0.0.0/8"        >> /export/public/server-info.txt
echo "admin_contact=admin@corp.internal"   >> /export/public/server-info.txt

# Attempt to start rpc/nfs (may fail in container — that's acceptable)
exportfs -ra 2>/dev/null || true

# ── Vuln #9: Wildcard injection — populate /opt/scripts ───────────────────────
echo "[VulnBox] Setting up wildcard injection target..."
mkdir -p /opt/scripts
chmod 777 /opt/scripts
echo "#!/bin/bash" > /opt/scripts/backup.sh
echo "echo 'backup placeholder'" >> /opt/scripts/backup.sh
chmod +x /opt/scripts/backup.sh
echo "data_file_1.txt" > /opt/scripts/data_file_1.txt
echo "data_file_2.txt" > /opt/scripts/data_file_2.txt

# ── Supervisor log dir ─────────────────────────────────────────────────────────
mkdir -p /var/log/supervisor

echo "[VulnBox] Initialization complete, starting supervisord..."
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/vulnbox.conf
