/**
 * Configuration View — Full system configuration
 *
 * AI provider selection, scan modes, 60+ tools organized by category,
 * AI tuning, MCP settings, service endpoints, target scope.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Save,
  RefreshCw,
  Settings,
  Brain,
  Shield,
  Crosshair,
  Network,
  Lock,
  Cloud,
  Terminal,
  Eye,
  Key,
  Loader2,
  ChevronDown,
  ChevronRight,
  X,
  Plus,
  Wifi,
  WifiOff,
  AlertTriangle,
  Zap,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { useUIStore } from '@stores/uiStore';
import { useSystemStore } from '@stores/systemStore';
import { apiService } from '@services/api';
import { SectionPanel } from '@components/ui/SectionPanel';
import type { Config, VpnConnection, VpnProvider } from '@/types';

// ── Scan Modes (all 18 backend-supported modes) ─────────────────────────────

interface ScanModeInfo {
  id: string;
  label: string;
  description: string;
  category: 'core' | 'web' | 'network' | 'advanced';
}

const SCAN_MODES: ScanModeInfo[] = [
  // Core
  { id: 'port', label: 'Port Scan', description: 'TCP/UDP port scanning', category: 'core' },
  { id: 'http', label: 'HTTP Probe', description: 'HTTP service probing & fingerprinting', category: 'core' },
  { id: 'dns', label: 'DNS Recon', description: 'DNS records, zone transfers, lookups', category: 'core' },
  { id: 'subdomain', label: 'Subdomain Enum', description: 'Subdomain discovery & enumeration', category: 'core' },
  { id: 'network', label: 'Network Scan', description: 'Mass port scanning (masscan, rustscan)', category: 'core' },
  // Web
  { id: 'dirbusting', label: 'Dir Busting', description: 'Directory & file enumeration', category: 'web' },
  { id: 'vulnscan', label: 'Vuln Scan', description: 'Vulnerability scanning (nuclei, nikto)', category: 'web' },
  { id: 'apiscan', label: 'API Scan', description: 'API vulnerability scanning (VulnAPI)', category: 'web' },
  { id: 'web_exploit', label: 'Web Exploit', description: 'SQLi, XSS, command injection', category: 'web' },
  { id: 'ssl', label: 'SSL/TLS', description: 'SSL/TLS configuration analysis', category: 'web' },
  // Network
  { id: 'smb', label: 'SMB Enum', description: 'SMB shares, users, policies', category: 'network' },
  { id: 'ldap', label: 'LDAP Enum', description: 'LDAP directory enumeration', category: 'network' },
  { id: 'snmp', label: 'SNMP Enum', description: 'SNMP community string & OID walking', category: 'network' },
  // Advanced
  { id: 'osint', label: 'OSINT', description: 'Open-source intelligence gathering', category: 'advanced' },
  { id: 'credentials', label: 'Credentials', description: 'Credential management & brute-force', category: 'advanced' },
  { id: 'password', label: 'Password Crack', description: 'Hash cracking & wordlist gen', category: 'advanced' },
  { id: 'cloud', label: 'Cloud/Container', description: 'Cloud & container security scanning', category: 'advanced' },
  { id: 'lateral', label: 'Lateral Movement', description: 'Post-exploitation & pivoting', category: 'advanced' },
];

const SCAN_MODE_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'core', label: 'Core Scanning' },
  { key: 'web', label: 'Web Application' },
  { key: 'network', label: 'Network Services' },
  { key: 'advanced', label: 'Advanced / Post-Exploit' },
];

// ── Tool Catalog (all 60+ backend tools, organized by category) ─────────────

interface ToolInfo {
  id: string;
  description: string;
}

interface ToolCategory {
  key: string;
  label: string;
  icon: typeof Terminal;
  color: string;
  tools: ToolInfo[];
}

const TOOL_CATEGORIES: ToolCategory[] = [
  {
    key: 'recon',
    label: 'Reconnaissance',
    icon: Eye,
    color: 'var(--grok-recon-blue)',
    tools: [
      { id: 'nmap', description: 'Network mapper — port/service scan' },
      { id: 'masscan', description: 'Mass IP port scanner' },
      { id: 'rustscan', description: 'Fast Rust port scanner' },
      { id: 'subfinder', description: 'Passive subdomain discovery' },
      { id: 'amass', description: 'Attack surface mapper' },
      { id: 'theHarvester', description: 'Email, subdomain & name harvesting' },
      { id: 'dnsenum', description: 'DNS enumeration' },
      { id: 'dnsrecon', description: 'DNS reconnaissance' },
      { id: 'whois', description: 'WHOIS domain lookup' },
      { id: 'dig', description: 'DNS query utility' },
      { id: 'host', description: 'DNS lookup utility' },
      { id: 'traceroute', description: 'Network path tracing' },
    ],
  },
  {
    key: 'http',
    label: 'HTTP Probing',
    icon: Network,
    color: 'var(--grok-scan-cyan)',
    tools: [
      { id: 'httpx', description: 'HTTP probing & tech detection' },
      { id: 'httprobe', description: 'HTTP/HTTPS probe' },
      { id: 'curl', description: 'HTTP request tool' },
      { id: 'whatweb', description: 'Web technology fingerprinting' },
      { id: 'nikto', description: 'Web server scanner' },
      { id: 'wafw00f', description: 'WAF detection' },
      { id: 'shcheck', description: 'Security header checker' },
      { id: 'aquatone', description: 'Visual recon & screenshotting' },
    ],
  },
  {
    key: 'web_exploit',
    label: 'Web Exploitation',
    icon: Crosshair,
    color: 'var(--grok-exploit-red)',
    tools: [
      { id: 'sqlmap', description: 'SQL injection & database takeover' },
      { id: 'xsstrike', description: 'XSS detection & exploitation' },
      { id: 'commix', description: 'Command injection exploitation' },
      { id: 'arjun', description: 'HTTP parameter discovery' },
      { id: 'jwt_tool.py', description: 'JWT token analysis & attacks' },
      { id: 'wpscan', description: 'WordPress vulnerability scanner' },
    ],
  },
  {
    key: 'dirbusting',
    label: 'Directory / File Busting',
    icon: Terminal,
    color: 'var(--grok-warning)',
    tools: [
      { id: 'ffuf', description: 'Fast web fuzzer' },
      { id: 'gobuster', description: 'Directory/DNS/VHost brute-forcer' },
      { id: 'feroxbuster', description: 'Recursive content discovery' },
      { id: 'waybackurls', description: 'Wayback Machine URL extraction' },
      { id: 'gau', description: 'Get All URLs from AlienVault/Wayback' },
    ],
  },
  {
    key: 'vuln',
    label: 'Vulnerability Scanning',
    icon: Shield,
    color: 'var(--grok-crit-red)',
    tools: [
      { id: 'nuclei', description: 'Template-based vulnerability scanner' },
      { id: 'vulnapi', description: 'API endpoint vulnerability scanner' },
      { id: 'enum4linux-ng', description: 'SMB/LDAP/RPC enumeration' },
    ],
  },
  {
    key: 'network_enum',
    label: 'Network Enumeration',
    icon: Network,
    color: 'var(--grok-info)',
    tools: [
      { id: 'smbmap', description: 'SMB share enumeration' },
      { id: 'rpcclient', description: 'RPC enumeration' },
      { id: 'ldapsearch', description: 'LDAP directory queries' },
      { id: 'snmpwalk', description: 'SNMP OID tree walking' },
      { id: 'onesixtyone', description: 'Fast SNMP community scanner' },
    ],
  },
  {
    key: 'credentials',
    label: 'Credentials & Brute Force',
    icon: Key,
    color: 'var(--grok-loot-green)',
    tools: [
      { id: 'hydra', description: 'Network service brute-forcer' },
      { id: 'smtp-user-enum', description: 'SMTP user enumeration' },
    ],
  },
  {
    key: 'ssl',
    label: 'SSL / TLS Testing',
    icon: Lock,
    color: 'var(--grok-ai-purple)',
    tools: [
      { id: 'testssl', description: 'Comprehensive SSL/TLS analysis' },
      { id: 'sslscan', description: 'SSL cipher & cert scanner' },
      { id: 'sslyze', description: 'SSL configuration analyzer' },
    ],
  },
  {
    key: 'password',
    label: 'Password Cracking',
    icon: Lock,
    color: 'var(--grok-error)',
    tools: [
      { id: 'hashcat', description: 'GPU-accelerated hash cracker' },
      { id: 'john', description: 'John the Ripper password cracker' },
      { id: 'cewl', description: 'Custom wordlist generator' },
      { id: 'hashid', description: 'Hash type identification' },
    ],
  },
  {
    key: 'osint',
    label: 'OSINT',
    icon: Eye,
    color: 'var(--grok-scan-cyan)',
    tools: [
      { id: 'shodan', description: 'Internet-connected device search' },
      { id: 'sherlock', description: 'Username reconnaissance across sites' },
    ],
  },
  {
    key: 'impacket',
    label: 'Impacket (Post-Exploit)',
    icon: Terminal,
    color: 'var(--grok-exploit-red)',
    tools: [
      { id: 'impacket-secretsdump', description: 'SAM/LSA/NTDS credential dump' },
      { id: 'impacket-psexec', description: 'Remote command execution (SMB)' },
      { id: 'impacket-wmiexec', description: 'WMI-based remote execution' },
      { id: 'impacket-smbexec', description: 'SMB-based remote execution' },
      { id: 'impacket-GetUserSPNs', description: 'Kerberoasting — SPN enumeration' },
    ],
  },
  {
    key: 'post_exploit',
    label: 'Lateral Movement & Tunneling',
    icon: Network,
    color: 'var(--grok-warning)',
    tools: [
      { id: 'chisel', description: 'TCP/UDP tunnel over HTTP' },
      { id: 'responder', description: 'LLMNR/NBT-NS/MDNS poisoner' },
      { id: 'bloodhound-python', description: 'Active Directory graph mapping' },
      { id: 'proxychains4', description: 'Proxy chain for pivoting' },
    ],
  },
  {
    key: 'cloud',
    label: 'Cloud & Container',
    icon: Cloud,
    color: 'var(--grok-info)',
    tools: [
      { id: 'trivy', description: 'Container & IaC vulnerability scanner' },
      { id: 'kube-hunter', description: 'Kubernetes penetration testing' },
      { id: 'gowitness', description: 'Web screenshot utility' },
      { id: 'eyewitness', description: 'Web app screenshot & header analysis' },
    ],
  },
  {
    key: 'services',
    label: 'Service Daemons',
    icon: Settings,
    color: 'var(--grok-text-muted)',
    tools: [
      { id: 'msfconsole', description: 'Metasploit Framework console' },
      { id: 'msfrpcd', description: 'Metasploit RPC daemon' },
      { id: 'zap.sh', description: 'OWASP ZAP daemon' },
      { id: 'burpsuite', description: 'Burp Suite scanner' },
    ],
  },
];

// ── AI Provider Options ─────────────────────────────────────────────────────

const AI_PROVIDERS = [
  { id: 'ollama', label: 'Ollama (Local)', defaultModel: 'qwen3' },
  { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-5.2' },
  { id: 'anthropic', label: 'Anthropic (Claude)', defaultModel: 'claude-sonnet-4-6' },
  { id: 'grok', label: 'xAI (Grok)', defaultModel: 'grok-3' },
];

// ── VPN Provider Metadata ────────────────────────────────────────────────────

interface VpnProviderInfo {
  id: VpnProvider;
  label: string;
  description: string;
  defaultInterface: string;
}

const VPN_PROVIDERS: VpnProviderInfo[] = [
  { id: 'tailscale',  label: 'Tailscale',  description: 'Mesh VPN via tailscale up',        defaultInterface: 'tailscale0' },
  { id: 'wireguard',  label: 'WireGuard',  description: 'Kernel WireGuard (wg-quick)',       defaultInterface: 'wg0' },
  { id: 'nordvpn',    label: 'NordVPN',    description: 'nordvpn CLI (nordlynx)',             defaultInterface: 'nordlynx' },
  { id: 'mullvad',    label: 'Mullvad',    description: 'mullvad CLI daemon',                defaultInterface: 'wg-mullvad' },
  { id: 'openvpn',    label: 'OpenVPN',    description: 'openvpn --daemon (tun0)',            defaultInterface: 'tun0' },
];

// ── Component ───────────────────────────────────────────────────────────────

export function ConfigurationView() {
  const [config, setConfig] = useState<Config>({
    openai_api_key: '',
    ai_provider: 'openai',
    allow_exploitation: false,
    scan_modes: ['port', 'http', 'dns'],
    allowed_tools: ['nmap', 'subfinder', 'httpx'],
    max_threads: 10,
    max_runtime: 3600,
    msf_username: 'msf',
    msf_password: '',
    msf_host: 'localhost',
    msf_port: 55552,
    zap_host: 'localhost',
    zap_port: 8090,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['recon', 'http']));
  const [scopeInput, setScopeInput] = useState('');
  const { addToast } = useUIStore();

  // ── VPN state ─────────────────────────────────────────────────────────────
  const { vpnConnections, setVpnConnections } = useSystemStore();
  const [vpnLoading, setVpnLoading] = useState(false);
  const [vpnActionLoading, setVpnActionLoading] = useState<Record<string, boolean>>({});
  const [splitRouting, setSplitRouting] = useState(false);

  // ── AI Provider test state ──────────────────────────────────────────────────
  const [aiTestResult, setAiTestResult] = useState<{
    tested: boolean;
    testing: boolean;
    reachable: boolean;
    error?: string;
    provider?: string;
    model?: string;
  }>({ tested: false, testing: false, reachable: false });

  const handleTestAI = useCallback(async () => {
    setAiTestResult((prev) => ({ ...prev, testing: true }));
    try {
      const result = await apiService.testAIProvider();
      setAiTestResult({
        tested: true,
        testing: false,
        reachable: result.reachable,
        error: result.error,
        provider: result.provider,
        model: result.model,
      });
      addToast({
        type: result.reachable ? 'success' : 'error',
        message: result.reachable
          ? `${result.provider} / ${result.model} — connected`
          : `${result.provider} — ${result.error || 'not reachable'}`,
        duration: 4000,
      });
    } catch {
      setAiTestResult((prev) => ({ ...prev, testing: false, tested: true, reachable: false, error: 'API unreachable' }));
      addToast({ type: 'error', message: 'AI provider test failed — API unreachable', duration: 4000 });
    }
  }, [addToast]);

  useEffect(() => {
    loadConfig();
    loadVpnStatus();
  }, []); // eslint-disable-line

  const loadConfig = async () => {
    setIsLoading(true);
    try {
      const data = await apiService.getConfig();
      setConfig((prev) => ({
        ...prev,
        ...data,
        scan_modes: Array.isArray(data.scan_modes) ? data.scan_modes : prev.scan_modes,
        allowed_tools: Array.isArray(data.allowed_tools) ? data.allowed_tools : prev.allowed_tools,
        target_scope: Array.isArray(data.target_scope) ? data.target_scope : prev.target_scope || [],
      }));
    } catch {
      addToast({ type: 'error', message: 'Failed to load configuration' });
    } finally {
      setIsLoading(false);
    }
  };

  const loadVpnStatus = async () => {
    setVpnLoading(true);
    try {
      const connections = await apiService.getVpnConnections();
      setVpnConnections(connections);
    } catch {
      addToast({ type: 'error', message: 'Failed to load VPN status' });
    } finally {
      setVpnLoading(false);
    }
  };

  const handleVpnConnect = async (provider: VpnProvider) => {
    setVpnActionLoading((prev) => ({ ...prev, [provider]: true }));
    try {
      await apiService.connectVpn(provider);
      addToast({ type: 'success', message: `${provider} connecting...` });
      // Refresh after a short delay to let the backend state settle
      setTimeout(loadVpnStatus, 2000);
    } catch {
      addToast({ type: 'error', message: `Failed to connect ${provider}` });
    } finally {
      setVpnActionLoading((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const handleVpnDisconnect = async (provider: VpnProvider) => {
    setVpnActionLoading((prev) => ({ ...prev, [provider]: true }));
    try {
      await apiService.disconnectVpn(provider);
      addToast({ type: 'success', message: `${provider} disconnected` });
      setTimeout(loadVpnStatus, 1000);
    } catch {
      addToast({ type: 'error', message: `Failed to disconnect ${provider}` });
    } finally {
      setVpnActionLoading((prev) => ({ ...prev, [provider]: false }));
    }
  };

  // Build a quick-lookup map from the store connections
  const vpnStatusMap = new Map<VpnProvider, VpnConnection>(
    vpnConnections.map((c) => [c.provider, c]),
  );

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await apiService.updateConfig(config);
      addToast({ type: 'success', message: 'Configuration saved' });
    } catch {
      addToast({ type: 'error', message: 'Failed to save configuration' });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleScanMode = (mode: string) => {
    setConfig((prev) => ({
      ...prev,
      scan_modes: prev.scan_modes.includes(mode)
        ? prev.scan_modes.filter((m) => m !== mode)
        : [...prev.scan_modes, mode],
    }));
  };

  const toggleTool = (tool: string) => {
    setConfig((prev) => ({
      ...prev,
      allowed_tools: prev.allowed_tools.includes(tool)
        ? prev.allowed_tools.filter((t) => t !== tool)
        : [...prev.allowed_tools, tool],
    }));
  };

  const toggleCategory = (key: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllInCategory = useCallback(
    (cat: ToolCategory) => {
      setConfig((prev) => {
        const catToolIds = cat.tools.map((t) => t.id);
        const allSelected = catToolIds.every((id) => prev.allowed_tools.includes(id));
        if (allSelected) {
          return { ...prev, allowed_tools: prev.allowed_tools.filter((t) => !catToolIds.includes(t)) };
        } else {
          const merged = new Set([...prev.allowed_tools, ...catToolIds]);
          return { ...prev, allowed_tools: Array.from(merged) };
        }
      });
    },
    [],
  );

  const addScopeTarget = () => {
    const target = scopeInput.trim();
    if (!target) return;
    setConfig((prev) => ({
      ...prev,
      target_scope: [...(prev.target_scope || []), target],
    }));
    setScopeInput('');
  };

  const removeScopeTarget = (index: number) => {
    setConfig((prev) => ({
      ...prev,
      target_scope: (prev.target_scope || []).filter((_, i) => i !== index),
    }));
  };

  const selectedProvider = AI_PROVIDERS.find((p) => p.id === config.ai_provider) || AI_PROVIDERS[0];
  const totalTools = TOOL_CATEGORIES.reduce((sum, cat) => sum + cat.tools.length, 0);
  const enabledTools = (config.allowed_tools || []).length;
  const enabledModes = (config.scan_modes || []).length;

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-[var(--grok-recon-blue)] animate-spin mx-auto mb-2" />
          <p className="text-xs text-[var(--grok-text-muted)]">Loading configuration...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-5 space-y-5">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[var(--grok-text-heading)] flex items-center gap-2">
            <Settings className="w-5 h-5 text-[var(--grok-scan-cyan)]" />
            Configuration
          </h1>
          <p className="text-[10px] text-[var(--grok-text-muted)] mt-0.5 font-mono">
            {enabledTools}/{totalTools} tools &middot; {enabledModes}/{SCAN_MODES.length} modes &middot; AI: {selectedProvider.label}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadConfig} disabled={isLoading} className="cs-btn flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            Reload
          </button>
          <button onClick={handleSave} disabled={isSaving} className="cs-btn cs-btn-primary flex items-center gap-1.5">
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
      </div>

      {/* ── AI Provider ────────────────────────────────────────── */}
      <SectionPanel title="AI Provider" icon={<Brain className="w-4 h-4 text-[var(--grok-ai-purple)]" />}>
        <div className="space-y-4">
          {/* Provider selector */}
          <div>
            <label className="text-xs text-[var(--grok-text-muted)] block mb-1.5">Provider</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {AI_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() =>
                    setConfig((prev) => ({ ...prev, ai_provider: p.id }))
                  }
                  className={`text-xs font-mono px-3 py-2 rounded border transition-all ${
                    config.ai_provider === p.id
                      ? 'border-[var(--grok-ai-purple)] bg-[var(--grok-ai-purple)]/10 text-[var(--grok-ai-purple)]'
                      : 'border-[var(--grok-border)] bg-[var(--grok-surface-2)] text-[var(--grok-text-body)] hover:border-[var(--grok-border-glow)]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Provider-specific fields */}
          {config.ai_provider === 'ollama' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ConfigInput
                label="Ollama Host"
                value={config.ollama_url || 'http://localhost:11434'}
                onChange={(v) => setConfig({ ...config, ollama_url: v })}
                placeholder="http://localhost:11434"
              />
              <ConfigInput
                label="Model"
                value={config.ollama_model || 'qwen3'}
                onChange={(v) => setConfig({ ...config, ollama_model: v })}
                placeholder="qwen3"
              />
            </div>
          )}
          {config.ai_provider === 'openai' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ConfigInput
                label="OpenAI API Key"
                type="password"
                value={config.openai_api_key}
                onChange={(v) => setConfig({ ...config, openai_api_key: v })}
                placeholder="sk-..."
              />
              <ConfigInput
                label="Model"
                value={config.openai_model || 'gpt-5.2'}
                onChange={(v) => setConfig({ ...config, openai_model: v })}
                placeholder="gpt-5.2"
              />
            </div>
          )}
          {config.ai_provider === 'anthropic' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ConfigInput
                label="Anthropic API Key"
                type="password"
                value={config.anthropic_api_key || ''}
                onChange={(v) => setConfig({ ...config, anthropic_api_key: v })}
                placeholder="sk-ant-..."
              />
              <ConfigInput
                label="Model"
                value={config.anthropic_model || 'claude-sonnet-4-6'}
                onChange={(v) => setConfig({ ...config, anthropic_model: v })}
                placeholder="claude-sonnet-4-6"
              />
            </div>
          )}
          {config.ai_provider === 'grok' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ConfigInput
                label="Grok API Key"
                type="password"
                value={config.grok_api_key || ''}
                onChange={(v) => setConfig({ ...config, grok_api_key: v })}
                placeholder="xai-..."
              />
              <ConfigInput
                label="Model"
                value={config.grok_model || 'grok-3'}
                onChange={(v) => setConfig({ ...config, grok_model: v })}
                placeholder="grok-3"
              />
            </div>
          )}

          {/* Test Connection */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleTestAI}
              disabled={aiTestResult.testing}
              className="cs-btn cs-btn-primary flex items-center gap-1.5"
            >
              {aiTestResult.testing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5" />
              )}
              Test Connection
            </button>
            {aiTestResult.tested && !aiTestResult.testing && (
              <div className="flex items-center gap-1.5">
                {aiTestResult.reachable ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-[var(--grok-success)]" />
                    <span className="text-xs font-mono text-[var(--grok-success)]">
                      Connected — {aiTestResult.provider} / {aiTestResult.model}
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 text-[var(--grok-error)]" />
                    <span className="text-xs font-mono text-[var(--grok-error)]">
                      {aiTestResult.error || 'Not reachable'}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* AI tuning */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <ConfigInput
              label="Max Iterations"
              type="number"
              value={config.ai_max_iterations ?? 15}
              onChange={(v) => setConfig({ ...config, ai_max_iterations: parseInt(v) || 15 })}
            />
            <ConfigInput
              label="Max Tokens"
              type="number"
              value={config.ai_max_tokens ?? 800}
              onChange={(v) => setConfig({ ...config, ai_max_tokens: parseInt(v) || 800 })}
            />
            <ConfigInput
              label="Temperature"
              type="number"
              value={config.ai_temperature ?? 0.3}
              onChange={(v) => setConfig({ ...config, ai_temperature: parseFloat(v) || 0.3 })}
              step="0.1"
            />
          </div>

          {/* MCP toggle */}
          <ToggleRow
            label="MCP Tool Calling"
            description="Enable Model Context Protocol for agentic tool use"
            checked={config.mcp_enabled ?? true}
            onChange={(v) => setConfig({ ...config, mcp_enabled: v })}
          />

          {/* AI Thinking toggle */}
          <ToggleRow
            label="AI Thinking Mode"
            description="Enable chain-of-thought reasoning (slower but more thorough analysis)"
            checked={config.ai_thinking ?? false}
            onChange={(v) => setConfig({ ...config, ai_thinking: v })}
          />
        </div>
      </SectionPanel>

      {/* ── Target Scope ───────────────────────────────────────── */}
      <SectionPanel title="Target Scope" icon={<Crosshair className="w-4 h-4 text-[var(--grok-exploit-red)]" />}>
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={scopeInput}
              onChange={(e) => setScopeInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addScopeTarget()}
              placeholder="example.com or 192.168.1.0/24"
              className="flex-1 px-3 py-1.5 text-xs font-mono bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded text-[var(--grok-text-body)] focus:border-[var(--grok-recon-blue)] focus:outline-none"
            />
            <button onClick={addScopeTarget} className="cs-btn cs-btn-success flex items-center gap-1 text-[10px]">
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
          {(config.target_scope || []).length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {(config.target_scope || []).map((t, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono bg-[var(--grok-surface-3)] border border-[var(--grok-border)] rounded text-[var(--grok-text-body)]"
                >
                  {t}
                  <button onClick={() => removeScopeTarget(i)} className="text-[var(--grok-text-muted)] hover:text-[var(--grok-error)]">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-[var(--grok-text-muted)]">No targets in scope. Add targets above.</p>
          )}
        </div>
      </SectionPanel>

      {/* ── Scan Modes ─────────────────────────────────────────── */}
      <SectionPanel
        title="Scan Modes"
        icon={<Shield className="w-4 h-4 text-[var(--grok-recon-blue)]" />}
        badge={`${enabledModes}/${SCAN_MODES.length}`}
      >
        <div className="space-y-4">
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setConfig((prev) => ({ ...prev, scan_modes: SCAN_MODES.map((m) => m.id) }))}
              className="text-[10px] font-mono px-2 py-1 rounded border border-[var(--grok-border)] text-[var(--grok-text-muted)] hover:text-[var(--grok-recon-blue)] hover:border-[var(--grok-recon-blue)]/40 transition-colors"
            >
              Enable All
            </button>
            <button
              onClick={() => setConfig((prev) => ({ ...prev, scan_modes: [] }))}
              className="text-[10px] font-mono px-2 py-1 rounded border border-[var(--grok-border)] text-[var(--grok-text-muted)] hover:text-[var(--grok-error)] hover:border-[var(--grok-error)]/40 transition-colors"
            >
              Disable All
            </button>
          </div>
          {SCAN_MODE_CATEGORIES.map((cat) => {
            const modes = SCAN_MODES.filter((m) => m.category === cat.key);
            return (
              <div key={cat.key}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)] mb-2">
                  {cat.label}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1.5">
                  {modes.map((mode) => (
                    <label
                      key={mode.id}
                      className={`flex items-start gap-2 px-2.5 py-2 rounded border cursor-pointer transition-all ${
                        config.scan_modes.includes(mode.id)
                          ? 'border-[var(--grok-recon-blue)]/40 bg-[var(--grok-recon-blue)]/5'
                          : 'border-[var(--grok-border)] bg-[var(--grok-surface-2)] hover:border-[var(--grok-border-glow)]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={config.scan_modes.includes(mode.id)}
                        onChange={() => toggleScanMode(mode.id)}
                        className="mt-0.5 rounded border-[var(--grok-border)] bg-[var(--grok-surface-2)]"
                      />
                      <div>
                        <span className="text-xs font-medium text-[var(--grok-text-heading)] block">{mode.label}</span>
                        <span className="text-[9px] text-[var(--grok-text-muted)]">{mode.description}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}

          <ToggleRow
            label="Allow Exploitation"
            description="Enable AI to run active exploitation tools and attacks"
            checked={config.allow_exploitation}
            onChange={(v) => setConfig({ ...config, allow_exploitation: v })}
            danger
          />
        </div>
      </SectionPanel>

      {/* ── Tools (collapsible categories) ─────────────────────── */}
      <SectionPanel
        title="Allowed Tools"
        icon={<Terminal className="w-4 h-4 text-[var(--grok-loot-green)]" />}
        badge={`${enabledTools}/${totalTools}`}
      >
        <div className="space-y-1">
          <div className="flex gap-2 justify-end mb-2">
            <button
              onClick={() => setConfig((prev) => ({ ...prev, allowed_tools: TOOL_CATEGORIES.flatMap((c) => c.tools.map((t) => t.id)) }))}
              className="text-[10px] font-mono px-2 py-1 rounded border border-[var(--grok-border)] text-[var(--grok-text-muted)] hover:text-[var(--grok-loot-green)] hover:border-[var(--grok-loot-green)]/40 transition-colors"
            >
              Enable All
            </button>
            <button
              onClick={() => setConfig((prev) => ({ ...prev, allowed_tools: [] }))}
              className="text-[10px] font-mono px-2 py-1 rounded border border-[var(--grok-border)] text-[var(--grok-text-muted)] hover:text-[var(--grok-error)] hover:border-[var(--grok-error)]/40 transition-colors"
            >
              Disable All
            </button>
          </div>
          {TOOL_CATEGORIES.map((cat) => {
            const expanded = expandedCategories.has(cat.key);
            const catToolIds = cat.tools.map((t) => t.id);
            const enabledInCat = catToolIds.filter((id) => config.allowed_tools.includes(id)).length;
            const CatIcon = cat.icon;

            return (
              <div key={cat.key} className="border border-[var(--grok-border)] rounded overflow-hidden">
                {/* Category header */}
                <button
                  onClick={() => toggleCategory(cat.key)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-[var(--grok-surface-2)] hover:bg-[var(--grok-hover)] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {expanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-[var(--grok-text-muted)]" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-[var(--grok-text-muted)]" />
                    )}
                    <CatIcon className="w-3.5 h-3.5" style={{ color: cat.color }} />
                    <span className="text-xs font-semibold text-[var(--grok-text-heading)]">{cat.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-[var(--grok-text-muted)]">
                      {enabledInCat}/{cat.tools.length}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        selectAllInCategory(cat);
                      }}
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-[var(--grok-border)] text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] hover:border-[var(--grok-border-glow)]"
                    >
                      {enabledInCat === cat.tools.length ? 'None' : 'All'}
                    </button>
                  </div>
                </button>

                {/* Tools grid */}
                {expanded && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1 p-2 bg-[var(--grok-surface-1)]">
                    {cat.tools.map((tool) => (
                      <label
                        key={tool.id}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded cursor-pointer transition-all ${
                          config.allowed_tools.includes(tool.id)
                            ? 'bg-[var(--grok-surface-3)]'
                            : 'hover:bg-[var(--grok-surface-2)]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={config.allowed_tools.includes(tool.id)}
                          onChange={() => toggleTool(tool.id)}
                          className="rounded border-[var(--grok-border)] bg-[var(--grok-surface-2)]"
                        />
                        <div className="min-w-0">
                          <span className="text-xs font-mono font-medium text-[var(--grok-text-heading)] block truncate">
                            {tool.id}
                          </span>
                          <span className="text-[9px] text-[var(--grok-text-muted)] block truncate">
                            {tool.description}
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SectionPanel>

      {/* ── Execution Limits ───────────────────────────────────── */}
      <SectionPanel title="Execution Limits" icon={<Settings className="w-4 h-4 text-[var(--grok-text-muted)]" />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ConfigInput
            label="Max Threads"
            type="number"
            value={config.max_threads}
            onChange={(v) => setConfig({ ...config, max_threads: parseInt(v) || 10 })}
          />
          <ConfigInput
            label="Max Runtime (seconds)"
            type="number"
            value={config.max_runtime}
            onChange={(v) => setConfig({ ...config, max_runtime: parseInt(v) || 3600 })}
          />
        </div>
      </SectionPanel>

      {/* ── Metasploit RPC ─────────────────────────────────────── */}
      <SectionPanel title="Metasploit RPC" icon={<Terminal className="w-4 h-4 text-[var(--grok-exploit-red)]" />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ConfigInput label="Host" value={config.msf_host} onChange={(v) => setConfig({ ...config, msf_host: v })} placeholder="127.0.0.1" />
          <ConfigInput label="Port" type="number" value={config.msf_port} onChange={(v) => setConfig({ ...config, msf_port: parseInt(v) || 55552 })} />
          <ConfigInput label="Username" value={config.msf_username} onChange={(v) => setConfig({ ...config, msf_username: v })} placeholder="msf" />
          <ConfigInput label="Password" type="password" value={config.msf_password} onChange={(v) => setConfig({ ...config, msf_password: v })} />
        </div>
      </SectionPanel>

      {/* ── OWASP ZAP ──────────────────────────────────────────── */}
      <SectionPanel title="OWASP ZAP" icon={<Shield className="w-4 h-4 text-[var(--grok-scan-cyan)]" />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ConfigInput label="Host" value={config.zap_host} onChange={(v) => setConfig({ ...config, zap_host: v })} placeholder="127.0.0.1" />
          <ConfigInput label="Port" type="number" value={config.zap_port} onChange={(v) => setConfig({ ...config, zap_port: parseInt(v) || 8090 })} />
        </div>
      </SectionPanel>

      {/* ── VPN Management ─────────────────────────────────────── */}
      <SectionPanel
        title="VPN Management"
        icon={<Network className="w-4 h-4 text-[var(--grok-recon-blue)]" />}
        badge={
          vpnLoading
            ? 'loading...'
            : `${vpnConnections.filter((c) => c.status === 'connected').length}/${VPN_PROVIDERS.length} connected`
        }
      >
        <div className="space-y-3">
          {/* Split routing toggle */}
          <ToggleRow
            label="Split Routing"
            description="Route only tool traffic through VPN — keep management traffic on direct path (requires ip route / fwmark)"
            checked={splitRouting}
            onChange={setSplitRouting}
          />

          <div className="h-px bg-[var(--grok-border)]" />

          {/* Refresh button */}
          <div className="flex justify-end">
            <button
              onClick={loadVpnStatus}
              disabled={vpnLoading}
              className="cs-btn flex items-center gap-1.5"
            >
              {vpnLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Refresh
            </button>
          </div>

          {/* Provider rows */}
          <div className="space-y-2">
            {VPN_PROVIDERS.map((providerInfo) => {
              const conn = vpnStatusMap.get(providerInfo.id);
              const status = conn?.status ?? 'disconnected';
              const isActionLoading = vpnActionLoading[providerInfo.id] ?? false;
              const isConnected = status === 'connected';
              const isConnecting = status === 'connecting';

              return (
                <VpnProviderRow
                  key={providerInfo.id}
                  info={providerInfo}
                  connection={conn ?? null}
                  isActionLoading={isActionLoading}
                  isConnected={isConnected}
                  isConnecting={isConnecting}
                  onConnect={() => handleVpnConnect(providerInfo.id)}
                  onDisconnect={() => handleVpnDisconnect(providerInfo.id)}
                />
              );
            })}
          </div>
        </div>
      </SectionPanel>
    </div>
  );
}

/* ── Reusable Sub-Components ─────────────────────────────────────────────── */


function ConfigInput({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  step,
}: {
  label: string;
  type?: string;
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  step?: string;
}) {
  return (
    <div>
      <label className="text-[10px] text-[var(--grok-text-muted)] block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        step={step}
        className="w-full px-3 py-1.5 text-xs font-mono bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded text-[var(--grok-text-body)] focus:border-[var(--grok-recon-blue)] focus:outline-none"
      />
    </div>
  );
}

// ── VpnProviderRow ────────────────────────────────────────────────────────────

function VpnProviderRow({
  info,
  connection,
  isActionLoading,
  isConnected,
  isConnecting,
  onConnect,
  onDisconnect,
}: {
  info: VpnProviderInfo;
  connection: VpnConnection | null;
  isActionLoading: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const status = connection?.status ?? 'disconnected';
  const isError = status === 'error';

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded border transition-colors ${
        isConnected
          ? 'border-[var(--grok-recon-blue)]/40 bg-[var(--grok-recon-blue)]/5'
          : isError
            ? 'border-[var(--grok-error)]/40 bg-[var(--grok-error)]/5'
            : 'border-[var(--grok-border)] bg-[var(--grok-surface-2)]'
      }`}
    >
      {/* Status dot */}
      <VpnStatusDot status={status} />

      {/* Provider info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[var(--grok-text-heading)]">
            {info.label}
          </span>
          <span className="text-[9px] font-mono text-[var(--grok-text-muted)]">
            {info.defaultInterface}
          </span>
        </div>
        <p className="text-[9px] text-[var(--grok-text-muted)] truncate">{info.description}</p>
        {/* IP display when connected */}
        {isConnected && (connection?.assignedIp || connection?.publicIp) && (
          <p className="text-[9px] font-mono text-[var(--grok-recon-blue)] mt-0.5">
            {connection.assignedIp ?? connection.publicIp}
          </p>
        )}
      </div>

      {/* Status label */}
      <span
        className={`text-[9px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded ${
          isConnected
            ? 'text-[var(--grok-recon-blue)] bg-[var(--grok-recon-blue)]/10'
            : isConnecting
              ? 'text-[var(--grok-warning)] bg-[var(--grok-warning)]/10'
              : isError
                ? 'text-[var(--grok-error)] bg-[var(--grok-error)]/10'
                : 'text-[var(--grok-text-muted)] bg-[var(--grok-surface-3)]'
        }`}
      >
        {status}
      </span>

      {/* Action button */}
      <button
        onClick={isConnected ? onDisconnect : onConnect}
        disabled={isActionLoading || isConnecting}
        className={`flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          isConnected
            ? 'border-[var(--grok-error)]/50 text-[var(--grok-error)] hover:bg-[var(--grok-error)]/10'
            : 'border-[var(--grok-recon-blue)]/50 text-[var(--grok-recon-blue)] hover:bg-[var(--grok-recon-blue)]/10'
        }`}
      >
        {isActionLoading || isConnecting ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : isConnected ? (
          <WifiOff className="w-3 h-3" />
        ) : (
          <Wifi className="w-3 h-3" />
        )}
        {isConnected ? 'Disconnect' : 'Connect'}
      </button>
    </div>
  );
}

function VpnStatusDot({ status }: { status: string }) {
  if (status === 'connected') {
    return (
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--grok-recon-blue)] opacity-60" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--grok-recon-blue)]" />
      </span>
    );
  }
  if (status === 'connecting') {
    return (
      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--grok-warning)] animate-pulse" />
    );
  }
  if (status === 'error') {
    return (
      <AlertTriangle className="w-2.5 h-2.5 shrink-0 text-[var(--grok-error)]" />
    );
  }
  return (
    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--grok-surface-3)] border border-[var(--grok-border)]" />
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  danger,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  danger?: boolean;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-[var(--grok-surface-2)] transition-colors">
      <div
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
        className={`w-9 h-5 rounded-full relative transition-colors cursor-pointer ${
          checked
            ? danger
              ? 'bg-[var(--grok-exploit-red)]'
              : 'bg-[var(--grok-recon-blue)]'
            : 'bg-[var(--grok-surface-3)]'
        }`}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </div>
      <div>
        <p className="text-xs font-medium text-[var(--grok-text-heading)]">{label}</p>
        <p className="text-[9px] text-[var(--grok-text-muted)]">{description}</p>
      </div>
    </label>
  );
}
