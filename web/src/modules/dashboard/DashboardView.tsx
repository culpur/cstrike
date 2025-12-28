/**
 * Dashboard View - Live Activity Monitor for AI-driven scans
 *
 * This dashboard shows real-time monitoring of:
 * - Multiple active scans
 * - Current phase for each target
 * - Tool execution progress
 * - System metrics
 * - Service status (VIEW ONLY - no control buttons)
 */

import { useEffect, useState } from 'react';
import { Cpu, HardDrive, Globe, Clock } from 'lucide-react';
import { MetricCard, Panel, StatusBadge, ProgressBar } from '@components/ui';
import { useSystemStore } from '@stores/systemStore';
import { useLootStore } from '@stores/lootStore';
import { useReconStore } from '@stores/reconStore';
import { wsService } from '@services/websocket';
import { apiService } from '@services/api';
import { formatPercent, formatUptime, getPhaseDisplayName } from '@utils/index';
import type { SystemMetrics, ServiceState, PhaseProgress } from '@/types';

interface ActiveScan {
  scan_id: string;
  target: string;
  tools: string[];
  running_tools?: string[];
  started_at: string;
  status: string;
  current_phase?: string;
}

export function DashboardView() {
  const { metrics, services, phaseProgress, connected, updateMetrics, updateServiceStatus, updatePhase, setConnected } =
    useSystemStore();
  const { stats: lootStats } = useLootStore();
  const { targets } = useReconStore();
  const [activeScans, setActiveScans] = useState<ActiveScan[]>([]);

  // Fetch initial status on mount
  useEffect(() => {
    const fetchInitialStatus = async () => {
      try {
        const status = await apiService.getStatus();
        updateMetrics(status.metrics);
        updateServiceStatus('metasploitRpc', status.services.metasploitRpc);
        updateServiceStatus('zap', status.services.zap);
        updateServiceStatus('burp', status.services.burp);
        setConnected(true);
      } catch (error) {
        console.error('Failed to fetch initial status:', error);
        setConnected(false);
      }
    };

    fetchInitialStatus();
  }, [updateMetrics, updateServiceStatus, setConnected]);

  // Poll active scans periodically
  useEffect(() => {
    const pollActiveScans = async () => {
      try {
        const response = await apiService.getActiveScans();
        setActiveScans(response.active_scans);
      } catch (error) {
        console.error('Failed to fetch active scans:', error);
      }
    };

    pollActiveScans();
    const interval = setInterval(pollActiveScans, 3000);

    return () => clearInterval(interval);
  }, []);

  // Setup WebSocket listeners
  useEffect(() => {
    wsService.connect();

    const unsubMetrics = wsService.on<SystemMetrics>('system_metrics', (data) => {
      updateMetrics(data);
      setConnected(true);
    });

    const unsubStatus = wsService.on<{
      metrics: SystemMetrics;
      services: { metasploitRpc: string; zap: string; burp: string };
      phase: string;
    }>('status_update', (data) => {
      if (data.metrics) {
        updateMetrics(data.metrics);
      }
      if (data.services) {
        updateServiceStatus('metasploitRpc', data.services.metasploitRpc as any);
        updateServiceStatus('zap', data.services.zap as any);
        updateServiceStatus('burp', data.services.burp as any);
      }
      if (data.phase) {
        updatePhase(data.phase as any);
      }
      setConnected(true);
    });

    const unsubPhase = wsService.on<{ phase: string; target?: string }>('phase_change', (data) => {
      if (data.phase) {
        updatePhase(data.phase as any);
      }
    });

    const checkConnection = setInterval(() => {
      setConnected(wsService.isConnected());
    }, 5000);

    return () => {
      unsubMetrics();
      unsubStatus();
      unsubPhase();
      clearInterval(checkConnection);
    };
  }, [updateMetrics, updateServiceStatus, updatePhase, setConnected]);

  const phasePercentage = calculatePhaseProgress(phaseProgress);

  const targetCounts = {
    total: targets.length,
    pending: targets.filter(t => t.status === 'pending').length,
    scanning: targets.filter(t => t.status === 'scanning').length,
    complete: targets.filter(t => t.status === 'complete').length,
    failed: targets.filter(t => t.status === 'failed').length,
  };

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-grok-text-heading">
            CStrike Dashboard
          </h1>
          <p className="text-sm text-grok-text-muted mt-1">
            Real-time monitoring of AI-driven autonomous scans
          </p>
        </div>
        <div className="flex items-center gap-4">
          {targetCounts.total > 0 && (
            <span className="text-sm text-grok-text-muted">
              Targets: {targetCounts.complete + targetCounts.failed}/{targetCounts.total} complete
            </span>
          )}
          <StatusBadge
            status={connected ? 'running' : 'stopped'}
            label={connected ? 'Connected' : 'Disconnected'}
          />
        </div>
      </div>

      {/* System Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="CPU Usage"
          value={formatPercent(metrics.cpu)}
          icon={<Cpu className="w-5 h-5" />}
          variant={metrics.cpu > 80 ? 'danger' : 'default'}
        />
        <MetricCard
          label="Memory Usage"
          value={formatPercent(metrics.memory)}
          icon={<HardDrive className="w-5 h-5" />}
          variant={metrics.memory > 80 ? 'warning' : 'default'}
        />
        <MetricCard
          label="VPN IP"
          value={metrics.vpnIp || 'Not Connected'}
          icon={<Globe className="w-5 h-5" />}
          variant={metrics.vpnIp ? 'success' : 'default'}
        />
        <MetricCard
          label="Uptime"
          value={formatUptime(metrics.uptime)}
          icon={<Clock className="w-5 h-5" />}
        />
      </div>

      {/* Active Scans */}
      {activeScans.length > 0 && (
        <Panel title={`Active Scans (${activeScans.length})`}>
          <div className="space-y-4">
            {activeScans.map((scan) => (
              <div
                key={scan.scan_id}
                className="p-4 bg-grok-surface-2 rounded-lg border border-grok-border"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-grok-recon-blue rounded-full animate-pulse" />
                    <h3 className="text-sm font-semibold text-grok-text-heading">
                      {scan.target}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-grok-text-muted font-mono">
                      {scan.scan_id.substring(0, 8)}
                    </span>
                    <StatusBadge status={scan.status as any} />
                  </div>
                </div>

                {scan.current_phase && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-grok-text-muted">Current Phase:</span>
                      <span className="text-xs font-medium text-grok-text-heading">
                        {getPhaseDisplayName(scan.current_phase as import('@/types').PhaseType)}
                      </span>
                    </div>
                  </div>
                )}

                {scan.running_tools && scan.running_tools.length > 0 && (
                  <div>
                    <span className="text-xs text-grok-text-muted mb-2 block">
                      Running Tools:
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {scan.running_tools.map((tool) => (
                        <span
                          key={tool}
                          className="text-xs px-2 py-1 bg-grok-recon-blue/10 text-grok-recon-blue rounded border border-grok-recon-blue/30"
                        >
                          {tool}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-3 text-xs text-grok-text-muted">
                  Started {new Date(scan.started_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Phase Progress */}
      <Panel title="Exploitation Phase">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-grok-text-body">
              Current: {getPhaseDisplayName(phaseProgress.currentPhase)}
            </span>
            <span className="text-sm text-grok-text-muted">
              {phasePercentage}% Complete
            </span>
          </div>
          <ProgressBar
            value={phasePercentage}
            size="lg"
            variant="default"
            animated={phaseProgress.currentPhase !== 'idle'}
          />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-2">
            <PhaseIndicator
              label="Recon"
              complete={phaseProgress.reconComplete}
              active={phaseProgress.currentPhase === 'recon'}
              targetCount={targetCounts.total > 0 ? {
                completed: targetCounts.complete,
                total: targetCounts.total
              } : undefined}
            />
            <PhaseIndicator
              label="AI Analysis"
              complete={phaseProgress.aiAnalysisComplete}
              active={phaseProgress.currentPhase === 'ai'}
            />
            <PhaseIndicator
              label="ZAP Scan"
              complete={phaseProgress.zapScanComplete}
              active={phaseProgress.currentPhase === 'zap'}
            />
            <PhaseIndicator
              label="Metasploit"
              complete={phaseProgress.metasploitScanComplete}
              active={phaseProgress.currentPhase === 'metasploit'}
            />
            <PhaseIndicator
              label="Exploitation"
              complete={phaseProgress.exploitationComplete}
              active={phaseProgress.currentPhase === 'exploit'}
            />
          </div>
        </div>
      </Panel>

      {/* Services Status - READ ONLY */}
      <Panel title="Service Status (Auto-Managed)">
        <p className="text-xs text-grok-text-muted mb-3">
          Services are automatically started/stopped by the AI workflow as needed.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ServiceStatus name="Metasploit RPC" status={services.metasploitRpc} />
          <ServiceStatus name="OWASP ZAP" status={services.zap} />
          <ServiceStatus name="Burp Suite" status={services.burp} />
        </div>
      </Panel>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Panel title="Targets">
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-grok-text-muted">Total</span>
              <span className="text-lg font-semibold text-grok-text-heading">
                {targets.length}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-grok-text-muted">Scanning</span>
              <span className="text-lg font-semibold text-grok-recon-blue">
                {targets.filter((t) => t.status === 'scanning').length}
              </span>
            </div>
          </div>
        </Panel>

        <Panel title="Loot Collected">
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-grok-text-muted">Total Items</span>
              <span className="text-lg font-semibold text-grok-text-heading">
                {lootStats.totalItems}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-grok-text-muted">Credentials</span>
              <span className="text-lg font-semibold text-grok-loot-green">
                {lootStats.validatedCredentials}
              </span>
            </div>
          </div>
        </Panel>

        <Panel title="Activity">
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-grok-text-muted">Unique Targets</span>
              <span className="text-lg font-semibold text-grok-text-heading">
                {lootStats.uniqueTargets}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-grok-text-muted">Ports Found</span>
              <span className="text-lg font-semibold text-grok-recon-blue">
                {lootStats.byCategory.port || 0}
              </span>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

// Helper Components
function PhaseIndicator({
  label,
  complete,
  active,
  targetCount,
}: {
  label: string;
  complete: boolean;
  active: boolean;
  targetCount?: { completed: number; total: number };
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={cn(
          'w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all relative',
          complete && 'bg-grok-success border-grok-success',
          active && !complete && 'border-grok-recon-blue animate-pulse',
          !complete && !active && 'border-grok-border'
        )}
      >
        {complete && (
          <svg
            className="w-5 h-5 text-white"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-xs text-grok-text-muted text-center">{label}</span>
        {targetCount && targetCount.total > 0 && (
          <span className={cn(
            "text-xs font-mono font-semibold",
            targetCount.completed === targetCount.total ? 'text-grok-success' : 'text-grok-recon-blue'
          )}>
            {targetCount.completed}/{targetCount.total}
          </span>
        )}
      </div>
    </div>
  );
}

function ServiceStatus({
  name,
  status,
}: {
  name: string;
  status: ServiceState[keyof ServiceState];
}) {
  return (
    <div className="flex items-center justify-between p-3 bg-grok-surface-2 rounded border border-grok-border">
      <span className="text-sm text-grok-text-body">{name}</span>
      <StatusBadge status={status} />
    </div>
  );
}

function calculatePhaseProgress(progress: PhaseProgress): number {
  const phases = [
    progress.reconComplete,
    progress.aiAnalysisComplete,
    progress.zapScanComplete,
    progress.metasploitScanComplete,
    progress.exploitationComplete,
  ];

  const completed = phases.filter(Boolean).length;
  return Math.round((completed / phases.length) * 100);
}

function cn(...classes: (string | boolean | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
