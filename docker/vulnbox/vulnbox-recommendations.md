# VulnBox Enhancement Recommendations

## Complete Tool-to-Vulnerability Matrix (All 74 CStrike Tools)

Every CStrike tool must have something to find on the vulnbox. ✅ = exists, ⚠️ = needs adding.

---

### RECONNAISSANCE (12 tools)

#### 1. nmap — Port/service scan
| Finding | Status |
|---|---|
| SSH 22 (OpenSSH, weak ciphers) | ✅ |
| HTTP 80 (Apache + PHP) | ✅ |
| FTP 21 (vsftpd, anon) | ✅ |
| MySQL 3306 (remote) | ✅ |
| SMB 445 | ✅ |
| SNMP 161/udp | ✅ |
| Flask API 9090 | ✅ |
| ⚠️ Telnet 23 | MISSING |
| ⚠️ Redis 6379 (no auth) | MISSING |
| ⚠️ NFS 2049 | MISSING |
| ⚠️ SMTP 25 (open relay) | MISSING |
| ⚠️ DNS 53 | MISSING |
| ⚠️ LDAP 389 | MISSING |
| ⚠️ HTTPS 443 (weak SSL) | MISSING |
| ⚠️ Tomcat-like 8080 | MISSING |
| ⚠️ VNC 5900 | MISSING |
| ⚠️ PostgreSQL 5433 | MISSING |
| ⚠️ Memcached 11211 | MISSING |
| ⚠️ Docker API 2375 (simulated) | MISSING |
| ⚠️ TFTP 69 | MISSING |

#### 2. masscan — Mass IP port scanner
Same as nmap but faster. Benefits from more open ports. **No additional vulnbox changes** beyond what nmap needs.

#### 3. rustscan — Fast Rust port scanner
Same as nmap/masscan. **No additional changes needed.**

#### 4. subfinder — Passive subdomain discovery
| Finding | Status |
|---|---|
| ⚠️ DNS zone with subdomains | MISSING — need bind9 with vulnbox.local zone |

**Add:** bind9 with zone entries: `www`, `db`, `admin`, `backup`, `jenkins`, `gitlab`, `mail`, `vpn`, `dev`, `staging`, `api`, `ftp`, `ldap`, `redis`.vulnbox.local

#### 5. amass — Attack surface mapper
Same as subfinder — benefits from DNS zone. Also:
| Finding | Status |
|---|---|
| ⚠️ Reverse DNS entries | MISSING |
| ⚠️ ASN/CIDR mapping (simulated) | N/A for internal lab |
| ⚠️ SSL cert names (alt names) | MISSING — add SAN cert with multiple names |

#### 6. theHarvester — Email, subdomain & name harvesting
| Finding | Status |
|---|---|
| ⚠️ Email addresses in HTML pages | MISSING — embed emails in web pages |
| ⚠️ Email in HTML comments | MISSING |
| ⚠️ Email in robots.txt or security.txt | MISSING |
| ⚠️ SMTP server for email verification | MISSING |

**Add:** Embed `admin@vulnbox.local`, `deploy@vulnbox.local`, `root@vulnbox.local` in HTML comments across web pages. Add `/.well-known/security.txt` with contact info. Add SMTP server.

#### 7. dnsenum — DNS enumeration
| Finding | Status |
|---|---|
| ⚠️ Zone transfer (AXFR) | MISSING |
| ⚠️ DNS brute-force for subdomains | MISSING |
| ⚠️ MX/NS/TXT records | MISSING |
| ⚠️ Reverse lookup entries | MISSING |

**Add:** bind9 with full zone including MX (`mail.vulnbox.local`), NS records, TXT records with SPF (`v=spf1 +all`), and AXFR allowed from any.

#### 8. dnsrecon — DNS reconnaissance
Same requirements as dnsenum. Additionally:
| Finding | Status |
|---|---|
| ⚠️ SRV records (for service discovery) | MISSING |
| ⚠️ DNSSEC misconfiguration | Optional |

**Add:** SRV records: `_ldap._tcp`, `_kerberos._tcp`, `_http._tcp`, `_ftp._tcp`.vulnbox.local

#### 9. whois — WHOIS domain lookup
Internal lab — limited use. **No changes needed.** (Would need internet-facing domain.)

#### 10. dig — DNS query utility
Benefits from bind9 additions above. Key finding:
| Finding | Status |
|---|---|
| ⚠️ `dig axfr vulnbox.local @10.10.10.100` returns full zone | MISSING |
| ⚠️ TXT records with leaked info | MISSING |

**Add:** TXT record: `"v=spf1 +all"`, `"admin-password=changeme"` (intentional leak in DNS TXT).

#### 11. host — DNS lookup utility
Benefits from bind9. **No additional changes beyond DNS setup.**

#### 12. traceroute — Network path tracing
Internal lab — limited use. Shows single hop to vulnbox. **No changes needed.**

---

### HTTP PROBING (8 tools)

