/**
 * Scan Context Service — persistent per-target context documents.
 *
 * Aggregates findings, execution state, AI reasoning, and exploit progress
 * into a single ScanContext record per target. This enables:
 *  - Pause/resume: serialise in-memory loop state to DB
 *  - Cross-scan context: AI prompts include historical findings
 *  - Crash recovery: execution state survives service restarts
 */

import { prisma } from '../config/database.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ExecutionState {
  scanId: string;
  iteration: number;
  consecutiveSkips: number;
  gateHit: boolean;
  mode: string;
  /** Tool names that have been run — authoritative copy rebuilt from ScanResult on resume */
  toolsRun: string[];
  /** VPN rotation checkpoint data for pause/resume */
  vpnRotation?: unknown;
}

interface FindingsSummary {
  openPorts: Array<{ port: number; service: string; version?: string }>;
  urls: string[];
  credentials: Array<{ username: string; service?: string }>;
  vulnerabilities: Array<{ title: string; severity: string }>;
  technologies: string[];
  totalLoot: number;
}

// ── Service ─────────────────────────────────────────────────────────────────

class ScanContextService {
  /**
   * Get or create a ScanContext for a target.
   */
  async getOrCreate(targetId: string) {
    return prisma.scanContext.upsert({
      where: { targetId },
      update: {},
      create: { targetId },
    });
  }

  /**
   * Save the current execution state so the scan can be resumed later.
   */
  async saveExecutionState(targetId: string, scanId: string, state: ExecutionState): Promise<void> {
    await prisma.scanContext.upsert({
      where: { targetId },
      update: {
        scanId,
        executionState: state as any,
      },
      create: {
        targetId,
        scanId,
        executionState: state as any,
      },
    });
  }

  /**
   * Load execution state for resume.  Returns null if no saved state exists.
   */
  async loadExecutionState(targetId: string): Promise<ExecutionState | null> {
    const ctx = await prisma.scanContext.findUnique({ where: { targetId } });
    if (!ctx || !ctx.executionState || typeof ctx.executionState !== 'object') return null;
    const state = ctx.executionState as Record<string, unknown>;
    if (!state.scanId) return null;
    return state as unknown as ExecutionState;
  }

