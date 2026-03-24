/**
 * Dashboard — CStrike v2 Command Center
 *
 * Operational overview with:
 * - System telemetry (CPU, RAM, VPN, uptime)
 * - Service health strip
 * - Scan launcher
 * - Active scan tracker with live phase progress
 * - Vulnerability severity distribution (donut chart)
 * - Port distribution (bar chart)
 * - Loot counters with category breakdown
 * - Recent findings feed
 * - AI activity feed
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
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
  AlertTriangle,
  Globe,
  Lock,
  Unlock,
  FileText,
  Radio,
  ChevronRight,
  Server,
  Hash,
  Key,
  CalendarClock,
  Network,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';
import { useSystemStore } from '@stores/systemStore';
import { useReconStore } from '@stores/reconStore';
import { useLootStore } from '@stores/lootStore';
import { useAIStore } from '@stores/aiStore';
import { useUIStore } from '@stores/uiStore';
import { useExploitTrackStore } from '@stores/exploitTrackStore';
import { ExploitTrackPanel } from '@modules/exploitation/components/ExploitTrackPanel';
import { apiService } from '@services/api';
import { formatPercent, formatUptime, formatNumber } from '@utils/index';
import type { ServiceStatus } from '@/types';

interface ActiveScan {
  scan_id: string;
  target: string;
  tools: string[];
  running_tools?: string[];
  started_at: string;
  status: string;
  current_phase?: string;
  phase?: string;
  progress?: string;
}

interface ScanHistoryPoint {
  time: string;
  scans: number;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ff0033',
  high: '#ff4400',
  medium: '#ffaa00',
  low: '#00ccdd',
  info: '#6a6a80',
};

const PORT_COLORS = ['#2266ff', '#00ccdd', '#8844ff', '#00cc66', '#ffaa00', '#ff2040'];

export function DashboardView() {
  const { metrics, services, connected } = useSystemStore();
  const { targets, loadTargets } = useReconStore();
  const { stats: lootStats, items: lootItems, addLootItem } = useLootStore();
  const { thoughts, loadThoughts } = useAIStore();
  const { addToast, setActiveView } = useUIStore();
  const exploitTracks = useExploitTrackStore((s) => s.tracks);
  const [activeScans, setActiveScans] = useState<ActiveScan[]>([]);
  const [scanTarget, setScanTarget] = useState('');
  const [launching, setLaunching] = useState(false);
  const [scanHistory, setScanHistory] = useState<ScanHistoryPoint[]>([]);
  const [resultsData, setResultsData] = useState<{
    ports: Array<{ port: number; state: string; service?: string }>;
    vulns: Array<{ severity: string }>;
    subdomains: number;
    httpEndpoints: number;
  }>({ ports: [], vulns: [], subdomains: 0, httpEndpoints: 0 });

  // Poll active scans + fetch results summary
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

  // Fetch scan results for charts
  useEffect(() => {
    const fetchResults = async () => {
      try {
        const targetsData = await apiService.getTargets();
        if (targetsData.length > 0) {
          // Get results from first target for dashboard charts
          const results = await apiService.getTargetResults(targetsData[0].url);
          setResultsData({
            ports: results.ports || [],
            vulns: results.vulnerabilities || [],
            subdomains: results.subdomains?.length || 0,
            httpEndpoints: results.httpEndpoints?.length || 0,
          });
        }
      } catch { /* No results yet */ }
    };
    fetchResults();

    // Generate mock scan history from loot timestamps
    const now = Date.now();
    const history: ScanHistoryPoint[] = [];
    for (let i = 11; i >= 0; i--) {
      const t = now - i * 5 * 60 * 1000;
      const count = lootItems.filter((l) => l.timestamp > t - 5 * 60 * 1000 && l.timestamp <= t).length;
      history.push({
        time: new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        scans: count,
      });
    }
    setScanHistory(history);
  }, [lootItems]);

  // Get targets for quick-launch
  useEffect(() => {
    apiService.getTargets().then((t) => {
      if (t.length > 0 && !scanTarget) setScanTarget(t[0].url);
    }).catch(() => {});
  }, []); // eslint-disable-line

  // Hydrate reconStore targets from the DB on first mount so the Target counter
  // and scan-launcher dropdown reflect persisted data after a page reload.
  useEffect(() => {
    loadTargets();
  }, []); // eslint-disable-line

  // Hydrate lootStore from the DB on first mount.  We fetch all loot items
  // (target = 'all') and add them individually.  addLootItem deduplicates by
  // value + category + target so live WebSocket events arriving later won't
  // create duplicates.  Historical timestamps are preserved so the Findings
  // Activity graph reflects real scan times rather than the current wall-clock.
  useEffect(() => {
    const hydrateLoot = async () => {
      try {
        const items = await apiService.getLoot('all');
        for (const item of items) {
          addLootItem(item);
        }
      } catch {
        // API unreachable — loot store stays empty until WebSocket delivers live data.
      }
    };
    hydrateLoot();
  }, []); // eslint-disable-line

  // Hydrate aiStore thoughts from the DB on first mount.  addThought deduplicates
  // by thoughtType + content so live WebSocket events arriving later won't repeat
  // thoughts already loaded from history.
  useEffect(() => {
    loadThoughts();
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

  // Computed data for charts
  const sevCounts = useMemo(() => {
    const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    resultsData.vulns.forEach((v) => {
      const s = (v.severity || 'info').toLowerCase();
      counts[s] = (counts[s] || 0) + 1;
    });
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value, color: SEVERITY_COLORS[name] || '#6a6a80' }));
  }, [resultsData.vulns]);

  const portDistribution = useMemo(() => {
    const serviceCounts: Record<string, number> = {};
    resultsData.ports
      .filter((p) => p.state === 'open')
      .forEach((p) => {
        const svc = p.service || 'unknown';
        serviceCounts[svc] = (serviceCounts[svc] || 0) + 1;
      });
    return Object.entries(serviceCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([name, count]) => ({ name, count }));
  }, [resultsData.ports]);

  const openPorts = resultsData.ports.filter((p) => p.state === 'open').length;
  const totalVulns = resultsData.vulns.length;
  const recentThoughts = thoughts.slice(-50);
  const serviceList: Array<{ key: string; label: string; status: ServiceStatus }> = [
    { key: 'api', label: 'API', status: connected ? 'running' : 'stopped' },
    { key: 'msf', label: 'MSF', status: services.metasploitRpc },
    { key: 'zap', label: 'ZAP', status: services.zap },
    { key: 'burp', label: 'BURP', status: services.burp },
    { key: 'psql', label: 'PSQL', status: services.postgresql ?? 'stopped' },
    { key: 'redis', label: `REDIS${metrics.serviceHosts?.redis ? ` (${metrics.serviceHosts.redis})` : ''}`, status: services.redis ?? 'stopped' },
    { key: 'ollama', label: `OLLAMA${metrics.serviceHosts?.ollama ? ` (${metrics.serviceHosts.ollama})` : ''}`, status: services.ollama ?? 'stopped' },
    { key: 'docker', label: 'DOCKER', status: services.docker ?? 'stopped' },
  ];

  // Per-target pipeline stage logic
  const PIPELINE_STAGES = ['recon', 'ai_analysis_1', 'web_scans', 'exploitation', 'post_exploitation', 'complete'] as const;
  type PipelineStage = typeof PIPELINE_STAGES[number];
  const STAGE_LABELS: Record<PipelineStage, string> = {
    recon: 'Rcn',
    ai_analysis_1: 'AI',
    web_scans: 'Web',
    exploitation: 'Exp',
    post_exploitation: 'Shl',
    complete: 'Done',
  };

  // Map a current_phase value to a pipeline stage index (-1 = none started)
  const phaseToStageIndex = (phase: string | undefined): number => {
    const phaseMap: Record<string, number> = {
      idle: -1,
      recon: 0,
      ai_analysis_1: 1,
      ai_analysis: 1,
      web_scans: 2,
      vulnapi: 2,
      metasploit: 3,
      exploitation: 3,
      ai_analysis_2: 3,
      post_exploitation: 4,
      post_exploit: 4,
      reporting: 5,
      complete: 5,
    };
    return phaseMap[phase ?? ''] ?? -1;
  };

  // Target status pill derived from active scan state
  const getTargetScanStatus = (targetUrl: string): { label: string; color: string } | null => {
    const scan = activeScans.find((s) => s.target === targetUrl || s.target.includes(targetUrl) || targetUrl.includes(s.target));
    if (!scan) return null;
    const phase = scan.current_phase || scan.phase || '';
    if (phase === 'complete' || scan.status === 'completed') return { label: 'DONE', color: 'var(--grok-success)' };
    if (phaseToStageIndex(phase) >= 3) return { label: 'EXPLOITED', color: 'var(--grok-exploit-red)' };
    if (phaseToStageIndex(phase) >= 2) return { label: 'SCANNING', color: 'var(--grok-recon-blue)' };
    return { label: 'RECON', color: 'var(--grok-scan-cyan)' };
  };

  // Color keyword segments in AI thought content
  const colorizeThought = (content: string, thoughtType: string): React.ReactNode => {
    const typeColors: Record<string, string> = {
      reasoning: 'var(--grok-ai-purple)',
      command: 'var(--grok-recon-blue)',
      decision: 'var(--grok-scan-cyan)',
      observation: 'var(--grok-text-body)',
      ai_prompt: 'var(--grok-ai-purple)',
      ai_response: 'var(--grok-loot-green)',
      ai_decision: 'var(--grok-scan-cyan)',
      ai_execution: 'var(--grok-warning)',
    };
    const color = typeColors[thoughtType] || 'var(--grok-text-body)';
    const truncated = content.length > 180 ? content.slice(0, 180) + '...' : content;
    return <span style={{ color }}>{truncated}</span>;
  };

  // Recent loot items for activity feed
  const recentActivity = useMemo(() => {
    return [...lootItems]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20);
  }, [lootItems]);

  return (
    <div className="h-full overflow-y-auto p-5 flex flex-col gap-5">

      {/* ── Row 1: Header with scan launcher ───────────────────── */}
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
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={scanTarget}
            onChange={(e) => setScanTarget(e.target.value)}
            placeholder="http://target.com"
            className="px-3 py-1.5 text-xs font-mono bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded text-[var(--grok-text-body)] w-56 focus:border-[var(--grok-recon-blue)] focus:outline-none"
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

      {/* ── Row 2: Telemetry strip ──────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {/* Combined CPU / RAM / Uptime / Date-Time */}
        <div className="cs-panel p-3 relative overflow-hidden">
          <div className="flex items-center gap-3 text-xs font-mono flex-wrap">
            <span className="flex items-center gap-1" style={{ color: metrics.cpu > 80 ? 'var(--grok-error)' : 'var(--grok-scan-cyan)' }}>
              <Cpu className="w-3.5 h-3.5" /> {formatPercent(metrics.cpu)}
            </span>
            <span className="text-[var(--grok-border)]">/</span>
            <span className="flex items-center gap-1" style={{ color: metrics.memory > 80 ? 'var(--grok-warning)' : 'var(--grok-ai-purple)' }}>
              <HardDrive className="w-3.5 h-3.5" /> {formatPercent(metrics.memory)}
            </span>
            <span className="text-[var(--grok-border)]">/</span>
            <span className="flex items-center gap-1 text-[var(--grok-text-body)]">
              <Clock className="w-3.5 h-3.5" /> {formatUptime(metrics.uptime)}
            </span>
            <span className="text-[var(--grok-border)]">/</span>
            <span className="flex items-center gap-1 text-[var(--grok-text-muted)]">
              <CalendarClock className="w-3.5 h-3.5" /> {new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <div
            className="absolute bottom-0 left-0 h-0.5 transition-all duration-1000"
            style={{ width: `${metrics.cpu}%`, backgroundColor: metrics.cpu > 80 ? 'var(--grok-error)' : 'var(--grok-scan-cyan)' }}
          />
        </div>

        {/* VPN + Network interfaces */}
        <div className="cs-panel p-3">
          <div className="flex items-center gap-3 text-xs font-mono flex-wrap">
            <span className="flex items-center gap-1" style={{ color: metrics.vpnIp ? 'var(--grok-success)' : 'var(--grok-text-muted)' }}>
              {metrics.vpnIp ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              VPN: {metrics.vpnIp || 'OFF'}
            </span>
            <span className="text-[var(--grok-border)]">|</span>
            <span className="flex items-center gap-1 text-[var(--grok-text-body)]">
              <Network className="w-3.5 h-3.5 text-[var(--grok-scan-cyan)]" />
              MGMT: {metrics.mgmtIpInternal || '---'}
              <span className="text-[var(--grok-text-muted)]">INT</span>
              / {metrics.mgmtIpPublic || '---'}
              <span className="text-[var(--grok-text-muted)]">PUB</span>
            </span>
          </div>
          {metrics.opsIpInternal && (
            <div className="flex items-center gap-1 text-xs font-mono mt-1 text-[var(--grok-text-body)]">
              <span className="ml-5">OPS: {metrics.opsIpInternal}</span>
              <span className="text-[var(--grok-text-muted)]">INT</span>
              / {metrics.opsIpPublic || '---'}
              <span className="text-[var(--grok-text-muted)]">PUB</span>
            </div>
          )}
        </div>

        {/* Targets count */}
        <TelemetryCard
          icon={<Target className="w-4 h-4" />}
          label="Targets"
          value={String(targets.length)}
          color="var(--grok-recon-blue)"
        />
      </div>

      {/* ── Row 3: Service health strip (full width) ────────────── */}
      <div className="cs-panel p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)]">
            Services
          </span>
          <button
            onClick={() => setActiveView('services')}
            className="text-[10px] text-[var(--grok-recon-blue)] hover:underline flex items-center gap-0.5"
          >
            Manage <ChevronRight className="w-3 h-3" />
          </button>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
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

      {/* ── Row 4: Quick stats (5-column) ───────────────────────── */}
      <div className="grid grid-cols-5 gap-3">
        <QuickStat
          icon={<Server className="w-4 h-4" />}
          label="Open Ports"
          value={openPorts}
          color="var(--grok-recon-blue)"
          onClick={() => setActiveView('results')}
        />
        <QuickStat
          icon={<AlertTriangle className="w-4 h-4" />}
          label="Vulnerabilities"
          value={totalVulns}
          color="var(--grok-exploit-red)"
          onClick={() => setActiveView('results')}
        />
        <QuickStat
          icon={<Globe className="w-4 h-4" />}
          label="Subdomains"
          value={resultsData.subdomains}
          color="var(--grok-scan-cyan)"
          onClick={() => setActiveView('results')}
        />
        <QuickStat
          icon={<Trophy className="w-4 h-4" />}
          label="Total Loot"
          value={lootStats.totalItems}
          color="var(--grok-loot-green)"
          onClick={() => setActiveView('loot')}
        />
        <QuickStat
          icon={<Brain className="w-4 h-4" />}
          label="AI Insights"
          value={thoughts.length}
          color="var(--grok-ai-purple)"
          onClick={() => setActiveView('ai-stream')}
        />
      </div>

      {/* ── Row 5: Charts (3-column equal) ──────────────────────── */}
      <div className="grid grid-cols-3 gap-3">

        {/* Vuln Severity donut */}
        <div className="cs-panel p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)] mb-3">
            Vuln Severity
          </div>
          {sevCounts.length > 0 ? (
            <div className="flex items-center gap-4">
              <div className="w-28 h-28 flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={sevCounts}
                      cx="50%"
                      cy="50%"
                      innerRadius={28}
                      outerRadius={48}
                      paddingAngle={3}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {sevCounts.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5 flex-1 min-w-0">
                {['critical', 'high', 'medium', 'low', 'info'].map((sev) => {
                  const entry = sevCounts.find((s) => s.name === sev);
                  return (
                    <div key={sev} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: SEVERITY_COLORS[sev] || '#6a6a80' }} />
                        <span className="text-[11px] text-[var(--grok-text-body)] capitalize">{sev}</span>
                      </div>
                      <span className="text-xs font-mono font-bold text-[var(--grok-text-heading)]">{entry?.value ?? 0}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyChart label="No vulnerabilities detected" />
          )}
        </div>

        {/* Open Services bar chart */}
        <div className="cs-panel p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)] mb-3">
            Open Services
          </div>
          {portDistribution.length > 0 ? (
            <div className="h-28">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={portDistribution} barSize={16}>
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 9, fill: '#6a6a80' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{
                      background: '#12121a',
                      border: '1px solid #2a2a3a',
                      borderRadius: 6,
                      fontSize: 11,
                      color: '#e8e8f0',
                    }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {portDistribution.map((_, i) => (
                      <Cell key={i} fill={PORT_COLORS[i % PORT_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyChart label="No open ports detected" />
          )}
        </div>

        {/* Findings Activity area chart */}
        <div className="cs-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)]">
              Findings Activity
            </span>
            <span className="text-[10px] text-[var(--grok-text-muted)]">Last 60 min</span>
          </div>
          <div className="h-28">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={scanHistory}>
                <defs>
                  <linearGradient id="activityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2266ff" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#2266ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 8, fill: '#6a6a80' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <Area
                  type="monotone"
                  dataKey="scans"
                  stroke="#2266ff"
                  fill="url(#activityGrad)"
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Row 6: Targets + Findings (50/50) ───────────────────── */}
      <div className="grid grid-cols-2 gap-3">

        {/* Targets panel with per-target pipeline */}
        <div className="cs-panel">
          <div className="cs-panel-header flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Target className="w-3 h-3 text-[var(--grok-recon-blue)]" />
              Targets
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--grok-recon-blue)]/10 text-[var(--grok-recon-blue)]">
              {targets.length} hosts
            </span>
          </div>
          <div className="p-2 space-y-1.5 overflow-y-auto">
            {targets.length === 0 ? (
              <p className="text-xs text-[var(--grok-text-muted)] text-center py-6">
                No targets — launch a scan above
              </p>
            ) : (
              targets.map((tgt) => {
                const scan = activeScans.find((s) =>
                  s.target === tgt.url || s.target.includes(tgt.url) || tgt.url.includes(s.target)
                );
                const currentPhase = scan?.current_phase || scan?.phase;
                const activeStageIdx = scan ? phaseToStageIndex(currentPhase) : -2;
                const scanStatus = getTargetScanStatus(tgt.url);
                const isPausedScan = scan?.status === 'paused';

                return (
                  <div
                    key={tgt.id}
                    className="flex items-center gap-2 px-2 py-2 bg-[var(--grok-surface-2)] rounded border border-[var(--grok-border)] hover:border-[var(--grok-border-glow)] transition-colors"
                  >
                    {/* IP / URL */}
                    <span className="text-[11px] font-mono font-bold text-[var(--grok-text-heading)] w-32 truncate flex-shrink-0">
                      {tgt.ip || tgt.url.replace(/^https?:\/\//, '').split('/')[0]}
                    </span>

                    {/* Hostname (url) */}
                    <span className="text-[10px] text-[var(--grok-text-muted)] truncate w-28 flex-shrink-0 hidden lg:block">
                      {tgt.url.replace(/^https?:\/\//, '').split('/')[0]}
                    </span>

                    {/* 6-stage pipeline bars */}
                    <div className="flex flex-col flex-1 gap-0.5 min-w-0">
                      <div className="flex gap-px">
                        {PIPELINE_STAGES.map((stage, idx) => {
                          const isComplete = activeStageIdx > idx || activeStageIdx === 5;
                          const isActive = activeStageIdx === idx && !isPausedScan;
                          const isPausedStage = activeStageIdx === idx && isPausedScan;
                          let bg = '#21262d'; // pending grey
                          if (isComplete) bg = '#3fb950';
                          else if (isActive) bg = '#58a6ff';
                          else if (isPausedStage) bg = '#d29922';
                          return (
                            <div
                              key={stage}
                              className={`h-[3px] flex-1 rounded-sm transition-colors ${isActive ? 'animate-pulse' : ''}`}
                              style={{ backgroundColor: bg }}
                            />
                          );
                        })}
                      </div>
                      <div className="flex gap-px">
                        {PIPELINE_STAGES.map((stage, idx) => {
                          const isComplete = activeStageIdx > idx || activeStageIdx === 5;
                          const isActive = activeStageIdx === idx;
                          let labelColor = '#4a4a5a'; // pending
                          if (isComplete) labelColor = '#3fb950';
                          else if (isActive) labelColor = '#58a6ff';
                          return (
                            <span
                              key={stage}
                              className="flex-1 text-center"
                              style={{ fontSize: '6px', color: labelColor, lineHeight: '1.2', fontFamily: 'monospace', textTransform: 'uppercase' }}
                            >
                              {STAGE_LABELS[stage]}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    {/* Status pill */}
                    {scanStatus ? (
                      <span
                        className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                        style={{
                          color: scanStatus.color,
                          backgroundColor: `${scanStatus.color}18`,
                          border: `1px solid ${scanStatus.color}40`,
                        }}
                      >
                        {scanStatus.label}
                      </span>
                    ) : (
                      <span className="text-[9px] font-mono text-[var(--grok-text-muted)] flex-shrink-0 w-16 text-right">
                        {tgt.status.toUpperCase()}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Findings panel */}
        <div className="cs-panel">
          <div className="cs-panel-header flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Shield className="w-3 h-3 text-[var(--grok-warning)]" />
              Findings
            </span>
            <div className="flex items-center gap-2">
              {resultsData.vulns.length > 0 && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--grok-exploit-red)]/10 text-[var(--grok-exploit-red)]">
                  {resultsData.vulns.length} new
                </span>
              )}
              <button
                onClick={() => setActiveView('results')}
                className="text-[10px] text-[var(--grok-warning)] hover:underline"
              >
                View All
              </button>
            </div>
          </div>
          <div className="p-2 space-y-1 overflow-y-auto">
            {resultsData.vulns.length === 0 && resultsData.ports.length === 0 ? (
              <p className="text-xs text-[var(--grok-text-muted)] text-center py-6">
                No findings yet — run a scan
              </p>
            ) : (
              <>
                {resultsData.vulns.slice(0, 6).map((v, i) => {
                  const sev = (v.severity || 'info').toLowerCase();
                  const sevColor = SEVERITY_COLORS[sev] || '#6a6a80';
                  const targetLabel = targets[0]?.ip || targets[0]?.url.replace(/^https?:\/\//, '').split('/')[0] || '---';
                  return (
                    <div key={`v-${i}`} className="flex items-center gap-2 py-1 px-2 bg-[var(--grok-surface-2)] rounded">
                      <span
                        className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0 w-10 text-center"
                        style={{ color: sevColor, backgroundColor: `${sevColor}18`, border: `1px solid ${sevColor}40` }}
                      >
                        {sev === 'critical' ? 'CRIT' : sev.slice(0, 4).toUpperCase()}
                      </span>
                      <span className="text-[11px] font-mono text-[var(--grok-scan-cyan)] flex-shrink-0 w-24 truncate">
                        {targetLabel}
                      </span>
                      <span className="text-[11px] text-[var(--grok-text-body)] truncate">
                        {sev.charAt(0).toUpperCase() + sev.slice(1)} vulnerability detected
                      </span>
                    </div>
                  );
                })}
                {resultsData.ports.filter((p) => p.state === 'open').slice(0, 4).map((p, i) => {
                  const targetLabel = targets[0]?.ip || targets[0]?.url.replace(/^https?:\/\//, '').split('/')[0] || '---';
                  return (
                    <div key={`p-${i}`} className="flex items-center gap-2 py-1 px-2 bg-[var(--grok-surface-2)] rounded">
                      <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0 w-10 text-center text-[var(--grok-recon-blue)] bg-[var(--grok-recon-blue)]/10 border border-[var(--grok-recon-blue)]/30">
                        PORT
                      </span>
                      <span className="text-[11px] font-mono text-[var(--grok-scan-cyan)] flex-shrink-0 w-24 truncate">
                        {targetLabel}
                      </span>
                      <span className="text-[11px] text-[var(--grok-text-body)] truncate font-mono">
                        :{p.port} {p.service || 'unknown'}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Row 7: Exploitation Tracks (conditional) ───────────── */}
      {exploitTracks.length > 0 && (
        <ExploitTrackPanel tracks={exploitTracks} className="overflow-y-auto" />
      )}

      {/* ── Row 8: Bottom 3-column (Loot / AI Stream / Activity) ── */}
      <div className="grid grid-cols-3 gap-3">

        {/* Loot panel */}
        <div className="cs-panel p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)]">
              Loot
            </span>
            <button
              onClick={() => setActiveView('loot')}
              className="text-[10px] text-[var(--grok-loot-green)] hover:underline flex items-center gap-0.5"
            >
              View All <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-1.5">
            <LootRow icon={<Lock className="w-3 h-3" />} label="Credentials" value={lootStats.byCategory.credential || 0} color="var(--grok-warning)" />
            <LootRow icon={<Unlock className="w-3 h-3" />} label="Passwords" value={lootStats.byCategory.password || 0} color="var(--grok-exploit-red)" />
            <LootRow icon={<Hash className="w-3 h-3" />} label="Hashes" value={lootStats.byCategory.hash || 0} color="var(--grok-ai-purple)" />
            <LootRow icon={<Globe className="w-3 h-3" />} label="URLs" value={lootStats.byCategory.url || 0} color="var(--grok-scan-cyan)" />
            <LootRow icon={<Zap className="w-3 h-3" />} label="Ports" value={lootStats.byCategory.port || 0} color="var(--grok-recon-blue)" />
            <LootRow icon={<FileText className="w-3 h-3" />} label="Files" value={lootStats.byCategory.file || 0} color="var(--grok-loot-green)" />
            {(lootStats.byCategory.token || 0) > 0 && (
              <LootRow icon={<Key className="w-3 h-3" />} label="Tokens" value={lootStats.byCategory.token} color="var(--grok-warning)" />
            )}
            {(lootStats.byCategory.api_key || 0) > 0 && (
              <LootRow icon={<Key className="w-3 h-3" />} label="API Keys" value={lootStats.byCategory.api_key} color="var(--grok-exploit-red)" />
            )}
            {(lootStats.byCategory.session || 0) > 0 && (
              <LootRow icon={<Key className="w-3 h-3" />} label="Sessions" value={lootStats.byCategory.session} color="var(--grok-ai-purple)" />
            )}
          </div>
          <div className="pt-2 border-t border-[var(--grok-border)]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[var(--grok-text-body)]">Validated Creds</span>
              <span className="text-xs font-mono font-bold text-[var(--grok-success)]">
                {lootStats.validatedCredentials}
              </span>
            </div>
          </div>
        </div>

        {/* AI Stream panel */}
        <div className="cs-panel flex flex-col">
          <div className="cs-panel-header flex items-center justify-between flex-shrink-0">
            <span className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[var(--grok-ai-purple)] animate-pulse" />
              <Brain className="w-3 h-3 text-[var(--grok-ai-purple)]" />
              AI Stream
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--grok-ai-purple)]/15 text-[var(--grok-ai-purple)] border border-[var(--grok-ai-purple)]/30">
                Analyzing
              </span>
              <button
                onClick={() => setActiveView('ai-stream')}
                className="text-[10px] text-[var(--grok-ai-purple)] hover:underline"
              >
                View All
              </button>
            </div>
          </div>
          <div className="p-2 space-y-1 overflow-y-auto flex-1">
            {recentThoughts.length === 0 ? (
              <p className="text-xs text-[var(--grok-text-muted)] text-center py-4">
                No AI activity yet
              </p>
            ) : (
              recentThoughts.slice(-12).map((t) => (
                <div
                  key={t.id}
                  className="text-[10px] font-mono leading-relaxed animate-fade-in"
                >
                  <span className="text-[var(--grok-text-muted)] mr-1">
                    {new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  {colorizeThought(t.content, t.thoughtType)}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Activity feed panel */}
        <div className="cs-panel flex flex-col">
          <div className="cs-panel-header flex items-center justify-between flex-shrink-0">
            <span className="flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-[var(--grok-loot-green)]" />
              Activity
            </span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--grok-loot-green)]/10 text-[var(--grok-loot-green)] border border-[var(--grok-loot-green)]/30 flex items-center gap-1">
              <Radio className="w-2.5 h-2.5" /> Live
            </span>
          </div>
          <div className="p-2 space-y-1 overflow-y-auto flex-1">
            {recentActivity.length === 0 ? (
              <p className="text-xs text-[var(--grok-text-muted)] text-center py-4">
                No activity yet
              </p>
            ) : (
              recentActivity.map((item) => {
                const catColors: Record<string, string> = {
                  credential: 'var(--grok-warning)',
                  password: 'var(--grok-exploit-red)',
                  hash: 'var(--grok-ai-purple)',
                  url: 'var(--grok-scan-cyan)',
                  port: 'var(--grok-recon-blue)',
                  file: 'var(--grok-loot-green)',
                  token: 'var(--grok-warning)',
                  api_key: 'var(--grok-exploit-red)',
                  session: 'var(--grok-ai-purple)',
                  username: 'var(--grok-scan-cyan)',
                };
                const color = catColors[item.category] || 'var(--grok-text-body)';
                return (
                  <div key={item.id} className="text-[10px] font-mono leading-relaxed">
                    <span className="text-[var(--grok-text-muted)] mr-1">
                      {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span style={{ color }} className="mr-1 uppercase font-bold text-[9px]">
                      [{item.category}]
                    </span>
                    <span className="text-[var(--grok-text-body)]">
                      {item.value.length > 60 ? item.value.slice(0, 60) + '...' : item.value}
                    </span>
                  </div>
                );
              })
            )}
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
  percent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  percent?: number;
}) {
  return (
    <div className="cs-panel p-3 relative overflow-hidden">
      {percent !== undefined && (
        <div
          className="absolute bottom-0 left-0 h-0.5 transition-all duration-1000"
          style={{ width: `${percent}%`, backgroundColor: color }}
        />
      )}
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

function QuickStat({
  icon,
  label,
  value,
  color,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="cs-panel p-3 text-left hover:border-[var(--grok-border-glow)] transition-colors group"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)] group-hover:text-[var(--grok-text-body)] transition-colors">
          {label}
        </span>
        <span style={{ color }}>{icon}</span>
      </div>
      <div className="text-xl font-mono font-bold text-[var(--grok-text-heading)]">
        {formatNumber(value)}
      </div>
    </button>
  );
}

function LootRow({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-2" style={{ color }}>
        {icon}
        <span className="text-[11px] text-[var(--grok-text-body)]">{label}</span>
      </div>
      <span className="text-xs font-mono font-bold text-[var(--grok-text-heading)]">
        {value}
      </span>
    </div>
  );
}

/* FindingRow removed — inline finding rows used in dashboard layout */

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-28 flex items-center justify-center">
      <span className="text-xs text-[var(--grok-text-muted)]">{label}</span>
    </div>
  );
}

/* Pipeline phases moved inline to DashboardView component */

/* ScanCard removed — inline target rows with pipeline bars used in dashboard layout */