#### 13. httpx — HTTP probing & tech detection
| Finding | Status |
|---|---|
| Apache on 80 with PHP version | ✅ (needs ServerTokens Full, expose_php On) |
| Flask on 9090 | ✅ |
| ⚠️ HTTPS 443 (self-signed) | MISSING |
| ⚠️ Tomcat/Jenkins-like on 8080 | MISSING |
| ⚠️ Node.js/Express on 3000 | MISSING (optional) |
| ⚠️ Multiple vhosts responding differently | MISSING |

**Add:** Apache SSL vhost on 443. Simulated Tomcat manager login on 8080 (Python SimpleHTTPServer or another Flask app).

#### 14. httprobe — HTTP/HTTPS probe
Benefits from more web services. **Same additions as httpx.**

#### 15. curl — HTTP request tool
Used throughout exploitation. Already well-served by existing endpoints. **No changes needed.**

#### 16. whatweb — Web technology fingerprinting
| Finding | Status |
|---|---|
| Apache version | ✅ (needs ServerTokens Full) |
| PHP version | ✅ (needs expose_php On) |
| Flask/Python | ✅ |
| ⚠️ jQuery version (outdated) | MISSING — add old jQuery in HTML |
| ⚠️ CMS fingerprint | MISSING — add fake WordPress indicators |
| ⚠️ Framework detection (Bootstrap, etc.) | MISSING |

**Add:** Include `<script src="/js/jquery-1.6.1.min.js">` in web pages (known vulnerable jQuery). Add `/wp-login.php` fake page.

#### 17. nikto — Web server scanner
| Finding | Status |
|---|---|
| Apache version disclosure | ✅ |
| /robots.txt | ✅ |
| Directory listing /uploads/ | ✅ |
| ⚠️ /server-status accessible | MISSING (enable) |
| ⚠️ /server-info accessible | MISSING (enable) |
| ⚠️ /.git/ exposed | MISSING |
| ⚠️ /.env exposed | MISSING |
| ⚠️ phpinfo.php | MISSING |
| ⚠️ config.php.bak | MISSING |
| ⚠️ TRACE method enabled | MISSING |
| ⚠️ /phpmyadmin/ | MISSING |
| ⚠️ /cgi-bin/ (Shellshock) | MISSING |
| ⚠️ Missing security headers | ✅ (likely already missing) |
| ⚠️ X-Powered-By header | ✅ (PHP default) |
| ⚠️ ETag inode leak | Likely — Apache default |
| ⚠️ OPTIONS method verbose | Likely |

#### 18. wafw00f — WAF detection
Should detect **no WAF** — which is a finding. **No changes needed.**

#### 19. shcheck — Security header checker
| Finding | Status |
|---|---|
| Missing X-Frame-Options | ✅ (not set) |
| Missing Content-Security-Policy | ✅ (not set) |
| Missing X-Content-Type-Options | ✅ (not set) |
| Missing Strict-Transport-Security | ✅ (not set) |
| Missing Referrer-Policy | ✅ (not set) |
| Missing Permissions-Policy | ✅ (not set) |
| ⚠️ Need HTTPS to fully test HSTS | MISSING |

**Good news:** This tool already has plenty to find. Just add HTTPS for full coverage.

#### 20. aquatone — Visual recon & screenshotting
Benefits from more web services. Takes screenshots of discovered HTTP services. **Same additions as httpx** — more ports = more screenshots = more visual attack surface.

---

### WEB EXPLOITATION (6 tools)

#### 21. sqlmap — SQL injection & database takeover
| Finding | Status |
|---|---|
| SQLi in search.php?q= (MySQL) | ✅ |
| SQLi in /api/v1/login (SQLite) | ✅ |
| SQLi in /api/v1/search?q= (SQLite) | ✅ |
| Database dump → credentials | ✅ |
| ⚠️ Blind boolean-based SQLi | MISSING |
| ⚠️ Time-based blind SQLi | MISSING |
| ⚠️ FILE read via LOAD_FILE() | MISSING — need FILE priv |
| ⚠️ FILE write via INTO OUTFILE | MISSING — need secure_file_priv="" |
| ⚠️ OS shell via MySQL UDF | MISSING |
| ⚠️ Stacked queries | Depends on config |

**Add:** `profile.php?id=1` with blind boolean SQLi (returns different page based on query truth). Grant FILE privilege in seed.sql. Set `secure_file_priv=""` in my.cnf. This lets sqlmap do `--file-read=/etc/passwd` and `--os-shell`.

#### 22. xsstrike — XSS detection & exploitation
| Finding | Status |
|---|---|
| Reflected XSS in search.php | ✅ |
| ⚠️ Stored XSS (guestbook) | MISSING |
| ⚠️ DOM-based XSS | MISSING |
| ⚠️ XSS in Flask /api/v1/search | Possible (JSON response) |
| ⚠️ XSS via file upload name | MISSING |
| ⚠️ XSS in error pages | MISSING |

**Add:** `guestbook.php` with stored comments (no sanitization). Add a page with DOM-based XSS via `document.write(location.hash)`.

