<html><head><title>VulnBox - CStrike Training Target</title></head><body>
<h1>VulnBox</h1>
<p>Deliberately Vulnerable Web Application for CStrike v2 Testing</p>
<h2>Application Pages</h2>
<ul>
  <li><a href="/login.php">Login (SQLi)</a></li>
  <li><a href="/search.php">User Search (SQLi)</a></li>
  <li><a href="/upload.php">File Upload (unrestricted)</a></li>
  <li><a href="/cmd.php">Network Tools (RCE)</a></li>
  <li><a href="/include.php">Documentation (LFI/RFI)</a></li>
  <li><a href="/import.php">XML Import (XXE)</a></li>
  <li><a href="/guestbook.php">Guestbook (Stored XSS)</a></li>
  <li><a href="/profile.php?id=1">User Profile (IDOR)</a></li>
  <li><a href="/wp-login.php">WordPress Login (honeypot)</a></li>
  <li><a href="/admin/">Admin Panel</a></li>
  <li><a href="/api_docs.php">API Documentation</a></li>
</ul>
<h2>Information Disclosure</h2>
<ul>
  <li><a href="/phpinfo.php">PHP Info</a></li>
  <li><a href="/status.php">Server Status</a></li>
  <li><a href="/about.php">About / Version Info</a></li>
  <li><a href="/test.php">Test Page (debug)</a></li>
  <li><a href="/server-status">Apache Status</a></li>
  <li><a href="/backup.sql">Database Backup (leaked)</a></li>
  <li><a href="/config.php.bak">Config Backup (credentials)</a></li>
  <li><a href="/.env">Environment File (leaked)</a></li>
  <li><a href="/.htpasswd">Password File (leaked)</a></li>
  <li><a href="/wp-config.php">WordPress Config (leaked)</a></li>
</ul>
<h2>API Endpoints (port 9090)</h2>
<ul>
  <li><a href="http://vulnbox:9090/api/v1/fetch?url=http://169.254.169.254/latest/meta-data/">SSRF: /api/v1/fetch</a></li>
  <li><a href="http://vulnbox:9090/api/v1/webhook">Webhook SSRF: /api/v1/webhook</a></li>
  <li><a href="http://vulnbox:9090/api/v1/register">Register (Mass Assignment)</a></li>
  <li><a href="http://vulnbox:9090/api/v1/jwt/issue">JWT Issue (weak secret)</a></li>
  <li><a href="http://vulnbox:9090/api/v1/render?template={{7*7}}">SSTI: /api/v1/render</a></li>
  <li><a href="http://vulnbox:9090/api/v1/graphql">GraphQL (introspection)</a></li>
  <li><a href="http://vulnbox:9090/api/v1/metrics">Metrics (info disclosure)</a></li>
  <li><a href="http://vulnbox:9090/latest/meta-data/">Fake IMDS: /latest/meta-data/</a></li>
  <li><a href="http://vulnbox:9090/openapi.json">OpenAPI Spec</a></li>
</ul>
<h2>Network Services</h2>
<ul>
  <li>SSH: port 22 (root:toor, admin:password123, deploy:deploy)</li>
  <li>HTTP: port 80</li>
  <li>HTTPS: port 443 (weak SSL, self-signed)</li>
  <li>FTP: port 21 (anonymous upload)</li>
  <li>SMTP: port 25 (open relay, VRFY enabled)</li>
  <li>DNS: port 53 (open resolver, AXFR enabled, 80+ subdomains)</li>
  <li>MySQL: port 3306 (root:root, admin:password123)</li>
  <li>LDAP: port 389 (anonymous bind, weak passwords)</li>
  <li>SMB: port 445 (guest access)</li>
  <li>SNMP: port 161/udp (community: public/private)</li>
  <li>Redis: port 6379 (no auth)</li>
  <li>REST API: port 9090</li>
  <li>NFS: /export/public, /export/backups (no_root_squash)</li>
</ul>
<h2>CVE Targets</h2>
<ul>
  <li><a href="/cgi-bin/status.cgi">Shellshock CGI (CVE-2014-6271): /cgi-bin/status.cgi</a></li>
  <li>Git repo exposed: <a href="/.git/config">/.git/config</a>, <a href="/.git/COMMIT_EDITMSG">/.git/COMMIT_EDITMSG</a></li>
  <li>NFS no_root_squash: /export/public, /export/backups</li>
  <li>Wildcard cron injection: /opt/scripts (world-writable, tar *)</li>
</ul>
<!-- TODO: Remove debug info before production -->
<!-- DB: root/root on localhost:3306, database: vulnbox -->
<!-- API Key: master-key-do-not-share-98765 -->
<!-- Redis: 127.0.0.1:6379 (no password) -->
<!-- LDAP: cn=admin,dc=vulnbox,dc=local / admin -->
<!-- DNS zone: vulnbox.local (AXFR open) -->
<!-- SMTP: open relay, no auth -->
<!-- Git history contains credentials: git show HEAD~3:config.php -->
</body></html>
