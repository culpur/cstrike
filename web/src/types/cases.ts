/**
 * Exploit Case & Task Type Definitions
 */

// ============================================================================
// Case Types
// ============================================================================

export type CaseStatus = 'ACTIVE' | 'GATED' | 'COMPLETED' | 'ARCHIVED';
export type CasePhase = 'ENUMERATION' | 'EXPLOITATION' | 'PERSISTENCE' | 'COMPLETE';
export type GateStatus = 'NONE' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
export type ExploitTaskStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type CampaignStatus = 'PLANNED' | 'ACTIVE' | 'RUNNING' | 'COMPLETED' | 'ARCHIVED';

export interface ExploitTask {
  id: string;
  caseId: string;
  tool: string;
  target: string;
  phase: CasePhase;
  status: ExploitTaskStatus;
  trigger: string;
  config: Record<string, unknown>;
  output: string;
  findings: TaskFinding[];
  exitCode: number | null;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
  duration: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskFinding {
  type: 'vulnerability' | 'credential' | 'endpoint' | 'info';
  severity?: string;
  title: string;
  detail: string;
}

export interface ExploitCase {
  id: string;
  name: string;
  description: string;
  status: CaseStatus;
  currentPhase: CasePhase;
  gateStatus: GateStatus;
  targetId: string;
  campaignId: string | null;
  createdAt: string;
  updatedAt: string;
  target?: { url: string; hostname: string | null; ip: string | null };
  campaign?: { id: string; name: string } | null;
  tasks?: ExploitTask[];
  taskSummary?: Record<string, number>;
  _count?: { tasks: number };
}

export interface Campaign {
  id: string;
  name: string;
  description: string;
  status: CampaignStatus;
  color: string;
  createdAt: string;
  updatedAt: string;
  cases?: ExploitCase[];
  _count?: { cases: number };
}

export interface Wordlist {
  id: string;
  name: string;
  path: string;
  category: 'PASSWORDS' | 'USERNAMES' | 'WEB_CONTENT' | 'SUBDOMAINS' | 'CUSTOM';
  lineCount: number;
  sizeBytes: number;
  description: string;
}

// ============================================================================
// WebSocket Event Payloads
// ============================================================================

export interface TaskCreatedEvent {
  caseId: string;
  taskId: string;
  tool: string;
  target: string;
  config: Record<string, unknown>;
}

export interface TaskStartedEvent {
  caseId: string;
  taskId: string;
  tool: string;
  target: string;
  startedAt: number;
}

export interface TaskOutputEvent {
  caseId: string;
  taskId: string;
  chunk: string;
}

export interface TaskCompletedEvent {
  caseId: string;
  taskId: string;
  tool: string;
  target: string;
  exitCode: number;
  duration?: number;
  findingsCount: number;
  credentialsCount: number;
}

export interface TaskFailedEvent {
  caseId: string;
  taskId: string;
  tool: string;
  error: string;
}

export interface CaseGateReachedEvent {
  caseId: string;
  pendingTasks: number;
  phase: string;
}

export interface CasePhaseChangedEvent {
  caseId: string;
  phase: string;
}
