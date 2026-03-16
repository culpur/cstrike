/**
 * Intelligence Engine — Analyzes recon findings and generates exploitation tasks.
 *
 * The brain of the automated pipeline. Queries loot/scan results for a target
 * and produces task recommendations with auto-run vs gated classification.
 *
 * v2: Smart dedup (URL normalization), false-positive filtering, per-tool caps,
 *     and parallel task group awareness.
 */

import { prisma } from '../config/database.js';
import type { CasePhase } from '@prisma/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskRecommendation {
  tool: string;
  target: string;         // resolved target (host:port or URL)
  phase: CasePhase;
  trigger: string;        // human-readable reason
  autoRun: boolean;       // true = run immediately, false = needs gate approval
  config: Record<string, unknown>;
  priority: number;       // 1 = highest
  parallelGroup?: string; // tools in the same group can run concurrently
}

interface PortFinding {
  port: number;
  service: string;
  source: string;
}

interface UrlFinding {
  url: string;
  source: string;
}

interface CredFinding {
  username: string;
  password: string;
  service: string;
  port?: number;
}

// ---------------------------------------------------------------------------
// URL Normalization & False-Positive Filtering
// ---------------------------------------------------------------------------

/** Normalize a URL for dedup purposes — strip query params, trailing slashes, fragments */
function normalizeUrlForDedup(url: string): string {
  try {
    const u = new URL(url);
    // Remove query string and fragment entirely for dedup
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    // Not a valid URL — just lowercase and strip trailing slashes
    return url.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
  }
}

/** Broader dedup key: tool + normalized URL base path (not exact URL) */
function dedupKey(tool: string, target: string): string {
  return `${tool}::${normalizeUrlForDedup(target)}`;
}

/**
 * False-positive URL patterns — these are NOT real attack surfaces.
 * Apache directory listing sort params, IIS FrontPage, OIDC well-known, etc.
 */
const FALSE_POSITIVE_URL_PATTERNS = [
  // Apache directory listing sort parameters
  /[?&]C=[NMSD];O=[AD]/i,
  /[?&]O=[AD];C=[NMSD]/i,
  /\?C=\w/i,
  // Apache icons directory (standard Apache assets)
  /\/icons\/(small\/)?[\w.-]+\.(gif|png|ico|svg)/i,
  // IIS FrontPage extensions (dead technology)
  /_vti_(bin|cnf|pvt|adm|log|txt|inf)/i,
  // OIDC / OAuth well-known endpoints (not exploitable via sqlmap)
  /\.(well-known|openid-configuration|oauth-authorization-server)/i,
  /\/\.well-known\//i,
  // Standard non-exploitable metadata files
  /\/(robots\.txt|sitemap\.xml|crossdomain\.xml|favicon\.ico|apple-touch-icon)/i,
  // CSS/JS/image/font assets
  /\.(css|js|woff2?|ttf|eot|otf|svg|png|jpg|jpeg|gif|ico|webp|avif|map)(\?.*)?$/i,
  // Wordpress feeds and standard XML
  /\/(feed|rss|atom|xmlrpc\.php$)/i,
];

/** Check if a URL is a known false positive that should be skipped */
function isFalsePositiveUrl(url: string): boolean {
  return FALSE_POSITIVE_URL_PATTERNS.some((re) => re.test(url));
}

/**
 * Per-tool caps: max number of unique targets a single tool should be tasked against.
 * Prevents sqlmap from running against 30 different URLs when 3-5 is sufficient.
 */
const TOOL_TARGET_CAPS: Record<string, number> = {
  sqlmap: 5,    // max 5 unique URLs for SQL injection
  ffuf: 3,      // max 3 directories to fuzz
  commix: 3,    // max 3 command injection targets
  nuclei: 2,    // max 2 nuclei scans (it scans broadly already)
  http_fetch: 10, // more permissive — fetching files is cheap
};

// ---------------------------------------------------------------------------
// Service-to-tool mapping — what to run when a service is discovered
// ---------------------------------------------------------------------------

