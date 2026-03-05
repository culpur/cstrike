/**
 * Scan (recon) routes — start, monitor, and manage scans.
 * POST   /api/v1/recon/start
 * GET    /api/v1/recon/status/:scanId
 * GET    /api/v1/recon/active
 * POST   /api/v1/recon/batch
 * DELETE /api/v1/recon/scans/:scanId
 */

import { Router } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { validateTargetScope } from '../middleware/guardrails.js';
import { scanOrchestrator } from '../services/scanOrchestrator.js';

export const scansRouter = Router();

// Start a scan
scansRouter.post('/start', async (req, res, next) => {
  try {
    const { target, tools, mode } = req.body as {
      target: string;
      tools?: string[];
      mode?: string;
    };

    if (!target) throw new AppError(400, 'target is required');

    await validateTargetScope(target);

    // Upsert target record
    const normalizedUrl = target.startsWith('http') ? target : `https://${target}`;
    const targetRecord = await prisma.target.upsert({
      where: { url: normalizedUrl },
      update: { status: 'SCANNING' },
      create: {
        url: normalizedUrl,
        hostname: (() => { try { return new URL(normalizedUrl).hostname; } catch { return target; } })(),
        status: 'SCANNING',
      },
    });

    // Create scan record
    const scan = await prisma.scan.create({
      data: {
        targetId: targetRecord.id,
        status: 'QUEUED',
        mode: mode ?? 'full',
        tools: tools ?? [],
      },
    });

    // Start scan in background
    scanOrchestrator.startScan(scan.id, target, tools, mode);

    res.status(201).json({
      success: true,
      data: {
        scan_id: scan.id,
        target,
        status: 'queued',
        tools: scan.tools,
        mode: scan.mode,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// Get scan status
scansRouter.get('/status/:scanId', async (req, res, next) => {
  try {
    const scan = await prisma.scan.findUnique({
      where: { id: req.params.scanId },
      include: {
        target: true,
        _count: { select: { results: true, logEntries: true } },
      },
    });

    if (!scan) throw new AppError(404, 'Scan not found');

    res.json({
      success: true,
      data: {
        scan_id: scan.id,
        target: scan.target.url,
        status: scan.status.toLowerCase(),
        phase: scan.phase.toLowerCase(),
        progress: scan.progress,
        tools: scan.tools,
        results_count: scan._count.results,
        started_at: scan.startedAt?.getTime(),
        ended_at: scan.endedAt?.getTime(),
        error: scan.error,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// Get active scans (includes recently completed within last 5 minutes)
scansRouter.get('/active', async (_req, res, next) => {
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

    const scans = await prisma.scan.findMany({
      where: {
        OR: [
          { status: { in: ['QUEUED', 'RUNNING', 'PAUSED'] } },
          { status: { in: ['COMPLETED', 'FAILED', 'CANCELLED'] }, endedAt: { gte: fiveMinAgo } },
        ],
      },
      include: { target: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: scans.map((s) => ({
        scan_id: s.id,
        target: s.target.url,
        tools: s.tools,
        status: s.status.toLowerCase(),
        current_phase: s.phase.toLowerCase(),
        phase: s.phase.toLowerCase(),
        progress: s.progress,
        started_at: s.startedAt?.getTime(),
        ended_at: s.endedAt?.getTime(),
      })),
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// Batch scan
scansRouter.post('/batch', async (req, res, next) => {
  try {
    const { targets, tools, mode } = req.body as {
      targets: string[];
      tools?: string[];
      mode?: string;
    };

    if (!targets?.length) throw new AppError(400, 'targets array is required');

    const results = [];
    for (const target of targets) {
      await validateTargetScope(target);

      const normalizedUrl = target.startsWith('http') ? target : `https://${target}`;
      const targetRecord = await prisma.target.upsert({
        where: { url: normalizedUrl },
        update: { status: 'SCANNING' },
        create: {
          url: normalizedUrl,
          hostname: (() => { try { return new URL(normalizedUrl).hostname; } catch { return target; } })(),
          status: 'SCANNING',
        },
      });

      const scan = await prisma.scan.create({
        data: {
          targetId: targetRecord.id,
          status: 'QUEUED',
          mode: mode ?? 'full',
          tools: tools ?? [],
        },
      });

      scanOrchestrator.startScan(scan.id, target, tools, mode);
      results.push({ scan_id: scan.id, target });
    }

    res.status(201).json({
      success: true,
      data: { scans: results, count: results.length },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// Pause a running scan
scansRouter.post('/:scanId/pause', async (req, res, next) => {
  try {
    const { scanId } = req.params;
    const scan = await prisma.scan.findUnique({ where: { id: scanId } });
    if (!scan) throw new AppError(404, 'Scan not found');
    if (scan.status !== 'RUNNING') throw new AppError(400, `Cannot pause — scan status is ${scan.status}`);

    scanOrchestrator.pauseScan(scanId);

    res.json({
      success: true,
      data: { scan_id: scanId, status: 'pausing' },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// Resume a paused scan
scansRouter.post('/:scanId/resume', async (req, res, next) => {
  try {
    const { scanId } = req.params;
    await scanOrchestrator.resumeScan(scanId);

    res.json({
      success: true,
      data: { scan_id: scanId, status: 'resuming' },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// Get scan context for a target
scansRouter.get('/context/:targetId', async (req, res, next) => {
  try {
    const { targetId } = req.params;
    const ctx = await prisma.scanContext.findUnique({ where: { targetId } });
    if (!ctx) throw new AppError(404, 'No context found for this target');

    res.json({
      success: true,
      data: ctx,
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// Cancel/delete scan
scansRouter.delete('/scans/:scanId', async (req, res, next) => {
  try {
    const { scanId } = req.params;

    const scan = await prisma.scan.findUnique({ where: { id: scanId } });
    if (!scan) throw new AppError(404, 'Scan not found');

    if (scan.status === 'RUNNING' || scan.status === 'QUEUED') {
      scanOrchestrator.cancelScan(scanId);
    }

    await prisma.scan.update({
      where: { id: scanId },
      data: { status: 'CANCELLED', endedAt: new Date() },
    });

    // Also update target status back to PENDING (if no other active scans exist)
    const otherActiveScans = await prisma.scan.count({
      where: {
        targetId: scan.targetId,
        id: { not: scanId },
        status: { in: ['QUEUED', 'RUNNING'] },
      },
    });
    if (otherActiveScans === 0) {
      await prisma.target.update({
        where: { id: scan.targetId },
        data: { status: 'PENDING' },
      }).catch(() => {});
    }

    res.json({
      success: true,
      data: { scan_id: scanId, status: 'cancelled' },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});