#### 23. commix — Command injection exploitation
| Finding | Status |
|---|---|
| cmd.php command injection | ✅ |
| /api/v1/exec RCE | ✅ |
| ⚠️ Blind command injection (no output) | MISSING |
| ⚠️ Shellshock via CGI | MISSING |
| ⚠️ Command injection via User-Agent | MISSING |
| ⚠️ Command injection in filename processing | MISSING |

**Add:** `status.php` that runs a command but only shows "OK" or "Error" (blind injection). Shellshock-vulnerable CGI script at `/cgi-bin/status.sh`. A "log viewer" that processes filenames with backticks.

#### 24. arjun — HTTP parameter discovery
| Finding | Status |
|---|---|
| `q` parameter on search.php | ✅ |
| `host` parameter on cmd.php | ✅ |
| `page` parameter on include.php | ✅ |
| `file` parameter on download endpoint | ⚠️ MISSING |
| ⚠️ Hidden `debug` parameter | MISSING |
| ⚠️ Hidden `admin` parameter | MISSING |
| ⚠️ Hidden `cmd` parameter | MISSING |

**Add:** Hidden parameters that trigger different behavior: `?debug=1` on login.php shows SQL query. `?admin=true` on index.php shows admin panel link. `?cmd=` on status.php (blind injection). More parameters = more value from arjun.

#### 25. jwt_tool.py — JWT token analysis & attacks
| Finding | Status |
|---|---|
| ⚠️ JWT with weak secret | MISSING |
| ⚠️ JWT alg:none bypass | MISSING |
| ⚠️ JWT key confusion (RS256 → HS256) | MISSING |
| ⚠️ JWT with no expiration | MISSING |
| ⚠️ JWT claim tampering (role escalation) | MISSING |

**Add:** JWT authentication to Flask API alongside API key auth. Sign with weak secret (`secret`). Accept `alg:none`. Include `role` in claims. This is a **critical gap** — a dedicated JWT tool with zero JWT to test.

#### 26. wpscan — WordPress vulnerability scanner
| Finding | Status |
|---|---|
| ⚠️ WordPress installation | MISSING |
| ⚠️ wp-login.php | MISSING |
| ⚠️ xmlrpc.php | MISSING |
| ⚠️ Vulnerable plugins | MISSING |
| ⚠️ User enumeration via ?author=1 | MISSING |
| ⚠️ Exposed wp-config.php.bak | MISSING |

**Add:** Simulated WordPress at `/blog/` or `/wp/`. Doesn't need to be a real WP install — just enough files to trigger wpscan:
- `/wp-login.php` — login form
- `/xmlrpc.php` — accepts POST
- `/wp-json/wp/v2/users` — returns user list JSON
- `/wp-content/plugins/` — directory listing with fake plugin dirs
- `/wp-config.php.bak` — contains DB creds
- `/?author=1` redirects to `/author/admin/`

This gives wpscan a full target to enumerate.

---

### DIRECTORY / FILE BUSTING (5 tools)

#### 27. ffuf — Fast web fuzzer
#### 28. gobuster — Directory/DNS/VHost brute-forcer
#### 29. feroxbuster — Recursive content discovery

All three need **discoverable paths**:
| Path | Status |
|---|---|
| /uploads/ | ✅ |
| /secret/ | ✅ |
| /api_docs.php | ✅ |
| ⚠️ /.git/ | MISSING |
| ⚠️ /.git/config | MISSING |
| ⚠️ /.env | MISSING |
| ⚠️ /phpinfo.php | MISSING |
| ⚠️ /admin/ | MISSING (add .htpasswd protected) |
| ⚠️ /backup/ | MISSING |
| ⚠️ /phpmyadmin/ | MISSING |
| ⚠️ /cgi-bin/ | MISSING |
| ⚠️ /server-status | MISSING (enable) |
| ⚠️ /server-info | MISSING (enable) |
| ⚠️ /wp-login.php | MISSING |
| ⚠️ /wp-admin/ | MISSING |
| ⚠️ /console (Flask debugger) | ✅ (Flask debug=True) |
| ⚠️ /test.php | MISSING |
| ⚠️ /config.php.bak | MISSING |
| ⚠️ /db/ or /database/ | MISSING |
| ⚠️ /.htpasswd | MISSING |
| ⚠️ /.htaccess | MISSING |
| ⚠️ /logs/ | MISSING |
| ⚠️ /api/ (directory listing) | MISSING |
| ⚠️ /tmp/ | MISSING |
| ⚠️ /.well-known/security.txt | MISSING |
| ⚠️ /crossdomain.xml | MISSING |
| ⚠️ /sitemap.xml | MISSING |

**Gobuster also supports DNS/VHost mode** — needs bind9 zone for DNS mode, and Apache vhosts for VHost mode (e.g. `admin.vulnbox.local` resolves differently).

#### 30. waybackurls — Wayback Machine URL extraction
Internet-only tool. For internal lab:
| Finding | Status |
|---|---|
| ⚠️ Simulated URL list file | Optional — could create `/sitemap.xml` |

#### 31. gau — Get All URLs from AlienVault/Wayback
Same as waybackurls — internet-only. **Sitemap.xml** gives it something locally.

---

### VULNERABILITY SCANNING (3 tools)

