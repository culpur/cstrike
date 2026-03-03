/**
 * Evidence Collector — Engagement timeline and evidence management
 *
 * Provides a timeline of all actions taken during an engagement,
 * with the ability to tag, annotate, and export evidence for reports.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileCheck,
  Clock,
  Tag,
  MessageSquare,
  Download,
  Search,
  ChevronDown,
  ChevronRight,
  Shield,
  Terminal,
  Zap,
  Eye,
  Trash2,
  Plus,
  Copy,
  Check,
} from 'lucide-react';
import { cn } from '@utils/index';
import { useReconStore } from '@stores/reconStore';
import { useLootStore } from '@stores/lootStore';
import { useUIStore } from '@stores/uiStore';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
type EvidenceType = 'recon' | 'vulnerability' | 'exploitation' | 'credential' | 'note' | 'screenshot';
type EvidencePhase = 'reconnaissance' | 'scanning' | 'exploitation' | 'post-exploitation' | 'reporting';

interface EvidenceItem {
  id: string;
  timestamp: number;
  type: EvidenceType;
  phase: EvidencePhase;
  title: string;
  description: string;
  target?: string;
  tool?: string;
  tags: string[];
  annotations: string[];
  rawOutput?: string;
  severity?: string;
  starred: boolean;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const TYPE_CONFIG: Record<EvidenceType, { icon: typeof Shield; color: string; label: string }> = {
  recon: { icon: Eye, color: 'var(--grok-recon-blue)', label: 'Recon' },
  vulnerability: { icon: Shield, color: 'var(--grok-loot-gold)', label: 'Vulnerability' },
  exploitation: { icon: Zap, color: 'var(--grok-exploit-red)', label: 'Exploitation' },
  credential: { icon: Terminal, color: 'var(--grok-ok-green)', label: 'Credential' },
  note: { icon: MessageSquare, color: 'var(--grok-text-muted)', label: 'Note' },
  screenshot: { icon: Eye, color: 'var(--grok-recon-blue)', label: 'Screenshot' },
};

const PHASE_ORDER: EvidencePhase[] = [
  'reconnaissance',
  'scanning',
  'exploitation',
  'post-exploitation',
  'reporting',
];

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

let nextId = 1;
function genId() {
  return `ev-${Date.now()}-${nextId++}`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function EvidenceView() {
  const { addToast } = useUIStore();
  const reconOutputs = useReconStore((s) => s.reconOutputs);
  const lootItems = useLootStore((s) => s.items);

  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<EvidenceType | 'all'>('all');
  const [filterPhase, setFilterPhase] = useState<EvidencePhase | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'timeline' | 'table'>('timeline');
  const [showAddNote, setShowAddNote] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [noteTags, setNoteTags] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Build evidence from store data on mount
  useEffect(() => {
    const items: EvidenceItem[] = [];

    // From recon outputs
    reconOutputs.forEach((r: any) => {
      if (r.complete || r.event === 'tool_complete') {
        items.push({
          id: genId(),
          timestamp: r.timestamp,
          type: 'recon',
          phase: 'reconnaissance',
          title: `${r.tool.toUpperCase()} scan completed`,
          description: r.output?.slice(0, 200) || 'Scan completed',
          target: r.target,
          tool: r.tool,
          tags: [r.tool],
          annotations: [],
          rawOutput: r.output,
          starred: false,
        });
      }
    });

    // From loot items
    lootItems.forEach((l) => {
      const type: EvidenceType =
        l.category === 'credential' || l.category === 'password' || l.category === 'hash'
          ? 'credential'
          : 'recon';
      items.push({
        id: genId(),
        timestamp: l.timestamp,
        type,
        phase: type === 'credential' ? 'exploitation' : 'scanning',
        title: `${l.category} discovered: ${l.value.slice(0, 40)}`,
        description: `Found via ${l.source} on ${l.target}`,
        target: l.target,
        tool: l.source,
        tags: [l.category, l.source],
        annotations: [],
        severity: type === 'credential' ? 'high' : 'info',
        starred: type === 'credential',
      });
    });

    // Sort by timestamp
    items.sort((a, b) => a.timestamp - b.timestamp);
    setEvidence(items);
  }, [reconOutputs, lootItems]);

  // Filtered evidence
  const filtered = useMemo(() => {
    return evidence.filter((e) => {
      if (filterType !== 'all' && e.type !== filterType) return false;
      if (filterPhase !== 'all' && e.phase !== filterPhase) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          e.title.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q)) ||
          (e.target && e.target.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [evidence, filterType, filterPhase, searchQuery]);

  const selected = useMemo(
    () => evidence.find((e) => e.id === selectedId),
    [evidence, selectedId]
  );

  // Group by phase for timeline view
  const grouped = useMemo(() => {
    const groups: Record<string, EvidenceItem[]> = {};
    for (const phase of PHASE_ORDER) {
      const items = filtered.filter((e) => e.phase === phase);
      if (items.length > 0) groups[phase] = items;
    }
    return groups;
  }, [filtered]);

  const addNote = useCallback(() => {
    if (!noteTitle.trim()) return;
    const item: EvidenceItem = {
      id: genId(),
      timestamp: Date.now(),
      type: 'note',
      phase: 'reporting',
      title: noteTitle,
      description: noteBody,
      tags: noteTags.split(',').map((t) => t.trim()).filter(Boolean),
      annotations: [],
      starred: false,
    };
    setEvidence((prev) => [...prev, item].sort((a, b) => a.timestamp - b.timestamp));
    setNoteTitle('');
    setNoteBody('');
    setNoteTags('');
    setShowAddNote(false);
    addToast({ type: 'success', message: 'Note added', duration: 2000 });
  }, [noteTitle, noteBody, noteTags, addToast]);

  const toggleStar = useCallback((id: string) => {
    setEvidence((prev) =>
      prev.map((e) => (e.id === id ? { ...e, starred: !e.starred } : e))
    );
  }, []);

  const addAnnotation = useCallback((id: string, text: string) => {
    setEvidence((prev) =>
      prev.map((e) =>
        e.id === id ? { ...e, annotations: [...e.annotations, text] } : e
      )
    );
  }, []);

  const deleteEvidence = useCallback((id: string) => {
    setEvidence((prev) => prev.filter((e) => e.id !== id));
    if (selectedId === id) setSelectedId(null);
  }, [selectedId]);

  const copyToClipboard = useCallback(
    async (id: string) => {
      const item = evidence.find((e) => e.id === id);
      if (!item) return;
      const text = [
        `## ${item.title}`,
        `**Type:** ${item.type} | **Phase:** ${item.phase}`,
        `**Time:** ${fmtTime(item.timestamp)}`,
        item.target ? `**Target:** ${item.target}` : '',
        item.tool ? `**Tool:** ${item.tool}` : '',
        `**Tags:** ${item.tags.join(', ')}`,
        '',
        item.description,
        item.rawOutput ? `\n\`\`\`\n${item.rawOutput.slice(0, 500)}\n\`\`\`` : '',
      ]
        .filter(Boolean)
        .join('\n');
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    },
    [evidence]
  );

  const exportEvidence = useCallback(() => {
    const md = filtered
      .map(
        (e) =>
          `### ${fmtTime(e.timestamp)} — ${e.title}\n` +
          `**Type:** ${e.type} | **Phase:** ${e.phase}\n` +
          (e.target ? `**Target:** ${e.target}\n` : '') +
          (e.tool ? `**Tool:** ${e.tool}\n` : '') +
          `**Tags:** ${e.tags.join(', ')}\n\n` +
          e.description +
          (e.annotations.length
            ? `\n\n**Annotations:**\n${e.annotations.map((a) => `- ${a}`).join('\n')}`
            : '') +
          '\n\n---\n'
      )
      .join('\n');

    const blob = new Blob(
      [`# CStrike v2 — Evidence Report\n\nGenerated: ${new Date().toISOString()}\n\n---\n\n${md}`],
      { type: 'text/markdown' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `evidence-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    addToast({ type: 'success', message: 'Evidence exported', duration: 3000 });
  }, [filtered, addToast]);

  return (
    <div className="h-full flex flex-col overflow-hidden p-5 gap-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold text-[var(--grok-text-heading)] flex items-center gap-2">
            <FileCheck className="w-5 h-5 text-[var(--grok-loot-green)]" />
            Evidence Collector
          </h1>
          <p className="text-[10px] text-[var(--grok-text-muted)] mt-0.5 font-mono">
            {evidence.length} items collected
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddNote(true)}
            className="cs-btn cs-btn-primary flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Add Note
          </button>
          <button
            onClick={exportEvidence}
            className="cs-btn flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="flex-1 relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--grok-text-muted)]" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search evidence..."
            className="w-full bg-[var(--grok-surface-1)] border border-[var(--grok-border)] rounded px-9 py-2 text-xs text-[var(--grok-text-body)] placeholder:text-[var(--grok-text-muted)]"
          />
        </div>
        <div className="relative">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="bg-[var(--grok-surface-1)] border border-[var(--grok-border)] rounded px-3 py-2 text-xs text-[var(--grok-text-body)] appearance-none pr-7"
          >
            <option value="all">All Types</option>
            {Object.entries(TYPE_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-[var(--grok-text-muted)] pointer-events-none" />
        </div>
        <div className="relative">
          <select
            value={filterPhase}
            onChange={(e) => setFilterPhase(e.target.value as any)}
            className="bg-[var(--grok-surface-1)] border border-[var(--grok-border)] rounded px-3 py-2 text-xs text-[var(--grok-text-body)] appearance-none pr-7"
          >
            <option value="all">All Phases</option>
            {PHASE_ORDER.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-[var(--grok-text-muted)] pointer-events-none" />
        </div>
        <div className="flex rounded border border-[var(--grok-border)] overflow-hidden">
          {(['timeline', 'table'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={cn(
                'px-3 py-1.5 text-xs',
                viewMode === m
                  ? 'bg-[var(--grok-recon-blue)] text-white'
                  : 'bg-[var(--grok-surface-1)] text-[var(--grok-text-muted)]'
              )}
            >
              {m === 'timeline' ? 'Timeline' : 'Table'}
            </button>
          ))}
        </div>
      </div>

      {/* Add Note Modal */}
      {showAddNote && (
        <div className="p-4 rounded-lg bg-[var(--grok-surface-1)] border border-[var(--grok-recon-blue)] flex-shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-[var(--grok-text-heading)]">Add Note</span>
            <button
              onClick={() => setShowAddNote(false)}
              className="text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)]"
            >
              &times;
            </button>
          </div>
          <input
            value={noteTitle}
            onChange={(e) => setNoteTitle(e.target.value)}
            placeholder="Title"
            className="w-full bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded px-3 py-2 text-xs text-[var(--grok-text-body)]"
          />
          <textarea
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            placeholder="Description / observation..."
            rows={3}
            className="w-full bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded px-3 py-2 text-xs text-[var(--grok-text-body)] resize-none"
          />
          <input
            value={noteTags}
            onChange={(e) => setNoteTags(e.target.value)}
            placeholder="Tags (comma-separated)"
            className="w-full bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded px-3 py-2 text-xs text-[var(--grok-text-body)]"
          />
          <button
            onClick={addNote}
            className="px-4 py-2 text-xs rounded bg-[var(--grok-recon-blue)] text-white hover:brightness-110"
          >
            Save Note
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Timeline / Table */}
        <div className={cn('flex-1 overflow-y-auto', selected ? 'w-1/2' : 'w-full')}>
          {viewMode === 'timeline' ? (
            <div className="space-y-6">
              {Object.entries(grouped).map(([phase, items]) => (
                <div key={phase}>
                  <div className="flex items-center gap-2 mb-2 sticky top-0 bg-[var(--grok-void)] py-1 z-10">
                    <div className="w-2 h-2 rounded-full bg-[var(--grok-recon-blue)]" />
                    <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--grok-text-muted)]">
                      {phase}
                    </span>
                    <span className="text-[10px] text-[var(--grok-text-muted)]">({items.length})</span>
                    <div className="flex-1 h-px bg-[var(--grok-border)]" />
                  </div>
                  <div className="space-y-1 pl-4 border-l border-[var(--grok-border)] ml-1">
                    {items.map((item) => {
                      const cfg = TYPE_CONFIG[item.type];
                      const Icon = cfg.icon;
                      return (
                        <div
                          key={item.id}
                          onClick={() => setSelectedId(item.id === selectedId ? null : item.id)}
                          className={cn(
                            'flex items-start gap-3 px-3 py-2 rounded cursor-pointer transition-colors',
                            selectedId === item.id
                              ? 'bg-[var(--grok-surface-2)] border border-[var(--grok-recon-blue)]/30'
                              : 'hover:bg-[var(--grok-surface-1)]'
                          )}
                        >
                          <div
                            className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
                            style={{ background: `${cfg.color}15` }}
                          >
                            <Icon className="w-3.5 h-3.5" style={{ color: cfg.color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-[var(--grok-text-body)] truncate">
                                {item.title}
                              </span>
                              {item.starred && (
                                <span className="text-[var(--grok-loot-gold)] text-[10px]">★</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-[var(--grok-text-muted)]">
                                <Clock className="w-2.5 h-2.5 inline mr-0.5" />
                                {fmtRelative(item.timestamp)}
                              </span>
                              {item.tags.slice(0, 3).map((t) => (
                                <span
                                  key={t}
                                  className="text-[9px] px-1 rounded bg-[var(--grok-surface-2)] text-[var(--grok-text-muted)]"
                                >
                                  {t}
                                </span>
                              ))}
                            </div>
                          </div>
                          <ChevronRight
                            className={cn(
                              'w-3.5 h-3.5 text-[var(--grok-text-muted)] flex-shrink-0 transition-transform',
                              selectedId === item.id && 'rotate-90'
                            )}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {Object.keys(grouped).length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-[var(--grok-text-muted)]">
                  <FileCheck className="w-10 h-10 mb-3 opacity-40" />
                  <p className="text-sm">No evidence collected yet.</p>
                  <p className="text-xs mt-1">Run a scan to auto-populate evidence items.</p>
                </div>
              )}
            </div>
          ) : (
            /* Table view */
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--grok-border)] text-[var(--grok-text-muted)]">
                  <th className="text-left py-2 px-2">Time</th>
                  <th className="text-left py-2 px-2">Type</th>
                  <th className="text-left py-2 px-2">Phase</th>
                  <th className="text-left py-2 px-2">Title</th>
                  <th className="text-left py-2 px-2">Target</th>
                  <th className="text-left py-2 px-2">Tags</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => setSelectedId(item.id === selectedId ? null : item.id)}
                    className={cn(
                      'border-b border-[var(--grok-border)]/30 cursor-pointer',
                      selectedId === item.id
                        ? 'bg-[var(--grok-surface-2)]'
                        : 'hover:bg-[var(--grok-surface-1)]'
                    )}
                  >
                    <td className="py-2 px-2 text-[var(--grok-text-muted)] font-mono whitespace-nowrap">
                      {fmtTime(item.timestamp)}
                    </td>
                    <td className="py-2 px-2">
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] uppercase"
                        style={{
                          background: `${TYPE_CONFIG[item.type].color}15`,
                          color: TYPE_CONFIG[item.type].color,
                        }}
                      >
                        {item.type}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-[var(--grok-text-muted)]">{item.phase}</td>
                    <td className="py-2 px-2 text-[var(--grok-text-body)] truncate max-w-[250px]">
                      {item.title}
                    </td>
                    <td className="py-2 px-2 text-[var(--grok-text-muted)] font-mono">{item.target || '—'}</td>
                    <td className="py-2 px-2">
                      <div className="flex gap-1">
                        {item.tags.slice(0, 2).map((t) => (
                          <span
                            key={t}
                            className="text-[9px] px-1 rounded bg-[var(--grok-surface-2)] text-[var(--grok-text-muted)]"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail Panel */}
        {selected && (
          <div className="w-96 flex-shrink-0 overflow-y-auto bg-[var(--grok-surface-1)] border border-[var(--grok-border)] rounded-lg p-4 space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                {(() => {
                  const cfg = TYPE_CONFIG[selected.type];
                  const Icon = cfg.icon;
                  return (
                    <div
                      className="w-8 h-8 rounded flex items-center justify-center"
                      style={{ background: `${cfg.color}15` }}
                    >
                      <Icon className="w-4 h-4" style={{ color: cfg.color }} />
                    </div>
                  );
                })()}
                <div>
                  <h3 className="text-sm font-bold text-[var(--grok-text-heading)]">{selected.title}</h3>
                  <span className="text-[10px] text-[var(--grok-text-muted)]">{fmtTime(selected.timestamp)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => toggleStar(selected.id)}
                  className={cn(
                    'p-1 rounded transition-colors',
                    selected.starred
                      ? 'text-[var(--grok-loot-gold)]'
                      : 'text-[var(--grok-text-muted)] hover:text-[var(--grok-loot-gold)]'
                  )}
                  title={selected.starred ? 'Unstar' : 'Star'}
                >
                  ★
                </button>
                <button
                  onClick={() => copyToClipboard(selected.id)}
                  className="p-1 rounded text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)]"
                  title="Copy"
                >
                  {copiedId === selected.id ? (
                    <Check className="w-3.5 h-3.5 text-[var(--grok-ok-green)]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  onClick={() => deleteEvidence(selected.id)}
                  className="p-1 rounded text-[var(--grok-text-muted)] hover:text-[var(--grok-crit-red)]"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-[var(--grok-text-muted)]">Type</span>
                <p className="text-[var(--grok-text-body)]">{TYPE_CONFIG[selected.type].label}</p>
              </div>
              <div>
                <span className="text-[var(--grok-text-muted)]">Phase</span>
                <p className="text-[var(--grok-text-body)]">{selected.phase}</p>
              </div>
              {selected.target && (
                <div>
                  <span className="text-[var(--grok-text-muted)]">Target</span>
                  <p className="text-[var(--grok-text-body)] font-mono">{selected.target}</p>
                </div>
              )}
              {selected.tool && (
                <div>
                  <span className="text-[var(--grok-text-muted)]">Tool</span>
                  <p className="text-[var(--grok-text-body)] font-mono">{selected.tool}</p>
                </div>
              )}
            </div>

            {/* Description */}
            <div>
              <span className="text-[10px] uppercase tracking-wider text-[var(--grok-text-muted)]">
                Description
              </span>
              <p className="text-xs text-[var(--grok-text-body)] mt-1 whitespace-pre-wrap">
                {selected.description}
              </p>
            </div>

            {/* Tags */}
            <div>
              <span className="text-[10px] uppercase tracking-wider text-[var(--grok-text-muted)]">Tags</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {selected.tags.map((t) => (
                  <span
                    key={t}
                    className="px-2 py-0.5 rounded-full text-[10px] bg-[var(--grok-surface-2)] text-[var(--grok-text-body)] border border-[var(--grok-border)]"
                  >
                    <Tag className="w-2.5 h-2.5 inline mr-0.5" />
                    {t}
                  </span>
                ))}
              </div>
            </div>

            {/* Raw Output */}
            {selected.rawOutput && (
              <div>
                <span className="text-[10px] uppercase tracking-wider text-[var(--grok-text-muted)]">
                  Raw Output
                </span>
                <pre className="mt-1 p-2 rounded bg-[var(--grok-void)] border border-[var(--grok-border)] text-[10px] text-[var(--grok-text-body)] overflow-x-auto max-h-40 font-mono">
                  {selected.rawOutput.slice(0, 1000)}
                </pre>
              </div>
            )}

            {/* Annotations */}
            <div>
              <span className="text-[10px] uppercase tracking-wider text-[var(--grok-text-muted)]">
                Annotations ({selected.annotations.length})
              </span>
              <div className="space-y-1 mt-1">
                {selected.annotations.map((a, i) => (
                  <div
                    key={i}
                    className="text-xs text-[var(--grok-text-body)] p-2 rounded bg-[var(--grok-surface-2)] border-l-2 border-[var(--grok-recon-blue)]"
                  >
                    {a}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-1">
                <input
                  placeholder="Add annotation..."
                  className="flex-1 bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded px-2 py-1 text-xs text-[var(--grok-text-body)]"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const input = e.currentTarget;
                      if (input.value.trim()) {
                        addAnnotation(selected.id, input.value.trim());
                        input.value = '';
                      }
                    }
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
