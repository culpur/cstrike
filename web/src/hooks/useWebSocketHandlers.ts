/**
 * Global WebSocket-to-Store wiring hook.
 *
 * Mount this ONCE in App.tsx. It subscribes to ALL Socket.IO events
 * and dispatches them to the appropriate Zustand stores so every
 * view gets live data without manual setup.
 */

import { useEffect } from 'react';
import { wsService } from '@services/websocket';
import { useSystemStore } from '@stores/systemStore';
import { useReconStore } from '@stores/reconStore';
import { useAIStore } from '@stores/aiStore';
import { useLogStore } from '@stores/logStore';
import { useLootStore } from '@stores/lootStore';
import { useUIStore } from '@stores/uiStore';
import { useNotificationStore } from '@stores/notificationStore';
import { useExploitTrackStore } from '@stores/exploitTrackStore';
import { useTerminalStore } from '@stores/terminalStore';
import { apiService } from '@services/api';
import type { SystemMetrics, ServiceStatus } from '@/types';

export function useWebSocketHandlers() {
  const {
    updateMetrics,
    updateServiceStatus,
    updatePhase,
    setConnected,
    setPhaseComplete,
  } = useSystemStore();
  const { addReconOutput, addPortScanResult, addSubdomainResult } = useReconStore();
  const { addThought } = useAIStore();
  const { addLog } = useLogStore();
  const { addLootItem } = useLootStore();
  const { addToast } = useUIStore();
  const { addNotification } = useNotificationStore();

  useEffect(() => {
    wsService.connect();

    // ── System metrics (every 2s from backend) ─────────────────
    const unsubMetrics = wsService.on<SystemMetrics>('system_metrics', (data) => {
      updateMetrics(data);
      setConnected(true);
    });

    // ── Full status update (legacy, includes metrics + services) ──
    const unsubStatus = wsService.on<{
      metrics?: SystemMetrics;
      services?: Record<string, string>;
      phase?: string;
      connected?: boolean;
    }>('status_update', (data) => {
      if (data.metrics) updateMetrics(data.metrics);
      if (data.services) {
        for (const [svc, status] of Object.entries(data.services)) {
          updateServiceStatus(svc as any, status as ServiceStatus);
        }
      }
      if (data.phase) updatePhase(data.phase as any);
      if (typeof data.connected === 'boolean') setConnected(data.connected);
      else setConnected(true);
    });

    // ── Phase changes ──────────────────────────────────────────
    const unsubPhase = wsService.on<{ phase: string; target?: string; status?: string }>(
      'phase_change',
      (data) => {
        if (data.phase) {
          updatePhase(data.phase as any);
          // Map backend phase names to PhaseProgress booleans
          const phaseMap: Record<string, string> = {
            recon: 'reconComplete',
            ai_analysis_1: 'aiAnalysisComplete',
            ai_analysis_2: 'aiAnalysisComplete',
            web_scans: 'zapScanComplete',
            metasploit: 'metasploitScanComplete',
            exploitation: 'exploitationComplete',
            post_exploit: 'postExploitComplete',
          };
          if (data.status === 'complete' || data.status === 'done') {
            const key = phaseMap[data.phase];
            if (key) setPhaseComplete(key as any, true);
          }
        }
      },
    );

    // ── Recon output (tool progress) ───────────────────────────
    const unsubRecon = wsService.on<any>('recon_output', (data) => {
      addReconOutput({
        tool: data.tool || 'nmap',
        target: data.target || '',
        output: data.output || data.message || '',
        timestamp: Date.now(),
        complete: data.complete || false,
        event: data.event,
        progress: data.progress,
        scan_id: data.scan_id,
      });

      // Generate notifications for tool completions
      if (data.complete && data.event === 'tool_complete') {
        addNotification({
          type: 'task_completed',
          title: `${(data.tool || 'Tool').toUpperCase()} Complete`,
          message: `${data.tool || 'Tool'} finished on ${data.target || 'target'}${data.progress ? ` (${data.progress})` : ''}`,
          severity: 'info',
        });
        addToast({
          type: 'success',
          message: `${data.tool || 'Tool'} complete${data.progress ? ` [${data.progress}]` : ''}`,
          duration: 3000,
        });
      } else if (data.complete && data.event === 'tool_error') {
        addNotification({
          type: 'task_failed',
          title: `${(data.tool || 'Tool').toUpperCase()} Failed`,
          message: `${data.tool || 'Tool'} failed on ${data.target || 'target'}`,
          severity: 'high',
        });
        addToast({
          type: 'error',
          message: `${data.tool || 'Tool'} failed on ${data.target || 'target'}`,
          duration: 5000,
        });
      } else if (data.event === 'tool_start') {
        addToast({
          type: 'info',
          message: `Running ${data.tool || 'tool'}${data.progress ? ` [${data.progress}]` : ''}...`,
          duration: 3000,
        });
      }
    });

    // ── Port discovered ───────────────────────────────────────
    const unsubPortDiscovered = wsService.on<any>('port_discovered', (data) => {
      addPortScanResult({
        port: data.port,
        protocol: data.protocol || 'tcp',
        state: data.state || 'open',
        service: data.service || 'unknown',
        version: data.version || '',
        target: data.target || '',
      });

      // Notify on port discovery
      addNotification({
        type: 'scan_complete',
        title: 'Port Discovered',
        message: `${data.port}/${data.protocol || 'tcp'} ${data.state || 'open'} — ${data.service || 'unknown'}${data.version ? ` ${data.version}` : ''} on ${data.target || 'target'}`,
        severity: 'info',
      });
    });

    // ── Subdomain discovered ────────────────────────────────
    const unsubSubdomainDiscovered = wsService.on<any>('subdomain_discovered', (data) => {
      addSubdomainResult({
        subdomain: data.subdomain,
        target: data.target || '',
        source: data.source || 'unknown',
        discoveredAt: Date.now(),
      });
    });

    // ── Scan complete ──────────────────────────────────────────
    const unsubScanComplete = wsService.on<any>('scan_complete', (data) => {
      addToast({
        type: 'success',
        message: `Scan complete: ${data.target || 'unknown'}`,
        duration: 5000,
      });
      addNotification({
        type: 'scan_complete',
        title: 'Scan Complete',
        message: `Scan finished for ${data.target || 'unknown target'}`,
      });
    });

    // ── Vulnerability discovered ────────────────────────────────
    const unsubVulnDiscovered = wsService.on<any>(
      'vulnerability_discovered',
      (data) => {
        addNotification({
          type: 'vuln_found',
          title: data.name || data.title || 'Vulnerability Discovered',
          message: data.description
            ? data.description
            : `${data.severity || 'Unknown severity'} vulnerability found on ${data.target || data.host || 'target'}`,
          severity: data.severity ?? undefined,
        });
      }
    );

    // ── Credential extracted ───────────────────────────────────
    const unsubCredExtracted = wsService.on<any>(
      'credential_extracted',
      (data) => {
        const user = data.username || data.user || 'unknown';
        const target = data.target || data.host || 'target';
        addNotification({
          type: 'cred_found',
          title: 'Credential Extracted',
          message: `Found credentials for '${user}' on ${target}`,
          severity: 'high',
        });
      }
    );

    // ── Shell obtained ─────────────────────────────────────────
    const unsubShellObtained = wsService.on<any>('shell_obtained', async (data) => {
      const host = data.host || data.target || 'target';
      const shellType = data.type || data.shell_type || 'shell';
      addNotification({
        type: 'shell_obtained',
        title: 'Shell Obtained',
        message: `${shellType.toUpperCase()} shell established on ${host}${data.port ? `:${data.port}` : ''}`,
        severity: 'critical',
      });

      // Auto-create a terminal session tab for the obtained shell
      try {
        const sessionData = await apiService.createTerminalSession({
          type: shellType === 'ssh' ? 'ssh' : shellType === 'bind' ? 'bind_shell' : 'reverse_shell',
          host,
          port: data.port ?? (shellType === 'ssh' ? 22 : 4444),
          user: data.user ?? data.username ?? undefined,
          password: data.password ?? undefined,
          target: host,
        });

        if (sessionData?.id) {
          useTerminalStore.getState().addSession({
            id: sessionData.id,
            type: sessionData.type,
            target: sessionData.target ?? host,
            host: sessionData.host ?? host,
            port: sessionData.port ?? 4444,
            user: sessionData.user,
            createdAt: sessionData.createdAt ?? Date.now(),
            lastActivity: sessionData.lastActivity ?? Date.now(),
            active: true,
          });

          addToast({
            type: 'success',
            message: `Shell obtained on ${host} — terminal tab opened`,
            duration: 6000,
          });
        }
      } catch {
        // Shell tab creation failure should not break the notification
        addToast({
          type: 'warning',
          message: `Shell obtained on ${host} — could not auto-open terminal tab`,
          duration: 5000,
        });
      }
    });

    // ── Scan started ───────────────────────────────────────────
    const unsubScanStarted = wsService.on<any>('scan_started', (data) => {
      addNotification({
        type: 'scan_started',
        title: 'Scan Started',
        message: `Scan initiated against ${data.target || 'target'}${data.tool ? ` using ${data.tool}` : ''}`,
      });
    });

    // ── AI thoughts ────────────────────────────────────────────
    const { addDecision } = useAIStore.getState();

    const unsubAI = wsService.on<any>('ai_thought', (data) => {
      // Preserve the real thoughtType from the backend (ai_prompt, ai_response,
      // ai_decision, ai_execution, observation, reasoning, command, decision).
      // Pass through content, command, and metadata so the AI Stream view can
      // show the full prompt, response, and reasoning.
      const typeMap: Record<string, string> = {
        ai_prompt: 'ai_prompt',
        ai_response: 'ai_response',
        ai_decision: 'ai_decision',
        ai_execution: 'ai_execution',
        reasoning: 'reasoning',
        command: 'command',
        decision: 'decision',
        observation: 'observation',
      };
      const thoughtType = typeMap[data.thoughtType] || 'observation';

      addThought({
        thoughtType: thoughtType as any,
        content: data.content || data.response || data.message || '',
        command: data.command || undefined,
        metadata: data.metadata || undefined,
      });

      // AI decisions also go to the Recent Decisions panel
      if (thoughtType === 'ai_decision') {
        addDecision({
          phase: 'recon' as any,
          decision: data.content || '',
          reasoning: data.metadata?.rationale ? String(data.metadata.rationale) : '',
          confidence: 0.85,
          executedCommand: data.command || undefined,
        });
      }
    });

    // ── AI command execution ───────────────────────────────────
    const unsubAICmd = wsService.on<any>('ai_command_execution', (data) => {
      addThought({
        thoughtType: 'command',
        content: `Command: ${data.command || ''}`,
        command: data.command,
        metadata: { status: data.status, output: data.output },
      });
    });

    // ── Log entries ────────────────────────────────────────────
    const unsubLog = wsService.on<any>('log_entry', (data) => {
      addLog({
        level: data.level || 'INFO',
        source: data.source || 'system',
        message: data.message || '',
        metadata: data.metadata,
      });
    });

    // ── Loot items ─────────────────────────────────────────────
    const unsubLoot = wsService.on<any>('loot_item', (data) => {
      addLootItem({
        category: data.category || 'credential',
        value: data.value || '',
        source: data.source || 'scan',
        target: data.target || '',
      });
    });

    // ── Exploitation events ────────────────────────────────────
    const unsubExploitResult = wsService.on<any>('exploit_result', (data) => {
      addToast({
        type: data.severity === 'critical' || data.severity === 'high' ? 'warning' : 'info',
        message: `Exploit: ${data.vulnerability || data.message || 'result'}`,
        duration: 6000,
      });
    });

    const unsubExploitStarted = wsService.on<any>('exploit_started', (data) => {
      addToast({
        type: 'info',
        message: `Exploitation started: ${data.target || ''}`,
        duration: 3000,
      });
    });

    const unsubExploitCompleted = wsService.on<any>('exploit_completed', (data) => {
      addToast({
        type: 'success',
        message: `Exploitation complete: ${data.target || ''}`,
        duration: 5000,
      });
    });

    // ── Service auto-start notifications ───────────────────────
    const unsubServiceAuto = wsService.on<any>('service_auto_start', (data) => {
      if (data.service) {
        updateServiceStatus(data.service as any, (data.status || 'starting') as ServiceStatus);
      }
      addToast({
        type: 'info',
        message: `Auto-starting ${data.service || 'service'}...`,
        duration: 3000,
      });
    });

    // ── VulnAPI output ─────────────────────────────────────────
    const unsubVulnapi = wsService.on<any>('vulnapi_output', (data) => {
      if (data.findings && data.findings.length > 0) {
        addToast({
          type: 'warning',
          message: `VulnAPI: ${data.findings.length} findings for ${data.target || ''}`,
          duration: 5000,
        });
        // Surface the highest-severity finding as a notification
        const critCount: number = data.severity_counts?.critical ?? 0;
        const highCount: number = data.severity_counts?.high ?? 0;
        const topSeverity =
          critCount > 0 ? 'critical' : highCount > 0 ? 'high' : 'medium';
        addNotification({
          type: 'vuln_found',
          title: 'VulnAPI Findings',
          message: `${data.findings.length} API vulnerabilities found for ${data.target || 'target'} (${critCount} critical, ${highCount} high)`,
          severity: topSeverity,
        });
      }
    });

    // ── Task lifecycle → notifications ─────────────────────────
    const unsubTaskCompleted = wsService.on<any>('task_completed', (data) => {
      addNotification({
        type: 'task_completed',
        title: 'Task Complete',
        message: `${data.tool || 'task'} finished on ${data.target || 'target'}${data.findingsCount ? ` — ${data.findingsCount} findings` : ''}`,
        severity: 'info',
      });
      addToast({
        type: 'success',
        message: `${data.tool || 'Task'} complete on ${data.target || 'target'}`,
        duration: 4000,
      });
    });

    const unsubTaskFailed = wsService.on<any>('task_failed', (data) => {
      addNotification({
        type: 'task_failed',
        title: 'Task Failed',
        message: `${data.tool || 'task'} failed${data.error ? `: ${data.error}` : ''} on ${data.target || 'target'}`,
        severity: 'high',
      });
      addToast({
        type: 'error',
        message: `${data.tool || 'Task'} failed on ${data.target || 'target'}`,
        duration: 6000,
      });
    });

    // ── Case gate + phase → notifications ───────────────────────
    const unsubGateReached = wsService.on<any>('case_gate_reached', (data) => {
      addNotification({
        type: 'gate_reached',
        title: 'Gate Approval Required',
        message: `${data.pendingTasks || '?'} exploitation tasks await approval`,
        severity: 'high',
      });
      addToast({
        type: 'warning',
        message: `Gate reached — ${data.pendingTasks || '?'} tasks await approval`,
        duration: 8000,
      });
    });

    const unsubPhaseChanged = wsService.on<any>('case_phase_changed', (data) => {
      addNotification({
        type: 'phase_changed',
        title: 'Phase Changed',
        message: `Case moved to ${data.phase || 'next'} phase`,
        severity: 'info',
      });
    });

    // ── Exploit track spawned ───────────────────────────────────
    const { addTrack } = useExploitTrackStore.getState();

    const unsubTrackSpawned = wsService.on<any>('exploit_track_spawned', (data) => {
      addTrack({ ...data, spawnedAt: Date.now() });

      addNotification({
        type: data.mode === 'full-auto' ? 'scan_started' : 'gate_reached',
        title: 'Exploitation Track Spawned',
        message: `${data.trigger} → ${data.taskCount} tasks (${data.autoCount} auto, ${data.gatedCount} gated)`,
        severity: 'high',
      });

      addToast({
        type: data.gatedCount > 0 && data.mode !== 'full-auto' ? 'warning' : 'info',
        message: `Exploit track: ${data.trigger} → ${data.taskCount} tasks`,
        duration: 6000,
      });
    });

    // ── Scan paused / resumed ───────────────────────────────────
    const unsubScanPaused = wsService.on<any>('scan_paused', (data) => {
      addNotification({
        type: 'scan_complete',
        title: 'Scan Paused',
        message: `Scan paused for ${data.target || 'target'} — can be resumed later`,
        severity: 'info',
      });
      addToast({
        type: 'warning',
        message: `Scan paused: ${data.target || 'unknown'}`,
        duration: 5000,
      });
    });

    const unsubScanResumed = wsService.on<any>('scan_resumed', (data) => {
      addNotification({
        type: 'scan_started',
        title: 'Scan Resumed',
        message: `Scan resumed for ${data.target || 'target'}`,
        severity: 'info',
      });
      addToast({
        type: 'success',
        message: `Scan resumed: ${data.target || 'unknown'}`,
        duration: 4000,
      });
    });

    // ── Terminal output streaming ──────────────────────────────
    const { appendOutput, addSession, markSessionInactive } = useTerminalStore.getState();

    const unsubTerminalOutput = wsService.on<any>('terminal_output', (data) => {
      if (data.sessionId && data.output) {
        // Split multi-line chunks and append each line
        const lines: string[] = data.output.split('\n');
        for (const line of lines) {
          appendOutput(data.sessionId, line);
        }
      }
    });

    const unsubTerminalSessionCreated = wsService.on<any>('terminal_session_created', (data) => {
      if (data.sessionId) {
        // Session may already be in store if the REST response beat the WS event
        const existing = useTerminalStore.getState().sessions.find((s) => s.id === data.sessionId);
        if (!existing) {
          addSession({
            id: data.sessionId,
            type: data.type ?? 'reverse_shell',
            target: data.target ?? data.sessionId,
            host: data.target ?? data.sessionId,
            port: 0,
            createdAt: Date.now(),
            lastActivity: Date.now(),
            active: true,
          });
        }
      }
    });

    const unsubTerminalSessionClosed = wsService.on<any>('terminal_session_closed', (data) => {
      if (data.sessionId) {
        markSessionInactive(data.sessionId);
        addToast({
          type: 'warning',
          message: `Terminal session closed: ${data.sessionId.substring(0, 8)}...`,
          duration: 4000,
        });
      }
    });

    // ── Connection health check ────────────────────────────────
    const connectionCheck = setInterval(() => {
      setConnected(wsService.isConnected());
    }, 5000);

    return () => {
      unsubMetrics();
      unsubStatus();
      unsubPhase();
      unsubRecon();
      unsubPortDiscovered();
      unsubSubdomainDiscovered();
      unsubScanComplete();
      unsubVulnDiscovered();
      unsubCredExtracted();
      unsubShellObtained();
      unsubScanStarted();
      unsubAI();
      unsubAICmd();
      unsubLog();
      unsubLoot();
      unsubExploitResult();
      unsubExploitStarted();
      unsubExploitCompleted();
      unsubServiceAuto();
      unsubVulnapi();
      unsubTaskCompleted();
      unsubTaskFailed();
      unsubGateReached();
      unsubPhaseChanged();
      unsubTrackSpawned();
      unsubScanPaused();
      unsubScanResumed();
      unsubTerminalOutput();
      unsubTerminalSessionCreated();
      unsubTerminalSessionClosed();
      clearInterval(connectionCheck);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