const PORT_RULES: Array<{
  match: (p: PortFinding) => boolean;
  autoTasks: Array<{ tool: string; phase: CasePhase; group?: string; configFn: (p: PortFinding, baseTarget: string) => Record<string, unknown> }>;
  gatedTasks: Array<{ tool: string; phase: CasePhase; group?: string; configFn: (p: PortFinding, baseTarget: string) => Record<string, unknown> }>;
  triggerLabel: (p: PortFinding) => string;
}> = [
  // SSH
  {
    match: (p) => p.service === 'ssh' || p.port === 22 || p.port === 2222,
    autoTasks: [],
    gatedTasks: [
      { tool: 'hydra', phase: 'EXPLOITATION', group: 'brute', configFn: (p, _t) => ({ service: 'ssh', port: p.port }) },
    ],
    triggerLabel: (p) => `SSH on port ${p.port}`,
  },
  // FTP — browse anonymously first, then brute force if needed
  {
    match: (p) => p.service === 'ftp' || p.port === 21 || p.port === 2121 || p.port === 2123,
    autoTasks: [
      { tool: 'ftp_browse', phase: 'ENUMERATION', group: 'ftp_enum', configFn: (p, _t) => ({ port: p.port }) },
    ],
    gatedTasks: [
      { tool: 'ftp_upload', phase: 'EXPLOITATION', group: 'ftp_exploit', configFn: (p, _t) => ({ port: p.port }) },
      { tool: 'hydra', phase: 'EXPLOITATION', group: 'brute', configFn: (p, _t) => ({ service: 'ftp', port: p.port }) },
    ],
    triggerLabel: (p) => `FTP on port ${p.port}`,
  },
  // HTTP/HTTPS
  {
    match: (p) => p.service === 'http' || p.service === 'https' || [80, 443, 8080, 8443, 8888, 9090].includes(p.port),
    autoTasks: [
      { tool: 'gobuster', phase: 'ENUMERATION', group: 'http_enum', configFn: (p, t) => { let h: string; try { h = new URL(t).hostname; } catch { h = t.replace(/:\d+$/, ''); } const scheme = (p.port === 443 || p.port === 8443) ? 'https' : 'http'; return { targetUrl: `${scheme}://${h}:${p.port}` }; } },
      { tool: 'whatweb', phase: 'ENUMERATION', group: 'http_enum', configFn: (p, t) => { let h: string; try { h = new URL(t).hostname; } catch { h = t.replace(/:\d+$/, ''); } const scheme = (p.port === 443 || p.port === 8443) ? 'https' : 'http'; return { targetUrl: `${scheme}://${h}:${p.port}` }; } },
      { tool: 'nikto', phase: 'ENUMERATION', group: 'http_enum', configFn: (p, t) => { let h: string; try { h = new URL(t).hostname; } catch { h = t.replace(/:\d+$/, ''); } const scheme = (p.port === 443 || p.port === 8443) ? 'https' : 'http'; return { targetUrl: `${scheme}://${h}:${p.port}` }; } },
    ],
    gatedTasks: [
      { tool: 'nuclei', phase: 'EXPLOITATION', group: 'http_exploit', configFn: (p, t) => { let h: string; try { h = new URL(t).hostname; } catch { h = t.replace(/:\d+$/, ''); } const scheme = (p.port === 443 || p.port === 8443) ? 'https' : 'http'; return { targetUrl: `${scheme}://${h}:${p.port}` }; } },
      { tool: 'sqlmap', phase: 'EXPLOITATION', group: 'http_exploit', configFn: (p, t) => { let h: string; try { h = new URL(t).hostname; } catch { h = t.replace(/:\d+$/, ''); } const scheme = (p.port === 443 || p.port === 8443) ? 'https' : 'http'; return { targetUrl: `${scheme}://${h}:${p.port}` }; } },
    ],
    triggerLabel: (p) => `HTTP on port ${p.port}`,
  },
  // SMB
  {
    match: (p) => p.service === 'smb' || p.service === 'microsoft-ds' || p.service === 'netbios-ssn' || [445, 139, 4455].includes(p.port),
    autoTasks: [
      { tool: 'enum4linux', phase: 'ENUMERATION', group: 'smb_enum', configFn: () => ({}) },
      { tool: 'smbclient', phase: 'ENUMERATION', group: 'smb_enum', configFn: () => ({}) },
    ],
    gatedTasks: [],
    triggerLabel: (p) => `SMB on port ${p.port}`,
  },
  // MySQL/MariaDB
  {
    match: (p) => p.service === 'mysql' || [3306, 3307, 3308].includes(p.port),
    autoTasks: [],
    gatedTasks: [
      { tool: 'hydra', phase: 'EXPLOITATION', group: 'brute', configFn: (p, _t) => ({ service: 'mysql', port: p.port }) },
    ],
    triggerLabel: (p) => `MySQL on port ${p.port}`,
  },
  // SNMP
  {
    match: (p) => p.service === 'snmp' || p.port === 161 || p.port === 1161 || p.port === 1162,
    autoTasks: [
      { tool: 'snmpwalk', phase: 'ENUMERATION', group: 'snmp_enum', configFn: () => ({}) },
    ],
    gatedTasks: [],
    triggerLabel: (p) => `SNMP on port ${p.port}`,
  },
  // RDP
  {
    match: (p) => p.service === 'rdp' || p.service === 'ms-wbt-server' || p.port === 3389,
    autoTasks: [],
    gatedTasks: [
      { tool: 'hydra', phase: 'EXPLOITATION', group: 'brute', configFn: (p, _t) => ({ service: 'rdp', port: p.port }) },
    ],
    triggerLabel: (p) => `RDP on port ${p.port}`,
  },
];

