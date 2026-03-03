/**
 * API Service - REST API client
 */

import axios, { type AxiosInstance, type AxiosError } from 'axios';
import type {
  Target,
  SystemMetrics,
  ServiceState,
  LootItem,
  LootCategory,
  CredentialPair,
  LogEntry,
  HeatmapResponse,
  Config,
  CompleteScanResults,
  VulnAPIFinding,
  VulnAPIScanResult,
  VpnConnection,
  VpnProvider,
} from '@/types';

class ApiService {
  private client: AxiosInstance;

  constructor() {
    // In development, use relative URL to go through Vite proxy
    // In production, use configured API URL
    let baseURL: string;
    if (import.meta.env.DEV) {
      // Development: use Vite's proxy (configured in vite.config.ts)
      baseURL = '/api/v1';
    } else {
      // Production: use configured API URL
      const apiUrl = import.meta.env.VITE_API_URL || '';
      baseURL = apiUrl ? `${apiUrl}/api/v1` : '/api/v1';
    }

    this.client = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        // Add auth token if available
        const token = localStorage.getItem('auth_token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        // Handle common errors
        if (error.response?.status === 401) {
          // Unauthorized - clear token
          localStorage.removeItem('auth_token');
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  // ============================================================================
  // System & Services
  // ============================================================================

  async getSystemMetrics(): Promise<SystemMetrics> {
    // Backend returns { success, data: {metrics, services}, timestamp }
    const { data } = await this.client.get('/status');
    return data.data?.metrics || data.metrics || {};
  }

  async getServiceStatus(): Promise<ServiceState> {
    // Backend returns { success, data: [...services], timestamp }
    const { data } = await this.client.get('/services');
    return data.data || data;
  }

  async startService(service: 'metasploit' | 'zap' | 'burp'): Promise<void> {
    // Backend expects POST /services/<service_name> with {action: 'start'}
    await this.client.post(`/services/${service}`, { action: 'start' });
  }

  async stopService(service: 'metasploit' | 'zap' | 'burp'): Promise<void> {
    // Backend expects POST /services/<service_name> with {action: 'stop'}
    await this.client.post(`/services/${service}`, { action: 'stop' });
  }

  async restartService(service: 'metasploit' | 'zap' | 'burp'): Promise<void> {
    await this.client.post(`/services/${service}/restart`);
  }

  async getAIProvider(): Promise<{ provider: string; model: string; status: string }> {
    const { data } = await this.client.get('/ai/provider');
    return data.data || data;
  }

  async testAIProvider(): Promise<{ provider: string; model: string; reachable: boolean; error?: string }> {
    const { data } = await this.client.post('/ai/provider/test');
    return data.data || data;
  }

  async switchAIProvider(provider: string, model?: string): Promise<void> {
    await this.client.put('/ai/provider', { provider, model });
  }

  async getMCPTools(): Promise<Array<{ name: string; description: string }>> {
    const { data } = await this.client.get('/mcp/tools');
    return data.tools || [];
  }

  async invokeMCPTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const { data } = await this.client.post(`/mcp/tools/${toolName}`, args);
    return data;
  }

  // ============================================================================
  // Reconnaissance
  // ============================================================================

  async addTarget(url: string): Promise<Target> {
    // Backend expects POST /targets with {url: "url"}
    const { data } = await this.client.post('/targets', { url });
    if (data.success) {
      const t = data.data || {};
      return {
        id: t.id || Date.now().toString(),
        url: t.url || url,
        status: 'pending',
        addedAt: t.createdAt ? new Date(t.createdAt).getTime() : Date.now(),
      };
    }
    throw new Error(data.error || 'Failed to add target');
  }

  async removeTarget(targetUrl: string): Promise<void> {
    // Backend expects DELETE /targets/<path:target_id>
    // Can accept either integer index or URL string
    await this.client.delete(`/targets/${encodeURIComponent(targetUrl)}`);
  }

  async startRecon(target: string, tools: string[]): Promise<{scan_id: string; status: string}> {
    // Backend expects POST /recon/start with {target, tools}
    const { data } = await this.client.post('/recon/start', { target, tools });
    if (!data.scan_id) {
      throw new Error('Failed to start reconnaissance');
    }
    return data;
  }

  async stopRecon(scanId: string): Promise<void> {
    // Backend expects DELETE /recon/scans/<scan_id>
    await this.client.delete(`/recon/scans/${scanId}`);
  }

  async getActiveScans(): Promise<{
    active_scans: Array<{
      scan_id: string;
      target: string;
      tools: string[];
      running_tools?: string[];
      started_at: string;
      status: string;
    }>;
    count: number;
  }> {
    // Backend: GET /recon/active — returns { success, data: [...scans], timestamp }
    const { data } = await this.client.get('/recon/active');
    const scans = data.data || data.active_scans || [];
    return { active_scans: scans, count: scans.length };
  }

  async startBatchRecon(targets: string[], tools: string[]): Promise<{
    status: string;
    scan_ids: string[];
    successful: number;
    total: number;
    failed?: Array<{ target: string; reason: string }>;
  }> {
    // Backend: POST /recon/batch with {targets, tools}
    const { data } = await this.client.post('/recon/batch', { targets, tools });
    return data;
  }

  // ============================================================================
  // Exploitation
  // ============================================================================

  async startExploitation(target: string, tools: string[] = ['nuclei', 'ffuf']): Promise<{exploit_id: string; status: string}> {
    // Backend: POST /exploit/start with {target, tools}
    const { data } = await this.client.post('/exploit/start', { target, tools });
    return data;
  }

  async startBruteforce(config: {
    target: string;
    service: string;
    port: number;
    wordlist: string;
  }): Promise<{exploit_id: string; status: string}> {
    // Backend: POST /exploit/bruteforce
    const { data } = await this.client.post('/exploit/bruteforce', config);
    return data;
  }

  async analyzeWithAI(target: string, phase: 'recon' | 'exploitation' = 'recon'): Promise<{status: string; message: string}> {
    // Backend: POST /ai/analyze with {target, phase}
    const { data } = await this.client.post('/ai/analyze', { target, phase });
    return data;
  }

  async getAIThoughts(): Promise<Array<{id: string; timestamp: number; thoughtType: string; content: string; command?: string; metadata?: Record<string, unknown>}>> {
    // Backend: GET /ai/thoughts — returns { success, data: [...thoughts], timestamp }
    const { data } = await this.client.get('/ai/thoughts');
    return data.data || data.thoughts || [];
  }

  async getScanStatus(scanId: string): Promise<{status: string; target?: string; results?: unknown; error?: string}> {
    // Backend: GET /recon/status/<scan_id>
    const { data } = await this.client.get(`/recon/status/${scanId}`);
    return data;
  }

  async getTargets(): Promise<string[]> {
    // Backend: GET /targets — returns { success, data: [...targets], timestamp }
    const { data } = await this.client.get('/targets');
    const targets = data.data || data.targets || [];
    return Array.isArray(targets) ? targets.map((t: any) => t.url || t.hostname || t) : [];
  }

  // ============================================================================
  // Status
  // ============================================================================

  async getStatus(): Promise<{
    metrics: SystemMetrics;
    services: ServiceState;
    phase: string;
    timestamp: string;
  }> {
    const { data } = await this.client.get('/status');
    return data.data || data;
  }

  // ============================================================================
  // Loot
  // ============================================================================

  async getLoot(target: string = 'all'): Promise<LootItem[]> {
    // Backend: GET /loot/<target>
    // Returns { success, data: { items: { username: [{id,value,source,...}], ... }, total } }
    const encodedTarget = encodeURIComponent(target);
    const { data } = await this.client.get(`/loot/${encodedTarget}`);

    const items: LootItem[] = [];
    const t = target === 'all' ? 'unknown' : target;

    // Parse the nested {category: [{id, value, source, metadata, timestamp}]} structure
    const byCategory = data.data?.items || data.items || {};
    for (const [category, categoryItems] of Object.entries(byCategory)) {
      for (const item of categoryItems as Array<{ id: string; value: string; source: string; timestamp: number }>) {
        items.push({
          id: item.id || `${category}-${items.length}`,
          category: category as LootCategory,
          value: item.value,
          source: item.source || 'unknown',
          target: t,
          timestamp: item.timestamp || Date.now(),
        });
      }
    }

    return items;
  }

  async getCredentials(target?: string): Promise<CredentialPair[]> {
    // Backend: GET /loot/credentials?target=<target>
    const params = target ? { target } : {};
    const { data } = await this.client.get('/loot/credentials', { params });
    return data.credentials || [];
  }

  async validateCredential(
    credentialId: string,
    target: string,
    username: string,
    password: string,
    service: string,
    port?: number
  ): Promise<{status: string; message: string; credential_id: string}> {
    // Backend: POST /loot/credentials/validate
    const { data } = await this.client.post('/loot/credentials/validate', {
      credential_id: credentialId,
      target,
      username,
      password,
      service,
      port,
    });
    return data;
  }

  async validateCredentialsBatch(
    credentials: Array<{
      credential_id: string;
      target: string;
      username: string;
      password: string;
      service: string;
      port?: number;
    }>
  ): Promise<{status: string; count: number; message: string}> {
    // Backend: POST /loot/credentials/validate/batch
    const { data } = await this.client.post('/loot/credentials/validate/batch', {
      credentials,
    });
    return data;
  }

  async getLootHeatmap(limit = 50, minScore = 0): Promise<HeatmapResponse> {
    // Backend: GET /loot/heatmap?limit=N&min_score=X
    const { data } = await this.client.get('/loot/heatmap', {
      params: { limit, min_score: minScore },
    });
    // Ensure response has expected shape (endpoint may not exist yet)
    if (!data || !Array.isArray(data.credentials)) {
      const inner = data?.data;
      if (inner && Array.isArray(inner.credentials)) {
        return inner;
      }
      return { credentials: [], count: 0, timestamp: new Date().toISOString() };
    }
    return data;
  }

  // ============================================================================
  // Logs
  // ============================================================================

  async getLogs(limit = 1000): Promise<LogEntry[]> {
    // Backend expects GET /logs?limit=N&level=LEVEL — returns { success, data: { items, total }, timestamp }
    const { data } = await this.client.get('/logs', {
      params: { limit },
    });
    // Transform backend logs to frontend format
    const logs = data.data?.items || data.logs || [];
    return logs.map((log: any) => ({
      id: log.id || `${Date.now()}-${Math.random()}`,
      timestamp: log.timestamp ? new Date(log.timestamp).getTime() : Date.now(),
      level: log.level || 'INFO',
      source: log.source || 'system',
      message: log.message || '',
    }));
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  async getConfig(): Promise<Config> {
    // Backend: GET /config — returns { success, data: {...config}, timestamp }
    const { data } = await this.client.get('/config');
    return data.data || data;
  }

  async updateConfig(config: Config): Promise<void> {
    // Backend: PUT /config
    await this.client.put('/config', config);
  }

  async setOperationMode(mode: string): Promise<void> {
    await this.client.put('/config', { operation_mode: mode });
  }

  async getOperationMode(): Promise<string> {
    const config = await this.getConfig();
    return (config as any).operation_mode ?? 'semi-auto';
  }

  // ============================================================================
  // VulnAPI
  // ============================================================================

  async startVulnAPIScan(params: {
    target: string;
    mode?: 'full' | 'curl' | 'openapi';
    url?: string;
    spec_url?: string;
    headers?: Record<string, string>;
    method?: string;
  }): Promise<{
    status: string;
    scan_id: string;
    target: string;
    mode: string;
    findings?: VulnAPIFinding[];
    total_findings?: number;
  }> {
    const { data } = await this.client.post('/vulnapi/scan', params);
    return data;
  }

  async getVulnAPIResults(target: string): Promise<VulnAPIScanResult> {
    const { data } = await this.client.get(`/vulnapi/results/${encodeURIComponent(target)}`);
    return data;
  }

  // ============================================================================
  // Results
  // ============================================================================

  async getResults(): Promise<Target[]> {
    // Backend: GET /results returns { success, data: { items: [...], total, hasMore } }
    // Each item is a scan result; we need to deduplicate into unique targets
    const { data } = await this.client.get('/results');
    const items = data.data?.items || [];

    // Group by target URL to build unique target list
    const targetMap = new Map<string, Target>();
    for (const item of items) {
      const url = String(item.target || '');
      if (!url) continue;
      if (!targetMap.has(url)) {
        targetMap.set(url, {
          id: item.scan_id || url,
          url,
          addedAt: item.timestamp || Date.now(),
          status: 'complete',
        });
      }
    }

    return Array.from(targetMap.values());
  }

  async getTargetResults(target: string): Promise<CompleteScanResults> {
    // Backend: GET /results/<target> returns { data: { results: {port_scan: [...], ...}, total } }
    const { data } = await this.client.get(`/results/${encodeURIComponent(target)}`);
    const grouped = data.data?.results || data.results || {};

    // Each result record has: { id, data: { tool, output, duration, exitCode }, severity, source, timestamp }
    // We need to parse the raw tool output into structured findings.

    const ports = parsePortResults(grouped.port_scan || [], target);
    const subdomains = parseSubdomainResults(grouped.subdomain || [], target);
    const httpEndpoints = parseHttpEndpoints(grouped.http_endpoint || []);
    const technologies = parseTechnologies(grouped.technology || []);
    const vulnerabilities = parseVulnerabilities(grouped.vulnerability || []);
    const toolsUsed = collectToolsUsed(grouped);

    return {
      scanId: '',
      target,
      startTime: Date.now(),
      endTime: Date.now(),
      status: 'completed',
      toolsUsed,
      ports,
      subdomains,
      httpEndpoints,
      technologies,
      vulnerabilities,
      stats: {
        totalPorts: ports.length,
        openPorts: ports.filter(p => p.state === 'open').length,
        totalSubdomains: subdomains.length,
        aliveSubdomains: subdomains.length,
        totalEndpoints: httpEndpoints.length,
        totalVulnerabilities: vulnerabilities.length,
        criticalVulns: vulnerabilities.filter(v => v.severity === 'critical').length,
        highVulns: vulnerabilities.filter(v => v.severity === 'high').length,
        mediumVulns: vulnerabilities.filter(v => v.severity === 'medium').length,
        lowVulns: vulnerabilities.filter(v => v.severity === 'low').length,
      },
    } as unknown as CompleteScanResults;
  }

  async downloadResults(target: string, format: 'json' | 'markdown'): Promise<Blob> {
    // Backend: GET /results/<target>/download?format=json|markdown
    const { data } = await this.client.get(`/results/${encodeURIComponent(target)}/download`, {
      params: { format },
      responseType: 'blob',
    });
    return data;
  }

  // ============================================================================
  // VPN
  // ============================================================================

  async getVpnConnections(): Promise<VpnConnection[]> {
    // Backend: GET /vpn — returns {success, data: VpnConnection[], timestamp}
    const { data } = await this.client.get('/vpn');
    return (data.data || []).map((c: Record<string, unknown>) => ({
      provider: c.provider as VpnProvider,
      interface: c.interface as string,
      status: (c.status as string) as VpnConnection['status'],
      publicIp: (c.publicIp as string | null) ?? null,
      assignedIp: (c.assignedIp as string | null) ?? null,
      server: (c.server as string | null) ?? null,
      connectedAt: (c.connectedAt as number | null) ?? null,
    }));
  }

  async connectVpn(
    provider: VpnProvider,
    opts: { server?: string; config?: string } = {},
  ): Promise<{ provider: VpnProvider; status: string; assignedIp: string | null }> {
    // Backend: POST /vpn/:provider/connect  body: {server?, config?}
    const { data } = await this.client.post(`/vpn/${provider}/connect`, opts);
    return data.data;
  }

  async disconnectVpn(
    provider: VpnProvider,
  ): Promise<{ provider: VpnProvider; status: string }> {
    // Backend: POST /vpn/:provider/disconnect
    const { data } = await this.client.post(`/vpn/${provider}/disconnect`);
    return data.data;
  }

  // ============================================================================
  // Exploit Cases
  // ============================================================================

  async getCases(): Promise<any[]> {
    const { data } = await this.client.get('/cases');
    return data.data || [];
  }

  async createCase(name: string, targetId: string, campaignId?: string): Promise<any> {
    const { data } = await this.client.post('/cases', { name, targetId, campaignId });
    return data.data;
  }

  async getCase(caseId: string): Promise<any> {
    const { data } = await this.client.get(`/cases/${caseId}`);
    return data.data;
  }

  async updateCase(caseId: string, updates: Record<string, unknown>): Promise<any> {
    const { data } = await this.client.put(`/cases/${caseId}`, updates);
    return data.data;
  }

  async deleteCase(caseId: string): Promise<void> {
    await this.client.delete(`/cases/${caseId}`);
  }

  async approveGate(caseId: string): Promise<any> {
    const { data } = await this.client.post(`/cases/${caseId}/approve`);
    return data.data;
  }

  async createCaseTask(caseId: string, tool: string, config?: Record<string, unknown>): Promise<any> {
    const { data } = await this.client.post(`/cases/${caseId}/tasks`, { tool, config });
    return data.data;
  }

  async cancelCaseTask(caseId: string, taskId: string): Promise<void> {
    await this.client.delete(`/cases/${caseId}/tasks/${taskId}`);
  }

  async reanalyzeCase(caseId: string): Promise<any> {
    const { data } = await this.client.post(`/cases/${caseId}/analyze`);
    return data.data;
  }

  // ============================================================================
  // Campaigns
  // ============================================================================

  async getCampaigns(): Promise<any[]> {
    const { data } = await this.client.get('/campaigns');
    return data.data || [];
  }

  async createCampaign(name: string, description?: string, color?: string): Promise<any> {
    const { data } = await this.client.post('/campaigns', { name, description, color });
    return data.data;
  }

  // ============================================================================
  // Wordlists
  // ============================================================================

  async getWordlists(): Promise<any[]> {
    const { data } = await this.client.get('/wordlists');
    return data.data || [];
  }

  async scanWordlists(): Promise<any> {
    const { data } = await this.client.post('/wordlists/scan');
    return data.data;
  }

  // ============================================================================
  // Targets (extended)
  // ============================================================================

  async getTargetsWithDetails(): Promise<any[]> {
    const { data } = await this.client.get('/targets');
    return data.data || [];
  }

  // ============================================================================
  // Command Execution (Terminal)
  // ============================================================================

  async executeCommand(command: string): Promise<any> {
    // Backend: POST /terminal/execute  body: {command}
    const { data } = await this.client.post('/terminal/execute', { command }, { timeout: 120000 });
    return data.data || data;
  }

  // ============================================================================
  // Terminal Sessions
  // ============================================================================

  async executeTerminalCommand(command: string, sessionId?: string): Promise<{ output: string; exitCode: number; sessionId: string }> {
    const body: Record<string, unknown> = { command };
    if (sessionId) body.sessionId = sessionId;
    const { data } = await this.client.post('/terminal/execute', body, { timeout: 120000 });
    return data.data || data;
  }

  async createTerminalSession(params: {
    type?: 'local' | 'ssh' | 'reverse_shell' | 'bind_shell';
    host?: string;
    port?: number;
    user?: string;
    target?: string;
  }): Promise<any> {
    const { data } = await this.client.post('/terminal/sessions', params, { timeout: 30000 });
    return data.data || data;
  }

  async getTerminalSessions(): Promise<any[]> {
    const { data } = await this.client.get('/terminal/sessions');
    return data.data || [];
  }

  async closeTerminalSession(sessionId: string): Promise<void> {
    await this.client.delete(`/terminal/sessions/${sessionId}`);
  }

  async executeInSession(sessionId: string, command: string): Promise<{ output: string; exitCode: number; sessionId: string }> {
    const { data } = await this.client.post(
      `/terminal/sessions/${sessionId}/execute`,
      { command },
      { timeout: 120000 },
    );
    return data.data || data;
  }

  async getSessionOutput(sessionId: string): Promise<{ lines: string[]; active: boolean }> {
    const { data } = await this.client.get(`/terminal/sessions/${sessionId}/output`);
    return data.data || { lines: [], active: false };
  }
}

// ============================================================================
// Raw output parsers — extract structured data from tool CLI output
// ============================================================================

type RawResult = { id?: string; data?: { tool?: string; output?: string; duration?: number; exitCode?: number } & Record<string, unknown>; severity?: string; source?: string; timestamp?: number };

/** Strip ANSI escape codes from raw tool output */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '');
}

function getRawOutput(r: RawResult): string {
  return stripAnsi(String(r.data?.output || ''));
}

function collectToolsUsed(grouped: Record<string, RawResult[]>): string[] {
  const tools = new Set<string>();
  for (const items of Object.values(grouped)) {
    for (const r of items) {
      if (r.source) tools.add(r.source);
      if (r.data?.tool) tools.add(r.data.tool);
    }
  }
  return Array.from(tools);
}

/** Parse nmap output into individual port entries (deduped by port/protocol) */
function parsePortResults(results: RawResult[], target = ''): Array<{ port: number; protocol: string; state: string; service: string; version: string; target: string; raw: string }> {
  const ports: Array<{ port: number; protocol: string; state: string; service: string; version: string; target: string; raw: string }> = [];
  const seen = new Set<string>();
  // nmap line format: "22/tcp  open  ssh  OpenSSH 9.2p1 ..."
  const portLineRe = /^(\d+)\/(tcp|udp)\s+(open|closed|filtered)\s+(\S+)\s*(.*)/;

  for (const r of results) {
    const output = getRawOutput(r);
    // If data has structured port/protocol, use directly
    if (r.data?.port && typeof r.data.port === 'number') {
      const key = `${r.data.port}/${r.data.protocol || 'tcp'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ports.push({
        port: Number(r.data.port),
        protocol: String(r.data.protocol || 'tcp'),
        state: String(r.data.state || 'open'),
        service: String(r.data.service || 'unknown'),
        version: String(r.data.version || ''),
        target,
        raw: output,
      });
      continue;
    }

    // Parse nmap text output
    for (const line of output.split('\n')) {
      const match = line.trim().match(portLineRe);
      if (match) {
        const key = `${match[1]}/${match[2]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        ports.push({
          port: parseInt(match[1], 10),
          protocol: match[2],
          state: match[3],
          service: match[4],
          version: match[5]?.trim() || '',
          target,
          raw: line.trim(),
        });
      }
    }
  }
  return ports;
}

/** Parse subdomain results — split multi-hostname output into individual entries */
function parseSubdomainResults(results: RawResult[], target = ''): Array<{ subdomain: string; target: string; source: string; discoveredAt: number }> {
  const subs: Array<{ subdomain: string; target: string; source: string; discoveredAt: number }> = [];
  const seen = new Set<string>();

  for (const r of results) {
    const output = getRawOutput(r);
    const source = r.source || r.data?.tool || 'unknown';
    const ts = r.timestamp || Date.now();

    // Split by whitespace or newlines — each token could be a subdomain
    const tokens = output.split(/[\s,]+/).filter(Boolean);
    for (const token of tokens) {
      const cleaned = token.trim().replace(/^\*\./, '');
      // Must look like a hostname (contains a dot, or is 'localhost')
      if ((cleaned.includes('.') || cleaned === 'localhost') && !seen.has(cleaned)) {
        seen.add(cleaned);
        subs.push({ subdomain: cleaned, target, source, discoveredAt: ts });
      }
    }
  }
  return subs;
}

/** Parse HTTP endpoint results from gobuster/httpx/ffuf output */
function parseHttpEndpoints(results: RawResult[]): Array<{ url: string; statusCode: number; title: string; contentLength: number; technologies: string[] }> {
  const endpoints: Array<{ url: string; statusCode: number; title: string; contentLength: number; technologies: string[] }> = [];
  const seen = new Set<string>();

  for (const r of results) {
    const output = getRawOutput(r);

    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('Error') || trimmed.startsWith('Usage')) continue;

      // gobuster format: "/path (Status: 200) [Size: 1234]"
      const gobusterMatch = trimmed.match(/^(\/\S+)\s+\(Status:\s*(\d+)\)(?:\s+\[Size:\s*(\d+)\])?/);
      if (gobusterMatch) {
        const url = gobusterMatch[1];
        if (!seen.has(url)) {
          seen.add(url);
          endpoints.push({ url, statusCode: parseInt(gobusterMatch[2], 10), title: '', contentLength: parseInt(gobusterMatch[3] || '0', 10), technologies: [] });
        }
        continue;
      }

      // httpx format: "http://target [200] [Title] [content-length]" or just URLs
      const httpxMatch = trimmed.match(/^(https?:\/\/\S+)\s+\[(\d+)\](?:\s+\[([^\]]*)\])?/);
      if (httpxMatch) {
        const url = httpxMatch[1];
        if (!seen.has(url)) {
          seen.add(url);
          endpoints.push({ url, statusCode: parseInt(httpxMatch[2], 10), title: httpxMatch[3] || '', contentLength: 0, technologies: [] });
        }
        continue;
      }