#### 32. nuclei — Template-based vulnerability scanner
**This is the highest-ROI tool to feed.** Nuclei has 9000+ templates. Every common pattern we add triggers multiple templates:
| Finding | Status |
|---|---|
| robots.txt | ✅ |
| /swagger.json exposed | ✅ |
| ⚠️ .git/config exposed | MISSING — triggers `git-config-exposure` |
| ⚠️ .env exposed | MISSING — triggers `dotenv-file` |
| ⚠️ phpinfo.php | MISSING — triggers `phpinfo-files` |
| ⚠️ server-status | MISSING — triggers `apache-status` |
| ⚠️ Shellshock | MISSING — triggers `CVE-2014-6271` |
| ⚠️ Apache version CVEs | Needs ServerTokens Full |
| ⚠️ PHP version CVEs | Needs expose_php On |
| ⚠️ WordPress indicators | MISSING — triggers 100+ WP templates |
| ⚠️ Default Tomcat creds | MISSING |
| ⚠️ phpMyAdmin default | MISSING |
| ⚠️ CORS misconfiguration | MISSING |
| ⚠️ Open redirect | MISSING |
| ⚠️ CRLF injection | MISSING |
| ⚠️ Host header injection | MISSING |
| ⚠️ SSRF endpoints | MISSING |
| ⚠️ Exposed AWS metadata | MISSING |
| ⚠️ Exposed .DS_Store | MISSING |
| ⚠️ Exposed backup files (.bak, .old, .zip) | MISSING |
| ⚠️ X-Forwarded-For bypass | MISSING |
| ⚠️ GraphQL introspection | MISSING |
| ⚠️ Spring Actuator / Flask debug | ✅ Flask debug is on |
| ⚠️ Exposed metrics endpoint | MISSING — add /metrics |
| ⚠️ Security.txt | MISSING |

#### 33. vulnapi — API endpoint vulnerability scanner
| Finding | Status |
|---|---|
| OpenAPI spec at /swagger.json | ✅ |
| Unauthenticated endpoints | ✅ |
| IDOR | ✅ |
| SQLi in API | ✅ |
| RCE endpoint | ✅ |
| API key leak | ✅ |
| ⚠️ Mass assignment on registration | MISSING |
| ⚠️ Broken rate limiting | ✅ (no rate limit) |
| ⚠️ JWT vulnerabilities | MISSING |
| ⚠️ SSRF via webhook endpoint | MISSING |
| ⚠️ GraphQL introspection | MISSING |
| ⚠️ Excessive data exposure | ✅ /users returns all fields |

**Add:** `POST /api/v1/register` (mass assignment), `POST /api/v1/webhook` (SSRF), JWT auth, GraphQL endpoint at `/graphql`.

#### 34. enum4linux-ng — SMB/LDAP/RPC enumeration
| Finding | Status |
|---|---|
| SMB shares | ✅ |
| Guest/null session access | ✅ |
| User enumeration | ✅ |
| Password policy | Depends on config |
| OS info via SMB | ✅ |
| ⚠️ LDAP enumeration | MISSING — needs slapd |
| ⚠️ RPC endpoint info | ✅ Should work |

---

### NETWORK ENUMERATION (5 tools)

#### 35. smbmap — SMB share enumeration
| Finding | Status |
|---|---|
| Public share (read/write) | ✅ |
| Backups share (read/write) | ✅ |
| Guest access | ✅ |
| Credential files in shares | ✅ |
| ⚠️ Admin share access with creds | Needs testing |
| ⚠️ Hidden share | MISSING — add `[confidential]` share |

**Add:** Extra SMB share `[confidential]` requiring admin creds, containing SSH private keys and database dumps.

#### 36. rpcclient — RPC enumeration
| Finding | Status |
|---|---|
| ⚠️ Null session enumeration | Needs SMB config: `restrict anonymous = 0` |
| User list via enumdomusers | Should work |
| Group enumeration | Should work |
| ⚠️ Password policy via getdompwinfo | Needs testing |

**Add:** `restrict anonymous = 0` in smb.conf for null session support.

#### 37. ldapsearch — LDAP directory queries
| Finding | Status |
|---|---|
| ⚠️ Anonymous bind | MISSING — needs slapd |
| ⚠️ User enumeration | MISSING |
| ⚠️ Password in description field | MISSING |
| ⚠️ Email addresses | MISSING |
| ⚠️ Group membership | MISSING |
| ⚠️ Service account with SPN | MISSING |

**Add:** OpenLDAP (slapd) with:
- Anonymous bind enabled
- Users: admin, deploy, backup, svc-sql, svc-web
- `svc-sql` has password in `description` field: "Temp password: Summer2024!"
- Groups: Domain Admins (admin, deploy), Users (backup)
- Service accounts with servicePrincipalName attributes

