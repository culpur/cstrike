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
import { tracerouteService } from '../services/tracerouteService.js';

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

    // Check if target is an existing target ID first
    let targetRecord = await prisma.target.findUnique({ where: { id: target } });
    if (targetRecord) {
      // Existing target found by ID — mark as scanning
      await prisma.target.update({ where: { id: target }, data: { status: 'SCANNING' } });
    } else {
      // Treat as URL/hostname/IP — validate scope and upsert as-given
      await validateTargetScope(target);
      const targetValue = target.trim();
      let hostname: string;
      try { hostname = new URL(targetValue).hostname; } catch { hostname = targetValue.replace(/:\d+$/, ''); }
      targetRecord = await prisma.target.upsert({
        where: { url: targetValue },
        update: { status: 'SCANNING' },
        create: {
          url: targetValue,
          hostname,
          status: 'SCANNING',
        },
      });
    }

    // Create scan record
    const scan = await prisma.scan.create({
      data: {
        targetId: targetRecord.id,
        status: 'QUEUED',
        mode: mode ?? 'full',
        tools: tools ?? [],
      },
    });

    // Start scan in background — always pass the resolved URL, not the raw input
    scanOrchestrator.startScan(scan.id, targetRecord.url, tools, mode);

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
      // Check if target is an existing target ID first
      let targetRecord = await prisma.target.findUnique({ where: { id: target } });
      if (targetRecord) {
        await prisma.target.update({ where: { id: target }, data: { status: 'SCANNING' } });
      } else {
        await validateTargetScope(target);
        const targetValue = target.trim();
        let batchHostname: string;
        try { batchHostname = new URL(targetValue).hostname; } catch { batchHostname = targetValue.replace(/:\d+$/, ''); }
        targetRecord = await prisma.target.upsert({
          where: { url: targetValue },
          update: { status: 'SCANNING' },
          create: {
            url: targetValue,
            hostname: batchHostname,
            status: 'SCANNING',
          },
        });
      }

      const scan = await prisma.scan.create({
        data: {
          targetId: targetRecord.id,
          status: 'QUEUED',
          mode: mode ?? 'full',
          tools: tools ?? [],
        },
      });

      scanOrchestrator.startScan(scan.id, targetRecord.url, tools, mode);
      results.push({ scan_id: scan.id, target: targetRecord.url });
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

// Cancel/delete scan — ?delete=true removes scan + all data from DB
scansRouter.delete('/scans/:scanId', async (req, res, next) => {
  try {
    const { scanId } = req.params;
    const shouldDelete = req.query.delete === 'true';

    const scan = await prisma.scan.findUnique({ where: { id: scanId } });
    if (!scan) throw new AppError(404, 'Scan not found');

    // Cancel if still running
    if (scan.status === 'RUNNING' || scan.status === 'QUEUED') {
      scanOrchestrator.cancelScan(scanId);
    }

    if (shouldDelete) {
      // Wait briefly for orchestrator to register cancellation
      if (scan.status === 'RUNNING' || scan.status === 'QUEUED') {
        await new Promise(r => setTimeout(r, 1000));
      }

      // Full delete — Prisma cascade removes ScanResult, LogEntry, AIThought
      await prisma.scan.delete({ where: { id: scanId } });

      // Reset target to PENDING if no other scans remain
      const otherScans = await prisma.scan.count({
        where: { targetId: scan.targetId },
      });
      if (otherScans === 0) {
        await prisma.target.update({
          where: { id: scan.targetId },
          data: { status: 'PENDING' },
        }).catch(() => {});
      }

      res.json({
        success: true,
        data: { scan_id: scanId, status: 'deleted' },
        timestamp: Date.now(),
      });
    } else {
      // Cancel only (existing behavior)
      await prisma.scan.update({
        where: { id: scanId },
        data: { status: 'CANCELLED', endedAt: new Date() },
      });

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
    }
  } catch (err) {
    next(err);
  }
});

// Get scanner geo-location (for map origin — uses mgmt IP or VPN IP)
scansRouter.get('/scanner-location', async (_req, res, next) => {
  try {
    // Check for active VPN — if connected, use VPN public IP for geo
    let ip: string | null = null;
    try {
      const vpnConn = await prisma.vpnConnection.findFirst({
        where: { status: 'CONNECTED' },
        orderBy: { connectedAt: 'desc' },
      });
      if (vpnConn?.publicIp) ip = vpnConn.publicIp;
    } catch { /* VPN table may not exist */ }

    // Fall back to management public IP
    if (!ip) {
      try {
        const { execSync } = await import('node:child_process');
        ip = execSync('curl -s --max-time 3 ifconfig.me 2>/dev/null', { timeout: 5000, encoding: 'utf-8' }).trim() || null;
      } catch { /* ignore */ }
    }

    if (!ip) {
      res.json({ success: true, data: { lat: 0, lng: 0, city: 'Unknown', country: 'Unknown', ip: null }, timestamp: Date.now() });
      return;
    }

    // Resolve geo-IP
    const geoResp = await fetch(`http://ip-api.com/json/${ip}?fields=query,lat,lon,city,country,as,isp,status`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (geoResp.ok) {
      const geo = await geoResp.json() as { query: string; lat: number; lon: number; city: string; country: string; as: string; isp: string; status: string };
      if (geo.status === 'success') {
        res.json({
          success: true,
          data: { lat: geo.lat, lng: geo.lon, city: geo.city, country: geo.country, ip: geo.query, asn: geo.as, isp: geo.isp },
          timestamp: Date.now(),
        });
        return;
      }
    }

    res.json({ success: true, data: { lat: 0, lng: 0, city: 'Unknown', country: 'Unknown', ip }, timestamp: Date.now() });
  } catch (err) {
    next(err);
  }
});

// Run traceroute only (no scan) — for visual path mapping
scansRouter.post('/traceroute', async (req, res, next) => {
  try {
    const { target } = req.body as { target: string };
    if (!target) throw new AppError(400, 'target is required');

    // Run traceroute asynchronously, return immediately
    const result = await tracerouteService.runTraceroute(target);

    res.json({
      success: true,
      data: {
        target,
        hops: result.hops,
        hopCount: result.hops.length,
        duration: result.duration,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});