      // Plain URL lines
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        if (!seen.has(trimmed)) {
          seen.add(trimmed);
          endpoints.push({ url: trimmed, statusCode: 0, title: '', contentLength: 0, technologies: [] });
        }
      }
    }
  }
  return endpoints;
}

/** Parse technology detection output from whatweb */
function parseTechnologies(results: RawResult[]): Array<{ name: string; version: string; category: string; confidence: number }> {
  const techs: Array<{ name: string; version: string; category: string; confidence: number }> = [];
  const seen = new Set<string>();

  for (const r of results) {
    const output = getRawOutput(r);

    // whatweb format: "http://target [200 OK] Apache[2.4.66], PHP[8.2.29], ..."
    const bracketRe = /\b([A-Za-z][A-Za-z0-9_.+-]+)\[([^\]]*)\]/g;
    let match;
    while ((match = bracketRe.exec(output)) !== null) {
      const name = match[1];
      const version = match[2];
      if (!seen.has(name)) {
        seen.add(name);
        techs.push({ name, version, category: 'web', confidence: 100 });
      }
    }

    // Also parse lines like "Technology: Apache 2.4.66"
    for (const line of output.split('\n')) {
      const techMatch = line.match(/^(?:Technology|Server|Framework):\s*(.+)/i);
      if (techMatch && !seen.has(techMatch[1])) {
        seen.add(techMatch[1]);
        techs.push({ name: techMatch[1], version: '', category: 'web', confidence: 80 });
      }
    }
  }
  return techs;
}