#### 38. snmpwalk — SNMP OID tree walking
| Finding | Status |
|---|---|
| System info (hostname, OS) | ✅ |
| ⚠️ Running processes | MISSING — enable hrProcessTable |
| ⚠️ Network interfaces + IPs | MISSING — enable full MIB |
| ⚠️ Installed software list | MISSING — enable hrSWInstalledTable |
| ⚠️ User accounts via extension | MISSING |
| ⚠️ TCP connections | MISSING — enable tcpConnTable |
| RW community 'private' | ✅ |
| ⚠️ SNMP write → change sysName/sysLocation | Needs testing |

**Update snmpd.conf:** Add `view all included .1` and `rocommand public default -V all`. Enable all MIB trees. Add `extend user-list /usr/bin/cat /etc/passwd` for user enumeration via SNMP.

#### 39. onesixtyone — Fast SNMP community scanner
| Finding | Status |
|---|---|
| Community string 'public' | ✅ |
| Community string 'private' | ✅ |
| ⚠️ Additional community strings | MISSING |

**Add:** Extra communities: `manager`, `admin`, `vulnbox` in snmpd.conf. More strings = better brute-force exercise.

---

### CREDENTIALS & BRUTE FORCE (2 tools)

#### 40. hydra — Network service brute-forcer
| Protocol | Finding | Status |
|---|---|---|
| SSH | admin/deploy/backup/root weak passwords | ✅ |
| FTP | anonymous + admin | ✅ |
| MySQL | root:root, admin:password123 | ✅ |
| SMB | admin:password123 | ✅ |
| HTTP-GET (Basic Auth) | ⚠️ MISSING — add /admin/ |
| HTTP-POST-FORM | login.php | ✅ |
| ⚠️ Telnet | MISSING |
| ⚠️ VNC | MISSING |
| ⚠️ PostgreSQL | MISSING |
| ⚠️ Redis | MISSING (no auth = instant) |
| ⚠️ LDAP | MISSING |
| ⚠️ SNMP | ✅ (public/private) |
| ⚠️ POP3/IMAP | MISSING (add dovecot) |
| ⚠️ SMTP AUTH | MISSING |

#### 41. smtp-user-enum — SMTP user enumeration
| Finding | Status |
|---|---|
| ⚠️ VRFY command enabled | MISSING — needs SMTP server |
| ⚠️ EXPN command enabled | MISSING |
| ⚠️ RCPT TO enumeration | MISSING |
| ⚠️ Valid users: admin, root, deploy, backup | MISSING |

**Add:** Postfix SMTP server on port 25 with VRFY and EXPN enabled. Local delivery for vulnbox.local users. This feeds both smtp-user-enum and theHarvester.

---

### SSL/TLS TESTING (3 tools)

#### 42. testssl — Comprehensive SSL/TLS analysis
#### 43. sslscan — SSL cipher & cert scanner
#### 44. sslyze — SSL configuration analyzer

**ALL THREE have zero targets currently.** This is a critical gap.

| Finding | Status |
|---|---|
| ⚠️ Self-signed certificate | MISSING |
| ⚠️ Expired certificate | MISSING |
| ⚠️ CN mismatch | MISSING |
| ⚠️ SSLv3 enabled | MISSING |
| ⚠️ TLS 1.0 enabled | MISSING |
| ⚠️ TLS 1.1 enabled | MISSING |
| ⚠️ Weak ciphers (RC4, DES, 3DES, NULL) | MISSING |
| ⚠️ No HSTS | MISSING |
| ⚠️ No OCSP stapling | MISSING |
| ⚠️ Weak key size (1024-bit RSA) | MISSING |
| ⚠️ SHA-1 signature | MISSING |
| ⚠️ CRIME (compression enabled) | MISSING |
| ⚠️ SWEET32 (64-bit ciphers) | MISSING |
| ⚠️ Missing certificate chain | MISSING |

**Add:** Apache SSL vhost on 443 with intentionally bad config:
```
SSLProtocol all
SSLCipherSuite ALL:!aNULL
SSLCompression on
```
Generate self-signed cert with 1024-bit RSA, SHA-1 signature, expired, CN=wrong-hostname. This makes all 3 SSL tools light up like a Christmas tree.

---

### PASSWORD CRACKING (4 tools)

#### 45. hashcat — GPU-accelerated hash cracker
#### 46. john — John the Ripper password cracker

| Finding | Status |
|---|---|
| /etc/shadow hashes (after root) | ✅ |
| MySQL password hashes | ✅ |
| ⚠️ .htpasswd bcrypt hashes | MISSING |
| ⚠️ MD5 hashes in database | MISSING — add hashed_password column |
| ⚠️ SHA-256 hashes | MISSING |
| ⚠️ NTLM hashes (from SAM dump) | ⚠️ Partial via Samba |
| ⚠️ Password-protected ZIP file | MISSING |
| ⚠️ Password-protected SSH key | MISSING |
| ⚠️ Office document with password | MISSING |
| ⚠️ KeePass database | MISSING |
| ⚠️ PDF with password | MISSING |

**Add:**
- `.htpasswd` in /admin/ with bcrypt hashes
- `hashed_password` column in MySQL users table (MD5, SHA-256 mix)
- `backup.zip` in SMB backups share (password: `backup2024`)
- SSH private key with passphrase in /srv/samba/confidential/
- `passwords.kdbx` KeePass file (password: `master`)

