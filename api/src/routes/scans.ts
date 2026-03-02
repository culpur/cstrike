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
          { status: { in: ['QUEUED', 'RUNNING'] } },
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

// Cancel/delete scan
scansRouter.delete('/scans/:scanId', async (req, res, next) => {
  try {
    const { scanId } = req.params;

    const scan = await prisma.scan.findUnique({ where: { id: scanId } });
    if (!scan) throw new AppError(404, 'Scan not found');

    if (scan.status === 'RUNNING') {
      scanOrchestrator.cancelScan(scanId);
    }

    await prisma.scan.update({
      where: { id: scanId },
      data: { status: 'CANCELLED', endedAt: new Date() },
    });

    res.json({
      success: true,
      data: { scan_id: scanId, status: 'cancelled' },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});
