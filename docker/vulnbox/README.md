# VulnBox

Deliberately vulnerable target container for [CStrike](https://github.com/culpur/cstrike) penetration testing automation training.

> **WARNING: INTENTIONALLY INSECURE** — Run only in isolated lab environments. Never expose to production networks.

## Quick Start

```bash
# Build
docker build -t vulnbox .

# Run (all services start via supervisord)
docker run -d --name vulnbox \
  -p 2222:22 -p 8080:80 -p 8443:443 \
  -p 2121:21 -p 2525:25 -p 5353:53 -p 5353:53/udp \
  -p 3389:389 -p 3308:3306 -p 1161:161/udp \
  -p 9090:9090 -p 4455:445 -p 6379:6379 \
  vulnbox
```

## Services & Ports

| Service | Port | Credentials / Notes |
|---------|------|-------------------|
| SSH | 22 | `root:toor`, `admin:password123`, `deploy:deploy`, `backup:backup` |
| HTTP | 80 | Apache + PHP vulnerable webapp |
| HTTPS | 443 | Self-signed cert, weak SSL (RSA-1024, SSLv3/TLS1.0 allowed) |
| FTP | 21 | Anonymous upload enabled |
| SMTP | 25 | Postfix open relay, VRFY enabled |
| DNS | 53 | BIND9 open resolver, AXFR enabled, 80+ subdomains |
| LDAP | 389 | OpenLDAP, anonymous bind, weak passwords |
| MySQL | 3306 | `root:root`, `admin:password123` |
| SMB | 445 | Guest access, public + backups shares |
| SNMP | 161/udp | Community strings: `public` (ro), `private` (rw) |
| Redis | 6379 | No authentication, sensitive data seeded |
| REST API | 9090 | Flask API with 14+ vulnerabilities |
| NFS | 2049 | `no_root_squash` on /export/* |

## Web Application Vulnerabilities

| Endpoint | Vulnerability |
|----------|-------------|
| `/login.php` | SQL Injection |
| `/search.php` | SQL Injection |
| `/cmd.php` | Command Injection (RCE) |
| `/include.php` | Local/Remote File Inclusion |
| `/upload.php` | Unrestricted File Upload |
| `/import.php` | XML External Entity (XXE) |
| `/guestbook.php` | Stored Cross-Site Scripting (XSS) |
| `/profile.php?id=1` | Insecure Direct Object Reference (IDOR) |
| `/admin/` | Weak authentication, RCE |
| `/wp-login.php` | Credential harvesting honeypot |
| `/test.php?debug=phpinfo()` | eval() injection |

## Information Disclosure Endpoints

| Endpoint | What Leaks |
|----------|-----------|
| `/phpinfo.php` | Full PHP configuration |
| `/status.php` | System info, processes, env vars |
| `/about.php` | Software versions, service list |
| `/server-status` | Apache server status |
| `/.env` | Database, AWS, SMTP credentials |
| `/.htpasswd` | Password hashes |
| `/config.php.bak` | Database + AWS + LDAP credentials |
| `/wp-config.php` | WordPress-style config with secrets |
| `/backup.sql` | Full database dump with passwords |
| `/.git/` | Git history with committed secrets |
| `/robots.txt` | Lists all "hidden" paths |

## REST API Vulnerabilities (Port 9090)

| Endpoint | Vulnerability |
|----------|-------------|
| `POST /api/v1/login` | SQL Injection |
| `POST /api/v1/register` | Mass Assignment (role escalation) |
| `GET /api/v1/users/<id>` | IDOR (no auth, returns passwords) |
| `GET /api/v1/search?q=` | SQL Injection |
| `POST /api/v1/exec` | Remote Code Execution |
| `GET /api/v1/fetch?url=` | Server-Side Request Forgery |
| `POST /api/v1/webhook` | SSRF via callback |
| `POST /api/v1/jwt/issue` | Weak JWT secret (`secret`) |
| `POST /api/v1/jwt/verify` | `alg:none` bypass |
| `GET /api/v1/render?template=` | Server-Side Template Injection |
| `POST /api/v1/graphql` | GraphQL introspection (schema leak) |
| `GET /api/v1/metrics` | Prometheus-style info disclosure |
| `GET /api/v1/config` | Application secrets |
| `GET /api/v1/debug` | Environment variable dump |
| `GET /latest/meta-data/` | Fake AWS IMDS with credentials |
| `GET /openapi.json` | Full API specification |

## DNS Zone (vulnbox.local)

BIND9 serves the `vulnbox.local` zone with 80+ subdomains for enumeration:

**Categories:** Web (www, app, portal, cdn, static), API (api, api-v1, api-v2, graphql, rest, webhook), Admin (admin, panel, dashboard, console, cpanel, webmail), Mail (mail, smtp, pop3, imap), Dev/Staging (dev, staging, test, qa, uat, beta, demo, sandbox), DevOps (jenkins, ci, gitlab, git, registry, docker, k8s, argocd), Infrastructure (db, mysql, postgres, redis, cache, elastic, kibana, grafana, prometheus, splunk), Network (vpn, proxy, bastion, jump, firewall, dns, ldap), Security (monitor, nagios, zabbix, siem, vault, secrets), Storage (ftp, files, share, backup, nas, s3), Internal (intranet, corp, erp, crm, hr, wiki, docs, jira, confluence, slack)

**Wildcard record**: `*.vulnbox.local` resolves to 10.10.10.100

**AXFR enabled** — full zone transfer available to any client.

## LDAP Directory (dc=vulnbox,dc=local)

OpenLDAP with anonymous bind enabled. Contains:

- **Users**: admin, john, deploy, backup, root (all with weak passwords)
- **Groups**: admins, developers, operations
- **Service accounts**: ldap-service, web-app
- Excessive personal info exposed (email, phone, address)

## Infrastructure Vulnerabilities

| Vector | Description |
|--------|-----------|
| Git History | 5 commits with leaked AWS keys, SSH keys, production .env |
| Redis | Unauthenticated, contains session tokens, DB creds, AWS keys, flags |
| NFS | `no_root_squash` — remote root access to exports |
| Cron Wildcard | `tar *` in world-writable dir — checkpoint injection |
| Shellshock | `/cgi-bin/status.cgi` — CVE-2014-6271 |
| SUID Binaries | `/usr/bin/find` and `/usr/local/bin/old-bash` have SUID bit |
| Sudo Abuse | admin: NOPASSWD find/vim/python3/env; deploy: NOPASSWD ALL |
| Weak SSL | RSA-1024 key, SSLv3 allowed, weak cipher suites |
| Open Relay | SMTP accepts mail from anyone to anyone |
| DNS Amplification | Open resolver + AXFR zone transfer |

## CStrike Tool Coverage

This target is designed to provide findings for the majority of CStrike's 74 integrated security tools across all categories:

- **Reconnaissance**: nmap, masscan, rustscan, subfinder, amass, theHarvester, dnsenum, dnsrecon, fierce, dig, host, whois
- **HTTP Probing**: httpx, curl, wget
- **Web Scanning**: nikto, dirb, gobuster, feroxbuster, whatweb, wappalyzer
- **SSL/TLS**: testssl, sslscan, sslyze
- **Vulnerability Scanning**: nuclei, ZAP, sqlmap
- **Exploitation**: hydra, medusa, metasploit, xsstrike, ffuf
- **API Testing**: VulnAPI, Postman, GraphQL introspection
- **Infrastructure**: enum4linux, ldapsearch, smtp-user-enum, snmpwalk, showmount, redis-cli

## Architecture

Single container using **supervisord** to run 14 services:

```
supervisord
  ├── sshd (port 22)
  ├── apache2 (port 80, 443)
  ├── mysql (port 3306)
  ├── vsftpd (port 21)
  ├── snmpd (port 161/udp)
  ├── smbd (port 445)
  ├── nmbd (port 137)
  ├── cron
  ├── vulnapi (port 9090)
  ├── redis (port 6379)
  ├── named (port 53)
  ├── slapd (port 389)
  └── postfix (port 25)
```

## License

For authorized security testing and educational use only.
