/**
 * WorkflowDrawer — right-side slide-out panel for post-scan attack workflow.
 *
 * Groups findings by target, shows quick stats + priority attack vectors,
 * and lets the operator navigate to the Results page with a target pre-selected.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Shield,
  Server,
  Network,
  AlertTriangle,
  Loader,
} from 'lucide-react';
import { useUIStore } from '@stores/uiStore';
import { apiService } from '@services/api';
import { cn } from '@utils/index';
import type { Target, CompleteScanResults } from '@/types';

// ============================================================================
// Types
// ============================================================================

interface TargetSummary {
  target: Target;
  results: CompleteScanResults | null;
  loading: boolean;
  expanded: boolean;
}

// ============================================================================
// WorkflowDrawer
// ============================================================================

export function WorkflowDrawer() {
  const { workflowDrawerOpen, closeWorkflowDrawer, navigateToResultsWithTarget } = useUIStore();
  const [closing, setClosing] = useState(false);
  const [targets, setTargets] = useState<TargetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Fetch targets when drawer opens
  useEffect(() => {
    if (!workflowDrawerOpen) return;
    setClosing(false);
    loadTargets();
  }, [workflowDrawerOpen]);

  // Escape key to close
  useEffect(() => {
    if (!workflowDrawerOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [workflowDrawerOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTargets = async () => {
    setLoading(true);
    try {
      const data = await apiService.getResults();
      setTargets(
        data.map((t: Target) => ({
          target: t,
          results: null,
          loading: false,
          expanded: false,
        }))
      );
    } catch (err) {
      console.error('[WorkflowDrawer] Failed to load targets:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleTarget = useCallback(async (idx: number) => {
    setTargets((prev) => {
      const next = [...prev];
      const item = { ...next[idx] };
      item.expanded = !item.expanded;

      // Lazy-load results on first expand
      if (item.expanded && !item.results && !item.loading) {
        item.loading = true;
        next[idx] = item;

        // Fire off the async fetch
        apiService
          .getTargetResults(item.target.url)
          .then((results) => {
            setTargets((p) => {
              const updated = [...p];
              updated[idx] = { ...updated[idx], results, loading: false };
              return updated;
            });
          })
          .catch(() => {
            setTargets((p) => {
              const updated = [...p];
              updated[idx] = { ...updated[idx], loading: false };
              return updated;
            });
          });
      }

      next[idx] = item;
      return next;
    });
  }, []);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      closeWorkflowDrawer();
      setClosing(false);
    }, 200);
  }, [closeWorkflowDrawer]);

  const handleViewInResults = useCallback(
    (targetUrl: string) => {
      navigateToResultsWithTarget(targetUrl);
    },
    [navigateToResultsWithTarget]
  );

  if (!workflowDrawerOpen && !closing) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 bg-black/50 z-40 transition-opacity duration-200',
          closing ? 'opacity-0' : 'opacity-100'
        )}
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={cn(
          'fixed top-0 right-0 h-full w-96 max-w-[90vw] z-50 flex flex-col',
          'bg-[var(--grok-surface-1)] border-l border-[var(--grok-border)]',
          closing ? 'animate-slide-out-right' : 'animate-slide-in-right'
        )}
        role="dialog"
        aria-label="Attack Workflow"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--grok-border)] flex-shrink-0">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-[var(--grok-exploit-red)]" />
            <h2 className="text-sm font-bold text-[var(--grok-text-heading)] uppercase tracking-wide">
              Attack Workflow
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-[var(--grok-surface-3)] transition-colors"
            aria-label="Close workflow drawer"
          >
            <X className="w-4 h-4 text-[var(--grok-text-muted)]" />
          </button>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-b border-[var(--grok-border)] bg-[var(--grok-surface-2)] flex-shrink-0">
          {['Review', 'Prioritize', 'Execute'].map((step, i) => (
            <div key={step} className="flex items-center gap-1.5">
              <span
                className={cn(
                  'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border',
                  i === 0
                    ? 'border-[var(--grok-recon-blue)] text-[var(--grok-recon-blue)] bg-[var(--grok-recon-blue)]/10'
                    : 'border-[var(--grok-border)] text-[var(--grok-text-muted)]'
                )}
              >
                {i + 1}
              </span>
              <span
                className={cn(
                  'text-xs font-medium',
                  i === 0 ? 'text-[var(--grok-recon-blue)]' : 'text-[var(--grok-text-muted)]'
                )}
              >
                {step}
              </span>
            </div>
          ))}
        </div>

        {/* Target list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="w-6 h-6 text-[var(--grok-recon-blue)] animate-spin" />
            </div>
          ) : targets.length === 0 ? (
            <div className="text-center py-12 px-4">
              <Server className="w-8 h-8 text-[var(--grok-text-muted)] mx-auto mb-2" />
              <p className="text-sm text-[var(--grok-text-muted)]">
                No scan results yet. Run a scan from the Targets page.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--grok-border)]">
              {targets.map((item, idx) => (
                <TargetCard
                  key={item.target.id}
                  item={item}
                  onToggle={() => toggleTarget(idx)}
                  onViewResults={() => handleViewInResults(item.target.url)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ============================================================================
// TargetCard — expandable accordion card for a single target
// ============================================================================

interface TargetCardProps {
  item: TargetSummary;
  onToggle: () => void;
  onViewResults: () => void;
}

function TargetCard({ item, onToggle, onViewResults }: TargetCardProps) {
  const { target, results, loading, expanded } = item;

  return (
    <div>
      {/* Collapsed header */}
      <button
        onClick={onToggle}
        className={cn(
          'w-full text-left px-4 py-3 hover:bg-[var(--grok-surface-2)] transition-colors',
          expanded && 'bg-[var(--grok-surface-2)]'
        )}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-[var(--grok-text-muted)] flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[var(--grok-text-muted)] flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-mono text-[var(--grok-text-heading)] truncate">
              {target.url}
            </p>
            {results && (
              <p className="text-[10px] text-[var(--grok-text-muted)] mt-0.5">
                Ports: {results.stats?.openPorts ?? 0} · Vulns:{' '}
                {results.stats?.totalVulnerabilities ?? 0}
              </p>
            )}
          </div>
          <TargetStatusDot status={target.status} />
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-3 animate-fade-in">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader className="w-4 h-4 text-[var(--grok-recon-blue)] animate-spin" />
            </div>
          ) : results ? (
            <div className="space-y-3">
              {/* Quick stats */}
              <div className="grid grid-cols-3 gap-2">
                <MiniStat
                  icon={<Network className="w-3 h-3" />}
                  label="Ports"
                  value={results.stats?.openPorts ?? 0}
                />
                <MiniStat
                  icon={<AlertTriangle className="w-3 h-3" />}
                  label="Vulns"
                  value={results.stats?.totalVulnerabilities ?? 0}
                  critical={results.stats?.criticalVulns ?? 0}
                />
                <MiniStat
                  icon={<Server className="w-3 h-3" />}
                  label="Endpoints"
                  value={results.stats?.totalEndpoints ?? results.httpEndpoints?.length ?? 0}
                />
              </div>

              {/* Severity bar */}
              {results.stats && results.stats.totalVulnerabilities > 0 && (
                <div className="flex flex-wrap gap-1">
                  {results.stats.criticalVulns > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-red-900/30 text-red-400 border border-red-800">
                      {results.stats.criticalVulns} CRIT
                    </span>
                  )}
                  {results.stats.highVulns > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-orange-900/30 text-orange-400 border border-orange-800">
                      {results.stats.highVulns} HIGH
                    </span>
                  )}
                  {results.stats.mediumVulns > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-yellow-900/30 text-yellow-500 border border-yellow-800">
                      {results.stats.mediumVulns} MED
                    </span>
                  )}
                  {results.stats.lowVulns > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-blue-900/30 text-blue-400 border border-blue-800">
                      {results.stats.lowVulns} LOW
                    </span>
                  )}
                </div>
              )}

              {/* Attack vectors */}
              <AttackVectors results={results} />

              {/* View in Results button */}
              <button
                onClick={onViewResults}
                className="cs-btn cs-btn-primary w-full flex items-center justify-center gap-1.5"
              >
                <ExternalLink className="w-3 h-3" />
                View in Results
              </button>
            </div>
          ) : (
            <p className="text-xs text-[var(--grok-text-muted)] py-2">
              No results available for this target.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// AttackVectors — auto-derived from scan results
// ============================================================================

function AttackVectors({ results }: { results: CompleteScanResults }) {
  const vectors: string[] = [];

  // High-value ports
  const highValuePorts: Record<number, string> = {
    21: 'FTP',
    22: 'SSH',
    23: 'Telnet',
    25: 'SMTP',
    53: 'DNS',
    80: 'HTTP',
    110: 'POP3',
    139: 'NetBIOS',
    443: 'HTTPS',
    445: 'SMB',
    1433: 'MSSQL',
    1521: 'Oracle',
    3306: 'MySQL',
    3389: 'RDP',
    5432: 'PostgreSQL',
    5900: 'VNC',
    6379: 'Redis',
    8080: 'HTTP-Alt',
    8443: 'HTTPS-Alt',
    9090: 'Admin Panel',
    27017: 'MongoDB',
  };

  if (results.ports) {
    for (const port of results.ports) {
      if (port.state === 'open' && highValuePorts[port.port]) {
        const svc = port.service || highValuePorts[port.port];
        const version = port.version ? ` (${port.version})` : '';
        vectors.push(`${svc} on port ${port.port}${version}`);
      }
    }
  }

  // Vulnerabilities by severity
  if (results.vulnerabilities) {
    const critVulns = results.vulnerabilities.filter((v) => v.severity === 'critical');
    const highVulns = results.vulnerabilities.filter((v) => v.severity === 'high');
    for (const v of [...critVulns, ...highVulns].slice(0, 3)) {
      vectors.push(v.title);
    }
  }

  if (vectors.length === 0) return null;

  return (
    <div>
      <p className="text-[10px] font-semibold text-[var(--grok-text-muted)] uppercase tracking-wide mb-1.5">
        Priority Attack Vectors
      </p>
      <ul className="space-y-1">
        {vectors.slice(0, 6).map((v, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className="text-[var(--grok-exploit-red)] mt-0.5 text-[10px]">&#9679;</span>
            <span className="text-xs text-[var(--grok-text-body)]">{v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================================
// Small sub-components
// ============================================================================

function MiniStat({
  icon,
  label,
  value,
  critical,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  critical?: number;
}) {
  return (
    <div className="bg-[var(--grok-surface-3)] border border-[var(--grok-border)] rounded p-2 text-center">
      <div className="flex items-center justify-center gap-1 text-[var(--grok-text-muted)] mb-0.5">
        {icon}
        <span className="text-[10px] uppercase">{label}</span>
      </div>
      <span
        className={cn(
          'text-lg font-bold font-mono',
          critical && critical > 0
            ? 'text-[var(--grok-exploit-red)]'
            : value > 0
              ? 'text-[var(--grok-text-heading)]'
              : 'text-[var(--grok-text-muted)]'
        )}
      >
        {value}
      </span>
    </div>
  );
}

function TargetStatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-gray-500',
    scanning: 'bg-blue-400 animate-pulse',
    complete: 'bg-green-400',
    failed: 'bg-red-400',
  };

  return (
    <span
      className={cn('w-2 h-2 rounded-full flex-shrink-0', colors[status] ?? colors.pending)}
      title={status}
    />
  );
}
