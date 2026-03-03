-- CStrike v2 — Database Seed (SQL)
-- Runs on first deploy to populate required tables.
-- Uses ON CONFLICT to be idempotent (safe to re-run).
-- This is the SINGLE source of truth for seed data (seed.ts mirrors this).

-- ── Schema migrations (idempotent) ─────────────────────────────
ALTER TABLE services ADD COLUMN IF NOT EXISTS auto_start BOOLEAN DEFAULT false;

-- ── Service records ──────────────────────────────────────────
INSERT INTO services (id, name, status, port, optional, auto_start, "createdAt", "updatedAt")
VALUES
  ('svc_api',        'api_server',  'STOPPED', 3001,  false, false, NOW(), NOW()),
  ('svc_frontend',   'frontend',    'STOPPED', 3000,  false, false, NOW(), NOW()),
  ('svc_metasploit', 'metasploit',  'STOPPED', 55552, true,  true,  NOW(), NOW()),
  ('svc_zap',        'zap',         'STOPPED', 8090,  true,  true,  NOW(), NOW()),
  ('svc_burp',       'burp',        'STOPPED', NULL,  true,  true,  NOW(), NOW())
ON CONFLICT (name) DO UPDATE SET auto_start = EXCLUDED.auto_start;

-- ── Default configuration ────────────────────────────────────
-- AI provider settings
INSERT INTO config_entries (id, key, value, version, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'ai_provider',       '"ollama"',  1, NOW(), NOW()),
  (gen_random_uuid(), 'openai_api_key',    '""',        1, NOW(), NOW()),
  (gen_random_uuid(), 'openai_model',      '"gpt-4o"',  1, NOW(), NOW()),
  (gen_random_uuid(), 'anthropic_api_key', '""',        1, NOW(), NOW()),
  (gen_random_uuid(), 'anthropic_model',   '"claude-sonnet-4-20250514"', 1, NOW(), NOW()),
  (gen_random_uuid(), 'grok_api_key',      '""',        1, NOW(), NOW()),
  (gen_random_uuid(), 'grok_model',        '"grok-2"',  1, NOW(), NOW()),
  (gen_random_uuid(), 'ollama_model',      '"qwen3"',   1, NOW(), NOW()),
  (gen_random_uuid(), 'ollama_host',       '"http://localhost:11434"', 1, NOW(), NOW()),
  -- AI tuning
  (gen_random_uuid(), 'ai_max_iterations', '10',        1, NOW(), NOW()),
  (gen_random_uuid(), 'ai_max_tokens',     '4096',      1, NOW(), NOW()),
  (gen_random_uuid(), 'ai_temperature',    '0.7',       1, NOW(), NOW()),
  (gen_random_uuid(), 'mcp_enabled',       'true',      1, NOW(), NOW()),
  -- Exploitation gate
  (gen_random_uuid(), 'allow_exploitation', 'true',     1, NOW(), NOW()),
  -- Scan configuration
  (gen_random_uuid(), 'scan_modes',        '["port","http","dns","subdomain","network","dirbusting","vulnscan","apiscan","web_exploit","ssl","smb","ldap","snmp","osint","credentials","password","cloud","lateral"]', 1, NOW(), NOW()),
  (gen_random_uuid(), 'allowed_tools',     '["nmap","masscan","rustscan","subfinder","amass","theHarvester","dnsenum","dnsrecon","whois","dig","host","traceroute","httpx","httprobe","curl","whatweb","nikto","wafw00f","shcheck","aquatone","sqlmap","xsstrike","commix","arjun","jwt_tool.py","wpscan","ffuf","gobuster","feroxbuster","waybackurls","gau","nuclei","vulnapi","enum4linux-ng","smbmap","rpcclient","ldapsearch","snmpwalk","onesixtyone","hydra","smtp-user-enum","testssl","sslscan","sslyze","hashcat","john","cewl","hashid","shodan","sherlock","impacket-secretsdump","impacket-psexec","impacket-wmiexec","impacket-smbexec","impacket-GetUserSPNs","chisel","responder","bloodhound-python","proxychains4","trivy","kube-hunter","gowitness","eyewitness","msfconsole","msfrpcd","zap.sh","burpsuite","dirb","wfuzz","katana","medusa","enum4linux","smbclient","nbtscan"]', 1, NOW(), NOW()),
  -- Execution limits
  (gen_random_uuid(), 'max_threads',       '10',        1, NOW(), NOW()),
  (gen_random_uuid(), 'max_runtime',       '3600',      1, NOW(), NOW()),
  -- Metasploit RPC
  (gen_random_uuid(), 'msf_username',      '"msf"',     1, NOW(), NOW()),
  (gen_random_uuid(), 'msf_password',      '"msf"',     1, NOW(), NOW()),
  (gen_random_uuid(), 'msf_host',          '"127.0.0.1"', 1, NOW(), NOW()),
  (gen_random_uuid(), 'msf_port',          '55552',     1, NOW(), NOW()),
  -- OWASP ZAP
  (gen_random_uuid(), 'zap_host',          '"127.0.0.1"', 1, NOW(), NOW()),
  (gen_random_uuid(), 'zap_port',          '8090',      1, NOW(), NOW()),
  -- Target scope
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
