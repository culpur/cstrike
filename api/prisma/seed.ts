/**
 * CStrike v2 — Database Seed
 * Populates default configuration and service records.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding CStrike database...');

  // ── Default configuration entries ──────────────────────────
  const configDefaults: { key: string; value: unknown }[] = [
    // AI provider settings
    { key: 'ai_provider', value: 'openai' },
    { key: 'openai_api_key', value: '' },
    { key: 'openai_model', value: 'gpt-4o' },
    { key: 'anthropic_api_key', value: '' },
    { key: 'anthropic_model', value: 'claude-sonnet-4-20250514' },
    { key: 'grok_api_key', value: '' },
    { key: 'grok_model', value: 'grok-2' },
    { key: 'ollama_model', value: 'llama3' },
    { key: 'ollama_host', value: 'http://localhost:11434' },

    // AI tuning
    { key: 'ai_max_iterations', value: 10 },
    { key: 'ai_max_tokens', value: 4096 },
    { key: 'ai_temperature', value: 0.7 },
    { key: 'mcp_enabled', value: true },

    // Exploitation gate
    { key: 'allow_exploitation', value: false },

    // Scan configuration
    {
      key: 'scan_modes',
      value: [
        'port_scan', 'service_enum', 'subdomain_enum',
        'web_crawl', 'vuln_scan', 'ssl_audit',
      ],
    },
    {
      key: 'allowed_tools',
      value: [
        'nmap', 'subfinder', 'amass', 'nikto', 'httpx',
        'waybackurls', 'gau', 'dnsenum', 'nuclei', 'ffuf',
        'gobuster', 'dirb', 'wfuzz', 'sqlmap', 'xsstrike',
        'whatweb', 'wafw00f', 'sslscan', 'sslyze', 'testssl',
        'masscan', 'rustscan', 'feroxbuster', 'katana',
        'hydra', 'john', 'hashcat', 'medusa',
        'enum4linux', 'smbclient', 'nbtscan', 'snmpwalk',
        'dnsrecon', 'wpscan', 'commix', 'gowitness',
      ],
    },

    // Execution limits
    { key: 'max_threads', value: 10 },
    { key: 'max_runtime', value: 3600 },

    // Metasploit RPC
    { key: 'msf_username', value: 'msf' },
    { key: 'msf_password', value: 'msf' },
    { key: 'msf_host', value: '127.0.0.1' },
    { key: 'msf_port', value: 55552 },

    // OWASP ZAP
    { key: 'zap_host', value: '127.0.0.1' },
    { key: 'zap_port', value: 8090 },

    // Target scope
    { key: 'target_scope', value: [] },
  ];

  for (const { key, value } of configDefaults) {
    await prisma.configEntry.upsert({
      where: { key },
      update: {},
      create: { key, value: value as any },
    });
  }

  console.log(`  ${configDefaults.length} config entries seeded`);

  // ── Default service records ────────────────────────────────
  const services = [
    { name: 'api_server', port: 3001, optional: false },
    { name: 'frontend', port: 3000, optional: false },
    { name: 'metasploit', port: 55552, optional: true },
    { name: 'zap', port: 8090, optional: true },
    { name: 'burp', port: null, optional: true },
  ];

  for (const svc of services) {
    await prisma.service.upsert({
      where: { name: svc.name },
      update: {},
      create: {
        name: svc.name,
        status: 'STOPPED',
        port: svc.port,
        optional: svc.optional,
      },
    });
  }

  console.log(`  ${services.length} service records seeded`);

  // ── Default VPN connection records ─────────────────────────
  const vpnProviders = [
    { provider: 'wireguard', interface: 'wg0' },
    { provider: 'openvpn', interface: 'tun0' },
    { provider: 'tailscale', interface: 'tailscale0' },
    { provider: 'nordvpn', interface: 'nordlynx' },
    { provider: 'mullvad', interface: 'wg-mullvad' },
  ];

  for (const vpn of vpnProviders) {
    await prisma.vpnConnection.upsert({
      where: { provider: vpn.provider },
      update: {},
      create: {
        provider: vpn.provider,
        interface: vpn.interface,
        status: 'DISCONNECTED',
      },
    });
  }

  console.log(`  ${vpnProviders.length} VPN connection records seeded`);

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
