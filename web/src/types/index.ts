/**
 * CStrike Web UI - Core Type Definitions
 * Offensive Security Automation Framework
 */

// ============================================================================
// System & Status Types
// ============================================================================

export type PhaseType = 'recon' | 'ai' | 'zap' | 'metasploit' | 'exploit' | 'idle';

export type ServiceStatus = 'running' | 'stopped' | 'error' | 'starting' | 'stopping';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export interface SystemMetrics {
  cpu: number;
  memory: number;
  vpnIp: string | null;
  uptime: number;
  timestamp: number;
}

export interface ServiceState {
  metasploitRpc: ServiceStatus;
  zap: ServiceStatus;
  burp: ServiceStatus;
}

export interface PhaseProgress {
  currentPhase: PhaseType;
  reconComplete: boolean;
  aiAnalysisComplete: boolean;
  zapScanComplete: boolean;
  metasploitScanComplete: boolean;
  exploitationComplete: boolean;
}

// ============================================================================
// Target & Reconnaissance Types
// ============================================================================

export interface Target {
  id: string;
  url: string;
  ip?: string;
  addedAt: number;
  status: 'pending' | 'scanning' | 'complete' | 'failed';
}

export type ReconToolType =
  | 'nmap'
  | 'subfinder'
  | 'amass'
  | 'nikto'
  | 'httpx'
  | 'waybackurls'
  | 'gau'
  | 'dnsenum';

export interface ReconTool {
  name: ReconToolType;
  enabled: boolean;
  running: boolean;
  lastRun?: number;
}

export interface PortScanResult {
  port: number;
  protocol: 'tcp' | 'udp';
  state: 'open' | 'closed' | 'filtered';
  service?: string;
  version?: string;
  target: string;
}

export interface SubdomainResult {
  subdomain: string;
  target: string;
  source: string;
  discoveredAt: number;
}

export interface ReconOutput {
  tool: ReconToolType;
  target: string;
  output: string;
  timestamp: number;
  complete: boolean;
}

// ============================================================================
// AI Thought Stream Types
// ============================================================================

export interface AIThought {
  id: string;
  timestamp: number;
  thoughtType: 'reasoning' | 'command' | 'decision' | 'observation';
  content: string;
  command?: string;
  metadata?: Record<string, unknown>;
}

export interface AIDecision {
  id: string;
  timestamp: number;
  phase: PhaseType;
  decision: string;
  reasoning: string;
  confidence: number;
  executedCommand?: string;
}

// ============================================================================
// Exploitation Types
// ============================================================================

export type ExploitationType =
  | 'web'
  | 'network'
  | 'bruteforce'
  | 'credential-reuse'
  | 'service-specific';

export interface WebExploitConfig {
  nucleiEnabled: boolean;
  ffufEnabled: boolean;
  sqlmapEnabled: boolean;
  xssStrikeEnabled: boolean;
}

export interface BruteforceConfig {
  service: 'ssh' | 'ftp' | 'rdp' | 'smb' | 'http';
  target: string;
  username?: string;
  wordlist: 'rockyou' | 'fasttrack' | 'custom';
  customWordlistPath?: string;
}

export interface ExploitResult {
  id: string;
  type: ExploitationType;
  target: string;
  vulnerability: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  exploited: boolean;
  timestamp: number;
  details: string;
}

// ============================================================================
// Loot Types
// ============================================================================

export type LootCategory = 'username' | 'password' | 'hash' | 'url' | 'port' | 'credential' | 'file';

export interface LootItem {
  id: string;
  category: LootCategory;
  value: string;
  source: string;
  target: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface CredentialPair {
  id: string;
  username: string;
  password: string;
  source: string;
  target: string;
  validated: boolean;
  timestamp: number;
}

export interface LootStats {
  totalItems: number;
  byCategory: Record<LootCategory, number>;
  uniqueTargets: number;
  validatedCredentials: number;
}

// ============================================================================
// Log Types
// ============================================================================

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  source: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface LogFilter {
  levels: LogLevel[];
  sources: string[];
  searchQuery: string;
  startTime?: number;
  endTime?: number;
}

// ============================================================================
// WebSocket Message Types
// ============================================================================

export type WSMessageType =
  | 'system_metrics'
  | 'service_status'
  | 'phase_update'
  | 'status_update'
  | 'phase_change'
  | 'recon_output'
  | 'ai_thought'
  | 'exploit_result'
  | 'loot_item'
  | 'log_entry'
  | 'tool_update';

export interface WSMessage<T = unknown> {
  type: WSMessageType;
  data: T;
  timestamp: number;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ============================================================================
// UI State Types
// ============================================================================

export interface NavigationItem {
  id: string;
  label: string;
  icon: string;
  path: string;
  badge?: number;
}

export interface ToastNotification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
  timestamp: number;
}
