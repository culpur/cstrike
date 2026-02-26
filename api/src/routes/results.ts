/**
 * Results routes — scan results retrieval and export.
 * GET /api/v1/results
 * GET /api/v1/results/:target
 * GET /api/v1/results/:target/download
 */

import { Router } from 'express';
import { prisma } from '../config/database.js';
import type { Prisma } from '@prisma/client';

export const resultsRouter = Router();

// Get all results (paginated, filterable)
resultsRouter.get('/', async (req, res, next) => {
  try {
    const {
      type,
      severity,
      target,
      limit = '50',
      offset = '0',
    } = req.query as Record<string, string | undefined>;

    const where: Prisma.ScanResultWhereInput = {};
    if (type) where.resultType = type.toUpperCase() as any;
    if (severity) where.severity = severity.toUpperCase() as any;
    if (target) {
      where.scan = {
        target: {
          OR: [
            { url: { contains: target, mode: 'insensitive' } },
            { hostname: { contains: target, mode: 'insensitive' } },
          ],
        },
      };
    }

    const [results, total] = await Promise.all([
      prisma.scanResult.findMany({
        where,
        include: {
          scan: { include: { target: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit, 10),
        skip: parseInt(offset, 10),
      }),
      prisma.scanResult.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        items: results.map((r) => ({
          id: r.id,
          scan_id: r.scanId,
          target: r.scan.target.url,
          type: r.resultType,
          severity: r.severity,
          source: r.source,
          data: r.data,
          timestamp: r.createdAt.getTime(),
        })),
        total,
        hasMore: parseInt(offset, 10) + results.length < total,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// Get results for a specific target
resultsRouter.get('/:target', async (req, res, next) => {
  try {
    const { target } = req.params;

    const results = await prisma.scanResult.findMany({
      where: {
        scan: {
          target: {
            OR: [
              { url: { contains: target, mode: 'insensitive' } },
              { hostname: { contains: target, mode: 'insensitive' } },
              { id: target },
            ],
          },
        },
      },
      include: {
        scan: { include: { target: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group by type
    const grouped: Record<string, unknown[]> = {};
    for (const r of results) {
      const type = r.resultType.toLowerCase();
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push({
        id: r.id,
        data: r.data,
        severity: r.severity,
        source: r.source,
        timestamp: r.createdAt.getTime(),
      });
    }

    res.json({
      success: true,
      data: {
        target,
        results: grouped,
        total: results.length,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// Download results as JSON
resultsRouter.get('/:target/download', async (req, res, next) => {
  try {
    const { target } = req.params;

    const results = await prisma.scanResult.findMany({
      where: {
        scan: {
          target: {
            OR: [
              { url: { contains: target, mode: 'insensitive' } },
              { hostname: { contains: target, mode: 'insensitive' } },
            ],
          },
        },
      },
      include: {
        scan: { include: { target: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const exportData = {
      target,
      exported_at: new Date().toISOString(),
      total_results: results.length,
      results: results.map((r) => ({
        type: r.resultType,
        severity: r.severity,
        source: r.source,
        data: r.data,
        timestamp: r.createdAt.toISOString(),
      })),
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="cstrike-results-${target}.json"`);
    res.json(exportData);
  } catch (err) {
    next(err);
  }
});
