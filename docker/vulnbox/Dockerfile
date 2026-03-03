# CStrike v2 — Deliberately Vulnerable Target (ARM64-native)
# WARNING: INTENTIONALLY INSECURE — for authorized penetration testing ONLY.
FROM debian:bookworm-slim

ARG DEBIAN_FRONTEND=noninteractive

# System packages (all ARM64-compatible)
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    supervisor \
    openssh-server \
    apache2 libapache2-mod-php php php-mysql php-curl php-xml php-ldap \
    mariadb-server mariadb-client \
    vsftpd \
    snmpd snmp \
    samba samba-common \
    cron \
    sudo curl wget netcat-openbsd procps iproute2 openssl \
    python3 python3-pip python3-venv \
    vim nano \
    git \
    redis-server \
    nfs-kernel-server \
    bash \
    bind9 bind9utils dnsutils \
    slapd ldap-utils \
    postfix \
    && rm -rf /var/lib/apt/lists/*

# Weak user accounts (use -f to ignore existing)
RUN useradd -m -s /bin/bash admin 2>/dev/null || true && \
    useradd -m -s /bin/bash deploy 2>/dev/null || true && \
    useradd -m -s /bin/bash backup 2>/dev/null || true && \
    echo "admin:password123" | chpasswd && \
    echo "deploy:deploy" | chpasswd && \
    echo "backup:backup" | chpasswd && \
    echo "root:toor" | chpasswd && \
    echo "admin ALL=(ALL) NOPASSWD: /usr/bin/find, /usr/bin/vim, /usr/bin/python3, /usr/bin/less, /usr/bin/awk, /usr/bin/env" >> /etc/sudoers && \
    echo "deploy ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers && \
    echo "backup ALL=(ALL) NOPASSWD: /bin/tar, /bin/cp, /usr/bin/rsync" >> /etc/sudoers

# SSH — weak config
RUN mkdir -p /var/run/sshd && \
    sed -i 's/#Port 22/Port 22/' /etc/ssh/sshd_config && \
    sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config && \
    sed -i 's/#PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config && \
    sed -i 's/#PermitEmptyPasswords.*/PermitEmptyPasswords yes/' /etc/ssh/sshd_config && \
    ssh-keygen -A

# Apache + PHP vulnerable webapp
# Enable CGI, headers, SSL, rewrite for vulnerabilities
RUN a2enmod rewrite cgi headers ssl && \
    echo "ServerName localhost" >> /etc/apache2/apache2.conf && \
    echo "Listen 80\nListen 443" > /etc/apache2/ports.conf
COPY webapp/ /var/www/vulnbox/
COPY config/apache-vulnbox.conf /etc/apache2/sites-available/vulnbox.conf
COPY config/apache-vulnbox-ssl.conf /etc/apache2/sites-available/vulnbox-ssl.conf
RUN a2dissite 000-default && a2ensite vulnbox vulnbox-ssl && \
    chown -R www-data:www-data /var/www/vulnbox && \
    chmod -R 777 /var/www/vulnbox/uploads && \
    chmod -R 755 /var/www/vulnbox/secret

# Generate weak self-signed SSL cert (vuln: weak key, self-signed, long expiry)
RUN mkdir -p /etc/ssl/vulnbox && \
    openssl req -x509 -nodes -days 3650 \
        -newkey rsa:1024 \
        -keyout /etc/ssl/vulnbox/vulnbox.key \
        -out /etc/ssl/vulnbox/vulnbox.crt \
        -subj "/C=US/ST=Illinois/L=Springfield/O=VulnBox Corp/OU=IT/CN=vulnbox.local" \
        2>/dev/null

# CGI directory for Shellshock
RUN mkdir -p /usr/lib/cgi-bin && \
    chmod 755 /usr/lib/cgi-bin
COPY config/cgi-bin/status.cgi /usr/lib/cgi-bin/status.cgi
RUN chmod 755 /usr/lib/cgi-bin/status.cgi

# MySQL seed
COPY scripts/seed.sql /docker-entrypoint-initdb.d/seed.sql

# MySQL config
COPY config/my.cnf /etc/mysql/mariadb.conf.d/99-vulnbox.cnf

