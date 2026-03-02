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
    return data;
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

  async getAIThoughts(): Promise<string[]> {
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

    // Map grouped backend results into CompleteScanResults shape
    return {
      scanId: '',
      target,
      startTime: Date.now(),
      endTime: Date.now(),
      status: 'completed',
      toolsUsed: [],
      ports: (grouped.port_scan || []).map((r: Record<string, unknown>) => {
        const d = r.data as Record<string, unknown> || {};
        return { port: Number(d.port || 0), protocol: String(d.protocol || 'tcp'), state: String(d.state || 'open'), service: String(d.service || 'unknown'), version: String(d.version || ''), raw: d.output || '' };
      }),
      subdomains: (grouped.subdomain || []).map((r: Record<string, unknown>) => {
        const d = r.data as Record<string, unknown> || {};
        return { subdomain: String(d.subdomain || d.value || d.output || ''), source: String(r.source || ''), alive: true, ip: '' };
      }),
      httpEndpoints: (grouped.http_endpoint || []).map((r: Record<string, unknown>) => {
        const d = r.data as Record<string, unknown> || {};
        return { url: String(d.url || d.output || ''), statusCode: Number(d.statusCode || 0), title: String(d.title || ''), contentLength: 0, technologies: [] };
      }),
      technologies: (grouped.technology || []).map((r: Record<string, unknown>) => {
        const d = r.data as Record<string, unknown> || {};
        return { name: String(d.name || d.output || ''), version: String(d.version || ''), categories: [] };
      }),
      vulnerabilities: (grouped.vulnerability || []).map((r: Record<string, unknown>) => {
        const d = r.data as Record<string, unknown> || {};
        return { id: String(r.id || ''), name: String(d.name || d.template || ''), severity: String(r.severity || d.severity || 'info'), description: String(d.description || d.output || ''), url: String(d.url || ''), reference: '', tool: String(r.source || '') };
      }),
      stats: {
        totalPorts: (grouped.port_scan || []).length,
        openPorts: (grouped.port_scan || []).length,
        totalSubdomains: (grouped.subdomain || []).length,
        aliveSubdomains: (grouped.subdomain || []).length,
        totalEndpoints: (grouped.http_endpoint || []).length,
        totalVulnerabilities: (grouped.vulnerability || []).length,
        criticalVulns: 0, highVulns: 0, mediumVulns: 0, lowVulns: 0,
      },
    } as CompleteScanResults;
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
}

export const apiService = new ApiService();