#### 47. cewl — Custom wordlist generator
| Finding | Status |
|---|---|
| Web content for word extraction | ✅ |
| ⚠️ More text-heavy pages | MISSING |
| ⚠️ Pages with employee names | MISSING |
| ⚠️ "About Us" page with company jargon | MISSING |

**Add:** `about.php` with fake company info, employee names (that match usernames), and keywords that overlap with passwords. E.g., text mentioning "VulnBox", "admin", "deploy", "2024", "password" — these words should appear in the company text so cewl generates a wordlist that actually cracks the accounts.

#### 48. hashid — Hash type identification
Benefits from having diverse hash types present. **Same additions as john/hashcat** — more hash formats = more for hashid to identify.

---

### OSINT (2 tools)

#### 49. shodan — Internet-connected device search
Internet-only tool. **No vulnbox changes.** (Would need real internet exposure.)

#### 50. sherlock — Username reconnaissance across sites
Internet-only tool. **No vulnbox changes.** Operates against social media sites.

---

### IMPACKET — POST-EXPLOIT (5 tools)

#### 51. impacket-secretsdump — SAM/LSA/NTDS credential dump
| Finding | Status |
|---|---|
| ⚠️ SAM database dump | Needs SMB admin access (admin:password123 works) |
| ⚠️ LSA secrets | Linux equivalent: /etc/shadow |
| ⚠️ Cached credentials | MISSING |
| NTLM hashes via SMB | ✅ If admin creds work |

**Needs:** Samba configured to allow remote registry-like access. Add `smbpasswd` entries for all users so secretsdump can pull hashes.

#### 52. impacket-psexec — Remote command execution (SMB)
| Finding | Status |
|---|---|
| ⚠️ RCE via SMB admin credentials | Needs testing |
| Write to writable share → execute | ✅ (public share is writable) |

**Add:** Ensure Samba supports service creation or has writable C$ equivalent. May need `[admin]` share mapped to `/` with admin-only access.

#### 53. impacket-wmiexec — WMI-based remote execution
| Finding | Status |
|---|---|
| ⚠️ WMI execution | Linux-based — WMI not natively available |

**Note:** wmiexec is Windows-specific. For Linux vulnbox, this tool won't have a target unless we add a Windows VM. Consider documenting this as "N/A for Linux vulnbox."

#### 54. impacket-smbexec — SMB-based remote execution
Similar to psexec. Benefits from same SMB share setup.
| Finding | Status |
|---|---|
| ⚠️ RCE via writable SMB share | Needs Samba config tweaks |

#### 55. impacket-GetUserSPNs — Kerberoasting
| Finding | Status |
|---|---|
| ⚠️ Service accounts with SPNs | MISSING — needs Kerberos |
| ⚠️ Crackable service ticket hashes | MISSING |

**Add:** Install Kerberos KDC (`krb5-kdc`, `krb5-admin-server`) with realm `VULNBOX.LOCAL`. Create service accounts with SPNs and weak passwords. This is complex but gives Kerberoasting a real target.

**Alternative (simpler):** Plant pre-captured Kerberos ticket files (.kirbi/.ccache) in SMB shares for offline cracking exercise.

---

### LATERAL MOVEMENT & TUNNELING (4 tools)

#### 56. chisel — TCP/UDP tunnel over HTTP
| Finding | Status |
|---|---|
| ⚠️ Internal service accessible only via tunnel | MISSING |

**Add:** A service (e.g., internal admin panel on 127.0.0.1:8888) that's not exposed externally. After gaining shell, use chisel to tunnel and access it. Add a `docker-internal` network with a second container only reachable from vulnbox.

#### 57. responder — LLMNR/NBT-NS/MDNS poisoner
| Finding | Status |
|---|---|
| ⚠️ LLMNR enabled | MISSING — need Windows-like behavior |
| ⚠️ NBT-NS enabled | Samba may handle this |
| ⚠️ WPAD misconfiguration | MISSING |

**Add:** Enable NetBIOS name service in Samba (`nmbd`). Add a cron job or script that periodically makes DNS lookups for non-existent hosts (simulating a Windows client doing LLMNR/NBT-NS). Add `wpad.dat` auto-detection attempt.

#### 58. bloodhound-python — Active Directory graph mapping
| Finding | Status |
|---|---|
| ⚠️ LDAP with user/group data | MISSING — needs slapd |
| ⚠️ Domain trust relationships | MISSING — needs AD or simulated |

**Add:** OpenLDAP with AD-like schema (user objects, group memberships, adminCount, servicePrincipalName). bloodhound-python can query LDAP even without real AD, though results will be limited.

#### 59. proxychains4 — Proxy chain for pivoting
| Finding | Status |
|---|---|
| ⚠️ Multi-hop network topology | MISSING |

**Add:** Second container on internal-only network. Vulnbox can reach it but attacker can't directly. Forces proxychains through vulnbox. E.g., `vulnbox-internal` container at 172.16.0.100 running a database with more creds.

---

### CLOUD & CONTAINER (4 tools)

