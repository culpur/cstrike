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
import type { SystemMetrics, ServiceStatus } from '@/types';

export function useWebSocketHandlers() {
  const {
    updateMetrics,
    updateServiceStatus,
    updatePhase,
    setConnected,
    setPhaseComplete,
  } = useSystemStore();
  const { addReconOutput } = useReconStore();
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
    const unsubShellObtained = wsService.on<any>('shell_obtained', (data) => {
      const host = data.host || data.target || 'target';
      const shellType = data.type || data.shell_type || 'shell';
      addNotification({
        type: 'shell_obtained',
        title: 'Shell Obtained',
        message: `${shellType.toUpperCase()} shell established on ${host}${data.port ? `:${data.port}` : ''}`,
        severity: 'critical',
      });
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
    const unsubAI = wsService.on<any>('ai_thought', (data) => {
      addThought({
        thoughtType: data.thoughtType || 'observation',
        content: data.content || '',
        metadata: data.metadata,
      });
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

    // ── Connection health check ────────────────────────────────
    const connectionCheck = setInterval(() => {
      setConnected(wsService.isConnected());
    }, 5000);

    return () => {
      unsubMetrics();
      unsubStatus();
      unsubPhase();
      unsubRecon();
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
      clearInterval(connectionCheck);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