const URL_RULES: Array<{
  match: (url: string) => boolean;
  autoTasks?: Array<{ tool: string; phase: CasePhase; configFn: (url: string) => Record<string, unknown> }>;
  gatedTasks: Array<{ tool: string; phase: CasePhase; configFn: (url: string) => Record<string, unknown> }>;
  triggerLabel: (url: string) => string;
}> = [
  // Login pages → SQL injection (require path-level match, not just substring)
  {
    match: (url) => /\/(login|signin|auth)(\/|$|\?)/i.test(url),
    gatedTasks: [
      { tool: 'sqlmap', phase: 'EXPLOITATION', configFn: (url) => ({ targetUrl: url, forms: true }) },
    ],
    triggerLabel: (url) => `Login page: ${url}`,
  },
  // Admin panels (require path-level match)
  {
    match: (url) => /\/(admin|dashboard|manage)(\/|$|\?)/i.test(url),
    gatedTasks: [
      { tool: 'sqlmap', phase: 'EXPLOITATION', configFn: (url) => ({ targetUrl: url, forms: true }) },
    ],
    triggerLabel: (url) => `Admin panel: ${url}`,
  },
  // Upload directories (require path-level match)
  {
    match: (url) => /\/(upload|uploads)(\/|$|\?)/i.test(url),
    gatedTasks: [
      { tool: 'ffuf', phase: 'EXPLOITATION', configFn: (url) => ({ targetUrl: url }) },
    ],
    triggerLabel: (url) => `Upload directory: ${url}`,
  },
  // API endpoints
  {
    match: (url) => /\/api\//i.test(url),
    gatedTasks: [
      { tool: 'ffuf', phase: 'EXPLOITATION', configFn: (url) => ({ targetUrl: url }) },
      { tool: 'commix', phase: 'EXPLOITATION', configFn: (url) => ({ targetUrl: url }) },
    ],
    triggerLabel: (url) => `API endpoint: ${url}`,
  },
  // Sensitive files — auto-fetch and parse for credentials
  {
    match: (url) => /\.(sql|bak|conf|old|orig|save|backup|dump|db|sqlite|csv|ini|pgpass|htpasswd|htaccess)(\?.*)?$/i.test(url)
      || /\/(\.env|\.git\/config|config\.php\.bak|wp-config\.php|\.htpasswd|backup\.sql|database\.|credentials|shadow|passwd|id_rsa)/i.test(url),
    autoTasks: [
      { tool: 'http_fetch', phase: 'ENUMERATION', configFn: (url) => ({ targetUrl: url }) },
    ],
    gatedTasks: [],
    triggerLabel: (url) => `Sensitive file: ${url}`,
  },
];

// ---------------------------------------------------------------------------
// Intelligence Engine
// ---------------------------------------------------------------------------