#### 60. trivy — Container & IaC vulnerability scanner
| Finding | Status |
|---|---|
| ⚠️ Vulnerable packages (pin old versions) | Partially — bookworm-slim is current |
| ⚠️ Dockerfile misconfiguration | In the Dockerfile itself |
| ⚠️ Kubernetes manifest issues | MISSING |
| ⚠️ .dockerenv file | MISSING |

**Add:**
- Install specific old packages: `libssl1.1` (if available), old `curl`, etc.
- Plant `/var/run/secrets/kubernetes.io/serviceaccount/token` with fake token
- Plant `/.dockerenv`
- Plant fake `~/.aws/credentials` and `~/.kube/config` in home dirs

#### 61. kube-hunter — Kubernetes penetration testing
| Finding | Status |
|---|---|
| ⚠️ K8s API server endpoint | MISSING |
| ⚠️ Service account token | MISSING |
| ⚠️ Kubelet API | MISSING |

**Add:** Fake K8s API endpoint (simple Flask app on port 6443 returning API responses). Plant service account token at standard path. Plant kubeconfig files.

#### 62. gowitness — Web screenshot utility
#### 63. eyewitness — Web app screenshot & header analysis

Both take screenshots of discovered web services. **Benefit from more HTTP services.** Same additions as httpx — more ports, more vhosts, more to screenshot.

eyewitness also checks:
| Finding | Status |
|---|---|
| Default creds pages (Tomcat, Jenkins) | ⚠️ MISSING |
| Login portals | ✅ login.php exists |
| Header analysis | ✅ |

---

### SERVICE DAEMONS (4 tools)

#### 64. msfconsole / 65. msfrpcd — Metasploit Framework
**Critical tool — needs known CVE targets:**
| Exploit Module | Status |
|---|---|
| ⚠️ exploit/unix/ftp/vsftpd_234_backdoor | MISSING — install vsftpd 2.3.4 |
| ⚠️ exploit/multi/http/apache_mod_cgi_bash_env_exec (Shellshock) | MISSING |
| ⚠️ auxiliary/scanner/ssh/ssh_login (brute) | ✅ |
| ⚠️ exploit/linux/redis/redis_unauth_exec | MISSING — needs Redis |
| ⚠️ exploit/unix/misc/distccd_exec | MISSING — add distcc |
| ⚠️ exploit/multi/http/tomcat_mgr_upload | MISSING — add Tomcat |
| ⚠️ auxiliary/scanner/smb/smb_enumshares | ✅ |
| ⚠️ auxiliary/scanner/snmp/snmp_enum | ✅ |
| ⚠️ exploit/linux/misc/nfs_root_squash | MISSING — needs NFS |
| ⚠️ auxiliary/scanner/mysql/mysql_login | ✅ |
| ⚠️ exploit/multi/mysql/mysql_udf_payload | MISSING — needs UDF priv |
| ⚠️ auxiliary/scanner/ftp/anonymous | ✅ |
| ⚠️ exploit/unix/irc/unreal_ircd_3281_backdoor | MISSING (classic) |
| ⚠️ Post modules (hashdump, etc.) | ✅ Once shell gained |
| ⚠️ Meterpreter persistence | ✅ Writable cron, SSH keys |

**Top Metasploit additions:**
1. Shellshock CGI (extremely reliable MSF module)
2. Redis unauth (straightforward)
3. distccd (simple, common CTF target)
4. vsftpd 2.3.4 (iconic)

#### 66. zap.sh — OWASP ZAP daemon
Same as web exploitation tools. Benefits from:
- All PHP vulns (SQLi, XSS, LFI, RCE, CSRF) ✅
- ⚠️ XXE, SSRF, SSTI, open redirect, CORS misconfig
- ⚠️ JWT endpoints
- ⚠️ GraphQL

#### 67. burpsuite — Burp Suite scanner
Same as ZAP, plus:
- ⚠️ JWT analysis
- ⚠️ WebSocket testing
- ⚠️ HTTP/2 issues (optional)

---

### FULL SERVICES NEEDED (New Dockerfile additions)

| Service | Port | Package | Key Vulnerabilities |
|---|---|---|---|
| **Redis** | 6379 | redis-server | No auth, RCE via cron/SSH key write |
| **Apache SSL** | 443 | mod_ssl | Weak ciphers, old TLS, self-signed, expired |
| **Telnet** | 23 | telnetd/inetutils-telnetd | Cleartext creds, weak passwords |
| **BIND9 DNS** | 53 | bind9 | Zone transfer, leaked TXT records |
| **OpenLDAP** | 389 | slapd | Anonymous bind, password in description |
| **Postfix SMTP** | 25 | postfix | Open relay, VRFY/EXPN enabled |
| **NFS** | 2049 | nfs-kernel-server | no_root_squash, world-readable exports |
| **PostgreSQL** | 5433 | postgresql | trust auth, weak creds |
| **Distcc** | 3632 | distcc | Remote code execution (CVE-2004-2687) |
| **Memcached** | 11211 | memcached | No auth, data exfil |
| **VNC** | 5900 | x11vnc/tightvncserver | Weak password |
| **Fake Tomcat** | 8080 | python3 (Flask) | Default creds, WAR deploy sim |
| **Fake K8s API** | 6443 | python3 (Flask) | Exposed API, service tokens |
| **Fake IMDS** | — | iptables + python3 | Cloud credential theft via SSRF |

