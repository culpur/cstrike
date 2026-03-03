/**
 * Scan Diffing — Compare two scan runs side-by-side to spot changes
 *
 * Shows new/removed ports, subdomains, vulnerabilities between scans.
 * Useful for tracking attack surface changes over time.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  GitCompareArrows,
  ArrowRight,
  Plus,
  Minus,
  Equal,
  AlertTriangle,
  Globe,
  Network,
  Shield,
  RefreshCw,
  Download,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@utils/index';
import { apiService } from '@services/api';
import { useUIStore } from '@stores/uiStore';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface ScanSnapshot {
  id: string;
  target: string;
  timestamp: number;
  ports: { port: number; protocol: string; state: string; service?: string; version?: string }[];
  subdomains: string[];
  vulnerabilities: { id: string; title: string; severity: string; url?: string }[];
}

type DiffStatus = 'added' | 'removed' | 'unchanged' | 'changed';

interface DiffItem<T> {
  status: DiffStatus;
  value: T;
  prev?: T;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function diffArrays<T>(
  prev: T[],
  curr: T[],
  key: (item: T) => string
): DiffItem<T>[] {
  const prevMap = new Map(prev.map((i) => [key(i), i]));
  const currMap = new Map(curr.map((i) => [key(i), i]));
  const result: DiffItem<T>[] = [];

  for (const [k, v] of currMap) {
    if (!prevMap.has(k)) {
      result.push({ status: 'added', value: v });
    } else {
      const p = prevMap.get(k)!;
      const changed = JSON.stringify(p) !== JSON.stringify(v);
      result.push({ status: changed ? 'changed' : 'unchanged', value: v, prev: p });
    }
  }
  for (const [k, v] of prevMap) {
    if (!currMap.has(k)) {
      result.push({ status: 'removed', value: v });
    }
  }

  // Sort: added first, then changed, unchanged, removed
  const order: Record<DiffStatus, number> = { added: 0, changed: 1, unchanged: 2, removed: 3 };
  return result.sort((a, b) => order[a.status] - order[b.status]);
}

function statusColor(s: DiffStatus) {
  switch (s) {
    case 'added':
      return 'var(--grok-ok-green)';
    case 'removed':
      return 'var(--grok-crit-red)';
    case 'changed':
      return 'var(--grok-loot-gold)';
    default:
      return 'var(--grok-text-muted)';
  }
}

function StatusIcon({ status }: { status: DiffStatus }) {
  const color = statusColor(status);
  switch (status) {
    case 'added':
      return <Plus className="w-3.5 h-3.5" style={{ color }} />;
    case 'removed':
      return <Minus className="w-3.5 h-3.5" style={{ color }} />;
    case 'changed':
      return <RefreshCw className="w-3.5 h-3.5" style={{ color }} />;
    default:
      return <Equal className="w-3.5 h-3.5" style={{ color }} />;
  }
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function ScanDiffView() {
  const { addToast } = useUIStore();
  const [snapshots, setSnapshots] = useState<ScanSnapshot[]>([]);
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');
  const [loading, setLoading] = useState(true);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [activeTab, setActiveTab] = useState<'ports' | 'subdomains' | 'vulns'>('ports');

  // Fetch all scan results and build snapshots
  useEffect(() => {
    (async () => {
      try {
        const targets = await apiService.getResults();
        const all: ScanSnapshot[] = [];
        for (const t of targets) {
          try {
            const results = await apiService.getTargetResults(t.url);
            if (results) {
              all.push({
                id: results.scanId || t.id,
                target: t.url,
                timestamp: results.startTime || t.addedAt,
                ports: (results.ports || []).map((p: any) => ({
                  port: p.port,
                  protocol: p.protocol,
                  state: p.state,
                  service: p.service,
                  version: p.version,
                })),
                subdomains: (results.subdomains || []).map((s: any) => s.subdomain || s),
                vulnerabilities: (results.vulnerabilities || []).map((v: any) => ({
                  id: v.id || v.title,
                  title: v.title || v.name,
                  severity: v.severity,
                  url: v.url,
                })),
              });
            }
          } catch { /* skip */ }
        }
        // Sort newest first
        all.sort((a, b) => b.timestamp - a.timestamp);
        setSnapshots(all);
        if (all.length >= 2) {
          setLeftId(all[1].id);
          setRightId(all[0].id);
        } else if (all.length === 1) {
          setLeftId(all[0].id);
          setRightId(all[0].id);
        }
      } catch {
        addToast({ type: 'error', message: 'Failed to load scan data', duration: 4000 });
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const left = useMemo(() => snapshots.find((s) => s.id === leftId), [snapshots, leftId]);
  const right = useMemo(() => snapshots.find((s) => s.id === rightId), [snapshots, rightId]);

  const portDiff = useMemo(
    () =>
      left && right
        ? diffArrays(left.ports, right.ports, (p) => `${p.port}/${p.protocol}`)
        : [],
    [left, right]
  );

  const subDiff = useMemo(
    () =>
      left && right
        ? diffArrays(
            left.subdomains.map((s) => ({ sub: s })),
            right.subdomains.map((s) => ({ sub: s })),
            (s) => s.sub
          )
        : [],
    [left, right]
  );

  const vulnDiff = useMemo(
    () =>
      left && right
        ? diffArrays(left.vulnerabilities, right.vulnerabilities, (v) => v.id)
        : [],
    [left, right]
  );

  const stats = useMemo(() => {
    const count = (arr: DiffItem<any>[]) => ({
      added: arr.filter((i) => i.status === 'added').length,
      removed: arr.filter((i) => i.status === 'removed').length,
      changed: arr.filter((i) => i.status === 'changed').length,
      unchanged: arr.filter((i) => i.status === 'unchanged').length,
    });
    return { ports: count(portDiff), subs: count(subDiff), vulns: count(vulnDiff) };
  }, [portDiff, subDiff, vulnDiff]);

  const filtered = useCallback(
    <T,>(items: DiffItem<T>[]) =>
      showUnchanged ? items : items.filter((i) => i.status !== 'unchanged'),
    [showUnchanged]
  );

  const exportDiff = useCallback(() => {
    const data = { left: left?.target, right: right?.target, ports: portDiff, subdomains: subDiff, vulnerabilities: vulnDiff };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scan-diff-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast({ type: 'success', message: 'Diff exported', duration: 3000 });
  }, [left, right, portDiff, subDiff, vulnDiff, addToast]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <RefreshCw className="w-6 h-6 animate-spin text-[var(--grok-recon-blue)]" />
      </div>
    );
  }

  const tabs = [
    { id: 'ports' as const, label: 'Ports', icon: Network, count: stats.ports.added + stats.ports.removed + stats.ports.changed },
    { id: 'subdomains' as const, label: 'Subdomains', icon: Globe, count: stats.subs.added + stats.subs.removed + stats.subs.changed },
    { id: 'vulns' as const, label: 'Vulnerabilities', icon: Shield, count: stats.vulns.added + stats.vulns.removed + stats.vulns.changed },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden p-5 gap-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold text-[var(--grok-text-heading)] flex items-center gap-2">
            <GitCompareArrows className="w-5 h-5 text-[var(--grok-recon-blue)]" />
            Scan Diff
          </h1>
          <p className="text-[10px] text-[var(--grok-text-muted)] mt-0.5 font-mono">
            Compare scan runs side by side
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowUnchanged(!showUnchanged)}
            className={cn(
              'cs-btn',
              showUnchanged && 'border-[var(--grok-recon-blue)] text-[var(--grok-recon-blue)]'
            )}
          >
            {showUnchanged ? 'Hide' : 'Show'} Unchanged
          </button>
          <button
            onClick={exportDiff}
            className="cs-btn flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        </div>
      </div>

      {/* Selector Row */}
      <div className="flex items-center gap-3 flex-shrink-0 p-3 rounded-lg bg-[var(--grok-surface-1)] border border-[var(--grok-border)]">
        <div className="flex-1">
          <label className="text-[10px] uppercase tracking-wider text-[var(--grok-text-muted)] mb-1 block">
            Baseline (Before)
          </label>
          <div className="relative">
            <select
              value={leftId}
              onChange={(e) => setLeftId(e.target.value)}
              className="w-full bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded px-3 py-2 text-xs text-[var(--grok-text-body)] appearance-none cursor-pointer"
            >
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.target} — {fmtDate(s.timestamp)}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-[var(--grok-text-muted)] pointer-events-none" />
          </div>
        </div>
        <ArrowRight className="w-5 h-5 text-[var(--grok-recon-blue)] flex-shrink-0 mt-4" />
        <div className="flex-1">
          <label className="text-[10px] uppercase tracking-wider text-[var(--grok-text-muted)] mb-1 block">
            Current (After)
          </label>
          <div className="relative">
            <select
              value={rightId}
              onChange={(e) => setRightId(e.target.value)}
              className="w-full bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded px-3 py-2 text-xs text-[var(--grok-text-body)] appearance-none cursor-pointer"
            >
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.target} — {fmtDate(s.timestamp)}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-[var(--grok-text-muted)] pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Summary Badges */}
      <div className="flex gap-3 flex-shrink-0">
        {[
          { label: 'New', count: stats.ports.added + stats.subs.added + stats.vulns.added, color: 'var(--grok-ok-green)', icon: Plus },
          { label: 'Removed', count: stats.ports.removed + stats.subs.removed + stats.vulns.removed, color: 'var(--grok-crit-red)', icon: Minus },
          { label: 'Changed', count: stats.ports.changed + stats.subs.changed + stats.vulns.changed, color: 'var(--grok-loot-gold)', icon: RefreshCw },
        ].map((b) => (
          <div
            key={b.label}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--grok-surface-1)] border border-[var(--grok-border)]"
          >
            <b.icon className="w-3.5 h-3.5" style={{ color: b.color }} />
            <span className="text-lg font-bold font-mono" style={{ color: b.color }}>
              {b.count}
            </span>
            <span className="text-xs text-[var(--grok-text-muted)]">{b.label}</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-shrink-0 border-b border-[var(--grok-border)]">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                'px-4 py-2.5 text-xs font-medium flex items-center gap-2 border-b-2 transition-colors -mb-px',
                activeTab === t.id
                  ? 'border-[var(--grok-recon-blue)] text-[var(--grok-recon-blue)]'
                  : 'border-transparent text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)]'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
              {t.count > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-[var(--grok-surface-2)]">
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Diff Content */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {snapshots.length < 1 && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--grok-text-muted)]">
            <AlertTriangle className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">No scan data available. Run a scan first.</p>
          </div>
        )}

        {activeTab === 'ports' &&
          filtered(portDiff).map((d, i) => (
            <div
              key={i}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded text-xs font-mono',
                d.status === 'added' && 'bg-[var(--grok-ok-green)]/5',
                d.status === 'removed' && 'bg-[var(--grok-crit-red)]/5 line-through opacity-60',
                d.status === 'changed' && 'bg-[var(--grok-loot-gold)]/5',
                d.status === 'unchanged' && 'opacity-40'
              )}
            >
              <StatusIcon status={d.status} />
              <span className="w-16 text-[var(--grok-text-heading)]">
                {d.value.port}/{d.value.protocol}
              </span>
              <span
                className={cn(
                  'px-1.5 py-0.5 rounded text-[10px] uppercase',
                  d.value.state === 'open' ? 'bg-[var(--grok-ok-green)]/20 text-[var(--grok-ok-green)]' : 'bg-[var(--grok-border)] text-[var(--grok-text-muted)]'
                )}
              >
                {d.value.state}
              </span>
              <span className="text-[var(--grok-text-body)] flex-1">{d.value.service || '—'}</span>
              <span className="text-[var(--grok-text-muted)]">{d.value.version || ''}</span>
            </div>
          ))}

        {activeTab === 'subdomains' &&
          filtered(subDiff).map((d, i) => (
            <div
              key={i}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded text-xs font-mono',
                d.status === 'added' && 'bg-[var(--grok-ok-green)]/5',
                d.status === 'removed' && 'bg-[var(--grok-crit-red)]/5 line-through opacity-60',
                d.status === 'unchanged' && 'opacity-40'
              )}
            >
              <StatusIcon status={d.status} />
              <Globe className="w-3.5 h-3.5 text-[var(--grok-text-muted)]" />
              <span className="text-[var(--grok-text-body)]">{d.value.sub}</span>
            </div>
          ))}

        {activeTab === 'vulns' &&
          filtered(vulnDiff).map((d, i) => {
            const sev = d.value.severity?.toLowerCase();
            const sevColor =
              sev === 'critical'
                ? 'var(--grok-crit-red)'
                : sev === 'high'
                  ? 'var(--grok-exploit-red)'
                  : sev === 'medium'
                    ? 'var(--grok-loot-gold)'
                    : 'var(--grok-recon-blue)';
            return (
              <div
                key={i}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded text-xs',
                  d.status === 'added' && 'bg-[var(--grok-ok-green)]/5',
                  d.status === 'removed' && 'bg-[var(--grok-crit-red)]/5 opacity-60',
                  d.status === 'unchanged' && 'opacity-40'
                )}
              >
                <StatusIcon status={d.status} />
                <span
                  className="px-1.5 py-0.5 rounded text-[10px] uppercase font-bold"
                  style={{ background: `${sevColor}20`, color: sevColor }}
                >
                  {d.value.severity}
                </span>
                <span className="text-[var(--grok-text-body)] flex-1 font-mono">{d.value.title}</span>
                {d.value.url && (
                  <span className="text-[var(--grok-text-muted)] truncate max-w-[200px]">{d.value.url}</span>
                )}
              </div>
            );
          })}

        {/* Empty state for filtered view */}
        {((activeTab === 'ports' && filtered(portDiff).length === 0) ||
          (activeTab === 'subdomains' && filtered(subDiff).length === 0) ||
          (activeTab === 'vulns' && filtered(vulnDiff).length === 0)) &&
          snapshots.length > 0 && (
            <div className="text-center py-12 text-[var(--grok-text-muted)] text-sm">
              No differences found.{' '}
              {!showUnchanged && (
                <button
                  onClick={() => setShowUnchanged(true)}
                  className="text-[var(--grok-recon-blue)] hover:underline"
                >
                  Show unchanged items
                </button>
              )}
            </div>
          )}
      </div>
    </div>
  );
}
