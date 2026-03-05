/**
 * CStrike Web UI - Core Type Definitions
 * Offensive Security Automation Framework
 */

// ============================================================================
// System & Status Types
// ============================================================================

export type PhaseType = 'recon' | 'ai' | 'zap' | 'metasploit' | 'exploit' | 'post_exploit' | 'apiscan' | 'idle';

export type ServiceStatus = 'running' | 'stopped' | 'error' | 'starting' | 'stopping';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export interface SystemMetrics {
  cpu: number;
  memory: number;
  vpnIp: string | null;
  uptime: number;
  timestamp: number;
  mgmtIpInternal?: string | null;
  mgmtIpPublic?: string | null;
  opsIpInternal?: string | null;
  opsIpPublic?: string | null;
}

export interface ServiceInfo {
  status: ServiceStatus;
  port: number;
  pid?: number | null;
  error?: string;
  optional?: boolean;
  uptime?: number;
}

export interface ServiceState {
  metasploitRpc: ServiceStatus;
  zap: ServiceStatus;
  burp: ServiceStatus;
  api_server?: ServiceStatus;
  frontend?: ServiceStatus;
  postgresql?: ServiceStatus;
  redis?: ServiceStatus;
  ollama?: ServiceStatus;
  docker?: ServiceStatus;
}

export interface PhaseProgress {
  currentPhase: PhaseType;
  reconComplete: boolean;
  aiAnalysisComplete: boolean;
  zapScanComplete: boolean;
  metasploitScanComplete: boolean;
  exploitationComplete: boolean;
  postExploitComplete: boolean;
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
  event?: string; // tool_start, tool_complete, tool_error, tool_timeout, tool_retry, tool_failed
  progress?: string; // "5/15" format showing completed/total tools
  scan_id?: string;
  rawOutput?: string;
  exitCode?: number;
  duration?: number;
  targetId?: string;
}

// ============================================================================
// Comprehensive Scan Result Types
// ============================================================================

export interface HttpEndpoint {
  url: string;
  statusCode: number;
  title?: string;
  contentLength?: number;
  technologies?: string[];
  headers?: Record<string, string>;
}

export interface DetectedTechnology {
  name: string;
  version?: string;
  category: string;
  confidence: number;
}

export interface VulnerabilityFinding {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  description: string;
  cvss?: number;
  cve?: string;
  affectedComponent?: string;
  remediation?: string;
  references?: string[];
}

export interface DetailedPortScanResult extends PortScanResult {
  banner?: string;
  scripts?: Record<string, string>;
  cpe?: string[];
}

export interface DetailedSubdomainResult extends SubdomainResult {
  ipAddresses?: string[];
  alive?: boolean;
  httpStatus?: number;
}

export interface CompleteScanResults {
  scanId: string;
  target: string;
  startTime: number;
  endTime: number;
  status: 'completed' | 'failed' | 'partial';
  toolsUsed: ReconToolType[];

  // Detailed results by category
  ports: DetailedPortScanResult[];
  subdomains: DetailedSubdomainResult[];
  httpEndpoints: HttpEndpoint[];
  technologies: DetectedTechnology[];
  vulnerabilities: VulnerabilityFinding[];

  // Statistics
  stats: {
    totalPorts: number;
    openPorts: number;
    totalSubdomains: number;
    aliveSubdomains: number;
    totalEndpoints: number;
    totalVulnerabilities: number;
    criticalVulns: number;
    highVulns: number;
    mediumVulns: number;
    lowVulns: number;
  };

  // Raw output for reference
  rawOutput?: string[];
  errors?: string[];
}

// ============================================================================
// VulnAPI Types
// ============================================================================

export interface VulnAPIFinding {
  id?: string;
  name: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  cvss: string;
  owasp: string;
  url: string;
}

export interface VulnAPIScanResult {
  target: string;
  timestamp: string;
  endpoints_scanned: number;
  specs_found: number;
  spec_urls: string[];
  total_findings: number;
  findings: VulnAPIFinding[];
  severity_counts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
}

// ============================================================================
// AI Thought Stream Types
// ============================================================================

