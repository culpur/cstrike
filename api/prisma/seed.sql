-- CStrike v2 — Database Seed (SQL fallback)
-- Runs on first deploy to populate required tables.
-- Uses ON CONFLICT to be idempotent (safe to re-run).

-- ── Service records ──────────────────────────────────────────
INSERT INTO services (id, name, status, port, optional, "createdAt", "updatedAt")
VALUES
  ('svc_api',        'api_server',  'STOPPED', 3001,  false, NOW(), NOW()),
  ('svc_frontend',   'frontend',    'STOPPED', 3000,  false, NOW(), NOW()),
  ('svc_metasploit', 'metasploit',  'STOPPED', 55552, true,  NOW(), NOW()),
  ('svc_zap',        'zap',         'STOPPED', 8090,  true,  NOW(), NOW()),
  ('svc_burp',       'burp',        'STOPPED', NULL,  true,  NOW(), NOW())
ON CONFLICT (name) DO NOTHING;

-- ── Default configuration ────────────────────────────────────
INSERT INTO config_entries (id, key, value, version, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'ai_provider',       '"openai"',  1, NOW(), NOW()),
  (gen_random_uuid(), 'ai_temperature',    '0.7',       1, NOW(), NOW()),
  (gen_random_uuid(), 'ai_max_tokens',     '4096',      1, NOW(), NOW()),
  (gen_random_uuid(), 'allow_exploitation', 'false',    1, NOW(), NOW()),
  (gen_random_uuid(), 'scan_modes',        '["port_scan","service_enum","subdomain_enum","web_crawl","vuln_scan","ssl_audit"]', 1, NOW(), NOW()),
  (gen_random_uuid(), 'allowed_tools',     '["nmap","masscan","rustscan","subfinder","amass","theHarvester","dnsenum","dnsrecon","whois","dig","host","traceroute","httpx","httprobe","curl","whatweb","nikto","wafw00f","shcheck","aquatone","sqlmap","xsstrike","commix","arjun","jwt_tool.py","wpscan","ffuf","gobuster","feroxbuster","waybackurls","gau","nuclei","vulnapi","enum4linux-ng","smbmap","rpcclient","ldapsearch","snmpwalk","onesixtyone","hydra","smtp-user-enum","testssl","sslscan","sslyze","hashcat","john","cewl","hashid","shodan","sherlock","impacket-secretsdump","impacket-psexec","impacket-wmiexec","impacket-smbexec","impacket-GetUserSPNs","chisel","responder","bloodhound-python","proxychains4","trivy","kube-hunter","gowitness","eyewitness","msfconsole","msfrpcd","zap.sh","burpsuite","dirb","wfuzz","katana","medusa","enum4linux","smbclient","nbtscan"]', 1, NOW(), NOW()),
  (gen_random_uuid(), 'max_threads',       '10',        1, NOW(), NOW()),
  (gen_random_uuid(), 'max_runtime',       '3600',      1, NOW(), NOW()),
  (gen_random_uuid(), 'target_scope',      '[]',        1, NOW(), NOW())
ON CONFLICT (key) DO NOTHING;

-- ── VPN connection records ───────────────────────────────────
INSERT INTO vpn_connections (id, provider, interface, status, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'wireguard',  'wg0',        'DISCONNECTED', NOW(), NOW()),
  (gen_random_uuid(), 'openvpn',    'tun0',       'DISCONNECTED', NOW(), NOW()),
  (gen_random_uuid(), 'tailscale',  'tailscale0', 'DISCONNECTED', NOW(), NOW()),
  (gen_random_uuid(), 'nordvpn',    'nordlynx',   'DISCONNECTED', NOW(), NOW()),
  (gen_random_uuid(), 'mullvad',    'wg-mullvad', 'DISCONNECTED', NOW(), NOW())
ON CONFLICT (provider) DO NOTHING;
