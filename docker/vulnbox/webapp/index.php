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
  <li><a href="/api_docs.php">API Documentation</a></li>
</ul>
<h2>API Endpoints (port 9090)</h2>
<ul>
  <li><a href="http://vulnbox:9090/api/v1/fetch?url=http://169.254.169.254/latest/meta-data/">SSRF: /api/v1/fetch</a></li>
  <li><a href="http://vulnbox:9090/api/v1/jwt/issue">JWT Issue (weak secret)</a></li>
  <li><a href="http://vulnbox:9090/api/v1/render?template={{7*7}}">SSTI: /api/v1/render</a></li>
  <li><a href="http://vulnbox:9090/latest/meta-data/">Fake IMDS: /latest/meta-data/</a></li>
  <li><a href="http://vulnbox:9090/openapi.json">OpenAPI Spec</a></li>
</ul>
<h2>Other Services</h2>
<ul>
  <li>SSH: port 2222 (root:toor, admin:password123, deploy:deploy)</li>
  <li>FTP: port 2121 (anonymous)</li>
  <li>MySQL: port 3308 (root:root, admin:password123)</li>
  <li>SNMP: port 1161/udp (community: public)</li>
  <li>REST API: port 9090</li>
  <li>SMB: port 4455</li>
  <li>Redis: port 6379 (no auth)</li>
</ul>
<h2>CVE Targets</h2>
<ul>
  <li><a href="/cgi-bin/status.cgi">Shellshock CGI (CVE-2014-6271): /cgi-bin/status.cgi</a></li>
  <li>Git repo exposed: <a href="/.git/config">/.git/config</a>, <a href="/.git/COMMIT_EDITMSG">/.git/COMMIT_EDITMSG</a></li>
  <li>NFS no_root_squash: /export/public, /export/backups</li>
  <li>Wildcard cron injection: /opt/scripts (world-writable, tar *)</li>
</ul>
<!-- TODO: Remove debug info before production -->
<!-- DB: root/root on localhost:3307, database: vulnbox -->
<!-- API Key: master-key-do-not-share-98765 -->
<!-- Redis: 127.0.0.1:6379 (no password) -->
<!-- Git history contains credentials: git show HEAD~3:config.php -->
</body></html>
