/**
 * Results View - Browse completed scan results for all targets
 * Enhanced with expandable vulnerability details, CVSS gauges,
 * severity filters, port detail panels, and CSV/JSON export.
 */

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import {
  Download,
  RefreshCw,
  ChevronDown,
  AlertCircle,
  Copy,
  Check,
  FileJson,
  FileText,
  Shield,
  Server,
  Link,
  Wrench,
  BookOpen,
  Terminal,
  Zap,
  Network,
  ClipboardList,
  Workflow,
  Globe,
} from 'lucide-react';
import { SectionPanel } from '@components/ui';
import { useUIStore } from '@stores/uiStore';
import { apiService } from '@services/api';
import { cn } from '@utils/index';
import type {
  Target,
  CompleteScanResults,
  VulnerabilityFinding,
  DetailedPortScanResult,
} from '@/types';

// ============================================================================
// Severity config
// ============================================================================

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

const SEVERITY_CONFIG: Record<
  Severity,
  { label: string; bg: string; text: string; border: string; ring: string }
> = {
  critical: {
    label: 'CRITICAL',
    bg: 'bg-red-900/30',
    text: 'text-red-400',
    border: 'border-red-700',
    ring: 'ring-red-700',
  },
  high: {
    label: 'HIGH',
    bg: 'bg-orange-900/30',
    text: 'text-orange-400',
    border: 'border-orange-700',
    ring: 'ring-orange-700',
  },
  medium: {
    label: 'MEDIUM',
    bg: 'bg-yellow-900/30',
    text: 'text-yellow-500',
    border: 'border-yellow-700',
    ring: 'ring-yellow-700',
  },
  low: {
    label: 'LOW',
    bg: 'bg-blue-900/30',
    text: 'text-blue-400',
    border: 'border-blue-700',
    ring: 'ring-blue-700',
  },
  info: {
    label: 'INFO',
    bg: 'bg-gray-800/50',
    text: 'text-gray-400',
    border: 'border-gray-700',
    ring: 'ring-gray-700',
  },
};

const ALL_SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

// ============================================================================
// CVSS Gauge — inline SVG arc component
// ============================================================================

interface CvssGaugeProps {
  score: number;
  size?: number;
}

