/**
 * Dashboard View - Main overview of CStrike system
 */

import { useEffect } from 'react';
import { Cpu, HardDrive, Globe, Clock } from 'lucide-react';
import { MetricCard, Panel, StatusBadge, ProgressBar } from '@components/ui';
import { useSystemStore } from '@stores/systemStore';
import { useLootStore } from '@stores/lootStore';
import { useReconStore } from '@stores/reconStore';
import { wsService } from '@services/websocket';
import { apiService } from '@services/api';
import { formatPercent, formatUptime, getPhaseDisplayName } from '@utils/index';
import type { SystemMetrics, ServiceState, PhaseProgress } from '@/types';

export function DashboardView() {
  const { metrics, services, phaseProgress, connected, updateMetrics, updateServiceStatus, setConnected } =
    useSystemStore();
  const { stats: lootStats } = useLootStore();
  const { targets } = useReconStore();

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

  // Setup WebSocket listeners
  useEffect(() => {
    // Connect to WebSocket
    wsService.connect();

    // Listen for system metrics updates
    const unsubMetrics = wsService.on<SystemMetrics>('system_metrics', (data) => {
      updateMetrics(data);
      // Update connection status when we receive data
      setConnected(true);
    });

    // Listen for status updates (includes services)
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
      setConnected(true);
    });

    // Update connection status when disconnected
    const checkConnection = setInterval(() => {
      setConnected(wsService.isConnected());
    }, 5000);

    return () => {
      unsubMetrics();
      unsubStatus();
      clearInterval(checkConnection);
    };
  }, [updateMetrics, updateServiceStatus, setConnected]);

  const phasePercentage = calculatePhaseProgress(phaseProgress);

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      {/* Connection Status */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-grok-text-heading">
          CStrike Dashboard
        </h1>
        <StatusBadge
          status={connected ? 'running' : 'stopped'}
          label={connected ? 'Connected' : 'Disconnected'}
        />
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

      {/* Services Status */}
      <Panel title="Service Status">
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
}: {
  label: string;
  complete: boolean;
  active: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={cn(
          'w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all',
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
      <span className="text-xs text-grok-text-muted text-center">{label}</span>
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
