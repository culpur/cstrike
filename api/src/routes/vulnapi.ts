/**
 * VulnAPI routes — API vulnerability scanning.
 * POST /api/v1/vulnapi/scan
 * GET  /api/v1/vulnapi/results/:target
 */

import { Router } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { validateTargetScope } from '../middleware/guardrails.js';
import { toolExecutor } from '../services/toolExecutor.js';
import { emitVulnapiOutput } from '../websocket/emitter.js';

export const vulnapiRouter = Router();

// Start VulnAPI scan
vulnapiRouter.post('/scan', async (req, res, next) => {
  try {
    const { target, scan_type } = req.body as {
      target: string;
      scan_type?: 'full' | 'curl' | 'openapi';
    };

    if (!target) throw new AppError(400, 'target is required');

    await validateTargetScope(target);

    // Run scan in background
    setImmediate(async () => {
      try {
        const result = await toolExecutor.run('vulnapi', target, {
          scanType: scan_type ?? 'full',
        });

        // Store findings
        const targetRecord = await prisma.target.findFirst({
          where: { url: { contains: target } },
        });

        if (targetRecord && result.findings) {
          for (const finding of result.findings) {
            const scan = await prisma.scan.findFirst({
              where: { targetId: targetRecord.id },
              orderBy: { createdAt: 'desc' },
            });

            if (scan) {
              await prisma.scanResult.create({
                data: {
                  scanId: scan.id,
                  resultType: 'VULNAPI_FINDING',
                  data: finding as any,
                  severity: finding.severity?.toUpperCase() as any ?? null,
                  source: 'vulnapi',
                },
              });
            }
          }

          emitVulnapiOutput({ target, findings: result.findings });
        }
      } catch (err: any) {
        console.error('[VulnAPI]', err.message);
      }
    });

    res.json({
      success: true,
      data: { target, scan_type: scan_type ?? 'full', status: 'started' },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// Get VulnAPI results for a target
vulnapiRouter.get('/results/:target', async (req, res, next) => {
  try {
    const { target } = req.params;

    const results = await prisma.scanResult.findMany({
      where: {
        resultType: 'VULNAPI_FINDING',
        scan: {
          target: {
            OR: [
              { url: { contains: target, mode: 'insensitive' } },
              { hostname: { contains: target, mode: 'insensitive' } },
            ],
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const findings = results.map((r) => r.data);
    const severityCounts = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };

    for (const r of results) {
      const sev = r.severity?.toLowerCase() as keyof typeof severityCounts;
      if (sev && sev in severityCounts) severityCounts[sev]++;
    }

    res.json({
      success: true,
      data: {
        target,
        total_findings: findings.length,
        findings,
        severity_counts: severityCounts,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});
