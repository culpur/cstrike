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

  async removeTarget(id: string): Promise<void> {
    // Backend expects DELETE /targets/<int:target_id>
    // ID is the index in the array, not a string ID
    await this.client.delete(`/targets/${id}`);
  }

  async startRecon(target: string, tools: string[]): Promise<{scan_id: string; status: string}> {
    // Backend expects POST /recon/start with {target, tools}
    const { data } = await this.client.post('/recon/start', { target, tools });
    if (!data.scan_id) {
      throw new Error('Failed to start reconnaissance');
    }
    return data;
  }

  async stopRecon(_targetId: string): Promise<void> {
    // TODO: Backend doesn't have a stop endpoint yet
    throw new Error('Stop reconnaissance not implemented in backend');
  }

  // ============================================================================
  // Exploitation
  // ============================================================================

  async startExploitation(target: string): Promise<{exploit_id: string; status: string}> {
    // Backend: POST /exploit/start with {target}
    const { data } = await this.client.post('/exploit/start', { target });
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

  async getCredentials(): Promise<CredentialPair[]> {
    // TODO: Backend doesn't have a dedicated credentials endpoint
    // Would need to combine usernames and passwords from /loot/<target>
    throw new Error('Get credentials not implemented in backend');
  }

  async validateCredential(_id: string): Promise<boolean> {
    // TODO: Backend doesn't have credential validation endpoint
    throw new Error('Credential validation not implemented in backend');
  }

  // ============================================================================
  // Logs
  // ============================================================================

  async getLogs(limit = 1000): Promise<LogEntry[]> {
    // Backend expects GET /logs?limit=N&level=LEVEL
    const { data } = await this.client.get('/logs', {
      params: { limit },
    });
    return data.logs || [];
  }
}

export const apiService = new ApiService();
