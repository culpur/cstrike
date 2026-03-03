/**
 * CampaignsView — Scan Scheduling, Campaigns, and Target Grouping
 *
 * Tab 1: Campaigns — create/manage scan campaigns with scheduling
 * Tab 2: Target Groups — named groups of targets with color tags
 * Tab 3: Schedule Calendar — monthly calendar of scheduled scans
 */

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import {
  Calendar,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Clock,
  Target,
  Layers,
  X,
  Tag,
  CheckSquare,
  Square,
  Zap,
  Archive,
  Circle,
  AlertCircle,
} from 'lucide-react';
import { useUIStore } from '@stores/uiStore';
import { apiService } from '@services/api';
import { cn, generateId, formatDateTime } from '@utils/index';

// ── Types ─────────────────────────────────────────────────────────────────────

type CampaignStatus = 'planned' | 'active' | 'running' | 'completed';
type ScanProfile = 'quick' | 'standard' | 'deep' | 'stealth' | 'custom';
type ScheduleType = 'once' | 'daily' | 'weekly' | 'monthly';

interface RunRecord {
  id: string;
  startedAt: number;
  completedAt: number | null;
  findings: number;
  criticals: number;
  highs: number;
}

interface Campaign {
  id: string;
  name: string;
  description: string;
  targetIds: string[];
  groupIds: string[];
  scanProfile: ScanProfile;
  scheduleType: ScheduleType;
  scheduleTime: string;       // HH:MM
  scheduleDow: number;        // 0-6 for weekly (0=Sun)
  scheduleDom: number;        // 1-31 for monthly
  nextRun: number | null;     // epoch ms
  status: CampaignStatus;
  color: string;
  createdAt: number;
  runs: RunRecord[];
}

interface TargetGroup {
  id: string;
  name: string;
  description: string;
  color: string;
  tags: string[];
  targetIds: string[];
  createdAt: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SCAN_PROFILES: Array<{ id: ScanProfile; label: string; desc: string }> = [
  { id: 'quick',    label: 'Quick',    desc: 'Fast surface scan, top 100 ports' },
  { id: 'standard', label: 'Standard', desc: 'Full port scan + service fingerprint' },
  { id: 'deep',     label: 'Deep',     desc: 'Exhaustive vuln + exploitation pass' },
  { id: 'stealth',  label: 'Stealth',  desc: 'Low-and-slow, evades basic IDS' },
  { id: 'custom',   label: 'Custom',   desc: 'Use active configuration settings' },
];

const SCHEDULE_TYPES: Array<{ id: ScheduleType; label: string }> = [
  { id: 'once',    label: 'One-time' },
  { id: 'daily',   label: 'Daily' },
  { id: 'weekly',  label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
];

const GROUP_COLORS = [
  '#2266ff', '#ff2040', '#00cc66', '#8844ff',
  '#00ccdd', '#ffaa00', '#ff6600', '#cc44aa',
];

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeNextRun(
  scheduleType: ScheduleType,
  scheduleTime: string,
  scheduleDow: number,
  scheduleDom: number,
): number | null {
  if (scheduleType === 'once') return null;

  const [h, m] = scheduleTime.split(':').map(Number);
  const now = new Date();
  const base = new Date(now);
  base.setSeconds(0, 0);
  base.setHours(h, m);

  if (scheduleType === 'daily') {
    if (base <= now) base.setDate(base.getDate() + 1);
    return base.getTime();
  }
  if (scheduleType === 'weekly') {
    const diff = (scheduleDow - base.getDay() + 7) % 7 || 7;
    base.setDate(base.getDate() + diff);
    return base.getTime();
  }
  if (scheduleType === 'monthly') {
    base.setDate(scheduleDom);
    if (base <= now) base.setMonth(base.getMonth() + 1);
    return base.getTime();
  }
  return null;
}

function statusColor(status: CampaignStatus): string {
  switch (status) {
    case 'planned':   return 'var(--grok-text-muted)';
    case 'active':    return 'var(--grok-recon-blue)';
    case 'running':   return 'var(--grok-success)';
    case 'completed': return 'var(--grok-loot-green)';
  }
}

function profileColor(profile: ScanProfile): string {
  switch (profile) {
    case 'quick':    return 'var(--grok-scan-cyan)';
    case 'standard': return 'var(--grok-recon-blue)';
    case 'deep':     return 'var(--grok-exploit-red)';
    case 'stealth':  return 'var(--grok-ai-purple)';
    case 'custom':   return 'var(--grok-warning)';
  }
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

const StatusBadge = memo(({ status }: { status: CampaignStatus }) => {
  const label = status.toUpperCase();
  const color = statusColor(status);
  const isRunning = status === 'running';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-semibold border',
        isRunning && 'animate-pulse',
      )}
      style={{ color, borderColor: color, background: `${color}1a` }}
    >
      {isRunning ? (
        <Circle className="w-2 h-2 fill-current" />
      ) : (
        <Circle className="w-2 h-2" />
      )}
      {label}
    </span>
  );
});
StatusBadge.displayName = 'StatusBadge';

// ── CampaignForm ──────────────────────────────────────────────────────────────

