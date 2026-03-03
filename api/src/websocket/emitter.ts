/**
 * Typed WebSocket event emitter — singleton Socket.IO server reference.
 * Import this anywhere to emit events without circular dependencies.
 */

import type { Server as SocketIOServer } from 'socket.io';

let io: SocketIOServer | null = null;

export function setSocketIO(server: SocketIOServer) {
  io = server;
}

export function getIO(): SocketIOServer {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
}

// ── Typed event helpers ─────────────────────────────────────

export function emitSystemMetrics(data: {
  cpu: number;
  memory: number;
  vpnIp: string | null;
  uptime: number;
  timestamp: number;
}) {
  io?.emit('system_metrics', data);
}

export function emitStatusUpdate(data: {
  metrics?: unknown;
  services?: Record<string, string>;
  phase?: string;
  connected?: boolean;
}) {
  io?.emit('status_update', data);
}

export function emitPhaseChange(data: {
  phase: string;
  target?: string;
  status?: string;
}) {
  io?.emit('phase_change', data);
}

export function emitReconOutput(data: {
  tool: string;
  target: string;
  output: string;
  complete: boolean;
  event?: string;
  progress?: string;
  scan_id?: string;
}) {
  io?.emit('recon_output', data);
}

export function emitScanComplete(data: {
  target: string;
  scan_id?: string;
  stats?: unknown;
}) {
  io?.emit('scan_complete', data);
}

export function emitAIThought(data: {
  thoughtType: string;
  content: string;
  command?: string;
  metadata?: unknown;
}) {
  io?.emit('ai_thought', data);
}

export function emitAICommandExecution(data: {
  command: string;
  status: string;
  output?: string;
}) {
  io?.emit('ai_command_execution', data);
}

export function emitExploitResult(data: {
  vulnerability: string;
  severity: string;
  target: string;
  message?: string;
}) {
  io?.emit('exploit_result', data);
}

export function emitExploitStarted(data: { target: string }) {
  io?.emit('exploit_started', data);
}

export function emitExploitCompleted(data: { target: string }) {
  io?.emit('exploit_completed', data);
}

export function emitLogEntry(data: {
  level: string;
  source: string;
  message: string;
  metadata?: unknown;
}) {
  io?.emit('log_entry', data);
}

export function emitLootItem(data: {
  category: string;
  value: string;
  source: string;
  target: string;
}) {
  io?.emit('loot_item', data);
}

export function emitServiceAutoStart(data: {
  service: string;
  status: string;
}) {
  io?.emit('service_auto_start', data);
}

export function emitVulnapiOutput(data: {
  target: string;
  findings: unknown[];
}) {
  io?.emit('vulnapi_output', data);
}

// ── Exploit Case / Task events ───────────────────────────────

export function emitTaskCreated(data: {
  caseId: string;
  taskId: string;
  tool: string;
  target: string;
  config: Record<string, unknown>;
}) {
  io?.emit('task_created', data);
}

export function emitTaskStarted(data: {
  caseId: string;
  taskId: string;
  tool: string;
  target: string;
  startedAt: number;
}) {
  io?.emit('task_started', data);
}

export function emitTaskOutput(data: {
  caseId: string;
  taskId: string;
  chunk: string;
}) {
  io?.emit('task_output', data);
}

export function emitTaskCompleted(data: {
  caseId: string;
  taskId: string;
  tool: string;
  target: string;
  exitCode: number;
  duration?: number;
  findingsCount: number;
  credentialsCount: number;
}) {
  io?.emit('task_completed', data);
}

export function emitTaskFailed(data: {
  caseId: string;
  taskId: string;
  tool: string;
  error: string;
}) {
  io?.emit('task_failed', data);
}

export function emitCaseGateReached(data: {
  caseId: string;
  pendingTasks: number;
  phase: string;
}) {
  io?.emit('case_gate_reached', data);
}

export function emitCasePhaseChanged(data: {
  caseId: string;
  phase: string;
}) {
  io?.emit('case_phase_changed', data);
}