# FTP
COPY config/vsftpd.conf /etc/vsftpd.conf
RUN mkdir -p /var/run/vsftpd/empty /srv/ftp/pub /srv/ftp/uploads && \
    chmod 755 /srv/ftp/pub && chmod 777 /srv/ftp/uploads && \
    echo "Welcome to VulnBox FTP" > /srv/ftp/pub/README.txt && \
    echo "admin:password123" > /srv/ftp/pub/.credentials_backup.txt

# SNMP
COPY config/snmpd.conf /etc/snmp/snmpd.conf

# Samba
COPY config/smb.conf /etc/samba/smb.conf
RUN mkdir -p /srv/samba/public /srv/samba/backups && \
    chmod 777 /srv/samba/public /srv/samba/backups && \
    echo "Database backup - admin:password123" > /srv/samba/backups/db_backup_notes.txt && \
    (echo "password123"; echo "password123") | smbpasswd -a -s admin 2>/dev/null || true

# Flask API — install PyJWT, requests, graphql for new vulnerabilities
RUN pip3 install --break-system-packages --no-cache-dir flask flask-cors pymysql pyjwt requests 2>/dev/null || true
COPY api/ /opt/vulnapi/

# Redis — no auth, bound to all interfaces
COPY config/redis.conf /etc/redis/redis.conf
RUN chown redis:redis /etc/redis/redis.conf

# NFS exports — no_root_squash (scanner-detectable configuration)
RUN mkdir -p /export/public /export/backups && \
    chmod 777 /export/public /export/backups && \
    echo "# Sensitive data in NFS export" > /export/backups/server-config.txt && \
    echo "DB_PASSWORD=SuperSecret2024!" >> /export/backups/server-config.txt && \
    echo "API_KEY=master-key-do-not-share-98765" >> /export/backups/server-config.txt
COPY config/exports /etc/exports

# Wildcard injection + writable cron setup
RUN mkdir -p /opt/scripts && \
    chmod 777 /opt/scripts && \
    echo "#!/bin/bash" > /opt/scripts/placeholder.sh && \
    echo "echo 'backup running'" >> /opt/scripts/placeholder.sh && \
    chmod 755 /opt/scripts/placeholder.sh
COPY config/cron.d/wildcard-backup /etc/cron.d/wildcard-backup
RUN chmod 644 /etc/cron.d/wildcard-backup && \
    chmod 777 /etc/cron.d/

# Cron (persistence vector)
RUN echo "*/5 * * * * root curl -s http://localhost/ > /dev/null 2>&1" > /etc/cron.d/health-check && \
    chmod 644 /etc/cron.d/health-check

# SUID binaries (privesc vectors)
RUN chmod u+s /usr/bin/find && \
    cp /bin/bash /usr/local/bin/old-bash && chmod u+s /usr/local/bin/old-bash

# BIND9 DNS — vulnerable zone with many subdomains
COPY config/named/ /etc/bind/vulnbox/
RUN mkdir -p /var/log/named /var/cache/bind /run/named && \
    chown -R bind:bind /var/log/named /var/cache/bind /run/named && \
    cp /etc/bind/vulnbox/named.conf.options /etc/bind/named.conf.options && \
    cp /etc/bind/vulnbox/named.conf.local /etc/bind/named.conf.local && \
    cp /etc/bind/vulnbox/db.vulnbox.local /etc/bind/db.vulnbox.local && \
    cp /etc/bind/vulnbox/db.10.10.10 /etc/bind/db.10.10.10 && \
    chown -R bind:bind /etc/bind

# OpenLDAP — vulnerable directory
COPY config/ldap/base.ldif /opt/ldap/base.ldif

# Postfix SMTP — open relay
COPY config/postfix/main.cf /etc/postfix/main.cf
RUN mkdir -p /var/spool/postfix && \
    echo "root: admin@vulnbox.local" >> /etc/aliases && \
    echo "postmaster: root" >> /etc/aliases && \
    newaliases 2>/dev/null || true

# Supervisord + init
COPY supervisord.conf /etc/supervisor/conf.d/vulnbox.conf
COPY scripts/init.sh /opt/init.sh
RUN chmod +x /opt/init.sh

EXPOSE 22 80 443 21 25 53 53/udp 389 3306 161/udp 9090 445 21000-21010 6379

CMD ["/opt/init.sh"]
