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
  Pause,
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
  RotateCcw,
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
  const recentThoughts = thoughts.slice(-5);
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

      {/* ── Telemetry strip ────────────────────────────────────── */}
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
          {/* CPU usage bar */}
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

        {/* Targets */}
        <TelemetryCard
          icon={<Target className="w-4 h-4" />}
          label="Targets"
          value={String(targets.length)}
          color="var(--grok-recon-blue)"
        />
      </div>

      {/* ── Service health (full width) ─────────────────────────── */}
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

      {/* ── Main grid: Charts + Active ops ─────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        {/* Quick stats row */}
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
          color="var(--grok-warning)"
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── Left column: Charts ──────────────────────────────── */}
        <div className="lg:col-span-2 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {/* Vulnerability Severity Distribution */}
            <div className="cs-panel p-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)] mb-3">
                Vulnerability Severity
              </div>
              {sevCounts.length > 0 ? (
                <div className="flex items-center gap-4">
                  <div className="w-28 h-28">
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
                  <div className="space-y-1.5 flex-1">
                    {sevCounts.map((s) => (
                      <div key={s.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                          <span className="text-[11px] text-[var(--grok-text-body)] capitalize">{s.name}</span>
                        </div>
                        <span className="text-xs font-mono font-bold text-[var(--grok-text-heading)]">{s.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyChart label="No vulnerabilities detected" />
              )}
            </div>

            {/* Port / Service Distribution */}
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
          </div>

          {/* Scan Activity Timeline */}
          <div className="cs-panel p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)]">
                Findings Activity
              </span>
              <span className="text-[10px] text-[var(--grok-text-muted)]">Last 60 min</span>
            </div>
            <div className="h-20">
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

          {/* Active Operations */}
          <div className="cs-panel">
            <div className="cs-panel-header flex items-center justify-between">
              <span>Active Operations ({activeScans.length})</span>
              {activeScans.length > 0 && (
                <span className="text-[var(--grok-recon-blue)] animate-pulse-glow flex items-center gap-1">
                  <Radio className="w-3 h-3" /> LIVE
                </span>
              )}
            </div>
            <div className="p-3 space-y-2">
              {activeScans.length === 0 ? (
                <div className="text-center py-6 text-xs text-[var(--grok-text-muted)]">
                  No active scans. Launch a scan above to begin.
                </div>
              ) : (
                activeScans.map((scan) => (
                  <ScanCard
                    key={scan.scan_id}
                    scan={scan}
                    onPause={async () => {
                      try {
                        await apiService.pauseScan(scan.scan_id);
                        addToast({ type: 'info', message: `Pausing scan: ${scan.target}`, duration: 3000 });
                      } catch (err: any) {
                        addToast({ type: 'error', message: err.message || 'Pause failed', duration: 5000 });
                      }
                    }}
                    onResume={async () => {
                      try {
                        await apiService.resumeScan(scan.scan_id);
                        addToast({ type: 'info', message: `Resuming scan: ${scan.target}`, duration: 3000 });
                      } catch (err: any) {
                        addToast({ type: 'error', message: err.message || 'Resume failed', duration: 5000 });
                      }
                    }}
                  />
                ))
              )}
            </div>
          </div>

          {/* Exploitation Tracks (shown during active scans) */}
          {exploitTracks.length > 0 && <ExploitTrackPanel tracks={exploitTracks} />}
        </div>

        {/* ── Right column: Loot + AI + Findings ───────────────── */}
        <div className="flex flex-col gap-3">
          {/* Loot Breakdown */}
          <div className="cs-panel p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)]">
                Loot Breakdown
              </span>
              <button
                onClick={() => setActiveView('loot')}
                className="text-[10px] text-[var(--grok-loot-green)] hover:underline flex items-center gap-0.5"
              >
                View All <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            <div className="space-y-1.5">
              <LootRow
                icon={<Lock className="w-3 h-3" />}
                label="Credentials"
                value={lootStats.byCategory.credential || 0}
                color="var(--grok-warning)"
              />
              <LootRow
                icon={<Unlock className="w-3 h-3" />}
                label="Passwords"
                value={lootStats.byCategory.password || 0}
                color="var(--grok-exploit-red)"
              />
              <LootRow
                icon={<Hash className="w-3 h-3" />}
                label="Hashes"
                value={lootStats.byCategory.hash || 0}
                color="var(--grok-ai-purple)"
              />
              <LootRow
                icon={<Globe className="w-3 h-3" />}
                label="URLs"
                value={lootStats.byCategory.url || 0}
                color="var(--grok-scan-cyan)"
              />
              <LootRow
                icon={<Zap className="w-3 h-3" />}
                label="Ports"
                value={lootStats.byCategory.port || 0}
                color="var(--grok-recon-blue)"
              />
              <LootRow
                icon={<FileText className="w-3 h-3" />}
                label="Files"
                value={lootStats.byCategory.file || 0}
                color="var(--grok-loot-green)"
              />
              {(lootStats.byCategory.token || 0) > 0 && (
                <LootRow
                  icon={<Key className="w-3 h-3" />}
                  label="Tokens"
                  value={lootStats.byCategory.token}
                  color="var(--grok-warning)"
                />
              )}
              {(lootStats.byCategory.api_key || 0) > 0 && (
                <LootRow
                  icon={<Key className="w-3 h-3" />}
                  label="API Keys"
                  value={lootStats.byCategory.api_key}
                  color="var(--grok-exploit-red)"
                />
              )}
              {(lootStats.byCategory.session || 0) > 0 && (
                <LootRow
                  icon={<Key className="w-3 h-3" />}
                  label="Sessions"
                  value={lootStats.byCategory.session}
                  color="var(--grok-ai-purple)"
                />
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

          {/* Recent Findings */}
          <div className="cs-panel">
            <div className="cs-panel-header flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Shield className="w-3 h-3 text-[var(--grok-warning)]" />
                Recent Findings
              </span>
              <button
                onClick={() => setActiveView('results')}
                className="text-[10px] text-[var(--grok-warning)] hover:underline"
              >
                View All
              </button>
            </div>
            <div className="p-2 space-y-1 max-h-40 overflow-y-auto">
              {resultsData.vulns.length === 0 && resultsData.ports.length === 0 ? (
                <p className="text-xs text-[var(--grok-text-muted)] text-center py-4">
                  No findings yet — run a scan
                </p>
              ) : (
                <>
                  {resultsData.vulns.slice(0, 4).map((v, i) => (
                    <FindingRow key={`v-${i}`} type="vuln" severity={v.severity} />
                  ))}
                  {resultsData.ports.filter((p) => p.state === 'open').slice(0, 3).map((p, i) => (
                    <FindingRow key={`p-${i}`} type="port" label={`${p.port} ${p.service}`} />
                  ))}
                </>
              )}
            </div>
          </div>

          {/* AI Activity Feed */}
          <div className="cs-panel flex-1 min-h-0 flex flex-col">
            <div className="cs-panel-header flex items-center justify-between flex-shrink-0">
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
            <div className="p-2 space-y-1.5 flex-1 overflow-y-auto">
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
                    {t.content.length > 100 ? t.content.slice(0, 100) + '...' : t.content}
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

function FindingRow({
  type,
  severity,
  label,
}: {
  type: 'vuln' | 'port';
  severity?: string;
  label?: string;
}) {
  if (type === 'vuln') {
    const sevColor = SEVERITY_COLORS[(severity || 'info').toLowerCase()] || '#6a6a80';
    return (
      <div className="flex items-center justify-between py-1 px-2 bg-[var(--grok-surface-2)] rounded">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-3 h-3" style={{ color: sevColor }} />
          <span className="text-[11px] text-[var(--grok-text-body)] capitalize">{severity} vulnerability</span>
        </div>
        <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold" style={{ color: sevColor, backgroundColor: `${sevColor}15` }}>
          {(severity || 'INFO').toUpperCase()}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 py-1 px-2 bg-[var(--grok-surface-2)] rounded">
      <Zap className="w-3 h-3 text-[var(--grok-recon-blue)]" />
      <span className="text-[11px] font-mono text-[var(--grok-text-body)]">{label}</span>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-28 flex items-center justify-center">
      <span className="text-xs text-[var(--grok-text-muted)]">{label}</span>
    </div>
  );
}

const SCAN_PIPELINE_PHASES = ['recon', 'ai_analysis_1', 'web_scans', 'exploitation', 'post_exploitation', 'complete'] as const;
const PHASE_LABELS: Record<string, string> = {
  idle: 'Idle',
  recon: 'Recon',
  ai_analysis_1: 'AI',
  web_scans: 'Web',
  vulnapi: 'API',
  metasploit: 'MSF',
  ai_analysis_2: 'AI-2',
  exploitation: 'Exploit',
  post_exploitation: 'Shells',
  post_exploit: 'Shells',
  reporting: 'Report',
  complete: 'Done',
};

function ScanCard({
  scan,
  onPause,
  onResume,
}: {
  scan: ActiveScan;
  onPause: () => void;
  onResume: () => void;
}) {
  const isRunning = scan.status === 'running';
  const isPaused = scan.status === 'paused';
  const isFinished = ['completed', 'failed', 'cancelled'].includes(scan.status);
  const currentPhase = scan.current_phase || scan.phase || 'idle';

  const statusColor = isPaused
    ? 'var(--grok-warning)'
    : isRunning
    ? 'var(--grok-recon-blue)'
    : isFinished
    ? 'var(--grok-success)'
    : 'var(--grok-text-muted)';

  return (
    <div className="p-3 bg-[var(--grok-surface-2)] rounded border border-[var(--grok-border)] animate-fade-in">
      {/* Header: target + controls */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${isRunning ? 'animate-pulse' : ''}`}
            style={{ backgroundColor: statusColor }}
          />
          <span className="text-sm font-mono font-semibold text-[var(--grok-text-heading)]">
            {scan.target}
          </span>
          {isPaused && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 bg-[var(--grok-warning)]/15 text-[var(--grok-warning)] rounded uppercase font-bold">
              Paused
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {scan.progress && (
            <span className="text-[10px] font-mono text-[var(--grok-text-muted)]">
              {scan.progress}
            </span>
          )}
          {isRunning && (
            <button
              onClick={onPause}
              className="p-1 rounded hover:bg-[var(--grok-surface-3)] text-[var(--grok-warning)] transition-colors"
              title="Pause scan"
            >
              <Pause className="w-3.5 h-3.5" />
            </button>
          )}
          {isPaused && (
            <button
              onClick={onResume}
              className="p-1 rounded hover:bg-[var(--grok-surface-3)] text-[var(--grok-success)] transition-colors"
              title="Resume scan"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Per-target pipeline mini-phase indicator */}
      <div className="flex items-center gap-1 mb-2">
        {SCAN_PIPELINE_PHASES.map((phase) => {
          const phaseIdx = SCAN_PIPELINE_PHASES.indexOf(phase);
          const currentIdx = SCAN_PIPELINE_PHASES.indexOf(
            SCAN_PIPELINE_PHASES.find((p) => p === currentPhase) ?? 'recon'
          );
          const isPhaseComplete = currentIdx > phaseIdx || currentPhase === 'complete';
          const isPhaseActive = currentPhase === phase || (currentIdx === -1 && phase === 'recon');

          return (
            <div key={phase} className="flex items-center gap-1">
              <div
                className={`w-4 h-4 rounded-full border flex items-center justify-center text-[6px] font-bold transition-all ${
                  isPhaseComplete
                    ? 'bg-[var(--grok-success)] border-[var(--grok-success)] text-black'
                    : isPhaseActive
                    ? isPaused
                      ? 'border-[var(--grok-warning)] text-[var(--grok-warning)]'
                      : 'border-[var(--grok-recon-blue)] text-[var(--grok-recon-blue)] animate-pulse'
                    : 'border-[var(--grok-border)] text-[var(--grok-text-muted)]'
                }`}
              >
                {isPhaseComplete ? '\u2713' : ''}
              </div>
              <span className="text-[7px] text-[var(--grok-text-muted)] mr-1">
                {PHASE_LABELS[phase] || phase}
              </span>
            </div>
          );
        })}
      </div>

      {/* Running tools */}
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
  );
}


