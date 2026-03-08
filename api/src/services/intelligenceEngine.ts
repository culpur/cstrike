/**
 * Intelligence Engine — Analyzes recon findings and generates exploitation tasks.
 *
 * The brain of the automated pipeline. Queries loot/scan results for a target
 * and produces task recommendations with auto-run vs gated classification.
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
// Service-to-tool mapping — what to run when a service is discovered
// ---------------------------------------------------------------------------

const PORT_RULES: Array<{
  match: (p: PortFinding) => boolean;
  autoTasks: Array<{ tool: string; phase: CasePhase; configFn: (p: PortFinding, baseTarget: string) => Record<string, unknown> }>;
  gatedTasks: Array<{ tool: string; phase: CasePhase; configFn: (p: PortFinding, baseTarget: string) => Record<string, unknown> }>;
  triggerLabel: (p: PortFinding) => string;
}> = [
  // SSH
  {
    match: (p) => p.service === 'ssh' || p.port === 22 || p.port === 2222,
    autoTasks: [],
    gatedTasks: [
      { tool: 'hydra', phase: 'EXPLOITATION', configFn: (p, _t) => ({ service: 'ssh', port: p.port }) },
    ],
    triggerLabel: (p) => `SSH on port ${p.port}`,
  },
  // FTP — browse anonymously first, then brute force if needed
  {
    match: (p) => p.service === 'ftp' || p.port === 21 || p.port === 2121 || p.port === 2123,
    autoTasks: [
      { tool: 'ftp_browse', phase: 'ENUMERATION', configFn: (p, _t) => ({ port: p.port }) },
    ],
    gatedTasks: [
      { tool: 'ftp_upload', phase: 'EXPLOITATION', configFn: (p, _t) => ({ port: p.port }) },
      { tool: 'hydra', phase: 'EXPLOITATION', configFn: (p, _t) => ({ service: 'ftp', port: p.port }) },
    ],
    triggerLabel: (p) => `FTP on port ${p.port}`,
  },
  // HTTP/HTTPS
  {
    match: (p) => p.service === 'http' || p.service === 'https' || [80, 443, 8080, 8443, 8888, 9090].includes(p.port),
    autoTasks: [
      { tool: 'gobuster', phase: 'ENUMERATION', configFn: (p, t) => ({ targetUrl: `http://${new URL(t).hostname}:${p.port}` }) },
      { tool: 'whatweb', phase: 'ENUMERATION', configFn: (p, t) => ({ targetUrl: `http://${new URL(t).hostname}:${p.port}` }) },
      { tool: 'nikto', phase: 'ENUMERATION', configFn: (p, t) => ({ targetUrl: `http://${new URL(t).hostname}:${p.port}` }) },
    ],
    gatedTasks: [
      { tool: 'nuclei', phase: 'EXPLOITATION', configFn: (p, t) => ({ targetUrl: `http://${new URL(t).hostname}:${p.port}` }) },
      { tool: 'sqlmap', phase: 'EXPLOITATION', configFn: (p, t) => ({ targetUrl: `http://${new URL(t).hostname}:${p.port}` }) },
    ],
    triggerLabel: (p) => `HTTP on port ${p.port}`,
  },
  // SMB
  {
    match: (p) => p.service === 'smb' || p.service === 'microsoft-ds' || p.service === 'netbios-ssn' || [445, 139, 4455].includes(p.port),
    autoTasks: [
      { tool: 'enum4linux', phase: 'ENUMERATION', configFn: () => ({}) },
      { tool: 'smbclient', phase: 'ENUMERATION', configFn: () => ({}) },
    ],
    gatedTasks: [],
    triggerLabel: (p) => `SMB on port ${p.port}`,
  },
  // MySQL/MariaDB
  {
    match: (p) => p.service === 'mysql' || [3306, 3307, 3308].includes(p.port),
    autoTasks: [],
    gatedTasks: [
      { tool: 'hydra', phase: 'EXPLOITATION', configFn: (p, _t) => ({ service: 'mysql', port: p.port }) },
    ],
    triggerLabel: (p) => `MySQL on port ${p.port}`,
  },
  // SNMP
  {
    match: (p) => p.service === 'snmp' || p.port === 161 || p.port === 1161 || p.port === 1162,
    autoTasks: [
      { tool: 'snmpwalk', phase: 'ENUMERATION', configFn: () => ({}) },
    ],
    gatedTasks: [],
    triggerLabel: (p) => `SNMP on port ${p.port}`,
  },
  // RDP
  {
    match: (p) => p.service === 'rdp' || p.service === 'ms-wbt-server' || p.port === 3389,
    autoTasks: [],
    gatedTasks: [
      { tool: 'hydra', phase: 'EXPLOITATION', configFn: (p, _t) => ({ service: 'rdp', port: p.port }) },
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
  // Login pages → SQL injection
  {
    match: (url) => /login|signin|auth/i.test(url),
    gatedTasks: [
      { tool: 'sqlmap', phase: 'EXPLOITATION', configFn: (url) => ({ targetUrl: url, forms: true }) },
    ],
    triggerLabel: (url) => `Login page: ${url}`,
  },
  // Admin panels
  {
    match: (url) => /admin|dashboard|manage/i.test(url),
    gatedTasks: [
      { tool: 'sqlmap', phase: 'EXPLOITATION', configFn: (url) => ({ targetUrl: url, forms: true }) },
    ],
    triggerLabel: (url) => `Admin panel: ${url}`,
  },
  // Upload directories
  {
    match: (url) => /upload/i.test(url),
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

    // Get existing tasks to avoid duplicates
    const existingTasks = await prisma.exploitTask.findMany({
      where: { caseId },
      select: { tool: true, target: true, config: true },
    });
    const existingKey = (tool: string, tgt: string) => `${tool}::${tgt}`;
    const existing = new Set(existingTasks.map((t) => existingKey(t.tool, t.target)));

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
          if (existing.has(existingKey(task.tool, resolvedTarget))) continue;

          recommendations.push({
            tool: task.tool,
            target: resolvedTarget,
            phase: task.phase,
            trigger,
            autoRun: true,
            config: task.configFn(pf, baseTarget),
            priority: priority++,
          });
        }

        // Gated exploitation tasks
        for (const task of rule.gatedTasks) {
          const resolvedTarget = this.resolveTarget(baseTarget, pf);
          if (existing.has(existingKey(task.tool, resolvedTarget))) continue;

          recommendations.push({
            tool: task.tool,
            target: resolvedTarget,
            phase: task.phase,
            trigger,
            autoRun: false,
            config: task.configFn(pf, baseTarget),
            priority: priority++,
          });
        }
      }
    }

    // 2. Analyze URL discoveries
    const urlFindings = await this.getUrlFindings(targetId);
    for (const uf of urlFindings) {
      for (const rule of URL_RULES) {
        if (!rule.match(uf.url)) continue;

        const trigger = `auto:${rule.triggerLabel(uf.url)}`;

        // Auto-run tasks (e.g., http_fetch for sensitive files)
        if (rule.autoTasks) {
          for (const task of rule.autoTasks) {
            if (existing.has(existingKey(task.tool, uf.url))) continue;

            recommendations.push({
              tool: task.tool,
              target: uf.url,
              phase: task.phase,
              trigger,
              autoRun: true,
              config: task.configFn(uf.url),
              priority: 3,
            });
          }
        }

        for (const task of rule.gatedTasks) {
          if (existing.has(existingKey(task.tool, uf.url))) continue;

          recommendations.push({
            tool: task.tool,
            target: uf.url,
            phase: task.phase,
            trigger,
            autoRun: false,
            config: task.configFn(uf.url),
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

    return lootItems.map((item) => ({
      url: item.value.replace(/\]$/, ''), // gobuster sometimes appends ]
      source: item.source,
    }));
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
}

export const intelligenceEngine = new IntelligenceEngine();
