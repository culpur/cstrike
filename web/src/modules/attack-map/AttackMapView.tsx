/**
 * Attack Map — MITRE ATT&CK Matrix + Attack Surface Visualizer
 *
 * Shows:
 * - MITRE ATT&CK tactic/technique heatmap mapped from scan findings
 * - Network topology graph of discovered hosts/services
 * - Kill chain progress visualization
 */

import { useEffect, useState, useMemo } from 'react';
import {
  Map,
  Network,
  Shield,
  Target,
  Crosshair,
  Server,
  Zap,
  Radio,
  Search,
  Layers,
} from 'lucide-react';
import { apiService } from '@services/api';

// MITRE ATT&CK Tactics (Enterprise)
const TACTICS = [
  { id: 'TA0043', name: 'Reconnaissance', short: 'Recon' },
  { id: 'TA0042', name: 'Resource Development', short: 'Resources' },
  { id: 'TA0001', name: 'Initial Access', short: 'Init Access' },
  { id: 'TA0002', name: 'Execution', short: 'Execution' },
  { id: 'TA0003', name: 'Persistence', short: 'Persist' },
  { id: 'TA0004', name: 'Privilege Escalation', short: 'Priv Esc' },
  { id: 'TA0005', name: 'Defense Evasion', short: 'Def Evasion' },
  { id: 'TA0006', name: 'Credential Access', short: 'Cred Access' },
  { id: 'TA0007', name: 'Discovery', short: 'Discovery' },
  { id: 'TA0008', name: 'Lateral Movement', short: 'Lat Move' },
  { id: 'TA0009', name: 'Collection', short: 'Collection' },
  { id: 'TA0011', name: 'Command and Control', short: 'C2' },
  { id: 'TA0010', name: 'Exfiltration', short: 'Exfil' },
  { id: 'TA0040', name: 'Impact', short: 'Impact' },
];

// Map CStrike tools/findings to MITRE techniques
interface TechniqueMapping {
  id: string;
  name: string;
  tactic: string;
  status: 'detected' | 'attempted' | 'succeeded' | 'not_tested';
  source?: string;
  count?: number;
}