export interface AIThought {
  id: string;
  timestamp: number;
  thoughtType:
    | 'reasoning'       // AI is thinking/analyzing
    | 'command'         // Command being executed
    | 'decision'        // Decision being made
    | 'observation'     // General observation
    | 'ai_prompt'       // Prompt being sent to AI API
    | 'ai_response'     // Response received from AI API
    | 'ai_decision'     // AI decided on commands to execute
    | 'ai_execution';   // Commands ready for execution
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

export type LootCategory = 'username' | 'password' | 'hash' | 'url' | 'port' | 'credential' | 'file' | 'token' | 'api_key' | 'session';

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
  port?: number;
  validated: boolean;
  timestamp: number;
}

export interface LootStats {
  totalItems: number;
  byCategory: Record<LootCategory, number>;
  uniqueTargets: number;
  validatedCredentials: number;
}

export interface ScoreBreakdown {
  reuse_count: number;
  reuse_score: number;
  username_weight: number;
  service_weight: number;
  complexity_score: number;
  complexity_penalty: number;
}

export interface ScoredCredential {
  username: string;
  password: string;
  service: string;
  target: string;
  score: number;
  breakdown: ScoreBreakdown;
}

export interface HeatmapResponse {
  credentials: ScoredCredential[];
  count: number;
  timestamp: string;
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
  | 'scan_complete'
  | 'ai_thought'
  | 'ai_command_execution'
  | 'exploit_result'
  | 'exploit_started'
  | 'exploit_completed'
  | 'exploit_failed'
  | 'vulnerability_discovered'
  | 'shell_obtained'
  | 'credential_extracted'
  | 'file_downloaded'
  | 'loot_item'
  | 'log_entry'
  | 'tool_update'
  | 'vulnapi_output'
  | 'service_auto_start'
  | 'scan_started'
  | 'task_created'
  | 'task_started'
  | 'task_output'
  | 'task_completed'
  | 'task_failed'
  | 'case_gate_reached'
  | 'case_phase_changed'
  | 'port_discovered'
  | 'subdomain_discovered'
  | 'exploit_track_spawned'
  | 'scan_paused'
  | 'scan_resumed'
  | 'terminal_output'
  | 'terminal_session_created'
  | 'terminal_session_closed'
  | 'early_exploit_result'
  | 'persistence_deployed';

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

// ============================================================================
// Configuration Types
// ============================================================================

export interface Config {
  openai_api_key: string;
  anthropic_api_key?: string;
  grok_api_key?: string;
  ai_provider: string;
  ollama_model?: string;
  ollama_url?: string;
  openai_model?: string;
  anthropic_model?: string;
  grok_model?: string;
  allow_exploitation: boolean;
  scan_modes: string[];
  allowed_tools: string[];
  max_threads: number;
  max_runtime: number;
  ai_max_iterations?: number;
  ai_max_tokens?: number;
  ai_temperature?: number;
  mcp_enabled?: boolean;
  msf_username: string;
  msf_password: string;
  msf_host: string;
  msf_port: number;
  zap_host: string;
  zap_port: number;
  target_scope?: string[];
}

// ============================================================================
// VPN Types
// ============================================================================

export type VpnProvider = 'wireguard' | 'openvpn' | 'tailscale' | 'nordvpn' | 'mullvad';

export type VpnStatusType = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface VpnConnection {
  provider: VpnProvider;
  interface: string;
  status: VpnStatusType;
  publicIp: string | null;
  assignedIp: string | null;
  server: string | null;
  connectedAt: number | null;
}

// ============================================================================
// Feature Status Types
// ============================================================================

export interface FeatureStatus {
  name: string;
  category: 'recon' | 'exploit' | 'ai' | 'service' | 'network';
  enabled: boolean;
  available: boolean;
  detail?: string;
}

// ============================================================================
// Evidence / Case Folder Types
// ============================================================================

export interface EvidenceRecord {
  id: string;
  tool: string;
  type: 'scan' | 'exploit';
  phase: string;
  rawOutput: string;
  exitCode: number | null;
  duration: number | null;
  status: string;
  createdAt: number;
  scanId: string | null;
}

export interface EvidenceTarget {
  targetId: string;
  hostname: string;
  url: string;
  scanResultCount: number;
  exploitTaskCount: number;
  lastActivity: number;
}