---

### WEBAPP ADDITIONS (New PHP/Python files)

| File | Vulnerability | Tools That Benefit |
|---|---|---|
| `xxe.php` | XML External Entity injection | ZAP, Burp, nuclei |
| `fetch.php` | SSRF (fetches user-supplied URL) | ZAP, Burp, nuclei, VulnAPI |
| `redirect.php` | Open redirect | nuclei, ZAP, Burp |
| `guestbook.php` | Stored XSS | xsstrike, ZAP, Burp |
| `download.php` | Path traversal file read | ZAP, Burp, nuclei, commix |
| `profile.php` | Blind boolean SQL injection | sqlmap |
| `status.php` | Blind command injection | commix |
| `about.php` | Employee names for wordlists | cewl |
| `phpinfo.php` | Full PHP config disclosure | nikto, nuclei |
| `admin/index.php` | Basic auth protected admin | hydra, john, ffuf |
| `wp-login.php` | Fake WordPress login | wpscan, nuclei |
| `xmlrpc.php` | Fake WordPress XMLRPC | wpscan |
| `.env` | Database credentials exposed | nikto, nuclei, ffuf |
| `config.php.bak` | Backup with creds | nikto, nuclei, ffuf |
| `/cgi-bin/status.sh` | Shellshock (CVE-2014-6271) | nuclei, commix, metasploit |
| Flask: `/api/v1/register` | Mass assignment | VulnAPI |
| Flask: `/api/v1/webhook` | SSRF | VulnAPI, nuclei |
| Flask: `/api/v1/render` | Jinja2 SSTI | ZAP, Burp, nuclei |
| Flask: `/graphql` | GraphQL introspection | VulnAPI, Burp |
| Flask: JWT auth | alg:none, weak secret | jwt_tool, Burp, ZAP |

---

### EXPLOITATION CHAINS (10 paths CStrike should execute)

#### Chain 1: Web → Shell → Root ✅ WORKS NOW
```
ffuf → /uploads/ → upload.php (no filter) → PHP webshell → www-data
→ find SUID find → root
```

#### Chain 2: Info Leak → Cred Reuse → Persistence ⚠️ NEEDS .git/
```
nuclei → .git/config → git log shows password → SSH as admin
→ sudo vim → root → plant SSH key + cron backdoor
```

#### Chain 3: SNMP → Enum → Cred Reuse ✅ MOSTLY WORKS
```
onesixtyone → 'public' → snmpwalk → system info + users
→ hydra SSH → deploy:deploy → sudo ALL → root
```

#### Chain 4: SQLi → Dump → SSH → Privesc ✅ WORKS NOW
```
sqlmap → search.php → dump users → admin:password123
→ SSH → sudo python3 → root
```

#### Chain 5: API Recon → RCE → Persistence ✅ WORKS NOW
```
/swagger.json → /api/v1/config → secrets → /api/v1/exec
→ reverse shell → cron persistence
```

#### Chain 6: FTP → Creds → SMB → MySQL → Secrets ✅ WORKS NOW
```
FTP anon → .credentials_backup.txt → SMB login → db_backup_notes.txt
→ MySQL → dump secrets table → AWS keys
```

#### Chain 7: Redis → SSH Key → Root ⚠️ NEEDS REDIS
```
nmap → Redis 6379 → redis-cli → write authorized_keys → SSH root
```

#### Chain 8: NFS → SUID → Root ⚠️ NEEDS NFS
```
showmount → mount no_root_squash → write SUID binary → root
```

#### Chain 9: DNS → SSRF → Cloud Creds ⚠️ NEEDS DNS + SSRF + IMDS
```
dig AXFR → discover internal hosts → SSRF via fetch.php
→ fake IMDS → AWS creds
```

#### Chain 10: Shellshock → www-data → Privesc ⚠️ NEEDS SHELLSHOCK
```
nuclei → Shellshock on /cgi-bin/status.sh → RCE as www-data
→ SUID find → root → persistence
```

---

### SUMMARY

| Metric | Current | After Enhancement |
|---|---|---|
| Open ports | 7 | 20+ |
| Vulnerabilities | ~35 | ~100+ |
| Tools with targets | ~30/74 (41%) | ~65/74 (88%) |
| Exploitation chains | 4 working | 10 working |
| CVE-based exploits | 0 | 4+ |
| Web endpoints | 9 | 25+ |
| API endpoints | 10 | 18+ |
| Services | 6 | 15+ |
| Crackable hash types | 2 | 7+ |
| Tools with NO target | ~20 | ~6 (internet-only tools) |

The only tools that genuinely can't be served by a local vulnbox are internet-dependent: shodan, sherlock, waybackurls, gau, and partially theHarvester/amass (which benefit from DNS though). Everything else should have at least one finding.