const CvssGauge = memo(function CvssGauge({ score, size = 96 }: CvssGaugeProps) {
  const clamped = Math.min(10, Math.max(0, score));
  const radius = 36;
  const stroke = 7;
  const cx = size / 2;
  const cy = size / 2;

  // Arc spans 220 degrees (from 160deg to 380deg / 20deg), centered at bottom
  const startAngle = 160;
  const totalDeg = 220;
  const endAngle = startAngle + totalDeg;

  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const polarToXY = (angleDeg: number, r: number) => ({
    x: cx + r * Math.cos(toRad(angleDeg)),
    y: cy + r * Math.sin(toRad(angleDeg)),
  });

  const arcPath = (fromDeg: number, toDeg: number, r: number) => {
    const start = polarToXY(fromDeg, r);
    const end = polarToXY(toDeg, r);
    const large = toDeg - fromDeg > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
  };

  const fillAngle = startAngle + (clamped / 10) * totalDeg;

  // Color based on score
  const color =
    clamped >= 9.0
      ? 'var(--grok-crit-red)'
      : clamped >= 7.0
        ? 'var(--grok-exploit-red)'
        : clamped >= 4.0
          ? 'var(--grok-loot-gold)'
          : 'var(--grok-ok-green)';

  const trackPath = arcPath(startAngle, endAngle, radius);
  const fillPath = clamped > 0 ? arcPath(startAngle, fillAngle, radius) : null;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-label={`CVSS score ${clamped.toFixed(1)} out of 10`}
      role="img"
    >
      {/* Track */}
      <path
        d={trackPath}
        fill="none"
        stroke="var(--grok-border)"
        strokeWidth={stroke}
        strokeLinecap="round"
      />
      {/* Fill */}
      {fillPath && (
        <path
          d={fillPath}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 4px ${color})` }}
        />
      )}
      {/* Score label */}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={color}
        fontSize="16"
        fontWeight="700"
        fontFamily="monospace"
      >
        {clamped.toFixed(1)}
      </text>
      <text
        x={cx}
        y={cy + 12}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="var(--grok-text-muted)"
        fontSize="8"
        fontFamily="sans-serif"
        letterSpacing="0.05em"
      >
        CVSS
      </text>
    </svg>
  );
});

// ============================================================================
// Severity Filter Bar
// ============================================================================

interface SeverityFilterBarProps {
  counts: Record<Severity, number>;
  active: Set<Severity>;
  onToggle: (s: Severity) => void;
  onClearAll: () => void;
  total: number;
}

const SeverityFilterBar = memo(function SeverityFilterBar({
  counts,
  active,
  onToggle,
  onClearAll,
  total,
}: SeverityFilterBarProps) {
  const allActive = active.size === 0;

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-grok-border">
      <button
        onClick={onClearAll}
        className={cn(
          'px-3 py-1 rounded text-xs font-medium border transition-colors',
          allActive
            ? 'bg-grok-recon-blue/20 text-grok-recon-blue border-grok-recon-blue'
            : 'border-grok-border text-grok-text-muted hover:border-grok-text-muted'
        )}
        aria-pressed={allActive}
      >
        All ({total})
      </button>

      {ALL_SEVERITIES.map((sev) => {
        const cfg = SEVERITY_CONFIG[sev];
        const isOn = active.has(sev);
        const count = counts[sev] ?? 0;
        if (count === 0) return null;
        return (
          <button
            key={sev}
            onClick={() => onToggle(sev)}
            aria-pressed={isOn}
            className={cn(
              'px-3 py-1 rounded text-xs font-medium border transition-all',
              isOn
                ? `${cfg.bg} ${cfg.text} ${cfg.border}`
                : 'border-grok-border text-grok-text-muted hover:border-grok-border/80',
              'focus-visible:outline-none focus-visible:ring-1',
              cfg.ring
            )}
          >
            {cfg.label} ({count})
          </button>
        );
      })}
    </div>
  );
});

// ============================================================================
// "Copy Finding" hook
// ============================================================================

function useCopyFinding() {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied((prev) => (prev === id ? null : prev)), 2000);
    });
  }, []);

  return { copied, copy };
}

// ============================================================================
// Build markdown for a single vulnerability finding
// ============================================================================

function buildFindingMarkdown(vuln: VulnerabilityFinding, target: string): string {
  const lines: string[] = [
    `## ${vuln.title}`,
    ``,
    `**Target:** ${target}`,
    `**Severity:** ${vuln.severity.toUpperCase()}`,
  ];
  if (vuln.cvss !== undefined) lines.push(`**CVSS Score:** ${vuln.cvss}`);
  if (vuln.cve) lines.push(`**CVE:** ${vuln.cve}`);
  if (vuln.affectedComponent) lines.push(`**Affected Component:** ${vuln.affectedComponent}`);
  lines.push(``);
  lines.push(`### Description`);
  lines.push(vuln.description);
  if (vuln.remediation) {
    lines.push(``);
    lines.push(`### Remediation`);
    lines.push(vuln.remediation);
  }
  if (vuln.references && vuln.references.length > 0) {
    lines.push(``);
    lines.push(`### References`);
    vuln.references.forEach((ref) => lines.push(`- ${ref}`));
  }
  return lines.join('\n');
}

// ============================================================================
// Vulnerability Detail Panel
// ============================================================================

interface VulnDetailPanelProps {
  vuln: VulnerabilityFinding;
  target: string;
  copied: string | null;
  onCopy: (id: string, text: string) => void;
}

const VulnDetailPanel = memo(function VulnDetailPanel({
  vuln,
  target,
  copied,
  onCopy,
}: VulnDetailPanelProps) {
  const cfg = SEVERITY_CONFIG[vuln.severity as Severity] ?? SEVERITY_CONFIG.info;
  const hasCvss = vuln.cvss !== undefined && vuln.cvss !== null;

  return (
    <div
      className={cn(
        'border-t border-grok-border bg-grok-void',
        'animate-in fade-in slide-in-from-top-1 duration-200'
      )}
      role="region"
      aria-label={`Details for ${vuln.title}`}
    >
      <div className="p-4 space-y-4">
        {/* Top row: CVSS gauge + meta */}
        <div className="flex gap-4 flex-wrap">
          {hasCvss && (
            <div className="flex flex-col items-center gap-1">
              <CvssGauge score={vuln.cvss as number} />
              {/* CVSS vector placeholder — real data would come from vuln.cvssVector */}
              <span className="text-[10px] font-mono text-grok-text-muted text-center max-w-[96px] leading-tight">
                CVSS:3.1
              </span>
            </div>
          )}

          <div className="flex-1 min-w-0 space-y-2">
            {/* Severity + CVE row */}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'px-2 py-0.5 rounded text-xs font-bold border',
                  cfg.bg,
                  cfg.text,
                  cfg.border
                )}
              >
                {cfg.label}
              </span>
              {vuln.cve && (
                <span className="px-2 py-0.5 rounded text-xs font-mono bg-grok-surface-2 border border-grok-border text-grok-recon-blue">
                  {vuln.cve}
                </span>
              )}
            </div>

            {/* Affected component / URL */}
            {vuln.affectedComponent && (
              <div className="flex items-start gap-2">
                <Link className="w-3.5 h-3.5 text-grok-text-muted mt-0.5 flex-shrink-0" />
                <span className="text-xs font-mono text-grok-text-body break-all">
                  {vuln.affectedComponent}
                </span>
              </div>
            )}

            {/* Description */}
            <div className="flex items-start gap-2">
              <BookOpen className="w-3.5 h-3.5 text-grok-text-muted mt-0.5 flex-shrink-0" />
              <p className="text-xs text-grok-text-body leading-relaxed">{vuln.description}</p>
            </div>
          </div>
        </div>

        {/* Remediation */}
        {vuln.remediation && (
          <div className="rounded border border-grok-border bg-grok-surface-1 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Wrench className="w-3.5 h-3.5 text-grok-loot-gold" />
              <span className="text-xs font-semibold text-grok-text-heading uppercase tracking-wide">
                Remediation
              </span>
            </div>
            <p className="text-xs text-grok-text-body leading-relaxed">{vuln.remediation}</p>
          </div>
        )}

        {/* References */}
        {vuln.references && vuln.references.length > 0 && (
          <div className="rounded border border-grok-border bg-grok-surface-1 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-3.5 h-3.5 text-grok-recon-blue" />
              <span className="text-xs font-semibold text-grok-text-heading uppercase tracking-wide">
                References
              </span>
            </div>
            <ul className="space-y-1">
              {vuln.references.map((ref, i) => (
                <li key={i}>
                  <a
                    href={ref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-grok-recon-blue hover:underline break-all"
                  >
                    {ref}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Copy Finding button */}
        <div className="flex justify-end">
          <button
            onClick={() => onCopy(vuln.id, buildFindingMarkdown(vuln, target))}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium',
              'border border-grok-border bg-grok-surface-2 text-grok-text-body',
              'hover:bg-grok-surface-3 hover:border-grok-text-muted transition-colors',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-grok-recon-blue'
            )}
            aria-label="Copy finding as markdown"
          >
            {copied === vuln.id ? (
              <>
                <Check className="w-3 h-3 text-grok-ok-green" />
                <span className="text-grok-ok-green">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                Copy Finding
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// Port Detail Panel
// ============================================================================

interface PortDetailPanelProps {
  port: DetailedPortScanResult;
}

const PortDetailPanel = memo(function PortDetailPanel({ port }: PortDetailPanelProps) {
  return (
    <div
      className="border-t border-grok-border bg-grok-void animate-in fade-in slide-in-from-top-1 duration-200"
      role="region"
      aria-label={`Details for port ${port.port}`}
    >
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Banner / version info */}
          <div className="rounded border border-grok-border bg-grok-surface-1 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Server className="w-3.5 h-3.5 text-grok-recon-blue" />
              <span className="text-xs font-semibold text-grok-text-heading uppercase tracking-wide">
                Service Info
              </span>
            </div>
            <div className="space-y-1 text-xs">
              <div className="flex gap-2">
                <span className="text-grok-text-muted w-16 flex-shrink-0">Service</span>
                <span className="font-mono text-grok-text-body">{port.service || 'unknown'}</span>
              </div>
              {port.version && (
                <div className="flex gap-2">
                  <span className="text-grok-text-muted w-16 flex-shrink-0">Version</span>
                  <span className="font-mono text-grok-text-body">{port.version}</span>
                </div>
              )}
              <div className="flex gap-2">
                <span className="text-grok-text-muted w-16 flex-shrink-0">Protocol</span>
                <span className="font-mono text-grok-text-body uppercase">
                  {port.protocol}
                </span>
              </div>
              {port.cpe && port.cpe.length > 0 && (
                <div className="flex gap-2">
                  <span className="text-grok-text-muted w-16 flex-shrink-0">CPE</span>
                  <span className="font-mono text-grok-text-body break-all">
                    {port.cpe.join(', ')}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Connection test (visual only) */}
          <div className="rounded border border-grok-border bg-grok-surface-1 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Network className="w-3.5 h-3.5 text-grok-loot-gold" />
              <span className="text-xs font-semibold text-grok-text-heading uppercase tracking-wide">
                Connection
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'w-2 h-2 rounded-full',
                  port.state === 'open' ? 'bg-green-400' : 'bg-gray-500'
                )}
              />
              <span className="text-xs text-grok-text-body">
                Port {port.port} is{' '}
                <span
                  className={
                    port.state === 'open' ? 'text-green-400 font-medium' : 'text-gray-400'
                  }
                >
                  {port.state}
                </span>
              </span>
            </div>
            <button
              className={cn(
                'mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium',
                'border border-grok-border bg-grok-surface-2 text-grok-text-muted',
                'cursor-not-allowed opacity-60'
              )}
              disabled
              title="Live connection testing requires an active scan session"
              aria-disabled="true"
            >
              <Zap className="w-3 h-3" />
              Test Connection
            </button>
          </div>
        </div>

        {/* Banner raw output */}
        {port.banner && (
          <div className="rounded border border-grok-border bg-grok-surface-1 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Terminal className="w-3.5 h-3.5 text-grok-text-muted" />
              <span className="text-xs font-semibold text-grok-text-heading uppercase tracking-wide">
                Banner
              </span>
            </div>
            <pre className="text-xs font-mono text-grok-text-body whitespace-pre-wrap break-all leading-relaxed">
              {port.banner}
            </pre>
          </div>
        )}

        {/* Nmap scripts */}
        {port.scripts && Object.keys(port.scripts).length > 0 && (
          <div className="rounded border border-grok-border bg-grok-surface-1 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Terminal className="w-3.5 h-3.5 text-grok-exploit-red" />
              <span className="text-xs font-semibold text-grok-text-heading uppercase tracking-wide">
                Script Output
              </span>
            </div>
            <div className="space-y-2">
              {Object.entries(port.scripts).map(([scriptName, output]) => (
                <div key={scriptName}>
                  <p className="text-[10px] font-mono text-grok-recon-blue uppercase mb-0.5">
                    {scriptName}
                  </p>
                  <pre className="text-xs font-mono text-grok-text-body whitespace-pre-wrap break-all leading-relaxed">
                    {output}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

// ============================================================================
// Export helpers
// ============================================================================

function exportCsv(vulns: VulnerabilityFinding[], target: string) {
  const header = ['ID', 'Title', 'Severity', 'CVE', 'CVSS', 'Affected Component', 'Description'];
  const rows = vulns.map((v) => [
    v.id,
    v.title,
    v.severity,
    v.cve ?? '',
    v.cvss?.toString() ?? '',
    v.affectedComponent ?? '',
    v.description.replace(/"/g, '""'),
  ]);

  const csv = [header, ...rows]
    .map((r) => r.map((cell) => `"${cell}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${target}-vulnerabilities.csv`;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

function exportJson(results: CompleteScanResults) {
  const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${results.target}-results.json`;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// ============================================================================
// Main ResultsView
// ============================================================================

export function ResultsView() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [results, setResults] = useState<CompleteScanResults | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [activeTab, setActiveTab] = useState<'ports' | 'subdomains' | 'vulns' | 'raw'>('vulns');

  // Expanded row IDs (shared between ports and vulns)
  const [expandedVulnId, setExpandedVulnId] = useState<string | null>(null);
  const [expandedPortIdx, setExpandedPortIdx] = useState<number | null>(null);

  // Severity filter
  const [activeSeverities, setActiveSeverities] = useState<Set<Severity>>(new Set());

  const { addToast, openWorkflowDrawer, workflowDrawerTarget } = useUIStore();
  const { copied, copy } = useCopyFinding();

  useEffect(() => {
    loadTargets();
  }, []);

  // Auto-select target if navigated from WorkflowDrawer
  useEffect(() => {
    if (workflowDrawerTarget && targets.length > 0 && selectedTarget !== workflowDrawerTarget) {
      loadTargetResults(workflowDrawerTarget);
    }
  }, [workflowDrawerTarget, targets]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset expanded rows and filters when target changes
  useEffect(() => {
    setExpandedVulnId(null);
    setExpandedPortIdx(null);
    setActiveSeverities(new Set());
    setActiveTab('vulns');
  }, [selectedTarget]);

  const loadTargets = async () => {
    setIsLoading(true);
    try {
      const data = await apiService.getResults();
      setTargets(data);
    } catch (error) {
      console.error('Failed to load results:', error);
      addToast({ type: 'error', message: 'Failed to load results' });
    } finally {
      setIsLoading(false);
    }
  };

  const loadTargetResults = async (target: string) => {
    setSelectedTarget(target);
    setIsLoadingResults(true);
    try {
      const data = await apiService.getTargetResults(target);
      setResults(data);
    } catch (error) {
      console.error('Failed to load target results:', error);
      addToast({ type: 'error', message: 'Failed to load target results' });
      setResults(null);
    } finally {
      setIsLoadingResults(false);
    }
  };

  const handleDownload = async (format: 'json' | 'markdown') => {
    if (!selectedTarget) return;
    try {
      const blob = await apiService.downloadResults(selectedTarget, format);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedTarget}-results.${format === 'json' ? 'json' : 'md'}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      addToast({ type: 'success', message: `Results downloaded as ${format.toUpperCase()}` });
    } catch (error) {
      console.error('Failed to download results:', error);
      addToast({ type: 'error', message: 'Failed to download results' });
    }
  };

  // Severity counts for filter bar
  const severityCounts = useMemo<Record<Severity, number>>(() => {
    const base: Record<Severity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };
    if (!results?.vulnerabilities) return base;
    for (const v of results.vulnerabilities) {
      const s = v.severity as Severity;
      if (s in base) base[s]++;
    }
    return base;
  }, [results?.vulnerabilities]);

  // Filtered vulnerabilities
  const filteredVulns = useMemo(() => {
    if (!results?.vulnerabilities) return [];
    if (activeSeverities.size === 0) return results.vulnerabilities;
    return results.vulnerabilities.filter((v) =>
      activeSeverities.has(v.severity as Severity)
    );
  }, [results?.vulnerabilities, activeSeverities]);

  const toggleSeverity = useCallback((sev: Severity) => {
    setActiveSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return next;
    });
    setExpandedVulnId(null);
  }, []);

  const clearSeverityFilter = useCallback(() => {
    setActiveSeverities(new Set());
    setExpandedVulnId(null);
  }, []);

  const toggleVuln = useCallback((id: string) => {
    setExpandedVulnId((prev) => (prev === id ? null : id));
  }, []);

  const togglePort = useCallback((idx: number) => {
    setExpandedPortIdx((prev) => (prev === idx ? null : idx));
  }, []);

  // -------- Render --------

  if (isLoading) {
    return (
      <div className="h-full overflow-auto p-5">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <RefreshCw className="w-8 h-8 text-grok-recon-blue animate-spin mx-auto mb-2" />
            <p className="text-grok-text-muted">Loading results...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-5 space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[var(--grok-text-heading)] flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-[var(--grok-recon-blue)]" />
            Results Browser
          </h1>
          <p className="text-[10px] text-[var(--grok-text-muted)] mt-0.5 font-mono">
            Browse and export scan results
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="cs-btn flex items-center gap-1.5"
            onClick={() => openWorkflowDrawer()}
          >
            <Workflow className="w-3.5 h-3.5" />
            Workflow
          </button>
          <button className="cs-btn flex items-center gap-1.5" onClick={loadTargets}>
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Targets — horizontal pills ──────────────────────── */}
      <SectionPanel
        title={`Targets (${targets.length})`}
        icon={<Globe className="w-3.5 h-3.5 text-[var(--grok-recon-blue)]" />}
      >
        {targets.length === 0 ? (
          <p className="text-sm text-[var(--grok-text-muted)]">
            No scan results available. Run a scan from the Targets page.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {targets.map((target) => (
              <button
                key={target.id}
                onClick={() => loadTargetResults(target.url)}
                className={cn(
                  'px-3 py-1.5 rounded text-xs font-mono border transition-all',
                  selectedTarget === target.url
                    ? 'border-[var(--grok-recon-blue)] bg-[var(--grok-recon-blue)]/10 text-[var(--grok-recon-blue)] shadow-[0_0_8px_rgba(34,102,255,0.25)]'
                    : 'border-[var(--grok-border)] bg-[var(--grok-surface-2)] text-[var(--grok-text-body)] hover:border-[var(--grok-border-glow)] hover:bg-[var(--grok-surface-3)]'
                )}
              >
                <span className="flex items-center gap-2">
                  <span className={cn(
                    'w-2 h-2 rounded-full flex-shrink-0',
                    target.status === 'complete' ? 'bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.5)]'
                      : target.status === 'scanning' ? 'bg-blue-400 animate-pulse'
                      : target.status === 'failed' ? 'bg-red-400'
                      : 'bg-gray-500'
                  )} />
                  {target.url}
                </span>
              </button>
            ))}
          </div>
        )}
      </SectionPanel>

      {/* ── Selected target results ─────────────────────────── */}
      {!selectedTarget ? (
        <SectionPanel title="Select a Target" icon={<AlertCircle className="w-3.5 h-3.5" />}>
          <div className="text-center py-8">
            <AlertCircle className="w-10 h-10 text-[var(--grok-text-muted)] mx-auto mb-3" />
            <p className="text-sm text-[var(--grok-text-muted)]">
              Select a target above to view detailed results
            </p>
          </div>
        </SectionPanel>
      ) : isLoadingResults ? (
        <SectionPanel title={selectedTarget}>
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-8 h-8 text-[var(--grok-recon-blue)] animate-spin" />
          </div>
        </SectionPanel>
      ) : results ? (
        <>
          {/* Stats + Export row */}
          <SectionPanel
            title={selectedTarget}
            icon={<Server className="w-3.5 h-3.5 text-[var(--grok-recon-blue)]" />}
            action={
              <div className="flex gap-1.5">
                <button
                  className="cs-btn flex items-center gap-1"
                  onClick={() => exportCsv(filteredVulns, selectedTarget)}
                  title="Export vulnerabilities as CSV"
                >
                  <FileText className="w-3 h-3" />
                  CSV
                </button>
                <button
                  className="cs-btn flex items-center gap-1"
                  onClick={() => exportJson(results)}
                  title="Export full results as JSON"
                >
                  <FileJson className="w-3 h-3" />
                  JSON
                </button>
                <button
                  className="cs-btn flex items-center gap-1"
                  onClick={() => handleDownload('json')}
                >
                  <Download className="w-3 h-3" />
                  Report
                </button>
              </div>
            }
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard label="Open Ports" value={results.stats?.openPorts || 0} color="text-[var(--grok-success)]" />
              <MetricCard label="Vulnerabilities" value={results.stats?.totalVulnerabilities || 0} color="text-[var(--grok-exploit-red)]" />
              <MetricCard label="Subdomains" value={results.stats?.totalSubdomains || 0} />
              <MetricCard label="Endpoints" value={results.stats?.totalEndpoints || results.httpEndpoints?.length || 0} />
            </div>

            {/* Severity summary bar */}
            {results.stats && results.stats.totalVulnerabilities > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {results.stats.criticalVulns > 0 && (
                  <span className="px-2 py-0.5 text-xs rounded bg-red-900/30 text-red-400 border border-red-800">
                    {results.stats.criticalVulns} CRIT
                  </span>
                )}
                {results.stats.highVulns > 0 && (
                  <span className="px-2 py-0.5 text-xs rounded bg-orange-900/30 text-orange-400 border border-orange-800">
                    {results.stats.highVulns} HIGH
                  </span>
                )}
                {results.stats.mediumVulns > 0 && (
                  <span className="px-2 py-0.5 text-xs rounded bg-yellow-900/30 text-yellow-500 border border-yellow-800">
                    {results.stats.mediumVulns} MED
                  </span>
                )}
                {results.stats.lowVulns > 0 && (
                  <span className="px-2 py-0.5 text-xs rounded bg-blue-900/30 text-blue-400 border border-blue-800">
                    {results.stats.lowVulns} LOW
                  </span>
                )}
              </div>
            )}
          </SectionPanel>

          {/* Tab navigation */}
          <div className="cs-panel">
            <div className="grid grid-cols-4 gap-0 p-3 border-b border-[var(--grok-border)]">
              {(
                [
                  { id: 'vulns' as const, label: 'Vulnerabilities', count: results.vulnerabilities?.length },
                  { id: 'ports' as const, label: 'Ports', count: results.ports?.length },
                  { id: 'subdomains' as const, label: 'Subdomains', count: results.subdomains?.length },
                  { id: 'raw' as const, label: 'Raw Output', count: results.rawOutput?.length },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'py-2 text-xs font-semibold uppercase tracking-wider border transition-all whitespace-nowrap text-center',
                    activeTab === tab.id
                      ? 'bg-[var(--grok-recon-blue)] border-[var(--grok-recon-blue)] text-white shadow-[0_0_10px_rgba(34,102,255,0.3)]'
                      : 'bg-[var(--grok-surface-2)] border-[var(--grok-border)] text-[var(--grok-text-muted)] hover:bg-[var(--grok-surface-3)] hover:border-[var(--grok-border-glow)] hover:text-[var(--grok-text-body)]',
                    'first:rounded-l last:rounded-r -ml-px first:ml-0'
                  )}
                >
                  {tab.label}
                  {tab.count ? (
                    <span className={cn(
                      'ml-2 px-2 py-0.5 text-[10px] rounded font-mono font-bold',
                      activeTab === tab.id
                        ? 'bg-white/20 text-white'
                        : 'bg-[var(--grok-void)] text-[var(--grok-text-muted)] border border-[var(--grok-border)]'
                    )}>
                      {tab.count}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            {/* === TAB: VULNERABILITIES === */}
            {activeTab === 'vulns' && (
              <div>
                {results.vulnerabilities && results.vulnerabilities.length > 0 ? (
                  <>
                    <SeverityFilterBar
                      counts={severityCounts}
                      active={activeSeverities}
                      onToggle={toggleSeverity}
                      onClearAll={clearSeverityFilter}
                      total={results.vulnerabilities.length}
                    />

                    {filteredVulns.length === 0 ? (
                      <div className="p-6 text-center text-[var(--grok-text-muted)] text-sm">
                        No vulnerabilities match the selected filters.
                      </div>
                    ) : (
                      <div>
                        {filteredVulns.map((vuln) => {
                          const isExpanded = expandedVulnId === vuln.id;
                          const cfg =
                            SEVERITY_CONFIG[vuln.severity as Severity] ?? SEVERITY_CONFIG.info;
                          return (
                            <div key={vuln.id} className="border-b border-[var(--grok-border)] last:border-b-0">
                              <button
                                className={cn(
                                  'w-full text-left p-4 hover:bg-[var(--grok-surface-1)] transition-colors',
                                  isExpanded && 'bg-[var(--grok-surface-1)]'
                                )}
                                onClick={() => toggleVuln(vuln.id)}
                                aria-expanded={isExpanded}
                                aria-controls={`vuln-detail-${vuln.id}`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex items-start gap-2 flex-1 min-w-0">
                                    <ChevronDown
                                      className={cn(
                                        'w-4 h-4 text-[var(--grok-text-muted)] mt-0.5 flex-shrink-0 transition-transform duration-200',
                                        !isExpanded && '-rotate-90'
                                      )}
                                    />
                                    <div className="min-w-0">
                                      <h4 className="text-sm font-medium text-[var(--grok-text-heading)]">
                                        {vuln.title}
                                      </h4>
                                      <p className="text-xs text-[var(--grok-text-muted)] mt-0.5 line-clamp-1">
                                        {vuln.description}
                                      </p>
                                      {vuln.cve && (
                                        <span className="text-[10px] font-mono text-[var(--grok-recon-blue)] mt-1 block">
                                          {vuln.cve}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    {vuln.cvss !== undefined && (
                                      <span
                                        className="text-xs font-mono font-bold"
                                        style={{
                                          color:
                                            vuln.cvss >= 9.0
                                              ? 'var(--grok-crit-red)'
                                              : vuln.cvss >= 7.0
                                                ? 'var(--grok-exploit-red)'
                                                : vuln.cvss >= 4.0
                                                  ? 'var(--grok-loot-gold)'
                                                  : 'var(--grok-ok-green)',
                                        }}
                                      >
                                        {vuln.cvss.toFixed(1)}
                                      </span>
                                    )}
                                    <span
                                      className={cn(
                                        'px-2 py-0.5 rounded text-xs font-medium border',
                                        cfg.bg,
                                        cfg.text,
                                        cfg.border
                                      )}
                                    >
                                      {cfg.label}
                                    </span>
                                  </div>
                                </div>
                              </button>

                              {isExpanded && (
                                <div id={`vuln-detail-${vuln.id}`}>
                                  <VulnDetailPanel
                                    vuln={vuln}
                                    target={selectedTarget}
                                    copied={copied}
                                    onCopy={copy}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="p-6 text-center text-[var(--grok-text-muted)] text-sm">
                    No vulnerabilities found for this target.
                  </div>
                )}
              </div>
            )}

            {/* === TAB: PORTS === */}
            {activeTab === 'ports' && (
              <div>
                {results.ports && results.ports.length > 0 ? (
                  <div>
                    <div className="grid grid-cols-5 gap-0 bg-[var(--grok-surface-2)] border-b border-[var(--grok-border)] px-4 py-2">
                      {['Port', 'Proto', 'State', 'Service', 'Version'].map((h) => (
                        <span key={h} className="text-xs font-medium text-[var(--grok-text-muted)] uppercase">
                          {h}
                        </span>
                      ))}
                    </div>
                    {results.ports.map((port, idx) => {
                      const isExpanded = expandedPortIdx === idx;
                      const hasBanner = !!(
                        port.banner ||
                        (port.scripts && Object.keys(port.scripts).length > 0)
                      );
                      return (
                        <div key={idx} className="border-b border-[var(--grok-border)] last:border-b-0">
                          <button
                            className={cn(
                              'w-full text-left px-4 py-2 hover:bg-[var(--grok-surface-1)] transition-colors',
                              isExpanded && 'bg-[var(--grok-surface-1)]'
                            )}
                            onClick={() => togglePort(idx)}
                            aria-expanded={isExpanded}
                          >
                            <div className="grid grid-cols-5 gap-0 items-center text-sm">
                              <div className="flex items-center gap-1.5">
                                {hasBanner ? (
                                  <ChevronDown
                                    className={cn(
                                      'w-3.5 h-3.5 text-[var(--grok-text-muted)] transition-transform duration-200',
                                      !isExpanded && '-rotate-90'
                                    )}
                                  />
                                ) : (
                                  <span className="w-3.5" />
                                )}
                                <span className="font-mono text-[var(--grok-text-heading)]">
                                  {port.port}
                                </span>
                              </div>
                              <span className="text-[var(--grok-text-body)] text-xs uppercase">
                                {port.protocol}
                              </span>
                              <span>
                                <span
                                  className={cn(
                                    'px-2 py-0.5 rounded text-xs font-medium',
                                    port.state === 'open'
                                      ? 'bg-green-500/20 text-green-400'
                                      : 'bg-gray-500/20 text-gray-400'
                                  )}
                                >
                                  {port.state}
                                </span>
                              </span>
                              <span className="text-[var(--grok-text-body)] text-xs">
                                {port.service || '-'}
                              </span>
                              <span className="text-[var(--grok-text-muted)] text-xs truncate">
                                {port.version || '-'}
                              </span>
                            </div>
                          </button>

                          {isExpanded && <PortDetailPanel port={port} />}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-6 text-center text-[var(--grok-text-muted)] text-sm">
                    No ports discovered for this target.
                  </div>
                )}
              </div>
            )}

            {/* === TAB: SUBDOMAINS === */}
            {activeTab === 'subdomains' && (
              <div>
                {results.subdomains && results.subdomains.length > 0 && (
                  <div className="max-h-96 overflow-y-auto divide-y divide-[var(--grok-border)]">
                    {results.subdomains.map((subdomain, idx) => (
                      <div key={idx} className="px-4 py-2 hover:bg-[var(--grok-surface-1)]">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-[var(--grok-text-body)] font-mono">
                            {subdomain.subdomain}
                          </span>
                          {subdomain.alive && (
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400">
                              ALIVE
                            </span>
                          )}
                        </div>
                        {subdomain.ipAddresses && subdomain.ipAddresses.length > 0 && (
                          <p className="text-xs text-[var(--grok-text-muted)] mt-1">
                            {subdomain.ipAddresses.join(', ')}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {results.httpEndpoints && results.httpEndpoints.length > 0 && (
                  <div className="border-t border-[var(--grok-border)]">
                    <div className="px-4 py-2 bg-[var(--grok-surface-2)] border-b border-[var(--grok-border)]">
                      <span className="text-xs font-semibold text-[var(--grok-text-muted)] uppercase tracking-wide">
                        HTTP Endpoints ({results.httpEndpoints.length})
                      </span>
                    </div>
                    <div className="max-h-64 overflow-y-auto divide-y divide-[var(--grok-border)]">
                      {results.httpEndpoints.map((endpoint, idx) => (
                        <div key={idx} className="px-4 py-3 hover:bg-[var(--grok-surface-1)]">
                          <div className="flex items-center justify-between mb-1">
                            <a
                              href={endpoint.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-[var(--grok-recon-blue)] hover:underline font-mono"
                            >
                              {endpoint.url}
                            </a>
                            <span className="text-xs text-[var(--grok-text-muted)]">
                              {endpoint.statusCode}
                            </span>
                          </div>
                          {endpoint.title && (
                            <p className="text-xs text-[var(--grok-text-body)] truncate">
                              {endpoint.title}
                            </p>
                          )}
                          {endpoint.technologies && endpoint.technologies.length > 0 && (
                            <div className="flex gap-1 mt-2 flex-wrap">
                              {endpoint.technologies.map((tech, i) => (
                                <span
                                  key={i}
                                  className="px-2 py-0.5 rounded text-xs bg-[var(--grok-surface-2)] border border-[var(--grok-border)] text-[var(--grok-text-muted)]"
                                >
                                  {tech}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {results.technologies && results.technologies.length > 0 && (
                  <div className="border-t border-[var(--grok-border)] p-4">
                    <p className="text-xs font-semibold text-[var(--grok-text-muted)] uppercase tracking-wide mb-3">
                      Technologies Detected
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {results.technologies.map((tech, idx) => (
                        <div
                          key={idx}
                          className="px-3 py-2 bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded"
                        >
                          <p className="text-sm font-medium text-[var(--grok-text-heading)]">
                            {tech.name}
                            {tech.version && (
                              <span className="text-[var(--grok-text-muted)] ml-1">v{tech.version}</span>
                            )}
                          </p>
                          <p className="text-xs text-[var(--grok-text-muted)] mt-0.5">{tech.category}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(!results.subdomains || results.subdomains.length === 0) &&
                  (!results.httpEndpoints || results.httpEndpoints.length === 0) &&
                  (!results.technologies || results.technologies.length === 0) && (
                    <div className="p-6 text-center text-[var(--grok-text-muted)] text-sm">
                      No subdomain or endpoint data available.
                    </div>
                  )}
              </div>
            )}

            {/* === TAB: RAW OUTPUT === */}
            {activeTab === 'raw' && (
              <div>
                {results.rawOutput && results.rawOutput.length > 0 ? (
                  <div className="max-h-[500px] overflow-y-auto">
                    <pre className="p-4 text-xs font-mono text-[var(--grok-text-body)] leading-relaxed whitespace-pre-wrap">
                      {results.rawOutput.join('\n')}
                    </pre>
                  </div>
                ) : (
                  <div className="p-6 text-center text-[var(--grok-text-muted)] text-sm">
                    No raw output available.
                  </div>
                )}
                {results.errors && results.errors.length > 0 && (
                  <div className="border-t border-[var(--grok-border)]">
                    <div className="px-4 py-2 bg-red-900/10 border-b border-[var(--grok-border)]">
                      <span className="text-xs font-semibold text-[var(--grok-exploit-red)] uppercase tracking-wide">
                        Errors ({results.errors.length})
                      </span>
                    </div>
                    <pre className="p-4 text-xs font-mono text-red-400 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                      {results.errors.join('\n')}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        <SectionPanel title={selectedTarget ?? ''}>
          <div className="text-center py-8">
            <AlertCircle className="w-10 h-10 text-[var(--grok-text-muted)] mx-auto mb-3" />
            <p className="text-sm text-[var(--grok-text-muted)]">No results available for this target</p>
          </div>
        </SectionPanel>
      )}
    </div>
  );
}

// ============================================================================
// Small reusable sub-components (kept file-local)
// ============================================================================

function MetricCard({
  label,
  value,
  color = 'text-grok-text-heading',
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded-lg p-4 hover:border-[var(--grok-border-glow)] transition-colors">
      <p className="text-[10px] text-[var(--grok-text-muted)] uppercase tracking-widest font-semibold mb-2">{label}</p>
      <p className={cn('text-3xl font-bold font-mono', color)}>{value}</p>
    </div>
  );
}
