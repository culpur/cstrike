/**
 * API Service - REST API client
 */

import axios, { type AxiosInstance, type AxiosError } from 'axios';
import type {
  ApiResponse,
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
    this.client = axios.create({
      baseURL: '/api',
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
    const { data } = await this.client.get<ApiResponse<SystemMetrics>>('/system/metrics');
    if (!data.success || !data.data) {
      throw new Error(data.error || 'Failed to fetch system metrics');
    }
    return data.data;
  }

  async getServiceStatus(): Promise<ServiceState> {
    const { data } = await this.client.get<ApiResponse<ServiceState>>('/services/status');
    if (!data.success || !data.data) {
      throw new Error(data.error || 'Failed to fetch service status');
    }
    return data.data;
  }

  async startService(service: 'metasploit' | 'zap' | 'burp'): Promise<void> {
    const { data } = await this.client.post<ApiResponse>(`/services/${service}/start`);
    if (!data.success) {
      throw new Error(data.error || `Failed to start ${service}`);
    }
  }

  async stopService(service: 'metasploit' | 'zap' | 'burp'): Promise<void> {
    const { data } = await this.client.post<ApiResponse>(`/services/${service}/stop`);
    if (!data.success) {
      throw new Error(data.error || `Failed to stop ${service}`);
    }
  }

  // ============================================================================
  // Reconnaissance
  // ============================================================================

  async addTarget(url: string): Promise<Target> {
    const { data } = await this.client.post<ApiResponse<Target>>('/recon/targets', { url });
    if (!data.success || !data.data) {
      throw new Error(data.error || 'Failed to add target');
    }
    return data.data;
  }

  async removeTarget(id: string): Promise<void> {
    const { data } = await this.client.delete<ApiResponse>(`/recon/targets/${id}`);
    if (!data.success) {
      throw new Error(data.error || 'Failed to remove target');
    }
  }

  async startRecon(targetId: string, tools: string[]): Promise<void> {
    const { data } = await this.client.post<ApiResponse>('/recon/start', {
      targetId,
      tools,
    });
    if (!data.success) {
      throw new Error(data.error || 'Failed to start reconnaissance');
    }
  }

  async stopRecon(targetId: string): Promise<void> {
    const { data } = await this.client.post<ApiResponse>('/recon/stop', { targetId });
    if (!data.success) {
      throw new Error(data.error || 'Failed to stop reconnaissance');
    }
  }

  // ============================================================================
  // Exploitation
  // ============================================================================

  async startWebExploit(targetId: string, config: Record<string, unknown>): Promise<void> {
    const { data } = await this.client.post<ApiResponse>('/exploit/web/start', {
      targetId,
      config,
    });
    if (!data.success) {
      throw new Error(data.error || 'Failed to start web exploitation');
    }
  }

  async startBruteforce(config: Record<string, unknown>): Promise<void> {
    const { data } = await this.client.post<ApiResponse>('/exploit/bruteforce/start', config);
    if (!data.success) {
      throw new Error(data.error || 'Failed to start bruteforce');
    }
  }

  // ============================================================================
  // Loot
  // ============================================================================

  async getLoot(): Promise<LootItem[]> {
    const { data } = await this.client.get<ApiResponse<LootItem[]>>('/loot');
    if (!data.success || !data.data) {
      throw new Error(data.error || 'Failed to fetch loot');
    }
    return data.data;
  }

  async getCredentials(): Promise<CredentialPair[]> {
    const { data } = await this.client.get<ApiResponse<CredentialPair[]>>('/loot/credentials');
    if (!data.success || !data.data) {
      throw new Error(data.error || 'Failed to fetch credentials');
    }
    return data.data;
  }

  async validateCredential(id: string): Promise<boolean> {
    const { data } = await this.client.post<ApiResponse<{ valid: boolean }>>(
      `/loot/credentials/${id}/validate`
    );
    if (!data.success || !data.data) {
      throw new Error(data.error || 'Failed to validate credential');
    }
    return data.data.valid;
  }

  // ============================================================================
  // Logs
  // ============================================================================

  async getLogs(limit = 1000): Promise<LogEntry[]> {
    const { data } = await this.client.get<ApiResponse<LogEntry[]>>('/logs', {
      params: { limit },
    });
    if (!data.success || !data.data) {
      throw new Error(data.error || 'Failed to fetch logs');
    }
    return data.data;
  }
}

export const apiService = new ApiService();
