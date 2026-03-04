/**
 * Evidence Collector — DB-backed case folders with full raw tool output.
 *
 * Left sidebar shows per-target case folders. Selecting a target loads
 * the full evidence timeline from the API, with complete untruncated
 * raw output for every tool that ran against that target.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  FileCheck,
  Clock,
  MessageSquare,
  Download,
  Search,
  ChevronDown,
  ChevronRight,
  Terminal,
  Zap,
  Eye,
  Plus,
  Copy,
  Check,
  FolderOpen,
  Activity,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { cn } from '@utils/index';
import { useReconStore } from '@stores/reconStore';
import { useUIStore } from '@stores/uiStore';
import { apiService } from '@services/api';
import type { EvidenceRecord, EvidenceTarget } from '@/types';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const PHASE_COLORS: Record<string, string> = {
  port_scan: 'var(--grok-recon-blue)',
  subdomain: 'var(--grok-recon-blue)',
  web_scan: 'var(--grok-loot-gold)',
  vulnerability: 'var(--grok-exploit-red)',
  exploitation: 'var(--grok-exploit-red)',
  enumeration: 'var(--grok-recon-blue)',
  credential: 'var(--grok-ok-green)',
  brute_force: 'var(--grok-loot-gold)',
  unknown: 'var(--grok-text-muted)',
};

const TYPE_ICONS = {
  scan: Eye,
  exploit: Zap,
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function fmtTime(ts: number) {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function fmtRelative(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—';
  const s = ms / 1000;
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function phaseColor(phase: string): string {
  return PHASE_COLORS[phase] ?? PHASE_COLORS.unknown;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function EvidenceView() {
  const { addToast } = useUIStore();
  const reconOutputs = useReconStore((s) => s.reconOutputs);

  // Target list (sidebar)
  const [targets, setTargets] = useState<EvidenceTarget[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(true);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);

  // Evidence for selected target
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [targetInfo, setTargetInfo] = useState<{ hostname: string; url: string } | null>(null);

  // UI state
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filterTool, setFilterTool] = useState('all');
  const [filterType, setFilterType] = useState<'all' | 'scan' | 'exploit'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'success' | 'error'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showAddNote, setShowAddNote] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [localNotes, setLocalNotes] = useState<EvidenceRecord[]>([]);

  const outputRefs = useRef<Map<string, HTMLPreElement>>(new Map());

  // Load target list
  const loadTargets = useCallback(async () => {
    setTargetsLoading(true);
    try {
      const result = await apiService.getEvidenceTargets();
      setTargets(result);
    } catch (err: any) {
      console.error('Failed to load evidence targets:', err);
    } finally {
      setTargetsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTargets();
  }, [loadTargets]);

  // Load evidence when target selected
  useEffect(() => {
    if (!selectedTargetId) {
      setEvidence([]);
      setTargetInfo(null);
      return;
    }

    let cancelled = false;
    setEvidenceLoading(true);

    apiService.getEvidence(selectedTargetId).then((result) => {
      if (cancelled) return;
      setEvidence(result.evidence);
      setTargetInfo({ hostname: result.hostname, url: result.url });
      setEvidenceLoading(false);
    }).catch((err) => {
      if (cancelled) return;
      console.error('Failed to load evidence:', err);
      setEvidenceLoading(false);
    });

    return () => { cancelled = true; };
  }, [selectedTargetId]);

  // Merge live WebSocket outputs for the selected target
  useEffect(() => {
    if (!selectedTargetId) return;

    const liveItems: EvidenceRecord[] = [];
    for (const r of reconOutputs) {
      if (r.targetId === selectedTargetId && r.complete && r.rawOutput) {
        // Check if already in DB evidence (by matching tool + approximate time)
        const exists = evidence.some(
          (e) => e.tool === r.tool && Math.abs(e.createdAt - (r.timestamp || Date.now())) < 5000
        );
        if (!exists) {
          liveItems.push({
            id: `live-${r.tool}-${r.timestamp}`,
            tool: r.tool || 'unknown',
            type: 'scan',
            phase: 'unknown',
            rawOutput: r.rawOutput || r.output || '',
            exitCode: r.exitCode ?? null,
            duration: r.duration ?? null,
            status: r.exitCode === 0 ? 'success' : r.exitCode != null ? 'error' : 'unknown',
            createdAt: r.timestamp || Date.now(),
            scanId: r.scan_id || null,
          });
        }
      }
    }

    if (liveItems.length > 0) {
      setEvidence((prev) => {
        const merged = [...liveItems, ...prev];
        merged.sort((a, b) => b.createdAt - a.createdAt);
        return merged;
      });
    }
  }, [reconOutputs, selectedTargetId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Combine DB evidence + local notes
  const allEvidence = useMemo(() => {
    const combined = [...evidence, ...localNotes];
    combined.sort((a, b) => b.createdAt - a.createdAt);
    return combined;
  }, [evidence, localNotes]);

  // Unique tool names for filter dropdown
  const availableTools = useMemo(() => {
    const tools = new Set(allEvidence.map((e) => e.tool));
    return Array.from(tools).sort();
  }, [allEvidence]);

  // Filtered evidence
  const filtered = useMemo(() => {
    return allEvidence.filter((e) => {
      if (filterTool !== 'all' && e.tool !== filterTool) return false;
      if (filterType !== 'all' && e.type !== filterType) return false;
      if (filterStatus !== 'all') {
        if (filterStatus === 'success' && e.status !== 'success') return false;
        if (filterStatus === 'error' && e.status !== 'error' && e.status !== 'failed') return false;
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          e.tool.toLowerCase().includes(q) ||
          e.phase.toLowerCase().includes(q) ||
          e.rawOutput.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allEvidence, filterTool, filterType, filterStatus, searchQuery]);

  // Toggle expand
  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Copy evidence item
  const copyToClipboard = useCallback(async (item: EvidenceRecord) => {
    const text = [
      `## ${item.tool.toUpperCase()} — ${item.phase}`,
      `**Type:** ${item.type} | **Status:** ${item.status}`,
      `**Time:** ${fmtTime(item.createdAt)}`,
      `**Exit Code:** ${item.exitCode ?? 'N/A'} | **Duration:** ${fmtDuration(item.duration)}`,
      '',
      '```',
      item.rawOutput,
      '```',
    ].join('\n');
    await navigator.clipboard.writeText(text);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  // Export all evidence for target
  const exportEvidence = useCallback(() => {
    if (!targetInfo || filtered.length === 0) return;

    const sections = filtered.map((e) =>
      `${'='.repeat(72)}\n` +
      `TOOL: ${e.tool}  |  TYPE: ${e.type}  |  PHASE: ${e.phase}\n` +
      `STATUS: ${e.status}  |  EXIT: ${e.exitCode ?? 'N/A'}  |  DURATION: ${fmtDuration(e.duration)}\n` +
      `TIME: ${fmtTime(e.createdAt)}\n` +
      `${'='.repeat(72)}\n\n` +
      e.rawOutput +
      '\n\n'
    );

    const header =
      `CStrike v2 — Evidence Export\n` +
      `Target: ${targetInfo.url} (${targetInfo.hostname})\n` +
      `Generated: ${new Date().toISOString()}\n` +
      `Total Records: ${filtered.length}\n` +
      `${'='.repeat(72)}\n\n`;

    const blob = new Blob([header + sections.join('')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `evidence-${targetInfo.hostname || 'target'}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    addToast({ type: 'success', message: `Exported ${filtered.length} evidence records`, duration: 3000 });
  }, [filtered, targetInfo, addToast]);

  // Add note
  const addNote = useCallback(() => {
    if (!noteTitle.trim() || !selectedTargetId) return;
    const note: EvidenceRecord = {
      id: `note-${Date.now()}`,
      tool: 'operator',
      type: 'scan',
      phase: 'note',
      rawOutput: noteBody,
      exitCode: null,
      duration: null,
      status: 'note',
      createdAt: Date.now(),
      scanId: null,
    };
    setLocalNotes((prev) => [note, ...prev]);
    setNoteTitle('');
    setNoteBody('');
    setShowAddNote(false);
    addToast({ type: 'success', message: 'Note added', duration: 2000 });
  }, [noteTitle, noteBody, selectedTargetId, addToast]);

  return (
    <div className="h-full flex flex-col overflow-hidden p-5 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold text-[var(--grok-text-heading)] flex items-center gap-2">
            <FileCheck className="w-5 h-5 text-[var(--grok-loot-green)]" />
            Evidence Collector
          </h1>
          <p className="text-[10px] text-[var(--grok-text-muted)] mt-0.5 font-mono">
            {targets.length} target{targets.length !== 1 ? 's' : ''} with evidence
            {selectedTargetId && ` | ${filtered.length} records loaded`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadTargets}
            className="cs-btn flex items-center gap-1.5"
            title="Refresh targets"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {selectedTargetId && (
            <>
              <button
                onClick={() => setShowAddNote(true)}
                className="cs-btn cs-btn-primary flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Note
              </button>
              <button
                onClick={exportEvidence}
                className="cs-btn flex items-center gap-1.5"
                disabled={filtered.length === 0}
              >
                <Download className="w-3.5 h-3.5" /> Export
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main layout: sidebar + content */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Target Sidebar */}
        <div className="w-64 flex-shrink-0 flex flex-col overflow-hidden bg-[var(--grok-surface-1)] border border-[var(--grok-border)] rounded-lg">
          <div className="px-3 py-2 border-b border-[var(--grok-border)] flex items-center gap-2">
            <FolderOpen className="w-3.5 h-3.5 text-[var(--grok-text-muted)]" />
            <span className="text-xs font-bold text-[var(--grok-text-heading)]">Case Folders</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {targetsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-[var(--grok-text-muted)]" />
              </div>
            ) : targets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                <FolderOpen className="w-8 h-8 text-[var(--grok-text-muted)] opacity-40 mb-2" />
                <p className="text-xs text-[var(--grok-text-muted)]">No evidence yet</p>
                <p className="text-[10px] text-[var(--grok-text-muted)] mt-1">Run a scan to start collecting</p>
              </div>
            ) : (
              targets.map((t) => (
                <button
                  key={t.targetId}
                  onClick={() => setSelectedTargetId(
                    t.targetId === selectedTargetId ? null : t.targetId
                  )}
                  className={cn(
                    'w-full text-left px-3 py-2.5 border-b border-[var(--grok-border)]/30 transition-colors',
                    t.targetId === selectedTargetId
                      ? 'bg-[var(--grok-recon-blue)]/10 border-l-2 border-l-[var(--grok-recon-blue)]'
                      : 'hover:bg-[var(--grok-surface-2)]'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Terminal className="w-3 h-3 text-[var(--grok-text-muted)] flex-shrink-0" />
                    <span className="text-xs font-medium text-[var(--grok-text-body)] truncate">
                      {t.hostname || t.url}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 pl-5">
                    <span className="text-[10px] text-[var(--grok-text-muted)]">
                      {t.scanResultCount + t.exploitTaskCount} records
                    </span>
                    <span className="text-[10px] text-[var(--grok-text-muted)]">
                      {fmtRelative(t.lastActivity)}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedTargetId ? (
            /* No target selected */
            <div className="flex-1 flex flex-col items-center justify-center text-[var(--grok-text-muted)]">
              <FolderOpen className="w-12 h-12 mb-3 opacity-40" />
              <p className="text-sm">Select a target from the sidebar</p>
              <p className="text-xs mt-1">to view its evidence case folder</p>
            </div>
          ) : (
            <>
              {/* Target header + filters */}
              <div className="flex-shrink-0 space-y-3 mb-3">
                {targetInfo && (
                  <div className="flex items-center gap-3">
                    <Activity className="w-4 h-4 text-[var(--grok-recon-blue)]" />
                    <div>
                      <span className="text-sm font-bold text-[var(--grok-text-heading)] font-mono">
                        {targetInfo.hostname || targetInfo.url}
                      </span>
                      {targetInfo.hostname && (
                        <span className="text-[10px] text-[var(--grok-text-muted)] ml-2">{targetInfo.url}</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Filters */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex-1 relative min-w-[200px]">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--grok-text-muted)]" />
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search raw output..."
                      className="w-full bg-[var(--grok-surface-1)] border border-[var(--grok-border)] rounded px-9 py-1.5 text-xs text-[var(--grok-text-body)] placeholder:text-[var(--grok-text-muted)]"
                    />
                  </div>
                  <div className="relative">
                    <select
                      value={filterTool}
                      onChange={(e) => setFilterTool(e.target.value)}
                      className="bg-[var(--grok-surface-1)] border border-[var(--grok-border)] rounded px-3 py-1.5 text-xs text-[var(--grok-text-body)] appearance-none pr-7"
                    >
                      <option value="all">All Tools</option>
                      {availableTools.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-[var(--grok-text-muted)] pointer-events-none" />
                  </div>
                  <div className="relative">
                    <select
                      value={filterType}
                      onChange={(e) => setFilterType(e.target.value as any)}
                      className="bg-[var(--grok-surface-1)] border border-[var(--grok-border)] rounded px-3 py-1.5 text-xs text-[var(--grok-text-body)] appearance-none pr-7"
                    >
                      <option value="all">All Types</option>
                      <option value="scan">Scan</option>
                      <option value="exploit">Exploit</option>
                    </select>
                    <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-[var(--grok-text-muted)] pointer-events-none" />
                  </div>
                  <div className="relative">
                    <select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value as any)}
                      className="bg-[var(--grok-surface-1)] border border-[var(--grok-border)] rounded px-3 py-1.5 text-xs text-[var(--grok-text-body)] appearance-none pr-7"
                    >
                      <option value="all">All Status</option>
                      <option value="success">Success</option>
                      <option value="error">Error</option>
                    </select>
                    <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-[var(--grok-text-muted)] pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Add Note Inline */}
              {showAddNote && (
                <div className="flex-shrink-0 p-3 rounded-lg bg-[var(--grok-surface-1)] border border-[var(--grok-recon-blue)] mb-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[var(--grok-text-heading)]">Add Note</span>
                    <button
                      onClick={() => setShowAddNote(false)}
                      className="text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] text-sm"
                    >
                      &times;
                    </button>
                  </div>
                  <input
                    value={noteTitle}
                    onChange={(e) => setNoteTitle(e.target.value)}
                    placeholder="Title"
                    className="w-full bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded px-3 py-1.5 text-xs text-[var(--grok-text-body)]"
                  />
                  <textarea
                    value={noteBody}
                    onChange={(e) => setNoteBody(e.target.value)}
                    placeholder="Observation / notes..."
                    rows={3}
                    className="w-full bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded px-3 py-1.5 text-xs text-[var(--grok-text-body)] resize-none font-mono"
                  />
                  <button
                    onClick={addNote}
                    className="px-4 py-1.5 text-xs rounded bg-[var(--grok-recon-blue)] text-white hover:brightness-110"
                  >
                    Save Note
                  </button>
                </div>
              )}

              {/* Evidence Timeline */}
              <div className="flex-1 overflow-y-auto space-y-1">
                {evidenceLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-6 h-6 animate-spin text-[var(--grok-text-muted)]" />
                    <span className="ml-2 text-sm text-[var(--grok-text-muted)]">Loading evidence...</span>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-[var(--grok-text-muted)]">
                    <FileCheck className="w-10 h-10 mb-3 opacity-40" />
                    <p className="text-sm">No evidence records found</p>
                    {(filterTool !== 'all' || filterType !== 'all' || filterStatus !== 'all' || searchQuery) && (
                      <p className="text-xs mt-1">Try adjusting your filters</p>
                    )}
                  </div>
                ) : (
                  filtered.map((item) => {
                    const isExpanded = expandedIds.has(item.id);
                    const Icon = TYPE_ICONS[item.type] || Eye;
                    const color = phaseColor(item.phase);
                    const isNote = item.status === 'note';

                    return (
                      <div
                        key={item.id}
                        className="rounded border border-[var(--grok-border)]/50 bg-[var(--grok-surface-1)] overflow-hidden"
                      >
                        {/* Item header — clickable to expand */}
                        <div
                          onClick={() => toggleExpand(item.id)}
                          className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-[var(--grok-surface-2)] transition-colors"
                        >
                          <ChevronRight
                            className={cn(
                              'w-3.5 h-3.5 text-[var(--grok-text-muted)] flex-shrink-0 transition-transform',
                              isExpanded && 'rotate-90'
                            )}
                          />
                          <div
                            className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
                            style={{ background: `${color}15` }}
                          >
                            {isNote ? (
                              <MessageSquare className="w-3.5 h-3.5" style={{ color }} />
                            ) : (
                              <Icon className="w-3.5 h-3.5" style={{ color }} />
                            )}
                          </div>
                          <div className="flex-1 min-w-0 flex items-center gap-2">
                            <span className="text-xs font-bold text-[var(--grok-text-body)] font-mono uppercase">
                              {item.tool}
                            </span>
                            <span
                              className="text-[9px] px-1.5 py-0.5 rounded uppercase font-medium"
                              style={{
                                background: `${color}15`,
                                color,
                              }}
                            >
                              {item.phase.replace(/_/g, ' ')}
                            </span>
                            <span
                              className={cn(
                                'text-[9px] px-1.5 py-0.5 rounded',
                                item.status === 'success' || item.status === 'completed'
                                  ? 'bg-[var(--grok-ok-green)]/10 text-[var(--grok-ok-green)]'
                                  : item.status === 'error' || item.status === 'failed'
                                    ? 'bg-[var(--grok-crit-red)]/10 text-[var(--grok-crit-red)]'
                                    : 'bg-[var(--grok-text-muted)]/10 text-[var(--grok-text-muted)]'
                              )}
                            >
                              {item.status}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0 text-[10px] text-[var(--grok-text-muted)]">
                            {item.duration != null && (
                              <span className="font-mono">{fmtDuration(item.duration)}</span>
                            )}
                            {item.exitCode != null && (
                              <span className={cn(
                                'font-mono',
                                item.exitCode !== 0 && 'text-[var(--grok-crit-red)]'
                              )}>
                                exit:{item.exitCode}
                              </span>
                            )}
                            <span>
                              <Clock className="w-2.5 h-2.5 inline mr-0.5" />
                              {fmtRelative(item.createdAt)}
                            </span>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(item);
                            }}
                            className="p-1 rounded text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] flex-shrink-0"
                            title="Copy to clipboard"
                          >
                            {copiedId === item.id ? (
                              <Check className="w-3.5 h-3.5 text-[var(--grok-ok-green)]" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>

                        {/* Expanded raw output */}
                        {isExpanded && (
                          <div className="border-t border-[var(--grok-border)]/50">
                            <div className="flex items-center justify-between px-3 py-1 bg-[var(--grok-void)]">
                              <span className="text-[10px] uppercase tracking-wider text-[var(--grok-text-muted)]">
                                Raw Output — {item.rawOutput.length.toLocaleString()} chars
                              </span>
                              <span className="text-[10px] text-[var(--grok-text-muted)] font-mono">
                                {fmtTime(item.createdAt)}
                              </span>
                            </div>
                            <pre
                              ref={(el) => {
                                if (el) outputRefs.current.set(item.id, el);
                              }}
                              className="px-3 py-2 text-[11px] font-mono text-[var(--grok-text-body)] bg-[var(--grok-void)] overflow-x-auto overflow-y-auto max-h-[500px] whitespace-pre select-text"
                            >
                              {item.rawOutput || '(no output)'}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