interface CampaignFormProps {
  apiTargets: string[];
  groups: TargetGroup[];
  onSave: (c: Campaign) => void;
  onCancel: () => void;
}

const CampaignForm = memo(({ apiTargets, groups, onSave, onCancel }: CampaignFormProps) => {
  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups]   = useState<string[]>([]);
  const [scanProfile, setScanProfile] = useState<ScanProfile>('standard');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('once');
  const [scheduleTime, setScheduleTime] = useState('02:00');
  const [scheduleDow, setScheduleDow]   = useState(1);
  const [scheduleDom, setScheduleDom]   = useState(1);

  const toggleTarget = useCallback((t: string) => {
    setSelectedTargets(prev =>
      prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
    );
  }, []);

  const toggleGroup = useCallback((id: string) => {
    setSelectedGroups(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }, []);

  const nextRun = useMemo(
    () => computeNextRun(scheduleType, scheduleTime, scheduleDow, scheduleDom),
    [scheduleType, scheduleTime, scheduleDow, scheduleDom],
  );

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      id: generateId(),
      name: name.trim(),
      description: description.trim(),
      targetIds: selectedTargets,
      groupIds: selectedGroups,
      scanProfile,
      scheduleType,
      scheduleTime,
      scheduleDow,
      scheduleDom,
      nextRun,
      status: 'planned',
      color: GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)],
      createdAt: Date.now(),
      runs: [],
    });
  };

  const inputCls =
    'w-full bg-[var(--grok-surface-1)] border border-[var(--grok-border)] rounded px-3 py-2 text-sm text-[var(--grok-text-body)] focus:outline-none focus:border-[var(--grok-recon-blue)] placeholder:text-[var(--grok-text-muted)]';

  const labelCls = 'block text-xs font-medium text-[var(--grok-text-muted)] uppercase tracking-wide mb-1';

  return (
    <div
      className="rounded-lg border border-[var(--grok-border)] bg-[var(--grok-surface-2)] p-5 space-y-5"
      style={{ boxShadow: 'var(--glow-blue)' }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--grok-text-heading)] uppercase tracking-wider">
          New Campaign
        </h3>
        <button onClick={onCancel} className="text-[var(--grok-text-muted)] hover:text-[var(--grok-text-heading)]">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Name + Description */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Campaign Name *</label>
          <input
            className={inputCls}
            placeholder="Q2 Web Audit"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Description</label>
          <input
            className={inputCls}
            placeholder="Optional notes..."
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </div>
      </div>

      {/* Scan Profile */}
      <div>
        <label className={labelCls}>Scan Profile</label>
        <div className="flex flex-wrap gap-2">
          {SCAN_PROFILES.map(p => (
            <button
              key={p.id}
              onClick={() => setScanProfile(p.id)}
              title={p.desc}
              className={cn(
                'px-3 py-1.5 rounded text-xs font-semibold border transition-all',
                scanProfile === p.id
                  ? 'text-white border-transparent'
                  : 'border-[var(--grok-border)] text-[var(--grok-text-muted)] hover:border-[var(--grok-border-glow)] hover:text-[var(--grok-text-body)]',
              )}
              style={scanProfile === p.id ? {
                background: profileColor(p.id),
                boxShadow: `0 0 8px ${profileColor(p.id)}66`,
              } : {}}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Target Selection */}
      {apiTargets.length > 0 && (
        <div>
          <label className={labelCls}>Targets ({selectedTargets.length} selected)</label>
          <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
            {apiTargets.map(t => (
              <button
                key={t}
                onClick={() => toggleTarget(t)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 rounded text-sm text-left transition-colors',
                  selectedTargets.includes(t)
                    ? 'bg-[var(--grok-recon-blue)]/10 text-[var(--grok-recon-blue)]'
                    : 'text-[var(--grok-text-muted)] hover:bg-[var(--grok-surface-1)]',
                )}
              >
                {selectedTargets.includes(t)
                  ? <CheckSquare className="w-3.5 h-3.5 shrink-0" />
                  : <Square className="w-3.5 h-3.5 shrink-0" />
                }
                <span className="font-mono text-xs truncate">{t}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Group Selection */}
      {groups.length > 0 && (
        <div>
          <label className={labelCls}>Target Groups ({selectedGroups.length} selected)</label>
          <div className="flex flex-wrap gap-2">
            {groups.map(g => (
              <button
                key={g.id}
                onClick={() => toggleGroup(g.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border transition-all',
                  selectedGroups.includes(g.id)
                    ? 'text-white border-transparent'
                    : 'border-[var(--grok-border)] text-[var(--grok-text-muted)] hover:border-[var(--grok-border-glow)]',
                )}
                style={selectedGroups.includes(g.id)
                  ? { background: g.color, boxShadow: `0 0 6px ${g.color}66` }
                  : {}
                }
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: g.color }}
                />
                {g.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Schedule */}
      <div>
        <label className={labelCls}>Schedule</label>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={scheduleType}
            onChange={e => setScheduleType(e.target.value as ScheduleType)}
            className={cn(inputCls, 'w-auto')}
          >
            {SCHEDULE_TYPES.map(s => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>

          {scheduleType !== 'once' && (
            <input
              type="time"
              value={scheduleTime}
              onChange={e => setScheduleTime(e.target.value)}
              className={cn(inputCls, 'w-auto')}
            />
          )}

          {scheduleType === 'weekly' && (
            <select
              value={scheduleDow}
              onChange={e => setScheduleDow(Number(e.target.value))}
              className={cn(inputCls, 'w-auto')}
            >
              {DOW_LABELS.map((d, i) => (
                <option key={i} value={i}>{d}</option>
              ))}
            </select>
          )}

          {scheduleType === 'monthly' && (
            <select
              value={scheduleDom}
              onChange={e => setScheduleDom(Number(e.target.value))}
              className={cn(inputCls, 'w-auto')}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                <option key={d} value={d}>Day {d}</option>
              ))}
            </select>
          )}
        </div>

        {nextRun && (
          <p className="mt-1.5 text-xs text-[var(--grok-text-muted)]">
            Next run: <span className="text-[var(--grok-recon-blue)]">{formatDateTime(nextRun)}</span>
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-1">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!name.trim()}
          className={cn(
            'px-4 py-2 text-sm font-semibold rounded transition-all',
            name.trim()
              ? 'bg-[var(--grok-recon-blue)] text-white hover:opacity-90'
              : 'bg-[var(--grok-surface-1)] text-[var(--grok-text-muted)] cursor-not-allowed',
          )}
        >
          Create Campaign
        </button>
      </div>
    </div>
  );
});
CampaignForm.displayName = 'CampaignForm';

// ── CampaignCard ──────────────────────────────────────────────────────────────

interface CampaignCardProps {
  campaign: Campaign;
  apiTargets: string[];
  isSelected: boolean;
  onSelect: (id: string) => void;
  onRunNow: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
}

const CampaignCard = memo(({
  campaign,
  apiTargets: _apiTargets,
  isSelected,
  onSelect,
  onRunNow,
  onArchive,
  onDelete,
}: CampaignCardProps) => {
  const totalFindings = campaign.runs.reduce((s, r) => s + r.findings, 0);
  const profileLabel  = SCAN_PROFILES.find(p => p.id === campaign.scanProfile)?.label ?? campaign.scanProfile;

  return (
    <div
      className={cn(
        'rounded-lg border transition-all cursor-pointer',
        isSelected
          ? 'border-[var(--grok-recon-blue)] bg-[var(--grok-recon-blue)]/5'
          : 'border-[var(--grok-border)] bg-[var(--grok-surface-1)] hover:border-[var(--grok-border-glow)]',
      )}
      onClick={() => onSelect(campaign.id)}
      role="button"
      aria-pressed={isSelected}
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onSelect(campaign.id)}
    >
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: campaign.color, boxShadow: `0 0 6px ${campaign.color}` }}
            />
            <h3 className="text-sm font-semibold text-[var(--grok-text-heading)] truncate">
              {campaign.name}
            </h3>
          </div>
          <StatusBadge status={campaign.status} />
        </div>

        {/* Description */}
        {campaign.description && (
          <p className="text-xs text-[var(--grok-text-muted)] mb-3 line-clamp-1">
            {campaign.description}
          </p>
        )}

        {/* Meta grid */}
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <p className="text-xs text-[var(--grok-text-muted)]">Targets</p>
            <p className="text-sm font-mono text-[var(--grok-text-body)]">
              {campaign.targetIds.length + campaign.groupIds.length}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--grok-text-muted)]">Runs</p>
            <p className="text-sm font-mono text-[var(--grok-text-body)]">{campaign.runs.length}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--grok-text-muted)]">Findings</p>
            <p
              className="text-sm font-mono"
              style={{ color: totalFindings > 0 ? 'var(--grok-exploit-red)' : 'var(--grok-text-muted)' }}
            >
              {totalFindings}
            </p>
          </div>
        </div>

        {/* Profile + Schedule */}
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border"
            style={{
              color: profileColor(campaign.scanProfile),
              borderColor: profileColor(campaign.scanProfile),
              background: `${profileColor(campaign.scanProfile)}1a`,
            }}
          >
            {profileLabel}
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-[var(--grok-text-muted)]">
            <Clock className="w-3 h-3" />
            {campaign.scheduleType === 'once' ? 'One-time' : campaign.scheduleType}
          </span>
          {campaign.nextRun && (
            <span className="text-xs text-[var(--grok-text-muted)]">
              Next: <span className="text-[var(--grok-scan-cyan)]">{formatDateTime(campaign.nextRun)}</span>
            </span>
          )}
        </div>

        {/* Actions */}
        <div
          className="flex items-center gap-2 pt-3 border-t border-[var(--grok-border)]"
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => onRunNow(campaign.id)}
            disabled={campaign.status === 'running'}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all',
              campaign.status === 'running'
                ? 'bg-[var(--grok-surface-2)] text-[var(--grok-text-muted)] cursor-not-allowed'
                : 'bg-[var(--grok-success)]/10 text-[var(--grok-success)] border border-[var(--grok-success)]/30 hover:bg-[var(--grok-success)]/20',
            )}
          >
            <Zap className="w-3 h-3" />
            Run Now
          </button>
          <button
            onClick={() => onArchive(campaign.id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-[var(--grok-text-muted)] border border-[var(--grok-border)] hover:border-[var(--grok-border-glow)] hover:text-[var(--grok-text-body)] transition-all"
          >
            <Archive className="w-3 h-3" />
            Archive
          </button>
          <button
            onClick={() => onDelete(campaign.id)}
            className="ml-auto inline-flex items-center gap-1 px-2 py-1.5 rounded text-xs text-[var(--grok-text-muted)] hover:text-[var(--grok-exploit-red)] transition-colors"
            aria-label="Delete campaign"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
});
CampaignCard.displayName = 'CampaignCard';

