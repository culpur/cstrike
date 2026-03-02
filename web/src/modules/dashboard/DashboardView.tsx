/**
 * Dashboard — CStrike Command Center
 *
 * Operational overview with:
 * - System telemetry (CPU, RAM, VPN, uptime)
 * - Service health strip
 * - Scan launcher
 * - Active scan tracker with live phase progress
 * - Loot counter
 * - Recent AI activity feed
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Cpu,
  HardDrive,
  Clock,
  Play,
  Zap,
  Shield,
  Target,
  Brain,
  Trophy,
  Wifi,
  WifiOff,
  Activity,
  Crosshair,
} from 'lucide-react';
import { useSystemStore } from '@stores/systemStore';
import { useReconStore } from '@stores/reconStore';
import { useLootStore } from '@stores/lootStore';
import { useAIStore } from '@stores/aiStore';
import { useUIStore } from '@stores/uiStore';
import { apiService } from '@services/api';
import { formatPercent, formatUptime, getPhaseDisplayName } from '@utils/index';
import type { PhaseProgress, ServiceStatus } from '@/types';

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
  const { metrics, services, phaseProgress, connected } = useSystemStore();
  const { targets } = useReconStore();
  const { stats: lootStats } = useLootStore();
  const { thoughts } = useAIStore();
  const { addToast, setActiveView } = useUIStore();
  const [activeScans, setActiveScans] = useState<ActiveScan[]>([]);
  const [scanTarget, setScanTarget] = useState('');
  const [launching, setLaunching] = useState(false);

  // Poll active scans
  useEffect(() => {
    const poll = async () => {
      try {
        const response = await apiService.getActiveScans();
        setActiveScans(response.active_scans || []);
      } catch { /* API unreachable */ }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, []);

  // Get targets from config for quick-launch
  useEffect(() => {
    apiService.getTargets().then((t) => {
      if (t.length > 0 && !scanTarget) setScanTarget(t[0]);
    }).catch(() => {});
  }, []); // eslint-disable-line

  const launchScan = useCallback(async () => {
    if (!scanTarget.trim()) return;
    setLaunching(true);
    try {
      const result = await apiService.startRecon(scanTarget.trim(), []);
      addToast({ type: 'success', message: `Scan launched: ${result.scan_id}`, duration: 4000 });
    } catch (err: any) {
      addToast({ type: 'error', message: err.message || 'Scan launch failed', duration: 5000 });
    } finally {
      setLaunching(false);
    }
  }, [scanTarget, addToast]);

  const recentThoughts = thoughts.slice(-5);
  const phasePercent = calculatePhaseProgress(phaseProgress);

  const serviceList: Array<{ key: string; label: string; status: ServiceStatus }> = [
    { key: 'api', label: 'API', status: connected ? 'running' : 'stopped' },
    { key: 'msf', label: 'MSF', status: services.metasploitRpc },
    { key: 'zap', label: 'ZAP', status: services.zap },
    { key: 'burp', label: 'BURP', status: services.burp },
  ];

  return (
    <div className="h-full overflow-auto p-5 space-y-5">
      {/* ── Header with scan launcher ──────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-[var(--grok-text-heading)] flex items-center gap-2">
            <Crosshair className="w-5 h-5 text-[var(--grok-exploit-red)]" />
            Command Center
          </h1>
          <p className="text-[10px] text-[var(--grok-text-muted)] mt-0.5 font-mono uppercase tracking-wider">
            {connected ? 'Systems Online' : 'Waiting for connection...'}
          </p>
        </div>

        {/* Quick scan launcher */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={scanTarget}
            onChange={(e) => setScanTarget(e.target.value)}
            placeholder="target.com"
            className="px-3 py-1.5 text-xs font-mono bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded text-[var(--grok-text-body)] w-48 focus:border-[var(--grok-recon-blue)] focus:outline-none"
            onKeyDown={(e) => e.key === 'Enter' && launchScan()}
          />
          <button
            onClick={launchScan}
            disabled={launching || !scanTarget.trim()}
            className="cs-btn cs-btn-primary flex items-center gap-1.5 disabled:opacity-40"
          >
            {launching ? (
              <Activity className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            Launch Scan
          </button>
        </div>
      </div>

      {/* ── Telemetry strip ────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-3">
        <TelemetryCard
          icon={<Cpu className="w-4 h-4" />}
          label="CPU"
          value={formatPercent(metrics.cpu)}
          color={metrics.cpu > 80 ? 'var(--grok-error)' : 'var(--grok-scan-cyan)'}
        />
        <TelemetryCard
          icon={<HardDrive className="w-4 h-4" />}
          label="RAM"
          value={formatPercent(metrics.memory)}
          color={metrics.memory > 80 ? 'var(--grok-warning)' : 'var(--grok-ai-purple)'}
        />
        <TelemetryCard
          icon={metrics.vpnIp ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
          label="VPN"
          value={metrics.vpnIp || 'OFF'}
          color={metrics.vpnIp ? 'var(--grok-success)' : 'var(--grok-text-muted)'}
        />
        <TelemetryCard
          icon={<Clock className="w-4 h-4" />}
          label="Uptime"
          value={formatUptime(metrics.uptime)}
          color="var(--grok-text-body)"
        />
        <TelemetryCard
          icon={<Target className="w-4 h-4" />}
          label="Targets"
          value={String(targets.length)}
          color="var(--grok-recon-blue)"
        />
      </div>

      {/* ── Service health strip ───────────────────────────────── */}
      <div className="cs-panel p-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)]">
            Services
          </span>
          <button
            onClick={() => setActiveView('services')}
            className="text-[10px] text-[var(--grok-recon-blue)] hover:underline"
          >
            Manage
          </button>
        </div>
        <div className="flex items-center gap-4 mt-2">
          {serviceList.map((svc) => (
            <div key={svc.key} className="flex items-center gap-1.5">
              <div
                className={`status-dot ${
                  svc.status === 'running'
                    ? 'status-dot-running'
                    : svc.status === 'error'
                    ? 'status-dot-error'
                    : 'status-dot-stopped'
                }`}
              />
              <span className="text-xs font-mono text-[var(--grok-text-body)]">
                {svc.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── Active Scans ──────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-3">
          <div className="cs-panel">
            <div className="cs-panel-header flex items-center justify-between">
              <span>Active Operations ({activeScans.length})</span>
              {activeScans.length > 0 && (
                <span className="text-[var(--grok-recon-blue)] animate-pulse-glow">LIVE</span>
              )}
            </div>
            <div className="p-3 space-y-3">
              {activeScans.length === 0 ? (
                <div className="text-center py-8 text-xs text-[var(--grok-text-muted)]">
                  No active scans. Launch a scan above to begin.
                </div>
              ) : (
                activeScans.map((scan) => (
                  <div
                    key={scan.scan_id}
                    className="p-3 bg-[var(--grok-surface-2)] rounded border border-[var(--grok-border)] animate-fade-in"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-[var(--grok-recon-blue)] rounded-full animate-pulse" />
                        <span className="text-sm font-mono font-semibold text-[var(--grok-text-heading)]">
                          {scan.target}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-[var(--grok-text-muted)]">
                        {scan.scan_id.substring(0, 12)}
                      </span>
                    </div>

                    {scan.current_phase && (
                      <div className="text-xs text-[var(--grok-scan-cyan)] font-mono mb-2">
                        Phase: {getPhaseDisplayName(scan.current_phase as any)}
                      </div>
                    )}

                    {scan.running_tools && scan.running_tools.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {scan.running_tools.map((tool) => (
                          <span
                            key={tool}
                            className="text-[10px] font-mono px-2 py-0.5 bg-[var(--grok-recon-blue)]/10 text-[var(--grok-recon-blue)] rounded border border-[var(--grok-recon-blue)]/20"
                          >
                            {tool}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Phase progress */}
          <div className="cs-panel p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)]">
                Pipeline Phase
              </span>
              <span className="text-xs font-mono text-[var(--grok-text-heading)]">
                {phasePercent}%
              </span>
            </div>
            {/* Progress bar */}
            <div className="w-full h-1.5 bg-[var(--grok-surface-3)] rounded-full overflow-hidden mb-4">
              <div
                className="h-full bg-[var(--grok-recon-blue)] rounded-full transition-all duration-500"
                style={{ width: `${phasePercent}%` }}
              />
            </div>
            <div className="flex justify-between">
              {(['recon', 'ai', 'zap', 'metasploit', 'exploit'] as const).map((phase) => {
                const isComplete = getPhaseComplete(phaseProgress, phase);
                const isActive = phaseProgress.currentPhase === phase;
                return (
                  <div key={phase} className="flex flex-col items-center gap-1">
                    <div
                      className={`w-6 h-6 rounded-full border flex items-center justify-center text-[8px] font-bold transition-all ${
                        isComplete
                          ? 'bg-[var(--grok-success)] border-[var(--grok-success)] text-black'
                          : isActive
                          ? 'border-[var(--grok-recon-blue)] text-[var(--grok-recon-blue)] animate-pulse'
                          : 'border-[var(--grok-border)] text-[var(--grok-text-muted)]'
                      }`}
                    >
                      {isComplete ? '\u2713' : ''}
                    </div>
                    <span className="text-[9px] text-[var(--grok-text-muted)]">
                      {getPhaseDisplayName(phase)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Right column — stats + AI feed ───────────────────── */}
        <div className="space-y-3">
          {/* Loot counters */}
          <div className="cs-panel p-4 space-y-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)]">
              Loot
            </span>
            <div className="grid grid-cols-2 gap-2">
              <StatBlock
                label="Total"
                value={lootStats.totalItems}
                icon={<Trophy className="w-3.5 h-3.5 text-[var(--grok-loot-green)]" />}
              />
              <StatBlock
                label="Creds"
                value={lootStats.validatedCredentials}
                icon={<Shield className="w-3.5 h-3.5 text-[var(--grok-warning)]" />}
              />
              <StatBlock
                label="Ports"
                value={lootStats.byCategory.port || 0}
                icon={<Zap className="w-3.5 h-3.5 text-[var(--grok-scan-cyan)]" />}
              />
              <StatBlock
                label="Targets"
                value={lootStats.uniqueTargets}
                icon={<Target className="w-3.5 h-3.5 text-[var(--grok-recon-blue)]" />}
              />
            </div>
          </div>

          {/* AI activity feed */}
          <div className="cs-panel">
            <div className="cs-panel-header flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Brain className="w-3 h-3 text-[var(--grok-ai-purple)]" />
                AI Feed
              </span>
              <button
                onClick={() => setActiveView('ai-stream')}
                className="text-[10px] text-[var(--grok-ai-purple)] hover:underline"
              >
                View All
              </button>
            </div>
            <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
              {recentThoughts.length === 0 ? (
                <p className="text-xs text-[var(--grok-text-muted)] text-center py-4">
                  No AI activity yet
                </p>
              ) : (
                recentThoughts.map((t) => (
                  <div
                    key={t.id}
                    className="text-[11px] text-[var(--grok-text-body)] font-mono p-2 bg-[var(--grok-surface-2)] rounded border-l-2 border-[var(--grok-ai-purple)] animate-fade-in"
                  >
                    {t.content.length > 120 ? t.content.slice(0, 120) + '...' : t.content}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Helper components ────────────────────────────────────────── */

function TelemetryCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="cs-panel p-3">
      <div className="flex items-center gap-2 mb-1" style={{ color }}>
        {icon}
        <span className="metric-label">{label}</span>
      </div>
      <div className="text-sm font-mono font-semibold text-[var(--grok-text-heading)] truncate">
        {value}
      </div>
    </div>
  );
}

function StatBlock({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 p-2 bg-[var(--grok-surface-2)] rounded">
      {icon}
      <div>
        <div className="text-xs font-mono font-bold text-[var(--grok-text-heading)]">{value}</div>
        <div className="text-[9px] text-[var(--grok-text-muted)]">{label}</div>
      </div>
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
  return Math.round((phases.filter(Boolean).length / phases.length) * 100);
}

function getPhaseComplete(progress: PhaseProgress, phase: string): boolean {
  const map: Record<string, boolean> = {
    recon: progress.reconComplete,
    ai: progress.aiAnalysisComplete,
    zap: progress.zapScanComplete,
    metasploit: progress.metasploitScanComplete,
    exploit: progress.exploitationComplete,
  };
  return map[phase] || false;
}