function mapFindingsToMitre(
  ports: Array<{ port: number; state: string; service?: string }>,
  vulns: Array<{ severity: string; title?: string; id?: string }>,
  subdomains: number,
  httpEndpoints: number,
  _lootPorts: number,
  lootCreds: number,
): TechniqueMapping[] {
  const techniques: TechniqueMapping[] = [];

  // Reconnaissance
  if (ports.length > 0) {
    techniques.push({ id: 'T1046', name: 'Network Service Discovery', tactic: 'TA0007', status: 'succeeded', source: 'nmap', count: ports.length });
  }
  if (subdomains > 0) {
    techniques.push({ id: 'T1596', name: 'Search Open Technical Databases', tactic: 'TA0043', status: 'succeeded', source: 'subfinder', count: subdomains });
    techniques.push({ id: 'T1590', name: 'Gather Victim Network Information', tactic: 'TA0043', status: 'succeeded', source: 'subfinder', count: subdomains });
  }
  if (httpEndpoints > 0) {
    techniques.push({ id: 'T1595.002', name: 'Active Scanning: Vulnerability Scanning', tactic: 'TA0043', status: 'succeeded', source: 'gobuster', count: httpEndpoints });
    techniques.push({ id: 'T1083', name: 'File and Directory Discovery', tactic: 'TA0007', status: 'succeeded', source: 'gobuster', count: httpEndpoints });
  }

  // Initial Access vectors detected
  const hasSSH = ports.some((p) => p.service === 'ssh' && p.state === 'open');
  const hasHTTP = ports.some((p) => (p.service === 'http' || p.service === 'ssl/http') && p.state === 'open');
  const hasFTP = ports.some((p) => p.service === 'ftp' && p.state === 'open');

  if (hasHTTP) {
    techniques.push({ id: 'T1190', name: 'Exploit Public-Facing Application', tactic: 'TA0001', status: vulns.length > 0 ? 'detected' : 'not_tested' });
  }
  if (hasSSH) {
    techniques.push({ id: 'T1078', name: 'Valid Accounts', tactic: 'TA0001', status: lootCreds > 0 ? 'succeeded' : 'not_tested' });
    techniques.push({ id: 'T1110', name: 'Brute Force', tactic: 'TA0006', status: lootCreds > 0 ? 'attempted' : 'not_tested' });
    techniques.push({ id: 'T1110.001', name: 'Brute Force: Password Guessing', tactic: 'TA0006', status: lootCreds > 0 ? 'attempted' : 'not_tested' });
  }
  if (hasFTP) {
    techniques.push({ id: 'T1078.001', name: 'Valid Accounts: Default Accounts', tactic: 'TA0001', status: 'not_tested' });
  }

  // Vulnerability findings
  if (vulns.some((v) => v.id?.includes('phpinfo'))) {
    techniques.push({ id: 'T1082', name: 'System Information Discovery', tactic: 'TA0007', status: 'succeeded', source: 'nuclei' });
  }
  if (vulns.some((v) => v.id?.includes('configuration') || v.id?.includes('backup'))) {
    techniques.push({ id: 'T1552', name: 'Unsecured Credentials', tactic: 'TA0006', status: 'detected', source: 'nuclei' });
    techniques.push({ id: 'T1213', name: 'Data from Information Repositories', tactic: 'TA0009', status: 'detected', source: 'nuclei' });
  }

  // SQL injection
  if (vulns.some((v) => v.id?.toLowerCase().includes('sql'))) {
    techniques.push({ id: 'T1059.004', name: 'Command and Scripting: SQL', tactic: 'TA0002', status: 'detected', source: 'nuclei' });
  }

  // Discovery phase
  if (ports.filter((p) => p.state === 'open').length > 0) {
    techniques.push({ id: 'T1049', name: 'System Network Connections Discovery', tactic: 'TA0007', status: 'succeeded', source: 'nmap' });
  }

  // Credential Access
  if (lootCreds > 0) {
    techniques.push({ id: 'T1003', name: 'OS Credential Dumping', tactic: 'TA0006', status: 'succeeded', count: lootCreds });
  }

  // Always show these as available
  techniques.push({ id: 'T1595.001', name: 'Active Scanning: Port Scanning', tactic: 'TA0043', status: ports.length > 0 ? 'succeeded' : 'not_tested', source: 'nmap' });
  techniques.push({ id: 'T1018', name: 'Remote System Discovery', tactic: 'TA0007', status: subdomains > 0 ? 'succeeded' : 'not_tested' });

  return techniques;
}

type ViewTab = 'mitre' | 'topology' | 'killchain';