// ── CampaignDetail ────────────────────────────────────────────────────────────

const CampaignDetail = memo(({ campaign }: { campaign: Campaign }) => {
  const totalCrit   = campaign.runs.reduce((s, r) => s + r.criticals, 0);
  const totalHigh   = campaign.runs.reduce((s, r) => s + r.highs, 0);
  const maxFindings = Math.max(...campaign.runs.map(r => r.findings), 1);

  return (
    <div className="rounded-lg border border-[var(--grok-border)] bg-[var(--grok-surface-1)] p-5 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-[var(--grok-text-heading)] uppercase tracking-wider mb-1">
          {campaign.name}
        </h3>
        {campaign.description && (
          <p className="text-xs text-[var(--grok-text-muted)]">{campaign.description}</p>
        )}
      </div>

      {/* Findings summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Runs', value: campaign.runs.length, color: 'var(--grok-recon-blue)' },
          { label: 'Critical',   value: totalCrit,            color: 'var(--grok-crit-red)' },
          { label: 'High',       value: totalHigh,            color: 'var(--grok-exploit-red)' },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            className="rounded bg-[var(--grok-surface-2)] border border-[var(--grok-border)] p-3 text-center"
          >
            <p className="text-xs text-[var(--grok-text-muted)] mb-1">{label}</p>
            <p className="text-xl font-bold font-mono" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Trend sparkline */}
      {campaign.runs.length > 0 && (
        <div>
          <p className="text-xs font-medium text-[var(--grok-text-muted)] uppercase tracking-wide mb-2">
            Findings Trend
          </p>
          <div className="flex items-end gap-1 h-16">
            {campaign.runs.map(run => {
              const pct = (run.findings / maxFindings) * 100;
              return (
                <div
                  key={run.id}
                  title={`Run ${formatDateTime(run.startedAt)}: ${run.findings} findings`}
                  className="flex-1 rounded-sm min-w-[6px] transition-all"
                  style={{
                    height: `${Math.max(pct, 5)}%`,
                    background: run.criticals > 0
                      ? 'var(--grok-crit-red)'
                      : run.highs > 0
                      ? 'var(--grok-exploit-red)'
                      : 'var(--grok-recon-blue)',
                    opacity: 0.85,
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Run history */}
      {campaign.runs.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-[var(--grok-text-muted)] uppercase tracking-wide mb-2">
            Run History
          </p>
          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
            {[...campaign.runs].reverse().map(run => (
              <div
                key={run.id}
                className="flex items-center justify-between px-3 py-2 rounded bg-[var(--grok-surface-2)] border border-[var(--grok-border)] text-xs"
              >
                <span className="text-[var(--grok-text-muted)] font-mono">
                  {formatDateTime(run.startedAt)}
                </span>
                <div className="flex items-center gap-3">
                  {run.criticals > 0 && (
                    <span className="font-mono" style={{ color: 'var(--grok-crit-red)' }}>
                      {run.criticals} CRIT
                    </span>
                  )}
                  {run.highs > 0 && (
                    <span className="font-mono" style={{ color: 'var(--grok-exploit-red)' }}>
                      {run.highs} HIGH
                    </span>
                  )}
                  <span className="font-mono text-[var(--grok-text-body)]">
                    {run.findings} findings
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-[var(--grok-text-muted)] text-center py-4">
          No runs yet — use Run Now or wait for schedule.
        </p>
      )}
    </div>
  );
});
CampaignDetail.displayName = 'CampaignDetail';

// ── CampaignsTab ──────────────────────────────────────────────────────────────

interface CampaignsTabProps {
  campaigns: Campaign[];
  groups: TargetGroup[];
  apiTargets: string[];
  onAddCampaign: (c: Campaign) => void;
  onRunNow: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
}

function CampaignsTab({
  campaigns,
  groups,
  apiTargets,
  onAddCampaign,
  onRunNow,
  onArchive,
  onDelete,
}: CampaignsTabProps) {
  const [showForm, setShowForm]         = useState(false);
  const [selectedId, setSelectedId]     = useState<string | null>(null);

  const selected = campaigns.find(c => c.id === selectedId) ?? null;

  const handleSelect = useCallback((id: string) => {
    setSelectedId(prev => (prev === id ? null : id));
  }, []);

  const handleSave = useCallback((c: Campaign) => {
    onAddCampaign(c);
    setShowForm(false);
  }, [onAddCampaign]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--grok-text-muted)]">
          {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}
        </p>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="cs-btn cs-btn-primary flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            New Campaign
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <CampaignForm
          apiTargets={apiTargets}
          groups={groups}
          onSave={handleSave}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Campaign list + detail panel */}
      {campaigns.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Target className="w-12 h-12 text-[var(--grok-border)] mb-4" />
          <p className="text-sm text-[var(--grok-text-muted)]">No campaigns yet.</p>
          <p className="text-xs text-[var(--grok-text-muted)] mt-1">
            Create a campaign to schedule and automate scans across target groups.
          </p>
        </div>
      ) : (
        <div className={cn('grid gap-4', selected ? 'grid-cols-[1fr_360px]' : 'grid-cols-1')}>
          <div className="grid gap-3 grid-cols-1 xl:grid-cols-2 content-start">
            {campaigns.map(c => (
              <CampaignCard
                key={c.id}
                campaign={c}
                apiTargets={apiTargets}
                isSelected={c.id === selectedId}
                onSelect={handleSelect}
                onRunNow={onRunNow}
                onArchive={onArchive}
                onDelete={onDelete}
              />
            ))}
          </div>
          {selected && (
            <div>
              <CampaignDetail campaign={selected} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── GroupForm ─────────────────────────────────────────────────────────────────

interface GroupFormProps {
  apiTargets: string[];
  onSave: (g: TargetGroup) => void;
  onCancel: () => void;
}

const GroupForm = memo(({ apiTargets, onSave, onCancel }: GroupFormProps) => {
  const [name, setName]             = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor]           = useState(GROUP_COLORS[0]);
  const [tagsInput, setTagsInput]   = useState('');
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);

  const toggleTarget = useCallback((t: string) => {
    setSelectedTargets(prev =>
      prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
    );
  }, []);

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      id: generateId(),
      name: name.trim(),
      description: description.trim(),
      color,
      tags: tagsInput.split(',').map(t => t.trim()).filter(Boolean),
      targetIds: selectedTargets,
      createdAt: Date.now(),
    });
  };

  const inputCls =
    'w-full bg-[var(--grok-surface-1)] border border-[var(--grok-border)] rounded px-3 py-2 text-sm text-[var(--grok-text-body)] focus:outline-none focus:border-[var(--grok-recon-blue)] placeholder:text-[var(--grok-text-muted)]';
  const labelCls = 'block text-xs font-medium text-[var(--grok-text-muted)] uppercase tracking-wide mb-1';

  return (
    <div
      className="rounded-lg border border-[var(--grok-border)] bg-[var(--grok-surface-2)] p-5 space-y-5"
      style={{ boxShadow: 'var(--glow-blue)' }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--grok-text-heading)] uppercase tracking-wider">
          New Target Group
        </h3>
        <button onClick={onCancel} className="text-[var(--grok-text-muted)] hover:text-[var(--grok-text-heading)]">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Group Name *</label>
          <input
            className={inputCls}
            placeholder="Production Web Tier"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Description</label>
          <input
            className={inputCls}
            placeholder="Optional notes..."
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </div>
      </div>

      {/* Color */}
      <div>
        <label className={labelCls}>Color Tag</label>
        <div className="flex gap-2">
          {GROUP_COLORS.map(c => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={cn(
                'w-6 h-6 rounded-full border-2 transition-all',
                color === c ? 'border-white scale-110' : 'border-transparent hover:scale-105',
              )}
              style={{ background: c }}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>
      </div>

      {/* Tags */}
      <div>
        <label className={labelCls}>Tags (comma-separated)</label>
        <input
          className={inputCls}
          placeholder="web, external, dmz"
          value={tagsInput}
          onChange={e => setTagsInput(e.target.value)}
        />
      </div>

      {/* Targets */}
      {apiTargets.length > 0 && (
        <div>
          <label className={labelCls}>Targets ({selectedTargets.length} selected)</label>
          <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
            {apiTargets.map(t => (
              <button
                key={t}
                onClick={() => toggleTarget(t)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 rounded text-sm text-left transition-colors',
                  selectedTargets.includes(t)
                    ? 'bg-[var(--grok-recon-blue)]/10 text-[var(--grok-recon-blue)]'
                    : 'text-[var(--grok-text-muted)] hover:bg-[var(--grok-surface-1)]',
                )}
              >
                {selectedTargets.includes(t)
                  ? <CheckSquare className="w-3.5 h-3.5 shrink-0" />
                  : <Square className="w-3.5 h-3.5 shrink-0" />
                }
                <span className="font-mono text-xs truncate">{t}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-1">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!name.trim()}
          className={cn(
            'px-4 py-2 text-sm font-semibold rounded transition-all',
            name.trim()
              ? 'bg-[var(--grok-recon-blue)] text-white hover:opacity-90'
              : 'bg-[var(--grok-surface-1)] text-[var(--grok-text-muted)] cursor-not-allowed',
          )}
        >
          Create Group
        </button>
      </div>
    </div>
  );
});
GroupForm.displayName = 'GroupForm';

// ── TargetGroupsTab ───────────────────────────────────────────────────────────

interface TargetGroupsTabProps {
  groups: TargetGroup[];
  apiTargets: string[];
  onAddGroup: (g: TargetGroup) => void;
  onDeleteGroup: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}

function TargetGroupsTab({
  groups,
  apiTargets,
  onAddGroup,
  onDeleteGroup,
  onMoveUp,
  onMoveDown,
}: TargetGroupsTabProps) {
  const [showForm, setShowForm] = useState(false);

  const handleSave = useCallback((g: TargetGroup) => {
    onAddGroup(g);
    setShowForm(false);
  }, [onAddGroup]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--grok-text-muted)]">
          {groups.length} group{groups.length !== 1 ? 's' : ''}
        </p>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="cs-btn cs-btn-primary flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            New Group
          </button>
        )}
      </div>

      {showForm && (
        <GroupForm
          apiTargets={apiTargets}
          onSave={handleSave}
          onCancel={() => setShowForm(false)}
        />
      )}

      {groups.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Layers className="w-12 h-12 text-[var(--grok-border)] mb-4" />
          <p className="text-sm text-[var(--grok-text-muted)]">No target groups yet.</p>
          <p className="text-xs text-[var(--grok-text-muted)] mt-1">
            Group related targets to simplify campaign assignment.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {groups.map((g, idx) => (
            <div
              key={g.id}
              className="rounded-lg border border-[var(--grok-border)] bg-[var(--grok-surface-1)] p-4"
              style={{ borderLeftColor: g.color, borderLeftWidth: '3px' }}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: g.color, boxShadow: `0 0 5px ${g.color}` }}
                    />
                    <h4 className="text-sm font-semibold text-[var(--grok-text-heading)] truncate">
                      {g.name}
                    </h4>
                  </div>
                  {g.description && (
                    <p className="text-xs text-[var(--grok-text-muted)] mt-0.5 ml-4.5 line-clamp-1">
                      {g.description}
                    </p>
                  )}
                </div>
                {/* Reorder + Delete */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => onMoveUp(g.id)}
                    disabled={idx === 0}
                    className="p-1 text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] disabled:opacity-30 transition-colors"
                    aria-label="Move up"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onMoveDown(g.id)}
                    disabled={idx === groups.length - 1}
                    className="p-1 text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] disabled:opacity-30 transition-colors"
                    aria-label="Move down"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDeleteGroup(g.id)}
                    className="p-1 text-[var(--grok-text-muted)] hover:text-[var(--grok-exploit-red)] transition-colors"
                    aria-label="Delete group"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-4 mb-2 text-xs text-[var(--grok-text-muted)]">
                <span className="flex items-center gap-1">
                  <Target className="w-3 h-3" />
                  {g.targetIds.length} target{g.targetIds.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Tags */}
              {g.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {g.tags.map(tag => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-[var(--grok-surface-2)] border border-[var(--grok-border)] text-[var(--grok-text-muted)]"
                    >
                      <Tag className="w-2.5 h-2.5" />
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Target list preview */}
              {g.targetIds.length > 0 && (
                <div className="mt-2 space-y-1">
                  {g.targetIds.slice(0, 3).map(id => (
                    <p key={id} className="text-xs font-mono text-[var(--grok-text-muted)] truncate pl-1">
                      {id}
                    </p>
                  ))}
                  {g.targetIds.length > 3 && (
                    <p className="text-xs text-[var(--grok-text-muted)] pl-1">
                      +{g.targetIds.length - 3} more
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── CalendarTab ───────────────────────────────────────────────────────────────

interface CalendarTabProps {
  campaigns: Campaign[];
}

function CalendarTab({ campaigns }: CalendarTabProps) {
  const today = new Date();
  const [viewYear, setViewYear]   = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const prevMonth = useCallback(() => {
    setViewMonth(m => {
      if (m === 0) { setViewYear(y => y - 1); return 11; }
      return m - 1;
    });
    setSelectedDay(null);
  }, []);

  const nextMonth = useCallback(() => {
    setViewMonth(m => {
      if (m === 11) { setViewYear(y => y + 1); return 0; }
      return m + 1;
    });
    setSelectedDay(null);
  }, []);

  // Build set of campaign dots per day number
  const dayMap = useMemo<Map<number, Campaign[]>>(() => {
    const map = new Map<number, Campaign[]>();
    campaigns.forEach(c => {
      if (!c.nextRun) return;
      const d = new Date(c.nextRun);
      if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
        const day = d.getDate();
        const list = map.get(day) ?? [];
        list.push(c);
        map.set(day, list);
      }
    });
    return map;
  }, [campaigns, viewYear, viewMonth]);

  // Calendar grid
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const isCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth();

  const cells: Array<number | null> = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const selectedCampaigns = selectedDay != null ? (dayMap.get(selectedDay) ?? []) : [];

  // Unique campaigns for legend
  const legendCampaigns = useMemo(() => {
    const seen = new Set<string>();
    const result: Campaign[] = [];
    dayMap.forEach(list => list.forEach(c => {
      if (!seen.has(c.id)) { seen.add(c.id); result.push(c); }
    }));
    return result;
  }, [dayMap]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={prevMonth}
          className="p-2 rounded text-[var(--grok-text-muted)] hover:text-[var(--grok-text-heading)] hover:bg-[var(--grok-surface-2)] transition-colors"
          aria-label="Previous month"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <h3 className="text-sm font-semibold text-[var(--grok-text-heading)]">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </h3>
        <button
          onClick={nextMonth}
          className="p-2 rounded text-[var(--grok-text-muted)] hover:text-[var(--grok-text-heading)] hover:bg-[var(--grok-surface-2)] transition-colors"
          aria-label="Next month"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 gap-1">
        {DOW_LABELS.map(d => (
          <div key={d} className="text-center text-xs font-semibold text-[var(--grok-text-muted)] py-1">
            {d}
          </div>
        ))}

        {/* Day cells */}
        {cells.map((day, i) => {
          if (day === null) {
            return <div key={`empty-${i}`} />;
          }
          const isToday    = isCurrentMonth && day === today.getDate();
          const hasItems   = dayMap.has(day);
          const isSelected = selectedDay === day;
          const dotList    = dayMap.get(day) ?? [];

          return (
            <button
              key={day}
              onClick={() => setSelectedDay(prev => (prev === day ? null : day))}
              className={cn(
                'relative flex flex-col items-center rounded py-2 min-h-[52px] text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--grok-recon-blue)]',
                isSelected
                  ? 'bg-[var(--grok-recon-blue)]/10 border border-[var(--grok-recon-blue)]'
                  : isToday
                  ? 'border border-[var(--grok-scan-cyan)] bg-[var(--grok-scan-cyan)]/5'
                  : 'border border-transparent hover:bg-[var(--grok-surface-2)]',
              )}
              aria-pressed={isSelected}
            >
              <span
                className={cn(
                  'text-xs font-mono',
                  isToday    ? 'text-[var(--grok-scan-cyan)] font-bold' :
                  hasItems   ? 'text-[var(--grok-text-heading)]' :
                               'text-[var(--grok-text-muted)]',
                )}
              >
                {day}
              </span>
              {/* Dots */}
              {dotList.length > 0 && (
                <div className="flex flex-wrap justify-center gap-0.5 mt-1 px-1 max-w-full">
                  {dotList.slice(0, 4).map(c => (
                    <span
                      key={c.id}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: c.color }}
                    />
                  ))}
                  {dotList.length > 4 && (
                    <span className="text-[9px] text-[var(--grok-text-muted)] leading-none">
                      +{dotList.length - 4}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected day panel */}
      {selectedDay !== null && (
        <div className="rounded-lg border border-[var(--grok-border)] bg-[var(--grok-surface-1)] p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-[var(--grok-text-heading)]">
              {MONTH_NAMES[viewMonth]} {selectedDay}, {viewYear}
            </h4>
            <button
              onClick={() => setSelectedDay(null)}
              className="text-[var(--grok-text-muted)] hover:text-[var(--grok-text-heading)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {selectedCampaigns.length === 0 ? (
            <p className="text-xs text-[var(--grok-text-muted)]">No scans scheduled on this day.</p>
          ) : (
            <div className="space-y-2">
              {selectedCampaigns.map(c => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 px-3 py-2 rounded bg-[var(--grok-surface-2)] border border-[var(--grok-border)]"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: c.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[var(--grok-text-heading)] truncate">{c.name}</p>
                    <p className="text-xs text-[var(--grok-text-muted)]">
                      {c.scheduleTime} &middot; {SCAN_PROFILES.find(p => p.id === c.scanProfile)?.label}
                    </p>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      {legendCampaigns.length > 0 && (
        <div className="flex flex-wrap gap-3 pt-2 border-t border-[var(--grok-border)]">
          <span className="text-xs text-[var(--grok-text-muted)] self-center">Legend:</span>
          {legendCampaigns.map(c => (
            <span key={c.id} className="inline-flex items-center gap-1.5 text-xs text-[var(--grok-text-body)]">
              <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
              {c.name}
            </span>
          ))}
        </div>
      )}

      {campaigns.filter(c => c.nextRun).length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Calendar className="w-12 h-12 text-[var(--grok-border)] mb-4" />
          <p className="text-sm text-[var(--grok-text-muted)]">No scheduled scans.</p>
          <p className="text-xs text-[var(--grok-text-muted)] mt-1">
            Create recurring campaigns to see them here.
          </p>
        </div>
      )}
    </div>
  );
}

// ── CampaignsView (root) ───────────────────────────────────────────────────────

type TabId = 'campaigns' | 'groups' | 'calendar';

interface TabDef {
  id: TabId;
  label: string;
  icon: typeof Calendar;
}

const TABS: TabDef[] = [
  { id: 'campaigns', label: 'Campaigns',      icon: Target },
  { id: 'groups',    label: 'Target Groups',  icon: Layers },
  { id: 'calendar',  label: 'Schedule',        icon: Calendar },
];

export function CampaignsView() {
  const { addToast } = useUIStore();

  const [activeTab, setActiveTab]   = useState<TabId>('campaigns');
  const [campaigns, setCampaigns]   = useState<Campaign[]>([]);
  const [groups, setGroups]         = useState<TargetGroup[]>([]);
  const [apiTargets, setApiTargets] = useState<string[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(true);

  // Fetch API targets on mount
  useEffect(() => {
    const load = async () => {
      try {
        const targets = await apiService.getTargets();
        setApiTargets(targets);
      } catch {
        // Non-fatal — campaigns work without live targets
      } finally {
        setLoadingTargets(false);
      }
    };
    load();
  }, []);

  // ── Campaign handlers ──────────────────────────────────────────────────────

  const handleAddCampaign = useCallback((c: Campaign) => {
    setCampaigns(prev => [c, ...prev]);
    addToast({ type: 'success', message: `Campaign "${c.name}" created.` });
  }, [addToast]);

  const handleRunNow = useCallback((id: string) => {
    setCampaigns(prev => prev.map(c => {
      if (c.id !== id) return c;
      const run: RunRecord = {
        id: generateId(),
        startedAt: Date.now(),
        completedAt: null,
        findings: 0,
        criticals: 0,
        highs: 0,
      };
      return { ...c, status: 'running', runs: [...c.runs, run] };
    }));

    const campaign = campaigns.find(c => c.id === id);
    addToast({ type: 'info', message: `Running campaign "${campaign?.name ?? id}"...` });

    // Simulate completion after a delay
    setTimeout(() => {
      setCampaigns(prev => prev.map(c => {
        if (c.id !== id) return c;
        const findings  = Math.floor(Math.random() * 24);
        const criticals = Math.floor(findings * 0.1);
        const highs     = Math.floor(findings * 0.25);
        return {
          ...c,
          status: 'completed',
          runs: c.runs.map((r, i) =>
            i === c.runs.length - 1
              ? { ...r, completedAt: Date.now(), findings, criticals, highs }
              : r
          ),
        };
      }));
      addToast({ type: 'success', message: `Campaign "${campaign?.name ?? id}" completed.` });
    }, 4000);
  }, [campaigns, addToast]);

  const handleArchive = useCallback((id: string) => {
    setCampaigns(prev => prev.map(c =>
      c.id === id ? { ...c, status: 'completed' } : c
    ));
    const campaign = campaigns.find(c => c.id === id);
    addToast({ type: 'info', message: `Campaign "${campaign?.name ?? id}" archived.` });
  }, [campaigns, addToast]);

  const handleDeleteCampaign = useCallback((id: string) => {
    const campaign = campaigns.find(c => c.id === id);
    setCampaigns(prev => prev.filter(c => c.id !== id));
    addToast({ type: 'info', message: `Campaign "${campaign?.name ?? id}" deleted.` });
  }, [campaigns, addToast]);

  // ── Group handlers ─────────────────────────────────────────────────────────

  const handleAddGroup = useCallback((g: TargetGroup) => {
    setGroups(prev => [g, ...prev]);
    addToast({ type: 'success', message: `Group "${g.name}" created.` });
  }, [addToast]);

  const handleDeleteGroup = useCallback((id: string) => {
    const group = groups.find(g => g.id === id);
    setGroups(prev => prev.filter(g => g.id !== id));
    addToast({ type: 'info', message: `Group "${group?.name ?? id}" deleted.` });
  }, [groups, addToast]);

  const handleMoveUp = useCallback((id: string) => {
    setGroups(prev => {
      const idx = prev.findIndex(g => g.id === id);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }, []);

  const handleMoveDown = useCallback((id: string) => {
    setGroups(prev => {
      const idx = prev.findIndex(g => g.id === id);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: 'var(--grok-void)' }}
    >
      {/* Page header */}
      <div
        className="flex-none px-5 pt-5 pb-0 border-b border-[var(--grok-border)]"
        style={{ background: 'var(--grok-surface-1)' }}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-lg font-bold text-[var(--grok-text-heading)] flex items-center gap-2">
              <Layers className="w-5 h-5 text-[var(--grok-scan-cyan)]" />
              Campaigns
            </h1>
            <p className="text-[10px] text-[var(--grok-text-muted)] mt-0.5 font-mono">
              Scan scheduling, target grouping, and campaign management
            </p>
          </div>
          {loadingTargets && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--grok-text-muted)]">
              <AlertCircle className="w-3.5 h-3.5 animate-pulse" />
              Loading targets...
            </div>
          )}
          {!loadingTargets && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--grok-text-muted)]">
              <Target className="w-3.5 h-3.5" />
              {apiTargets.length} live target{apiTargets.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        {/* Tab row */}
        <div className="flex gap-0" role="tablist">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all focus-visible:outline-none',
                  active
                    ? 'border-[var(--grok-recon-blue)] text-[var(--grok-recon-blue)]'
                    : 'border-transparent text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] hover:border-[var(--grok-border)]',
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {activeTab === 'campaigns' && (
          <CampaignsTab
            campaigns={campaigns}
            groups={groups}
            apiTargets={apiTargets}
            onAddCampaign={handleAddCampaign}
            onRunNow={handleRunNow}
            onArchive={handleArchive}
            onDelete={handleDeleteCampaign}
          />
        )}
        {activeTab === 'groups' && (
          <TargetGroupsTab
            groups={groups}
            apiTargets={apiTargets}
            onAddGroup={handleAddGroup}
            onDeleteGroup={handleDeleteGroup}
            onMoveUp={handleMoveUp}
            onMoveDown={handleMoveDown}
          />
        )}
        {activeTab === 'calendar' && (
          <CalendarTab campaigns={campaigns} />
        )}
      </div>
    </div>
  );
}
