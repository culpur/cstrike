/**
 * API Service - REST API client
 */

import axios, { type AxiosInstance, type AxiosError } from 'axios';
import type {
  Target,
  SystemMetrics,
  ServiceState,
  LootItem,
  CredentialPair,
  LogEntry,
  HeatmapResponse,
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
    // Backend returns {metrics, services, phase, timestamp}
    const { data } = await this.client.get('/status');
    return data.metrics;
  }

  async getServiceStatus(): Promise<ServiceState> {
    // Backend returns services object directly
    const { data } = await this.client.get('/services');
    return data;
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

  // ============================================================================
  // Reconnaissance
  // ============================================================================

  async addTarget(url: string): Promise<Target> {
    // Backend expects POST /targets with {target: "url"}
    const { data } = await this.client.post('/targets', { target: url });
    if (data.success) {
      // Return a Target object with the URL
      return {
        id: Date.now().toString(),
        url: data.target,
        status: 'pending',
        addedAt: Date.now(),
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
    // Backend: GET /recon/active
    const { data } = await this.client.get('/recon/active');
    return data;
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
    // Backend: GET /ai/thoughts
    const { data } = await this.client.get('/ai/thoughts');
    return data.thoughts || [];
  }

  async getScanStatus(scanId: string): Promise<{status: string; target?: string; results?: unknown; error?: string}> {
    // Backend: GET /recon/status/<scan_id>
    const { data } = await this.client.get(`/recon/status/${scanId}`);
    return data;
  }

  async getTargets(): Promise<string[]> {
    // Backend: GET /targets
    const { data } = await this.client.get('/targets');
    return data.targets || [];
  }

  // ============================================================================
  // Loot
  // ============================================================================

  async getLoot(target: string = 'all'): Promise<LootItem[]> {
    // Backend expects GET /loot/<target>
    // Returns {usernames, passwords, urls, ports} when no category specified
    const { data } = await this.client.get(`/loot/${target}`);

    // Convert backend format to LootItem array
    const items: LootItem[] = [];
    if (data.usernames) items.push(...data.usernames.map((u: string) => ({ type: 'username', value: u, timestamp: Date.now() })));
    if (data.passwords) items.push(...data.passwords.map((p: string) => ({ type: 'password', value: p, timestamp: Date.now() })));
    if (data.urls) items.push(...data.urls.map((url: string) => ({ type: 'url', value: url, timestamp: Date.now() })));
    if (data.ports) items.push(...data.ports.map((port: number) => ({ type: 'port', value: port.toString(), timestamp: Date.now() })));

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
    // Backend expects GET /logs?limit=N&level=LEVEL
    const { data } = await this.client.get('/logs', {
      params: { limit },
    });
    // Transform backend logs to frontend format
    const logs = data.logs || [];
    return logs.map((log: any) => ({
      id: log.id || `${Date.now()}-${Math.random()}`,
      timestamp: log.timestamp ? new Date(log.timestamp).getTime() : Date.now(),
      level: log.level || 'INFO',
      source: log.source || 'system',
      message: log.message || '',
    }));
  }
}

export const apiService = new ApiService();
