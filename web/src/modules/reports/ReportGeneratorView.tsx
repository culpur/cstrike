/**
 * Report Generator — CStrike v2
 * Generates penetration test reports from live scan data.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileText,
  ShieldAlert,
  ClipboardList,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Printer,
  Download,
  Clipboard,
  Loader2,
  Check,
  User,
  Building2,
  Calendar,
  Target,
  Lock,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  AlertCircle,
  Info,
  Globe,
  Key,
  List,
} from 'lucide-react';
import { useUIStore } from '@stores/uiStore';
import { useReconStore } from '@stores/reconStore';
import { useLootStore } from '@stores/lootStore';
import { apiService } from '@services/api';
import { cn, formatDateTime } from '@utils/index';
import type { CompleteScanResults, LootItem } from '@/types';

// ============================================================================
// Types
// ============================================================================

type TemplateId = 'pentest' | 'executive' | 'vuln' | 'compliance';
type ClassificationLevel = 'UNCLASSIFIED' | 'CUI' | 'CONFIDENTIAL' | 'SECRET';
type ExportStatus = 'idle' | 'generating' | 'done';

interface ReportTemplate {
  id: TemplateId;
  label: string;
  description: string;
  estimatedPages: number;
  icon: React.ReactNode;
  accentVar: string;
}

interface ReportSections {
  executiveSummary: boolean;
  methodology: boolean;
  findings: boolean;
  riskMatrix: boolean;
  remediation: boolean;
  evidence: boolean;
  appendix: boolean;
}

interface ReportConfig {
  template: TemplateId | null;
  selectedTargets: string[];
  dateFrom: string;
  dateTo: string;
  sections: ReportSections;
  classification: ClassificationLevel;
  analystName: string;
  organization: string;
}

interface TargetScanData {
  target: string;
  results: CompleteScanResults | null;
}

// ============================================================================
// Constants
// ============================================================================

const TEMPLATES: ReportTemplate[] = [
  {
    id: 'pentest',
    label: 'Full Penetration Test Report',
    description: 'Comprehensive technical report covering all phases: recon, exploitation, post-exploitation, and remediation guidance.',
    estimatedPages: 45,
    icon: <ShieldAlert className="w-5 h-5" />,
    accentVar: '--grok-exploit-red',
  },
  {
    id: 'executive',
    label: 'Executive Summary',
    description: 'High-level business-facing overview with risk scores, key findings, and strategic recommendations. Non-technical.',
    estimatedPages: 8,
    icon: <BarChart3 className="w-5 h-5" />,
    accentVar: '--grok-recon-blue',
  },
  {
    id: 'vuln',
    label: 'Vulnerability Assessment',
    description: 'Structured listing of all discovered vulnerabilities with CVSS scores, CVE references, and remediation steps.',
    estimatedPages: 20,
    icon: <AlertTriangle className="w-5 h-5" />,
    accentVar: '--grok-warning',
  },
  {
    id: 'compliance',
    label: 'Compliance Scan Report',
    description: 'Compliance-oriented findings mapped to OWASP Top 10, NIST 800-53, and PCI-DSS control frameworks.',
    estimatedPages: 30,
    icon: <ClipboardList className="w-5 h-5" />,
    accentVar: '--grok-loot-green',
  },
];

const CLASSIFICATION_BANNERS: Record<ClassificationLevel, { bg: string; text: string; label: string }> = {
  UNCLASSIFIED: { bg: 'bg-[var(--grok-ok-green,#00cc66)]', text: 'text-black', label: 'UNCLASSIFIED' },
  CUI:          { bg: 'bg-[#ff8800]',                       text: 'text-black', label: 'CUI // CONTROLLED UNCLASSIFIED INFORMATION' },
  CONFIDENTIAL: { bg: 'bg-[#3366ff]',                       text: 'text-white', label: 'CONFIDENTIAL' },
  SECRET:       { bg: 'bg-[var(--grok-crit-red)]',          text: 'text-white', label: 'SECRET' },
};

const SECTION_LABELS: Record<keyof ReportSections, string> = {
  executiveSummary: 'Executive Summary',
  methodology:      'Methodology',
  findings:         'Findings',
  riskMatrix:       'Risk Matrix',
  remediation:      'Remediation',
  evidence:         'Evidence',
  appendix:         'Appendix',
};

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: 'bg-[var(--grok-crit-red)]/10',    text: 'text-[var(--grok-crit-red)]',    border: 'border-[var(--grok-crit-red)]' },
  high:     { bg: 'bg-[var(--grok-exploit-red)]/10', text: 'text-[var(--grok-exploit-red)]', border: 'border-[var(--grok-exploit-red)]' },
  medium:   { bg: 'bg-[var(--grok-warning)]/10',     text: 'text-[var(--grok-warning)]',     border: 'border-[var(--grok-warning)]' },
  low:      { bg: 'bg-[var(--grok-recon-blue)]/10',  text: 'text-[var(--grok-recon-blue)]',  border: 'border-[var(--grok-recon-blue)]' },
  info:     { bg: 'bg-[var(--grok-text-muted)]/10',  text: 'text-[var(--grok-text-muted)]',  border: 'border-[var(--grok-border)]' },
};

const defaultSections: ReportSections = {
  executiveSummary: true,
  methodology:      true,
  findings:         true,
  riskMatrix:       true,
  remediation:      true,
  evidence:         false,
  appendix:         false,
};

// ============================================================================
// Helpers
// ============================================================================

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function thirtyDaysAgoIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function severityLabel(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function riskScore(critical: number, high: number, medium: number, low: number): number {
  return critical * 10 + high * 5 + medium * 2 + low;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================================
// Sub-components
// ============================================================================

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
  badge,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: string | number;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-[var(--grok-border)] rounded-lg overflow-hidden mb-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[var(--grok-surface-2)] hover:bg-[var(--grok-surface-3)] transition-colors text-left"
        aria-expanded={open}
      >
        <span className="text-xs font-semibold uppercase tracking-widest text-[var(--grok-text-muted)] flex items-center gap-2">
          {title}
          {badge !== undefined && (
            <span className="px-1.5 py-0.5 rounded bg-[var(--grok-surface-3)] text-[var(--grok-text-body)] text-xs font-mono">
              {badge}
            </span>
          )}
        </span>
        {open
          ? <ChevronDown className="w-4 h-4 text-[var(--grok-text-muted)]" />
          : <ChevronRight className="w-4 h-4 text-[var(--grok-text-muted)]" />}
      </button>
      {open && (
        <div className="p-4 bg-[var(--grok-surface-1)] animate-fade-in">
          {children}
        </div>
      )}
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 group"
    >
      {checked
        ? <ToggleRight className="w-5 h-5 text-[var(--grok-recon-blue)] transition-colors" />
        : <ToggleLeft  className="w-5 h-5 text-[var(--grok-text-muted)] transition-colors" />}
      <span
        className={cn(
          'text-sm transition-colors',
          checked ? 'text-[var(--grok-text-body)]' : 'text-[var(--grok-text-muted)]'
        )}
      >
        {label}
      </span>
    </button>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const style = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.info;
  return (
    <span className={cn('px-2 py-0.5 rounded text-xs font-semibold border', style.bg, style.text, style.border)}>
      {severityLabel(severity)}
    </span>
  );
}

// ============================================================================
// Report content builder (Markdown)
// ============================================================================

function buildMarkdown(
  config: ReportConfig,
  scanData: TargetScanData[],
  lootItems: LootItem[],
  redactLoot: boolean
): string {
  const template = TEMPLATES.find((t) => t.id === config.template);
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const lines: string[] = [];

  const banner = config.classification !== 'UNCLASSIFIED'
    ? `<!-- CLASSIFICATION: ${config.classification} -->\n`
    : '';

  lines.push(banner);
  lines.push(`# ${template?.label ?? 'Penetration Test Report'}`);
  lines.push('');
  lines.push(`**Classification:** ${config.classification}`);
  lines.push(`**Date:** ${date}`);
  lines.push(`**Analyst:** ${config.analystName || 'N/A'}`);
  lines.push(`**Organization:** ${config.organization || 'N/A'}`);
  lines.push(`**Targets:** ${config.selectedTargets.join(', ') || 'All'}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  const allVulns = scanData.flatMap((d) => d.results?.vulnerabilities ?? []);
  const allPorts = scanData.flatMap((d) => (d.results?.ports ?? []).filter((p) => p.state === 'open'));

  if (config.sections.executiveSummary) {
    const critCount = allVulns.filter((v) => v.severity === 'critical').length;
    const highCount = allVulns.filter((v) => v.severity === 'high').length;
    const score = riskScore(
      critCount,
      highCount,
      allVulns.filter((v) => v.severity === 'medium').length,
      allVulns.filter((v) => v.severity === 'low').length
    );

    lines.push('## 1. Executive Summary');
    lines.push('');
    lines.push(
      `This ${template?.label ?? 'assessment'} was conducted against ${config.selectedTargets.length || 'the configured'} target(s) ` +
      `on behalf of **${config.organization || 'the client organization'}**. ` +
      `The engagement identified **${allVulns.length} vulnerabilities** across ${scanData.length} target(s), ` +
      `including **${critCount} critical** and **${highCount} high** severity findings. ` +
      `The overall risk score is **${score}**.`
    );
    lines.push('');
  }

  if (config.sections.methodology) {
    lines.push('## 2. Methodology');
    lines.push('');
    lines.push('The assessment followed a structured black-box and grey-box approach using the following phases:');
    lines.push('');
    lines.push('- **Reconnaissance** — Passive and active information gathering (nmap, subfinder, httpx, amass)');
    lines.push('- **Enumeration** — Service and version identification, subdomain discovery');
    lines.push('- **Vulnerability Scanning** — Automated scanning with nuclei, nikto, ZAP');
    lines.push('- **Exploitation** — Controlled exploitation of confirmed findings');
    lines.push('- **Post-Exploitation** — Credential harvesting and lateral movement simulation');
    lines.push('- **Reporting** — Risk-rated findings with remediation guidance');
    lines.push('');
  }

  if (config.sections.findings) {
    lines.push('## 3. Findings');
    lines.push('');
    if (allVulns.length === 0) {
      lines.push('_No vulnerabilities found for the selected targets and date range._');
    } else {
      const sorted = [...allVulns].sort(
        (a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)
      );
      lines.push('| # | Severity | Title | CVE | Target |');
      lines.push('|---|----------|-------|-----|--------|');
      sorted.forEach((v, i) => {
        lines.push(
          `| ${i + 1} | ${severityLabel(v.severity)} | ${v.title} | ${v.cve ?? '—'} | ${scanData.find((d) => d.results?.vulnerabilities.includes(v))?.target ?? '—'} |`
        );
      });
    }
    lines.push('');
  }

  if (config.sections.riskMatrix) {
    lines.push('## 4. Risk Matrix');
    lines.push('');
    lines.push('| Likelihood \\ Impact | Low | Medium | High | Critical |');
    lines.push('|----------------------|-----|--------|------|----------|');
    ['High', 'Medium', 'Low'].forEach((likelihood) => {
      const row = ['Low', 'Medium', 'High', 'Critical'].map((impact) => {
        const count = allVulns.filter((v) => v.severity.toLowerCase() === impact.toLowerCase()).length;
        return count > 0 ? `**${count}**` : '—';
      });
      lines.push(`| ${likelihood} | ${row.join(' | ')} |`);
    });
    lines.push('');
  }

  if (config.sections.remediation) {
    lines.push('## 5. Remediation');
    lines.push('');
    const critAndHigh = allVulns
      .filter((v) => v.severity === 'critical' || v.severity === 'high')
      .slice(0, 10);
    if (critAndHigh.length === 0) {
      lines.push('_No critical or high severity findings requiring immediate remediation._');
    } else {
      critAndHigh.forEach((v, i) => {
        lines.push(`### ${i + 1}. ${v.title}`);
        lines.push(`**Severity:** ${severityLabel(v.severity)}`);
        if (v.cve) lines.push(`**CVE:** ${v.cve}`);
        lines.push(`**Description:** ${v.description}`);
        lines.push(`**Recommendation:** Apply vendor patches, enforce input validation, and conduct code review for affected components.`);
        lines.push('');
      });
    }
  }

  if (config.sections.evidence) {
    lines.push('## 6. Evidence');
    lines.push('');
    if (allPorts.length > 0) {
      lines.push('### Open Ports');
      lines.push('');
      lines.push('| Target | Port | Protocol | Service | Version |');
      lines.push('|--------|------|----------|---------|---------|');
      allPorts.slice(0, 30).forEach((p) => {
        lines.push(`| ${p.target} | ${p.port} | ${p.protocol} | ${p.service ?? '—'} | ${p.version ?? '—'} |`);
      });
      lines.push('');
    }

    if (lootItems.length > 0) {
      lines.push('### Captured Loot');
      lines.push('');
      lines.push('| Category | Value | Target | Source |');
      lines.push('|----------|-------|--------|--------|');
      lootItems.slice(0, 20).forEach((item) => {
        const val = redactLoot && (item.category === 'password' || item.category === 'hash')
          ? '**[REDACTED]**'
          : item.value;
        lines.push(`| ${item.category} | ${val} | ${item.target} | ${item.source} |`);
      });
      lines.push('');
    }
  }

  if (config.sections.appendix) {
    lines.push('## 7. Appendix');
    lines.push('');
    lines.push('### A. Tools Used');
    const toolsUsed = [...new Set(scanData.flatMap((d) => d.results?.toolsUsed ?? []))];
    if (toolsUsed.length > 0) {
      toolsUsed.forEach((t) => lines.push(`- ${t}`));
    } else {
      lines.push('- nmap, subfinder, httpx, nuclei, nikto, amass');
    }
    lines.push('');
    lines.push('### B. Scope');
    lines.push('');
    config.selectedTargets.forEach((t) => lines.push(`- ${t}`));
    lines.push('');
    lines.push(`### C. Disclaimer`);
    lines.push('');
    lines.push(
      'This report was generated by CStrike v2 and is intended solely for the organization named above. ' +
      'Unauthorized distribution is prohibited. All findings are based on point-in-time testing.'
    );
  }

  return lines.join('\n');
}

// ============================================================================
// HTML export builder
// ============================================================================

function buildHtml(
  config: ReportConfig,
  markdown: string,
  classificationBanner: { bg: string; text: string; label: string }
): string {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const template = TEMPLATES.find((t) => t.id === config.template);

  // Convert minimal markdown to HTML (tables, headings, bold, lists)
  const md2html = (text: string): string =>
    text
      .replace(/^#{1}\s(.+)/gm, '<h1>$1</h1>')
      .replace(/^#{2}\s(.+)/gm, '<h2>$1</h2>')
      .replace(/^#{3}\s(.+)/gm, '<h3>$1</h3>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/^- (.+)/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
      .replace(/^---$/gm, '<hr/>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(?!<[hul]|<p|<hr|<\/p|<li)(.+)$/gm, '<p>$1</p>');

  const bannerBg = config.classification === 'UNCLASSIFIED' ? '#00cc66'
    : config.classification === 'CUI' ? '#ff8800'
    : config.classification === 'CONFIDENTIAL' ? '#3366ff'
    : '#ff0033';
  const bannerFg = config.classification === 'UNCLASSIFIED' || config.classification === 'CUI' ? '#000' : '#fff';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${template?.label ?? 'Report'} — ${config.organization || 'CStrike'}</title>
<style>
  :root { font-family: 'Inter', Arial, sans-serif; color: #111; background: #fff; }
  body { max-width: 900px; margin: 0 auto; padding: 2rem; }
  .banner { background: ${bannerBg}; color: ${bannerFg}; text-align: center; font-weight: 700;
            font-size: 0.75rem; letter-spacing: 0.15em; padding: 6px 0; margin: -2rem -2rem 2rem; }
  h1 { font-size: 2rem; border-bottom: 2px solid #111; padding-bottom: 0.5rem; }
  h2 { font-size: 1.25rem; margin-top: 2rem; border-bottom: 1px solid #ddd; padding-bottom: 0.25rem; }
  h3 { font-size: 1rem; margin-top: 1.5rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin: 1rem 0; }
  th { background: #f5f5f5; text-align: left; padding: 8px 10px; border: 1px solid #ddd; }
  td { padding: 7px 10px; border: 1px solid #ddd; }
  tr:nth-child(even) td { background: #fafafa; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 2rem; margin: 1rem 0 2rem; font-size: 0.9rem; }
  .meta dt { color: #666; font-weight: 600; }
  .meta dd { margin: 0; }
  ul { padding-left: 1.5rem; }
  li { margin: 0.25rem 0; }
  hr { border: none; border-top: 1px solid #ddd; margin: 2rem 0; }
  @media print { .banner { position: fixed; top: 0; width: 100%; } body { padding-top: 3rem; } }
</style>
</head>
<body>
<div class="banner">${classificationBanner.label}</div>
<h1>${template?.label ?? 'Report'}</h1>
<dl class="meta">
  <dt>Date</dt><dd>${date}</dd>
  <dt>Classification</dt><dd>${config.classification}</dd>
  <dt>Analyst</dt><dd>${config.analystName || '—'}</dd>
  <dt>Organization</dt><dd>${config.organization || '—'}</dd>
  <dt>Targets</dt><dd>${config.selectedTargets.join(', ') || 'All'}</dd>
  <dt>Generated By</dt><dd>CStrike v2</dd>
</dl>
<hr/>
${md2html(markdown)}
<div class="banner" style="margin: 2rem -2rem -2rem;">${classificationBanner.label}</div>
</body>
</html>`;
}

// ============================================================================
// Main Component
// ============================================================================

export function ReportGeneratorView() {
  const { addToast } = useUIStore();
  const { targets } = useReconStore();
  const { items: lootItems } = useLootStore();

  const [config, setConfig] = useState<ReportConfig>({
    template: null,
    selectedTargets: [],
    dateFrom: thirtyDaysAgoIso(),
    dateTo: todayIso(),
    sections: { ...defaultSections },
    classification: 'UNCLASSIFIED',
    analystName: '',
    organization: '',
  });

  const [apiTargets, setApiTargets] = useState<string[]>([]);
  const [scanData, setScanData] = useState<TargetScanData[]>([]);
  const [loadingScanData, setLoadingScanData] = useState(false);
  const [redactLoot, setRedactLoot] = useState(true);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle');
  const [copiedMd, setCopiedMd] = useState(false);

  // Merge store targets with API targets
  const allTargets = useMemo(() => {
    const storeUrls = targets.map((t) => t.url);
    return [...new Set([...storeUrls, ...apiTargets])];
  }, [targets, apiTargets]);

  // Load API targets on mount
  useEffect(() => {
    apiService.getTargets().then((t) => setApiTargets(t.map((x) => x.url))).catch(() => void 0);
  }, []);

  // Select all targets when list loads (if none selected yet)
  useEffect(() => {
    if (allTargets.length > 0 && config.selectedTargets.length === 0) {
      setConfig((prev) => ({ ...prev, selectedTargets: allTargets }));
    }
  }, [allTargets, config.selectedTargets.length]);

  // Fetch scan results for selected targets
  useEffect(() => {
    if (config.selectedTargets.length === 0) {
      setScanData([]);
      return;
    }

    let cancelled = false;
    setLoadingScanData(true);

    Promise.all(
      config.selectedTargets.map(async (target): Promise<TargetScanData> => {
        try {
          const results = await apiService.getTargetResults(target);
          return { target, results };
        } catch {
          return { target, results: null };
        }
      })
    ).then((data) => {
      if (!cancelled) {
        setScanData(data);
        setLoadingScanData(false);
      }
    });

    return () => { cancelled = true; };
  }, [config.selectedTargets]);

  // Aggregate stats
  const stats = useMemo(() => {
    const allVulns = scanData.flatMap((d) => d.results?.vulnerabilities ?? []);
    const allPorts = scanData.flatMap((d) => (d.results?.ports ?? []).filter((p) => p.state === 'open'));
    const critical = allVulns.filter((v) => v.severity === 'critical').length;
    const high     = allVulns.filter((v) => v.severity === 'high').length;
    const medium   = allVulns.filter((v) => v.severity === 'medium').length;
    const low      = allVulns.filter((v) => v.severity === 'low').length;
    return {
      totalVulns: allVulns.length,
      critical,
      high,
      medium,
      low,
      openPorts: allPorts.length,
      lootItems: lootItems.length,
      riskScore: riskScore(critical, high, medium, low),
      allVulns,
      allPorts,
    };
  }, [scanData, lootItems]);

  // Markdown content (memoized for preview and export)
  const markdownContent = useMemo(
    () => config.template ? buildMarkdown(config, scanData, lootItems, redactLoot) : '',
    [config, scanData, lootItems, redactLoot]
  );

  const classificationBanner = CLASSIFICATION_BANNERS[config.classification];

  // ── Config helpers ─────────────────────────────────────────────

  const selectTemplate = useCallback((id: TemplateId) => {
    setConfig((prev) => ({ ...prev, template: id }));
  }, []);

  const toggleTarget = useCallback((url: string) => {
    setConfig((prev) => {
      const set = new Set(prev.selectedTargets);
      if (set.has(url)) set.delete(url);
      else set.add(url);
      return { ...prev, selectedTargets: Array.from(set) };
    });
  }, []);

  const toggleSection = useCallback((key: keyof ReportSections) => {
    setConfig((prev) => ({
      ...prev,
      sections: { ...prev.sections, [key]: !prev.sections[key] },
    }));
  }, []);

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Export actions ─────────────────────────────────────────────

  const handleGeneratePdf = useCallback(() => {
    if (!config.template) {
      addToast({ type: 'warning', message: 'Select a report template first' });
      return;
    }
    setExportStatus('generating');
    // Brief delay for visual feedback before print dialog opens
    setTimeout(() => {
      window.print();
      setExportStatus('done');
      setTimeout(() => setExportStatus('idle'), 2000);
    }, 400);
  }, [config.template, addToast]);

  const handleExportHtml = useCallback(() => {
    if (!config.template) {
      addToast({ type: 'warning', message: 'Select a report template first' });
      return;
    }
    setExportStatus('generating');
    try {
      const html = buildHtml(config, markdownContent, classificationBanner);
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const filename = `cstrike-report-${config.classification.toLowerCase()}-${Date.now()}.html`;
      downloadBlob(blob, filename);
      setExportStatus('done');
      addToast({ type: 'success', message: 'HTML report exported' });
      setTimeout(() => setExportStatus('idle'), 2000);
    } catch {
      setExportStatus('idle');
      addToast({ type: 'error', message: 'Failed to export HTML report' });
    }
  }, [config, markdownContent, classificationBanner, addToast]);

  const handleCopyMarkdown = useCallback(async () => {
    if (!config.template) {
      addToast({ type: 'warning', message: 'Select a report template first' });
      return;
    }
    try {
      await navigator.clipboard.writeText(markdownContent);
      setCopiedMd(true);
      addToast({ type: 'success', message: 'Markdown copied to clipboard' });
      setTimeout(() => setCopiedMd(false), 2000);
    } catch {
      addToast({ type: 'error', message: 'Failed to copy to clipboard' });
    }
  }, [config.template, markdownContent, addToast]);

  // ── Preview sections renderer ──────────────────────────────────

  const renderPreviewSection = (id: string, title: string, content: React.ReactNode) => {
    if (collapsedSections.has(id)) {
      return (
        <div key={id} className="border border-[var(--grok-border)] rounded mb-3 overflow-hidden">
          <button
            onClick={() => toggleCollapsed(id)}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-[var(--grok-surface-2)] hover:bg-[var(--grok-surface-3)] transition-colors"
            aria-expanded={false}
          >
            <span className="text-xs font-semibold text-[var(--grok-text-muted)] uppercase tracking-widest">{title}</span>
            <ChevronRight className="w-4 h-4 text-[var(--grok-text-muted)]" />
          </button>
        </div>
      );
    }
    return (
      <div key={id} className="border border-[var(--grok-border)] rounded mb-3 overflow-hidden">
        <button
          onClick={() => toggleCollapsed(id)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-[var(--grok-surface-2)] hover:bg-[var(--grok-surface-3)] transition-colors"
          aria-expanded={true}
        >
          <span className="text-xs font-semibold text-[var(--grok-text-muted)] uppercase tracking-widest">{title}</span>
          <ChevronDown className="w-4 h-4 text-[var(--grok-text-muted)]" />
        </button>
        <div className="p-4 bg-[var(--grok-surface-1)] animate-fade-in">
          {content}
        </div>
      </div>
    );
  };

  const hasTemplate = config.template !== null;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[var(--grok-void)]">
      {/* ── Header ── */}
      <div className="flex-none px-5 py-4 border-b border-[var(--grok-border)] bg-[var(--grok-surface-1)]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-[var(--grok-text-heading)] flex items-center gap-2">
              <FileText className="w-5 h-5 text-[var(--grok-recon-blue)]" />
              Report Generator
            </h1>
            {loadingScanData && (
              <span className="flex items-center gap-1.5 text-xs text-[var(--grok-text-muted)]">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading scan data...
              </span>
            )}
          </div>
          {/* Export actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyMarkdown}
              disabled={!hasTemplate}
              className="cs-btn flex items-center gap-1.5"
              aria-label="Copy markdown"
            >
              {copiedMd ? <Check className="w-3.5 h-3.5 text-[var(--grok-loot-green)]" /> : <Clipboard className="w-3.5 h-3.5" />}
              {copiedMd ? 'Copied' : 'Copy MD'}
            </button>

            <button
              onClick={handleExportHtml}
              disabled={!hasTemplate || exportStatus === 'generating'}
              className="cs-btn flex items-center gap-1.5"
              aria-label="Export HTML"
            >
              <Download className="w-3.5 h-3.5" />
              Export HTML
            </button>

            <button
              onClick={handleGeneratePdf}
              disabled={!hasTemplate || exportStatus === 'generating'}
              className="cs-btn cs-btn-primary flex items-center gap-1.5"
              aria-label="Generate PDF via print"
            >
              {exportStatus === 'generating'
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : exportStatus === 'done'
                  ? <Check className="w-3.5 h-3.5" />
                  : <Printer className="w-3.5 h-3.5" />}
              {exportStatus === 'generating' ? 'Generating...' : 'Generate PDF'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Body: 3-column layout ── */}
      <div className="flex-1 overflow-hidden flex gap-0">

        {/* ── Left: Template selection ── */}
        <div className="w-72 flex-none border-r border-[var(--grok-border)] overflow-y-auto p-4 space-y-3 bg-[var(--grok-surface-1)]">
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--grok-text-muted)] mb-3">
            Report Template
          </p>
          {TEMPLATES.map((tpl) => {
            const active = config.template === tpl.id;
            return (
              <button
                key={tpl.id}
                onClick={() => selectTemplate(tpl.id)}
                className={cn(
                  'w-full text-left p-3 rounded-lg border transition-all',
                  active
                    ? 'border-[var(--grok-recon-blue)] bg-[var(--grok-recon-blue)]/10 glow-blue'
                    : 'border-[var(--grok-border)] bg-[var(--grok-surface-2)] hover:border-[var(--grok-border-glow)] hover:bg-[var(--grok-surface-3)]'
                )}
                aria-pressed={active}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    style={{ color: `var(${tpl.accentVar})` }}
                    className="mt-0.5 flex-none"
                  >
                    {tpl.icon}
                  </span>
                  <div className="min-w-0">
                    <p className={cn(
                      'text-sm font-semibold leading-tight',
                      active ? 'text-[var(--grok-text-heading)]' : 'text-[var(--grok-text-body)]'
                    )}>
                      {tpl.label}
                    </p>
                    <p className="text-xs text-[var(--grok-text-muted)] mt-1 leading-relaxed">
                      {tpl.description}
                    </p>
                    <p className="text-xs text-[var(--grok-text-muted)] mt-1.5">
                      ~{tpl.estimatedPages} pages
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Center: Configuration ── */}
        <div className="w-80 flex-none border-r border-[var(--grok-border)] overflow-y-auto p-4 bg-[var(--grok-surface-1)]">
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--grok-text-muted)] mb-4">
            Configuration
          </p>

          {/* Stats bar */}
          {hasTemplate && (
            <div className="grid grid-cols-2 gap-2 mb-4">
              {[
                { label: 'Critical', value: stats.critical, color: 'var(--grok-crit-red)' },
                { label: 'High',     value: stats.high,     color: 'var(--grok-exploit-red)' },
                { label: 'Medium',   value: stats.medium,   color: 'var(--grok-warning)' },
                { label: 'Open Ports', value: stats.openPorts, color: 'var(--grok-recon-blue)' },
              ].map((s) => (
                <div
                  key={s.label}
                  className="bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded p-2 text-center"
                >
                  <p className="text-lg font-bold font-mono" style={{ color: s.color }}>
                    {s.value}
                  </p>
                  <p className="text-xs text-[var(--grok-text-muted)]">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Targets */}
          <CollapsibleSection
            title="Targets"
            badge={config.selectedTargets.length}
          >
            {allTargets.length === 0 ? (
              <p className="text-xs text-[var(--grok-text-muted)] text-center py-2">
                No targets found. Run a scan first.
              </p>
            ) : (
              <div className="space-y-1.5">
                {allTargets.map((url) => {
                  const checked = config.selectedTargets.includes(url);
                  return (
                    <label
                      key={url}
                      className="flex items-center gap-2 cursor-pointer group"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTarget(url)}
                        className="accent-[var(--grok-recon-blue)] w-3.5 h-3.5"
                      />
                      <span className={cn(
                        'text-xs font-mono truncate transition-colors',
                        checked ? 'text-[var(--grok-text-body)]' : 'text-[var(--grok-text-muted)]'
                      )}>
                        {url}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </CollapsibleSection>

          {/* Date range */}
          <CollapsibleSection title="Date Range">
            <div className="space-y-2">
              <label className="block">
                <span className="text-xs text-[var(--grok-text-muted)] flex items-center gap-1.5 mb-1">
                  <Calendar className="w-3 h-3" />
                  From
                </span>
                <input
                  type="date"
                  value={config.dateFrom}
                  onChange={(e) => setConfig((prev) => ({ ...prev, dateFrom: e.target.value }))}
                  className="w-full bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded px-3 py-1.5 text-xs text-[var(--grok-text-body)] focus:outline-none focus:border-[var(--grok-recon-blue)]"
                />
              </label>
              <label className="block">
                <span className="text-xs text-[var(--grok-text-muted)] flex items-center gap-1.5 mb-1">
                  <Calendar className="w-3 h-3" />
                  To
                </span>
                <input
                  type="date"
                  value={config.dateTo}
                  onChange={(e) => setConfig((prev) => ({ ...prev, dateTo: e.target.value }))}
                  className="w-full bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded px-3 py-1.5 text-xs text-[var(--grok-text-body)] focus:outline-none focus:border-[var(--grok-recon-blue)]"
                />
              </label>
            </div>
          </CollapsibleSection>

          {/* Sections */}
          <CollapsibleSection title="Sections">
            <div className="space-y-2.5">
              {(Object.keys(config.sections) as Array<keyof ReportSections>).map((key) => (
                <ToggleSwitch
                  key={key}
                  checked={config.sections[key]}
                  onChange={() => toggleSection(key)}
                  label={SECTION_LABELS[key]}
                />
              ))}
            </div>
          </CollapsibleSection>

          {/* Classification */}
          <CollapsibleSection title="Classification">
            <div className="space-y-1.5">
              {(Object.keys(CLASSIFICATION_BANNERS) as ClassificationLevel[]).map((level) => {
                const active = config.classification === level;
                return (
                  <button
                    key={level}
                    onClick={() => setConfig((prev) => ({ ...prev, classification: level }))}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded border text-xs font-semibold transition-all flex items-center gap-2',
                      active
                        ? 'border-[var(--grok-recon-blue)] bg-[var(--grok-recon-blue)]/10'
                        : 'border-[var(--grok-border)] hover:border-[var(--grok-border-glow)]'
                    )}
                    aria-pressed={active}
                  >
                    <Lock className="w-3 h-3 flex-none text-[var(--grok-text-muted)]" />
                    <span className={cn('truncate', active ? 'text-[var(--grok-text-heading)]' : 'text-[var(--grok-text-muted)]')}>
                      {level}
                    </span>
                    {active && <Check className="w-3 h-3 ml-auto text-[var(--grok-recon-blue)] flex-none" />}
                  </button>
                );
              })}
            </div>
          </CollapsibleSection>

          {/* Analyst / Org */}
          <CollapsibleSection title="Report Details">
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-[var(--grok-text-muted)] flex items-center gap-1.5 mb-1">
                  <User className="w-3 h-3" />
                  Analyst Name
                </span>
                <input
                  type="text"
                  value={config.analystName}
                  onChange={(e) => setConfig((prev) => ({ ...prev, analystName: e.target.value }))}
                  placeholder="e.g. Jane Smith"
                  className="w-full bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded px-3 py-1.5 text-xs text-[var(--grok-text-body)] placeholder-[var(--grok-text-muted)] focus:outline-none focus:border-[var(--grok-recon-blue)]"
                />
              </label>
              <label className="block">
                <span className="text-xs text-[var(--grok-text-muted)] flex items-center gap-1.5 mb-1">
                  <Building2 className="w-3 h-3" />
                  Organization
                </span>
                <input
                  type="text"
                  value={config.organization}
                  onChange={(e) => setConfig((prev) => ({ ...prev, organization: e.target.value }))}
                  placeholder="e.g. Acme Corp"
                  className="w-full bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded px-3 py-1.5 text-xs text-[var(--grok-text-body)] placeholder-[var(--grok-text-muted)] focus:outline-none focus:border-[var(--grok-recon-blue)]"
                />
              </label>
              <div className="pt-1">
                <ToggleSwitch
                  checked={redactLoot}
                  onChange={setRedactLoot}
                  label="Redact passwords / hashes"
                />
              </div>
            </div>
          </CollapsibleSection>
        </div>

        {/* ── Right: Live preview ── */}
        <div className="flex-1 overflow-y-auto p-5 bg-[var(--grok-void)]">
          {!hasTemplate ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-4">
              <FileText className="w-12 h-12 text-[var(--grok-border-glow)]" />
              <p className="text-[var(--grok-text-muted)] text-sm">
                Select a report template to begin
              </p>
              <p className="text-[var(--grok-text-muted)] text-xs max-w-xs">
                Configure targets, sections, and classification, then export as PDF, HTML, or Markdown.
              </p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto">
              {/* Classification banner */}
              <div className={cn(
                'text-center text-xs font-bold tracking-widest py-1.5 rounded-t mb-0 uppercase',
                classificationBanner.bg,
                classificationBanner.text
              )}>
                {classificationBanner.label}
              </div>

              {/* Report header card */}
              <div className="bg-[var(--grok-surface-1)] border border-[var(--grok-border)] rounded-b rounded-t-none px-6 py-5 mb-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-[var(--grok-text-heading)]">
                      {TEMPLATES.find((t) => t.id === config.template)?.label}
                    </h2>
                    <p className="text-xs text-[var(--grok-text-muted)] mt-1">
                      Generated: {formatDateTime(Date.now())}
                    </p>
                  </div>
                  <div className="text-right text-xs text-[var(--grok-text-muted)] space-y-1">
                    {config.analystName && (
                      <p className="flex items-center gap-1.5 justify-end">
                        <User className="w-3 h-3" />
                        {config.analystName}
                      </p>
                    )}
                    {config.organization && (
                      <p className="flex items-center gap-1.5 justify-end">
                        <Building2 className="w-3 h-3" />
                        {config.organization}
                      </p>
                    )}
                    <p className="flex items-center gap-1.5 justify-end">
                      <Target className="w-3 h-3" />
                      {config.selectedTargets.length} target(s)
                    </p>
                  </div>
                </div>

                {/* Risk summary */}
                <div className="mt-4 grid grid-cols-4 gap-3">
                  {[
                    { icon: <AlertCircle className="w-4 h-4" />, label: 'Critical', value: stats.critical, color: 'var(--grok-crit-red)' },
                    { icon: <AlertTriangle className="w-4 h-4" />, label: 'High',  value: stats.high,     color: 'var(--grok-exploit-red)' },
                    { icon: <AlertTriangle className="w-4 h-4" />, label: 'Medium',value: stats.medium,   color: 'var(--grok-warning)' },
                    { icon: <Info className="w-4 h-4" />,          label: 'Low',   value: stats.low,      color: 'var(--grok-recon-blue)' },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="bg-[var(--grok-surface-2)] rounded border border-[var(--grok-border)] p-3 text-center"
                    >
                      <p
                        className="text-2xl font-bold font-mono"
                        style={{ color: s.color }}
                      >
                        {s.value}
                      </p>
                      <p className="text-xs text-[var(--grok-text-muted)] mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview sections */}

              {config.sections.executiveSummary && renderPreviewSection(
                'exec',
                '1. Executive Summary',
                <div className="text-sm text-[var(--grok-text-body)] leading-relaxed">
                  <p>
                    This {TEMPLATES.find((t) => t.id === config.template)?.label} was conducted against{' '}
                    <strong className="text-[var(--grok-text-heading)]">{config.selectedTargets.length || 0} target(s)</strong>{' '}
                    on behalf of{' '}
                    <strong className="text-[var(--grok-text-heading)]">
                      {config.organization || '[Organization]'}
                    </strong>.
                    The engagement identified{' '}
                    <strong className="text-[var(--grok-text-heading)]">{stats.totalVulns} vulnerabilities</strong>,
                    including{' '}
                    <span className="text-[var(--grok-crit-red)] font-semibold">{stats.critical} critical</span> and{' '}
                    <span className="text-[var(--grok-exploit-red)] font-semibold">{stats.high} high</span> severity findings.
                    The overall risk score is{' '}
                    <strong className="text-[var(--grok-text-heading)]">{stats.riskScore}</strong>.
                  </p>
                </div>
              )}

              {config.sections.methodology && renderPreviewSection(
                'method',
                '2. Methodology',
                <ul className="text-xs text-[var(--grok-text-body)] space-y-1.5">
                  {[
                    'Reconnaissance — Passive and active information gathering',
                    'Enumeration — Service and version identification, subdomain discovery',
                    'Vulnerability Scanning — Automated scanning with nuclei, nikto, ZAP',
                    'Exploitation — Controlled exploitation of confirmed findings',
                    'Post-Exploitation — Credential harvesting and lateral movement simulation',
                    'Reporting — Risk-rated findings with remediation guidance',
                  ].map((step) => (
                    <li key={step} className="flex items-start gap-2">
                      <ChevronRight className="w-3 h-3 mt-0.5 flex-none text-[var(--grok-recon-blue)]" />
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              )}

              {config.sections.findings && renderPreviewSection(
                'findings',
                `3. Findings`,
                stats.allVulns.length === 0 ? (
                  <p className="text-xs text-[var(--grok-text-muted)] italic">
                    No vulnerabilities found for selected targets.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[var(--grok-border)]">
                          {['#', 'Severity', 'Title', 'CVE', 'Target'].map((h) => (
                            <th key={h} className="text-left pb-2 pr-3 text-[var(--grok-text-muted)] font-semibold uppercase tracking-wider text-[10px]">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--grok-border)]">
                        {[...stats.allVulns]
                          .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99))
                          .slice(0, 15)
                          .map((v, i) => (
                            <tr key={v.id + i} className="text-[var(--grok-text-body)]">
                              <td className="py-1.5 pr-3 text-[var(--grok-text-muted)]">{i + 1}</td>
                              <td className="py-1.5 pr-3">
                                <SeverityBadge severity={v.severity} />
                              </td>
                              <td className="py-1.5 pr-3 font-mono max-w-[180px] truncate">{v.title}</td>
                              <td className="py-1.5 pr-3 text-[var(--grok-text-muted)] font-mono">{v.cve ?? '—'}</td>
                              <td className="py-1.5 text-[var(--grok-text-muted)] font-mono max-w-[120px] truncate">
                                {scanData.find((d) => d.results?.vulnerabilities.some((dv) => dv.id === v.id))?.target ?? '—'}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {stats.allVulns.length > 15 && (
                      <p className="text-xs text-[var(--grok-text-muted)] mt-2 text-right">
                        +{stats.allVulns.length - 15} more vulnerabilities in full export
                      </p>
                    )}
                  </div>
                )
              )}

              {config.sections.riskMatrix && renderPreviewSection(
                'risk',
                '4. Risk Matrix',
                <div className="overflow-x-auto">
                  <table className="text-xs w-full">
                    <thead>
                      <tr className="border-b border-[var(--grok-border)]">
                        <th className="text-left pb-2 pr-4 text-[var(--grok-text-muted)] font-semibold text-[10px] uppercase tracking-wider">
                          Likelihood \ Impact
                        </th>
                        {['Low', 'Medium', 'High', 'Critical'].map((impact) => (
                          <th key={impact} className="pb-2 pr-3 text-center text-[10px] uppercase tracking-wider font-semibold">
                            <SeverityBadge severity={impact.toLowerCase()} />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--grok-border)]">
                      {['High', 'Medium', 'Low'].map((likelihood) => (
                        <tr key={likelihood}>
                          <td className="py-2 pr-4 text-[var(--grok-text-muted)] font-semibold">{likelihood}</td>
                          {['low', 'medium', 'high', 'critical'].map((impact) => {
                            const count = stats.allVulns.filter((v) => v.severity === impact).length;
                            const sty = SEVERITY_STYLES[impact] ?? SEVERITY_STYLES.info;
                            return (
                              <td key={impact} className="py-2 pr-3 text-center">
                                {count > 0
                                  ? <span className={cn('font-bold font-mono', sty.text)}>{count}</span>
                                  : <span className="text-[var(--grok-border-glow)]">—</span>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {config.sections.remediation && renderPreviewSection(
                'remediation',
                '5. Remediation',
                (() => {
                  const urgent = stats.allVulns
                    .filter((v) => v.severity === 'critical' || v.severity === 'high')
                    .slice(0, 5);
                  return urgent.length === 0 ? (
                    <p className="text-xs text-[var(--grok-text-muted)] italic">
                      No critical or high severity findings.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {urgent.map((v, i) => (
                        <div
                          key={v.id + i}
                          className={cn(
                            'border-l-2 pl-3 py-1',
                            v.severity === 'critical' ? 'border-[var(--grok-crit-red)]' : 'border-[var(--grok-exploit-red)]'
                          )}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <SeverityBadge severity={v.severity} />
                            <span className="text-xs font-semibold text-[var(--grok-text-heading)] font-mono">{v.title}</span>
                          </div>
                          {v.cve && (
                            <p className="text-xs text-[var(--grok-text-muted)] font-mono mb-0.5">{v.cve}</p>
                          )}
                          <p className="text-xs text-[var(--grok-text-body)] leading-relaxed">
                            {v.description.slice(0, 200)}{v.description.length > 200 ? '…' : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  );
                })()
              )}

              {config.sections.evidence && renderPreviewSection(
                'evidence',
                '6. Evidence',
                <div className="space-y-4">
                  {/* Open ports */}
                  {stats.openPorts > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-[var(--grok-text-muted)] uppercase tracking-widest mb-2 flex items-center gap-1.5">
                        <Globe className="w-3 h-3" />
                        Open Ports ({stats.openPorts})
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-[var(--grok-border)]">
                              {['Target', 'Port', 'Proto', 'Service', 'Version'].map((h) => (
                                <th key={h} className="text-left pb-1.5 pr-3 text-[var(--grok-text-muted)] font-semibold text-[10px] uppercase tracking-wider">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--grok-border)]">
                            {stats.allPorts.slice(0, 10).map((p, i) => (
                              <tr key={`${p.target}-${p.port}-${i}`} className="text-[var(--grok-text-body)]">
                                <td className="py-1.5 pr-3 font-mono text-[var(--grok-text-muted)]">{p.target}</td>
                                <td className="py-1.5 pr-3 font-mono text-[var(--grok-loot-green)]">{p.port}</td>
                                <td className="py-1.5 pr-3 text-[var(--grok-text-muted)]">{p.protocol}</td>
                                <td className="py-1.5 pr-3">{p.service ?? '—'}</td>
                                <td className="py-1.5 text-[var(--grok-text-muted)] font-mono">{p.version ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Loot */}
                  {lootItems.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-[var(--grok-text-muted)] uppercase tracking-widest flex items-center gap-1.5">
                          <Key className="w-3 h-3" />
                          Captured Loot ({lootItems.length})
                        </p>
                        <ToggleSwitch
                          checked={redactLoot}
                          onChange={setRedactLoot}
                          label="Redact"
                        />
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-[var(--grok-border)]">
                              {['Category', 'Value', 'Target', 'Source'].map((h) => (
                                <th key={h} className="text-left pb-1.5 pr-3 text-[var(--grok-text-muted)] font-semibold text-[10px] uppercase tracking-wider">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--grok-border)]">
                            {lootItems.slice(0, 10).map((item) => {
                              const isSecret = item.category === 'password' || item.category === 'hash';
                              const displayValue = redactLoot && isSecret
                                ? '•'.repeat(Math.min(item.value.length, 12))
                                : item.value;
                              return (
                                <tr key={item.id} className="text-[var(--grok-text-body)]">
                                  <td className="py-1.5 pr-3">
                                    <span className="px-1.5 py-0.5 rounded bg-[var(--grok-loot-green)]/10 text-[var(--grok-loot-green)] text-[10px] font-semibold">
                                      {item.category}
                                    </span>
                                  </td>
                                  <td className="py-1.5 pr-3 font-mono max-w-[140px] truncate">{displayValue}</td>
                                  <td className="py-1.5 pr-3 text-[var(--grok-text-muted)] font-mono">{item.target}</td>
                                  <td className="py-1.5 text-[var(--grok-text-muted)]">{item.source}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {config.sections.appendix && renderPreviewSection(
                'appendix',
                '7. Appendix',
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-[var(--grok-text-muted)] uppercase tracking-widest mb-2 flex items-center gap-1.5">
                      <List className="w-3 h-3" />
                      Tools Used
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {(() => {
                        const tools = [...new Set(scanData.flatMap((d) => d.results?.toolsUsed ?? []))];
                        const display = tools.length > 0
                          ? tools
                          : ['nmap', 'subfinder', 'httpx', 'nuclei', 'nikto'];
                        return display.map((t) => (
                          <span
                            key={t}
                            className="px-2 py-0.5 rounded bg-[var(--grok-surface-2)] border border-[var(--grok-border)] text-xs font-mono text-[var(--grok-text-body)]"
                          >
                            {t}
                          </span>
                        ));
                      })()}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[var(--grok-text-muted)] uppercase tracking-widest mb-2 flex items-center gap-1.5">
                      <Target className="w-3 h-3" />
                      Scope
                    </p>
                    <div className="space-y-1">
                      {config.selectedTargets.length > 0
                        ? config.selectedTargets.map((t) => (
                            <p key={t} className="text-xs font-mono text-[var(--grok-text-body)]">
                              {t}
                            </p>
                          ))
                        : <p className="text-xs text-[var(--grok-text-muted)] italic">No targets selected</p>}
                    </div>
                  </div>
                  <p className="text-xs text-[var(--grok-text-muted)] italic leading-relaxed border-t border-[var(--grok-border)] pt-3">
                    This report was generated by CStrike v2 and is intended solely for the named organization.
                    Unauthorized distribution is prohibited. All findings reflect point-in-time testing.
                  </p>
                </div>
              )}

              {/* Footer classification banner */}
              <div className={cn(
                'text-center text-xs font-bold tracking-widest py-1.5 rounded mt-2 uppercase',
                classificationBanner.bg,
                classificationBanner.text
              )}>
                {classificationBanner.label}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
