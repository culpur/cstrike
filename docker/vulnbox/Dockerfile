# CStrike v2 — Deliberately Vulnerable Target (ARM64-native)
# WARNING: INTENTIONALLY INSECURE — for authorized penetration testing ONLY.
FROM debian:bookworm-slim

ARG DEBIAN_FRONTEND=noninteractive

# System packages (all ARM64-compatible)
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    supervisor \
    openssh-server \
    apache2 libapache2-mod-php php php-mysql php-curl php-xml \
    mariadb-server mariadb-client \
    vsftpd \
    snmpd snmp \
    samba samba-common \
    cron \
    sudo curl wget netcat-openbsd procps iproute2 openssl \
    python3 python3-pip python3-venv \
    vim nano \
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
RUN a2enmod rewrite && \
    echo "ServerName localhost" >> /etc/apache2/apache2.conf && \
    echo "Listen 80" > /etc/apache2/ports.conf
COPY webapp/ /var/www/vulnbox/
COPY config/apache-vulnbox.conf /etc/apache2/sites-available/vulnbox.conf
RUN a2dissite 000-default && a2ensite vulnbox && \
    chown -R www-data:www-data /var/www/vulnbox && \
    chmod -R 777 /var/www/vulnbox/uploads && \
    chmod -R 755 /var/www/vulnbox/secret

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

# Flask API
COPY api/ /opt/vulnapi/
RUN pip3 install --break-system-packages --no-cache-dir flask flask-cors pymysql 2>/dev/null || true

# Cron (persistence vector)
RUN echo "*/5 * * * * root curl -s http://localhost/ > /dev/null 2>&1" > /etc/cron.d/health-check && \
    chmod 644 /etc/cron.d/health-check

# SUID binaries (privesc vectors)
RUN chmod u+s /usr/bin/find && \
    cp /bin/bash /usr/local/bin/old-bash && chmod u+s /usr/local/bin/old-bash

# Supervisord + init
COPY supervisord.conf /etc/supervisor/conf.d/vulnbox.conf
COPY scripts/init.sh /opt/init.sh
RUN chmod +x /opt/init.sh

EXPOSE 22 80 21 3306 161/udp 9090 445 21000-21010

CMD ["/opt/init.sh"]