class IntelligenceEngine {
  /**
   * Analyze all findings for a target and generate task recommendations.
   * Called when a case is created and after each exploitation task completes.
   *
   * v2: Uses normalized URL dedup, false-positive filtering, and per-tool caps.
   */
  async analyzeFindings(
    caseId: string,
    targetId: string,
  ): Promise<TaskRecommendation[]> {
    const recommendations: TaskRecommendation[] = [];

    // Get target URL for constructing tool targets
    const target = await prisma.target.findUnique({ where: { id: targetId } });
    if (!target) return [];

    const baseTarget = target.url;

    // Get existing tasks — use NORMALIZED dedup keys to prevent URL variant dupes
    const existingTasks = await prisma.exploitTask.findMany({
      where: { caseId },
      select: { tool: true, target: true, config: true },
    });
    const existing = new Set(existingTasks.map((t) => dedupKey(t.tool, t.target)));

    // Track per-tool target counts for capping
    const toolTargetCounts = new Map<string, number>();
    for (const t of existingTasks) {
      toolTargetCounts.set(t.tool, (toolTargetCounts.get(t.tool) ?? 0) + 1);
    }

    // Also track recommendations we're adding THIS cycle to prevent intra-batch dupes
    const batchDedup = new Set<string>();

    // 1. Analyze port/service discoveries
    const portFindings = await this.getPortFindings(targetId);
    for (const pf of portFindings) {
      for (const rule of PORT_RULES) {
        if (!rule.match(pf)) continue;

        const trigger = `auto:${rule.triggerLabel(pf)}`;
        let priority = 5;

        // Auto-run enumeration tasks
        for (const task of rule.autoTasks) {
          const resolvedTarget = this.resolveTarget(baseTarget, pf);
          const dk = dedupKey(task.tool, resolvedTarget);
          if (existing.has(dk) || batchDedup.has(dk)) continue;
          if (this.isToolCapped(task.tool, toolTargetCounts)) continue;

          batchDedup.add(dk);
          toolTargetCounts.set(task.tool, (toolTargetCounts.get(task.tool) ?? 0) + 1);
          recommendations.push({
            tool: task.tool,
            target: resolvedTarget,
            phase: task.phase,
            trigger,
            autoRun: true,
            config: task.configFn(pf, baseTarget),
            priority: priority++,
            parallelGroup: (task as any).group,
          });
        }

        // Gated exploitation tasks
        for (const task of rule.gatedTasks) {
          const resolvedTarget = this.resolveTarget(baseTarget, pf);
          const dk = dedupKey(task.tool, resolvedTarget);
          if (existing.has(dk) || batchDedup.has(dk)) continue;
          if (this.isToolCapped(task.tool, toolTargetCounts)) continue;

          batchDedup.add(dk);
          toolTargetCounts.set(task.tool, (toolTargetCounts.get(task.tool) ?? 0) + 1);
          recommendations.push({
            tool: task.tool,
            target: resolvedTarget,
            phase: task.phase,
            trigger,
            autoRun: false,
            config: task.configFn(pf, baseTarget),
            priority: priority++,
            parallelGroup: (task as any).group,
          });
        }
      }
    }

    // 2. Analyze URL discoveries (with false-positive filtering)
    const urlFindings = await this.getUrlFindings(targetId);
    for (const uf of urlFindings) {
      // Skip false-positive URLs (Apache sort params, IIS FrontPage, etc.)
      if (isFalsePositiveUrl(uf.url)) continue;

      // Ensure URLs have a host — skip bare relative paths
      const resolvedUrl = this.ensureAbsoluteUrl(uf.url, baseTarget);
      if (!resolvedUrl) continue;

      for (const rule of URL_RULES) {
        if (!rule.match(resolvedUrl)) continue;

        const trigger = `auto:${rule.triggerLabel(resolvedUrl)}`;

        // Auto-run tasks (e.g., http_fetch for sensitive files)
        if (rule.autoTasks) {
          for (const task of rule.autoTasks) {
            const dk = dedupKey(task.tool, resolvedUrl);
            if (existing.has(dk) || batchDedup.has(dk)) continue;
            if (this.isToolCapped(task.tool, toolTargetCounts)) continue;

            batchDedup.add(dk);
            toolTargetCounts.set(task.tool, (toolTargetCounts.get(task.tool) ?? 0) + 1);
            recommendations.push({
              tool: task.tool,
              target: resolvedUrl,
              phase: task.phase,
              trigger,
              autoRun: true,
              config: task.configFn(resolvedUrl),
              priority: 3,
            });
          }
        }

        for (const task of rule.gatedTasks) {
          const dk = dedupKey(task.tool, resolvedUrl);
          if (existing.has(dk) || batchDedup.has(dk)) continue;
          if (this.isToolCapped(task.tool, toolTargetCounts)) continue;

          batchDedup.add(dk);
          toolTargetCounts.set(task.tool, (toolTargetCounts.get(task.tool) ?? 0) + 1);
          recommendations.push({
            tool: task.tool,
            target: resolvedUrl,
            phase: task.phase,
            trigger,
            autoRun: false,
            config: task.configFn(resolvedUrl),
            priority: 10,
          });
        }
      }
    }

    // 3. Note: Credential-based post-exploitation (SSH shells, privesc) is
    //    handled by Phase 5 postExploitService — no tasks generated here.

    // Sort by priority
    recommendations.sort((a, b) => a.priority - b.priority);
    return recommendations;
  }