  /**
   * Refresh the findings summary from LootItem + ScanResult for this target.
   * Produces a condensed JSON < 4 KB suitable for AI prompt inclusion.
   */
  async refreshFindingsSummary(targetId: string): Promise<FindingsSummary> {
    // Open ports from ScanResult
    const portResults = await prisma.scanResult.findMany({
      where: {
        scan: { targetId },
        resultType: 'PORT_SCAN',
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const openPorts: FindingsSummary['openPorts'] = [];
    const seenPorts = new Set<number>();
    for (const r of portResults) {
      const data = r.data as Record<string, any>;
      const output = String(data?.output || '');
      const portRe = /^(\d+)\/(tcp|udp)\s+open\s+(\S+)\s*(.*)/gm;
      let match;
      while ((match = portRe.exec(output)) !== null) {
        const port = parseInt(match[1], 10);
        if (!seenPorts.has(port)) {
          seenPorts.add(port);
          openPorts.push({ port, service: match[3], version: match[4]?.trim() || undefined });
        }
      }
    }

    // URLs from loot
    const urlLoot = await prisma.lootItem.findMany({
      where: { targetId, category: 'URL' },
      take: 20,
      orderBy: { createdAt: 'desc' },
    });
    const urls = urlLoot.map((l) => l.value);

    // Credentials
    const creds = await prisma.credentialPair.findMany({
      where: { targetId },
      take: 20,
      orderBy: { createdAt: 'desc' },
    });
    const credentials = creds.map((c) => ({
      username: c.username,
      service: c.service || undefined,
    }));

    // Vulnerabilities from ScanResult
    const vulnResults = await prisma.scanResult.findMany({
      where: {
        scan: { targetId },
        resultType: 'VULNERABILITY',
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
    });
    const vulnerabilities: FindingsSummary['vulnerabilities'] = [];
    for (const r of vulnResults) {
      const data = r.data as Record<string, any>;
      vulnerabilities.push({
        title: data?.tool || r.source || 'unknown',
        severity: r.severity?.toLowerCase() || 'info',
      });
    }

    // Technologies
    const techResults = await prisma.scanResult.findMany({
      where: {
        scan: { targetId },
        resultType: 'TECHNOLOGY',
      },
      take: 10,
      orderBy: { createdAt: 'desc' },
    });
    const technologies: string[] = [];
    for (const r of techResults) {
      const data = r.data as Record<string, any>;
      const output = String(data?.output || '');
      // Extract bracketed tech names from whatweb output
      const techRe = /\b([A-Za-z][A-Za-z0-9_.+-]+)\[([^\]]*)\]/g;
      let m;
      while ((m = techRe.exec(output)) !== null) {
        const name = `${m[1]}${m[2] ? ` ${m[2]}` : ''}`;
        if (!technologies.includes(name)) technologies.push(name);
      }
    }

    // Total loot count
    const totalLoot = await prisma.lootItem.count({ where: { targetId } });

    const summary: FindingsSummary = {
      openPorts: openPorts.slice(0, 30),
      urls: urls.slice(0, 15),
      credentials: credentials.slice(0, 15),
      vulnerabilities: vulnerabilities.slice(0, 15),
      technologies: technologies.slice(0, 10),
      totalLoot,
    };

    // Persist
    await prisma.scanContext.upsert({
      where: { targetId },
      update: { findingsSummary: summary as any },
      create: { targetId, findingsSummary: summary as any },
    });

    return summary;
  }

  /**
   * Condense recent AI reasoning into a short summary from AIThought records.
   */
  async refreshAIReasoningSummary(targetId: string, scanId?: string): Promise<string> {
    const whereClause: any = {
      thoughtType: { in: ['AI_DECISION', 'OBSERVATION', 'DECISION'] },
    };
    if (scanId) {
      whereClause.scanId = scanId;
    } else {
      // Get thoughts from scans belonging to this target
      const scans = await prisma.scan.findMany({
        where: { targetId },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      whereClause.scanId = { in: scans.map((s) => s.id) };
    }

    const thoughts = await prisma.aIThought.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (thoughts.length === 0) return '';

    const bullets = thoughts
      .reverse()
      .map((t) => `- [${t.thoughtType}] ${t.content.substring(0, 200)}`)
      .join('\n');

    const summary = `AI reasoning (${thoughts.length} recent decisions):\n${bullets}`;

    // Persist
    await prisma.scanContext.upsert({
      where: { targetId },
      update: { aiReasoningSummary: summary },
      create: { targetId, aiReasoningSummary: summary },
    });

    return summary;
  }

  /**
   * Snapshot exploit cases and tasks for this target.
   */
  async refreshExploitSnapshot(targetId: string): Promise<void> {
    const cases = await prisma.exploitCase.findMany({
      where: { targetId },
      include: {
        tasks: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const snapshot = cases.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      phase: c.currentPhase,
      tasks: c.tasks.map((t) => ({
        tool: t.tool,
        target: t.target,
        status: t.status,
        findings: Array.isArray(t.findings) ? (t.findings as any[]).length : 0,
      })),
    }));

    await prisma.scanContext.upsert({
      where: { targetId },
      update: { exploitSnapshot: snapshot as any },
      create: { targetId, exploitSnapshot: snapshot as any },
    });
  }

  /**
   * Build a formatted context block for inclusion in AI prompts.
   * Returns empty string if no historical context exists.
   */
  async getContextForAIPrompt(targetId: string, excludeScanId?: string): Promise<string> {
    const ctx = await prisma.scanContext.findUnique({ where: { targetId } });
    if (!ctx) return '';

    const sections: string[] = [];

    // Findings summary
    const findings = ctx.findingsSummary as unknown as FindingsSummary | null;
    if (findings && typeof findings === 'object') {
      const parts: string[] = [];
      if (findings.openPorts?.length > 0) {
        parts.push(`Open ports: ${findings.openPorts.map((p) => `${p.port}/${p.service}`).join(', ')}`);
      }
      if (findings.credentials?.length > 0) {
        parts.push(`Known credentials: ${findings.credentials.map((c) => `${c.username}${c.service ? `@${c.service}` : ''}`).join(', ')}`);
      }
      if (findings.vulnerabilities?.length > 0) {
        parts.push(`Vulnerabilities: ${findings.vulnerabilities.map((v) => `${v.title} (${v.severity})`).join(', ')}`);
      }
      if (findings.technologies?.length > 0) {
        parts.push(`Technologies: ${findings.technologies.join(', ')}`);
      }
      if (parts.length > 0) {
        sections.push(`Previous findings:\n${parts.join('\n')}`);
      }
    }

    // AI reasoning
    if (ctx.aiReasoningSummary && ctx.aiReasoningSummary.length > 0) {
      sections.push(ctx.aiReasoningSummary);
    }

    // Exploit snapshot
    const exploits = ctx.exploitSnapshot as unknown as Array<{ name: string; status: string; tasks: Array<{ tool: string; status: string }> }> | null;
    if (exploits && Array.isArray(exploits) && exploits.length > 0) {
      const lines = exploits.map((c) => {
        const completed = c.tasks.filter((t) => t.status === 'COMPLETED').length;
        return `  ${c.name} (${c.status}): ${completed}/${c.tasks.length} tasks completed`;
      });
      sections.push(`Exploitation history:\n${lines.join('\n')}`);
    }

    if (sections.length === 0) return '';

    return sections.join('\n\n');
  }

  /**
   * Clear the active scan reference when a scan completes.
   */
  async clearActiveScan(targetId: string): Promise<void> {
    await prisma.scanContext.update({
      where: { targetId },
      data: {
        scanId: null,
        executionState: {} as any,
      },
    }).catch(() => {});
  }
}

export const scanContextService = new ScanContextService();