/** Parse vulnerability results from nuclei output (deduped, matches VulnerabilityFinding interface) */
function parseVulnerabilities(results: RawResult[]): Array<{ id: string; title: string; severity: string; description: string; url: string; cve?: string; tool: string }> {
  const vulns: Array<{ id: string; title: string; severity: string; description: string; url: string; cve?: string; tool: string }> = [];
  const seen = new Set<string>();

  for (const r of results) {
    const output = getRawOutput(r);
    const tool = r.source || r.data?.tool || 'unknown';

    // nuclei output: "[template-id] [protocol] [severity] url [extra-info...]"
    // Process line-by-line to avoid /g crossing newline boundaries into next finding
    const nucleiRe = /^\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(https?:\/\/\S+)/;
    for (const line of output.split('\n')) {
      const match = line.trim().match(nucleiRe);
      if (!match) continue;
      const key = `${match[1]}:${match[4]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const cveMatch = match[1].match(/(CVE-\d{4}-\d+)/i);
      vulns.push({
        id: match[1],
        title: match[1].replace(/-/g, ' '),
        severity: match[3].toLowerCase(),
        description: `${match[1]} detected via ${match[2]}`,
        url: match[4],
        cve: cveMatch ? cveMatch[1] : undefined,
        tool,
      });
    }

    // If no nuclei matches, try to extract findings from other formats
    if (vulns.length === 0 && output.length > 0) {
      // Generic: if result has severity set at top level
      if (r.severity && r.severity !== 'info') {
        const key = `${r.id || 'unknown'}:${tool}`;
        if (!seen.has(key)) {
          seen.add(key);
          vulns.push({
            id: r.id || 'unknown',
            title: tool + ' finding',
            severity: r.severity,
            description: output.substring(0, 500),
            url: '',
            tool,
          });
        }
      }
    }
  }
  return vulns;
}

export const apiService = new ApiService();