  /**
   * Create ExploitTask rows from recommendations.
   * In full-auto mode, ALL tasks are auto-run (no gating).
   * In semi-auto mode, gated tasks require operator approval.
   */
  async materializeTasks(
    caseId: string,
    recommendations: TaskRecommendation[],
    operationMode?: string,
  ): Promise<{ autoTasks: string[]; gatedTasks: string[] }> {
    const isFullAuto = operationMode === 'full-auto';
    const autoTaskIds: string[] = [];
    const gatedTaskIds: string[] = [];

    for (const rec of recommendations) {
      const task = await prisma.exploitTask.create({
        data: {
          caseId,
          tool: rec.tool,
          target: rec.target,
          phase: rec.phase,
          status: 'QUEUED',
          trigger: rec.trigger,
          config: rec.config as any,
        },
      });

      // In full-auto, everything is auto-run — no gates
      if (rec.autoRun || isFullAuto) {
        autoTaskIds.push(task.id);
      } else {
        gatedTaskIds.push(task.id);
      }
    }

    // Only set PENDING_APPROVAL in non-full-auto modes
    if (gatedTaskIds.length > 0 && !isFullAuto) {
      const exploitCase = await prisma.exploitCase.findUnique({ where: { id: caseId } });
      if (exploitCase && exploitCase.gateStatus === 'NONE') {
        await prisma.exploitCase.update({
          where: { id: caseId },
          data: { gateStatus: 'PENDING_APPROVAL' },
        });
      }
    }

    return { autoTasks: autoTaskIds, gatedTasks: gatedTaskIds };
  }

  // ---------------------------------------------------------------------------
  // Data accessors
  // ---------------------------------------------------------------------------

  private async getPortFindings(targetId: string): Promise<PortFinding[]> {
    const lootItems = await prisma.lootItem.findMany({
      where: { targetId, category: 'PORT' },
    });

    return lootItems.map((item) => ({
      port: parseInt(item.value, 10),
      service: (item.metadata as any)?.service ?? 'unknown',
      source: item.source,
    }));
  }

  private async getUrlFindings(targetId: string): Promise<UrlFinding[]> {
    const lootItems = await prisma.lootItem.findMany({
      where: { targetId, category: 'URL' },
    });

    // Deduplicate by normalized URL — multiple sources may discover the same path
    const seen = new Set<string>();
    const results: UrlFinding[] = [];
    for (const item of lootItems) {
      const url = item.value.replace(/\]$/, ''); // gobuster sometimes appends ]
      const normalized = normalizeUrlForDedup(url);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      results.push({ url, source: item.source });
    }
    return results;
  }

  private async getCredentialFindings(targetId: string): Promise<CredFinding[]> {
    const creds = await prisma.credentialPair.findMany({
      where: { targetId, validationStatus: 'VALID' },
    });

    return creds.map((c) => ({
      username: c.username,
      password: c.password,
      service: c.service ?? 'unknown',
      port: c.port ?? undefined,
    }));
  }

  private resolveTarget(baseTarget: string, pf: PortFinding): string {
    try {
      const url = new URL(baseTarget);
      return `${url.hostname}:${pf.port}`;
    } catch {
      return `${baseTarget}:${pf.port}`;
    }
  }

  /** Check if a tool has hit its per-tool target cap */
  private isToolCapped(tool: string, counts: Map<string, number>): boolean {
    const cap = TOOL_TARGET_CAPS[tool];
    if (cap === undefined) return false; // no cap for this tool
    return (counts.get(tool) ?? 0) >= cap;
  }

  /** Ensure a URL is absolute — resolve relative paths against the base target */
  private ensureAbsoluteUrl(url: string, baseTarget: string): string | null {
    // Already absolute
    if (/^https?:\/\//i.test(url)) return url;

    // Relative path — resolve against base target
    try {
      const base = new URL(baseTarget);
      if (url.startsWith('/')) {
        return `${base.protocol}//${base.host}${url}`;
      }
      // Bare path — append to base
      const basePath = base.pathname.replace(/\/[^/]*$/, '/');
      return `${base.protocol}//${base.host}${basePath}${url}`;
    } catch {
      return null; // can't resolve
    }
  }
}

export const intelligenceEngine = new IntelligenceEngine();
