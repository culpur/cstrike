/**
 * Evidence routes — per-target case folders with full raw tool output.
 * GET /api/v1/evidence/targets   — list targets with evidence counts
 * GET /api/v1/evidence/:targetId — full evidence timeline for a target
 */

import { Router } from 'express';
import { prisma } from '../config/database.js';

export const evidenceRouter = Router();

// List all targets that have evidence (ScanResult or ExploitTask records)
evidenceRouter.get('/targets', async (_req, res, next) => {
  try {
    // Get targets with scan result counts
    const scanCounts = await prisma.scanResult.groupBy({
      by: ['scanId'],
      _count: { id: true },
      _max: { createdAt: true },
    });

    // Map scanId → targetId via scans
    const scanIds = scanCounts.map((s) => s.scanId);
    const scans = scanIds.length > 0
      ? await prisma.scan.findMany({
          where: { id: { in: scanIds } },
          select: { id: true, targetId: true },
        })
      : [];

    const scanIdToTargetId = new Map(scans.map((s) => [s.id, s.targetId]));

    // Aggregate per target
    const targetMap = new Map<string, { scanResultCount: number; lastScanResult: Date | null }>();
    for (const sc of scanCounts) {
      const tid = scanIdToTargetId.get(sc.scanId);
      if (!tid) continue;
      const existing = targetMap.get(tid);
      if (existing) {
        existing.scanResultCount += sc._count.id;
        if (sc._max.createdAt && (!existing.lastScanResult || sc._max.createdAt > existing.lastScanResult)) {
          existing.lastScanResult = sc._max.createdAt;
        }
      } else {
        targetMap.set(tid, { scanResultCount: sc._count.id, lastScanResult: sc._max.createdAt });
      }
    }

    // Get exploit task counts per target
    const exploitCases = await prisma.exploitCase.findMany({
      where: { tasks: { some: {} } },
      select: {
        targetId: true,
        tasks: { select: { id: true, createdAt: true } },
      },
    });

    const exploitMap = new Map<string, { count: number; lastTask: Date | null }>();
    for (const ec of exploitCases) {
      const existing = exploitMap.get(ec.targetId);
      const taskDates = ec.tasks.map((t) => t.createdAt);
      const maxDate = taskDates.length > 0 ? new Date(Math.max(...taskDates.map((d) => d.getTime()))) : null;
      if (existing) {
        existing.count += ec.tasks.length;
        if (maxDate && (!existing.lastTask || maxDate > existing.lastTask)) {
          existing.lastTask = maxDate;
        }
      } else {
        exploitMap.set(ec.targetId, { count: ec.tasks.length, lastTask: maxDate });
      }
    }

    // Merge all target IDs
    const allTargetIds = new Set([...targetMap.keys(), ...exploitMap.keys()]);
    if (allTargetIds.size === 0) {
      return res.json({ success: true, data: { targets: [] }, timestamp: Date.now() });
    }

    // Fetch target details
    const targets = await prisma.target.findMany({
      where: { id: { in: [...allTargetIds] } },
      select: { id: true, hostname: true, url: true },
    });

    const result = targets.map((t) => {
      const sr = targetMap.get(t.id);
      const et = exploitMap.get(t.id);
      const lastScanResult = sr?.lastScanResult?.getTime() ?? 0;
      const lastExploitTask = et?.lastTask?.getTime() ?? 0;

      return {
        targetId: t.id,
        hostname: t.hostname ?? '',
        url: t.url,
        scanResultCount: sr?.scanResultCount ?? 0,
        exploitTaskCount: et?.count ?? 0,
        lastActivity: Math.max(lastScanResult, lastExploitTask),
      };
    });

    // Sort by last activity descending
    result.sort((a, b) => b.lastActivity - a.lastActivity);

    res.json({ success: true, data: { targets: result }, timestamp: Date.now() });
  } catch (err) {
    next(err);
  }
});

// Get full evidence timeline for a specific target
evidenceRouter.get('/:targetId', async (req, res, next) => {
  try {
    const { targetId } = req.params;

    // Fetch target info
    const target = await prisma.target.findUnique({
      where: { id: targetId },
      select: { id: true, hostname: true, url: true },
    });

    if (!target) {
      return res.status(404).json({ success: false, error: 'Target not found' });
    }

    // Fetch all scan results for this target (via Scan relation)
    const scanResults = await prisma.scanResult.findMany({
      where: { scan: { targetId } },
      include: { scan: { select: { id: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch all exploit tasks for this target (via ExploitCase relation)
    const exploitTasks = await prisma.exploitTask.findMany({
      where: { case: { targetId } },
      orderBy: { createdAt: 'desc' },
    });

    // Build unified evidence records
    const evidence: Array<{
      id: string;
      tool: string;
      type: 'scan' | 'exploit';
      phase: string;
      rawOutput: string;
      exitCode: number | null;
      duration: number | null;
      status: string;
      createdAt: number;
      scanId: string | null;
    }> = [];

    for (const sr of scanResults) {
      const data = sr.data as any ?? {};
      evidence.push({
        id: sr.id,
        tool: data.tool ?? sr.source ?? 'unknown',
        type: 'scan',
        phase: sr.resultType?.toLowerCase() ?? 'unknown',
        rawOutput: data.output ?? '',
        exitCode: data.exitCode ?? null,
        duration: data.duration ?? null,
        status: data.exitCode === 0 ? 'success' : data.exitCode != null ? 'error' : 'unknown',
        createdAt: sr.createdAt.getTime(),
        scanId: sr.scanId,
      });
    }

    for (const et of exploitTasks) {
      evidence.push({
        id: et.id,
        tool: et.tool,
        type: 'exploit',
        phase: et.phase?.toLowerCase() ?? 'exploitation',
        rawOutput: et.output ?? '',
        exitCode: et.exitCode ?? null,
        duration: et.duration ?? null,
        status: et.status?.toLowerCase() ?? 'unknown',
        createdAt: et.createdAt.getTime(),
        scanId: null,
      });
    }

    // Sort by createdAt descending (most recent first)
    evidence.sort((a, b) => b.createdAt - a.createdAt);

    res.json({
      success: true,
      data: {
        targetId: target.id,
        hostname: target.hostname ?? '',
        url: target.url,
        evidence,
        totalCount: evidence.length,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});