export function AttackMapView() {
  const [activeTab, setActiveTab] = useState<ViewTab>('mitre');
  const [resultsData, setResultsData] = useState<{
    ports: Array<{ port: number; state: string; service?: string }>;
    vulns: Array<{ severity: string; title?: string; id?: string }>;
    subdomains: number;
    httpEndpoints: number;
  }>({ ports: [], vulns: [], subdomains: 0, httpEndpoints: 0 });
  const [lootData, setLootData] = useState({ ports: 0, creds: 0 });
  const [selectedTechnique, setSelectedTechnique] = useState<TechniqueMapping | null>(null);
  const [targetName, setTargetName] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const targets = await apiService.getTargets();
        if (targets.length > 0) {
          setTargetName(targets[0].url);
          const results = await apiService.getTargetResults(targets[0].url);
          setResultsData({
            ports: results.ports || [],
            vulns: results.vulnerabilities || [],
            subdomains: results.subdomains?.length || 0,
            httpEndpoints: results.httpEndpoints?.length || 0,
          });
        }
        const loot = await apiService.getLoot();
        const items = Array.isArray(loot) ? loot : [];
        if (items.length > 0) {
          setLootData({
            ports: items.filter((i: any) => i.category === 'port').length,
            creds: items.filter((i: any) => i.category === 'credential').length,
          });
        }
      } catch { /* API not available */ }
    };
    fetchData();
  }, []);

  const techniques = useMemo(() =>
    mapFindingsToMitre(
      resultsData.ports,
      resultsData.vulns,
      resultsData.subdomains,
      resultsData.httpEndpoints,
      lootData.ports,
      lootData.creds,
    ), [resultsData, lootData]);

  // Group techniques by tactic
  const tacticGroups = useMemo(() => {
    const groups: Record<string, TechniqueMapping[]> = {};
    TACTICS.forEach((t) => { groups[t.id] = []; });
    techniques.forEach((tech) => {
      if (groups[tech.tactic]) {
        groups[tech.tactic].push(tech);
      }
    });
    return groups;
  }, [techniques]);

  const stats = useMemo(() => ({
    total: techniques.length,
    succeeded: techniques.filter((t) => t.status === 'succeeded').length,
    detected: techniques.filter((t) => t.status === 'detected').length,
    attempted: techniques.filter((t) => t.status === 'attempted').length,
    notTested: techniques.filter((t) => t.status === 'not_tested').length,
  }), [techniques]);

  const tabs: Array<{ key: ViewTab; label: string; icon: React.ReactNode }> = [
    { key: 'mitre', label: 'MITRE ATT&CK', icon: <Shield className="w-4 h-4" /> },
    { key: 'topology', label: 'Attack Surface', icon: <Network className="w-4 h-4" /> },
    { key: 'killchain', label: 'Kill Chain', icon: <Crosshair className="w-4 h-4" /> },
  ];

  return (
    <div className="h-full overflow-auto p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[var(--grok-text-heading)] flex items-center gap-2">
            <Map className="w-5 h-5 text-[var(--grok-exploit-red)]" />
            Attack Map
          </h1>
          <p className="text-[10px] text-[var(--grok-text-muted)] mt-0.5 font-mono">
            {targetName ? `Target: ${targetName}` : 'MITRE ATT&CK mapping and attack surface visualization'}
          </p>
        </div>
        {/* Tab selector */}
        <div className="flex items-center gap-1 bg-[var(--grok-surface-2)] rounded p-0.5 border border-[var(--grok-border)]">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors rounded ${
                activeTab === tab.key
                  ? 'bg-[var(--grok-recon-blue)] text-white'
                  : 'text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)]'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-5 gap-3">
        <StatCard label="Techniques Mapped" value={stats.total} color="var(--grok-text-heading)" />
        <StatCard label="Succeeded" value={stats.succeeded} color="var(--grok-success)" />
        <StatCard label="Detected" value={stats.detected} color="var(--grok-warning)" />
        <StatCard label="Attempted" value={stats.attempted} color="var(--grok-scan-cyan)" />
        <StatCard label="Not Tested" value={stats.notTested} color="var(--grok-text-muted)" />
      </div>

      {/* MITRE ATT&CK Matrix */}
      {activeTab === 'mitre' && (
        <div className="cs-panel p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)] mb-4">
            MITRE ATT&CK Enterprise Matrix
          </div>
          <div className="overflow-x-auto">
            <div className="flex gap-1 min-w-max">
              {TACTICS.map((tactic) => {
                const techs = tacticGroups[tactic.id] || [];
                return (
                  <div key={tactic.id} className="w-32 flex-shrink-0">
                    {/* Tactic header */}
                    <div className="bg-[var(--grok-surface-3)] px-2 py-2 rounded-t text-center border border-[var(--grok-border)]">
                      <div className="text-[9px] font-bold uppercase text-[var(--grok-text-heading)] leading-tight">
                        {tactic.short}
                      </div>
                      <div className="text-[8px] text-[var(--grok-text-muted)] mt-0.5">
                        {tactic.id}
                      </div>
                    </div>
                    {/* Techniques */}
                    <div className="space-y-0.5 mt-0.5">
                      {techs.length === 0 ? (
                        <div className="h-8 bg-[var(--grok-surface-2)] rounded border border-[var(--grok-border)]/50 flex items-center justify-center">
                          <span className="text-[8px] text-[var(--grok-text-muted)]">-</span>
                        </div>
                      ) : (
                        techs.map((tech) => (
                          <button
                            key={tech.id}
                            onClick={() => setSelectedTechnique(selectedTechnique?.id === tech.id ? null : tech)}
                            className={`w-full text-left px-2 py-1.5 rounded border transition-all text-[9px] leading-tight ${
                              getTechniqueStyle(tech.status)
                            } ${selectedTechnique?.id === tech.id ? 'ring-1 ring-[var(--grok-recon-blue)]' : ''}`}
                          >
                            <div className="font-mono text-[8px] opacity-60">{tech.id}</div>
                            <div className="truncate">{tech.name}</div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Selected technique detail */}
          {selectedTechnique && (
            <div className="mt-4 p-4 bg-[var(--grok-surface-2)] rounded border border-[var(--grok-border)] animate-fade-in">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="text-xs font-mono text-[var(--grok-text-muted)]">{selectedTechnique.id}</span>
                  <h3 className="text-sm font-semibold text-[var(--grok-text-heading)]">{selectedTechnique.name}</h3>
                </div>
                <StatusBadge status={selectedTechnique.status} />
              </div>
              <div className="grid grid-cols-3 gap-4 text-xs">
                <div>
                  <span className="text-[var(--grok-text-muted)]">Tactic:</span>
                  <span className="ml-2 text-[var(--grok-text-body)]">
                    {TACTICS.find((t) => t.id === selectedTechnique.tactic)?.name}
                  </span>
                </div>
                {selectedTechnique.source && (
                  <div>
                    <span className="text-[var(--grok-text-muted)]">Source:</span>
                    <span className="ml-2 text-[var(--grok-text-body)] font-mono">{selectedTechnique.source}</span>
                  </div>
                )}
                {selectedTechnique.count !== undefined && (
                  <div>
                    <span className="text-[var(--grok-text-muted)]">Findings:</span>
                    <span className="ml-2 text-[var(--grok-text-heading)] font-mono font-bold">{selectedTechnique.count}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Attack Surface / Topology View */}
      {activeTab === 'topology' && (
        <div className="cs-panel p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)] mb-4">
            Attack Surface — Discovered Services
          </div>
          <AttackSurfaceGraph
            ports={resultsData.ports}
            target={targetName}
            vulns={resultsData.vulns}
            subdomains={resultsData.subdomains}
          />
        </div>
      )}

      {/* Kill Chain View */}
      {activeTab === 'killchain' && (
        <div className="cs-panel p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)] mb-4">
            Cyber Kill Chain Progress
          </div>
          <KillChainView techniques={techniques} />
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ───────────────────────────────────────────── */

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="cs-panel p-3 text-center">
      <div className="text-xl font-mono font-bold" style={{ color }}>{value}</div>
      <div className="text-[9px] text-[var(--grok-text-muted)] uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    succeeded: 'bg-[var(--grok-success)]/10 text-[var(--grok-success)] border-[var(--grok-success)]/30',
    detected: 'bg-[var(--grok-warning)]/10 text-[var(--grok-warning)] border-[var(--grok-warning)]/30',
    attempted: 'bg-[var(--grok-scan-cyan)]/10 text-[var(--grok-scan-cyan)] border-[var(--grok-scan-cyan)]/30',
    not_tested: 'bg-[var(--grok-surface-3)] text-[var(--grok-text-muted)] border-[var(--grok-border)]',
  };
  return (
    <span className={`px-2 py-1 text-[10px] font-mono font-bold uppercase rounded border ${styles[status] || styles.not_tested}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function getTechniqueStyle(status: string): string {
  switch (status) {
    case 'succeeded':
      return 'bg-[var(--grok-success)]/10 border-[var(--grok-success)]/30 text-[var(--grok-success)]';
    case 'detected':
      return 'bg-[var(--grok-warning)]/10 border-[var(--grok-warning)]/30 text-[var(--grok-warning)]';
    case 'attempted':
      return 'bg-[var(--grok-scan-cyan)]/10 border-[var(--grok-scan-cyan)]/30 text-[var(--grok-scan-cyan)]';
    default:
      return 'bg-[var(--grok-surface-2)] border-[var(--grok-border)]/50 text-[var(--grok-text-muted)]';
  }
}

/* ── Attack Surface Graph (SVG-based) ─────────────────────────── */

function AttackSurfaceGraph({
  ports,
  target,
  vulns,
  subdomains,
}: {
  ports: Array<{ port: number; state: string; service?: string }>;
  target: string;
  vulns: Array<{ severity: string }>;
  subdomains: number;
}) {
  const openPorts = ports.filter((p) => p.state === 'open');

  if (openPorts.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-xs text-[var(--grok-text-muted)]">
        No services discovered — run a scan first
      </div>
    );
  }

  // Layout: central node with service nodes around it
  const cx = 400;
  const cy = 200;
  const radius = 140;
  const serviceNodes = openPorts.map((p, i) => {
    const angle = (2 * Math.PI * i) / openPorts.length - Math.PI / 2;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      port: p,
    };
  });

  const serviceColors: Record<string, string> = {
    http: '#2266ff',
    'ssl/http': '#2266ff',
    ssh: '#00cc66',
    ftp: '#ffaa00',
    mysql: '#8844ff',
    'ssl/https': '#00ccdd',
    domain: '#ff2040',
  };

  return (
    <div className="overflow-x-auto">
      <svg viewBox="0 0 800 400" className="w-full h-80">
        {/* Connection lines */}
        {serviceNodes.map((node, i) => (
          <line
            key={`line-${i}`}
            x1={cx}
            y1={cy}
            x2={node.x}
            y2={node.y}
            stroke="var(--grok-border)"
            strokeWidth="1"
            strokeDasharray="4 2"
            opacity="0.5"
          />
        ))}

        {/* Central target node */}
        <circle cx={cx} cy={cy} r={32} fill="var(--grok-surface-3)" stroke="var(--grok-exploit-red)" strokeWidth="2" />
        <circle cx={cx} cy={cy} r={28} fill="none" stroke="var(--grok-exploit-red)" strokeWidth="0.5" opacity="0.3">
          <animate attributeName="r" from="28" to="40" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" from="0.3" to="0" dur="2s" repeatCount="indefinite" />
        </circle>
        <text x={cx} y={cy - 6} textAnchor="middle" fill="var(--grok-text-heading)" fontSize="8" fontFamily="monospace" fontWeight="bold">
          TARGET
        </text>
        <text x={cx} y={cy + 6} textAnchor="middle" fill="var(--grok-text-muted)" fontSize="7" fontFamily="monospace">
          {target.replace(/https?:\/\//, '').substring(0, 20)}
        </text>
        {/* Vuln count badge */}
        {vulns.length > 0 && (
          <>
            <circle cx={cx + 22} cy={cy - 22} r={10} fill="var(--grok-warning)" />
            <text x={cx + 22} y={cy - 19} textAnchor="middle" fill="black" fontSize="8" fontWeight="bold">{vulns.length}</text>
          </>
        )}

        {/* Service nodes */}
        {serviceNodes.map((node, i) => {
          const color = (node.port.service ? serviceColors[node.port.service] : undefined) || '#6a6a80';
          return (
            <g key={`svc-${i}`}>
              <circle cx={node.x} cy={node.y} r={22} fill="var(--grok-surface-2)" stroke={color} strokeWidth="1.5" />
              <text x={node.x} y={node.y - 4} textAnchor="middle" fill={color} fontSize="9" fontFamily="monospace" fontWeight="bold">
                {node.port.port}
              </text>
              <text x={node.x} y={node.y + 8} textAnchor="middle" fill="var(--grok-text-muted)" fontSize="7" fontFamily="monospace">
                {node.port.service}
              </text>
            </g>
          );
        })}

        {/* Subdomain indicator */}
        {subdomains > 0 && (
          <g>
            <rect x={10} y={10} width={120} height={28} rx={4} fill="var(--grok-surface-2)" stroke="var(--grok-border)" strokeWidth="1" />
            <text x={20} y={28} fill="var(--grok-scan-cyan)" fontSize="9" fontFamily="monospace">
              {subdomains} subdomains
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

/* ── Kill Chain Visualization ─────────────────────────────────── */

const KILL_CHAIN_PHASES = [
  { id: 'recon', name: 'Reconnaissance', icon: Search, tactics: ['TA0043'] },
  { id: 'weaponize', name: 'Weaponization', icon: Layers, tactics: ['TA0042'] },
  { id: 'deliver', name: 'Delivery', icon: Target, tactics: ['TA0001'] },
  { id: 'exploit', name: 'Exploitation', icon: Zap, tactics: ['TA0002'] },
  { id: 'install', name: 'Installation', icon: Server, tactics: ['TA0003'] },
  { id: 'c2', name: 'Command & Control', icon: Radio, tactics: ['TA0011'] },
  { id: 'actions', name: 'Actions on Objectives', icon: Crosshair, tactics: ['TA0009', 'TA0010', 'TA0040'] },
];

function KillChainView({ techniques }: { techniques: TechniqueMapping[] }) {
  return (
    <div className="space-y-2">
      {KILL_CHAIN_PHASES.map((phase, idx) => {
        const phaseTechniques = techniques.filter((t) => phase.tactics.includes(t.tactic));
        const succeeded = phaseTechniques.filter((t) => t.status === 'succeeded').length;
        const detected = phaseTechniques.filter((t) => t.status === 'detected').length;
        const total = phaseTechniques.length;
        const progress = total > 0 ? Math.round(((succeeded + detected * 0.5) / total) * 100) : 0;
        const Icon = phase.icon;

        return (
          <div key={phase.id} className="flex items-center gap-3">
            {/* Phase number */}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border ${
              succeeded > 0
                ? 'bg-[var(--grok-success)]/10 border-[var(--grok-success)]/50 text-[var(--grok-success)]'
                : detected > 0
                ? 'bg-[var(--grok-warning)]/10 border-[var(--grok-warning)]/50 text-[var(--grok-warning)]'
                : 'bg-[var(--grok-surface-3)] border-[var(--grok-border)] text-[var(--grok-text-muted)]'
            }`}>
              {idx + 1}
            </div>

            {/* Phase details */}
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5 text-[var(--grok-text-muted)]" />
                  <span className="text-xs font-semibold text-[var(--grok-text-heading)]">{phase.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {succeeded > 0 && (
                    <span className="text-[9px] font-mono text-[var(--grok-success)]">{succeeded} succeeded</span>
                  )}
                  {detected > 0 && (
                    <span className="text-[9px] font-mono text-[var(--grok-warning)]">{detected} detected</span>
                  )}
                  <span className="text-[9px] font-mono text-[var(--grok-text-muted)]">{total} total</span>
                </div>
              </div>
              <div className="w-full h-1.5 bg-[var(--grok-surface-3)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${progress}%`,
                    background: succeeded > 0
                      ? 'var(--grok-success)'
                      : detected > 0
                      ? 'var(--grok-warning)'
                      : 'var(--grok-border)',
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
