/**
 * Log routes — structured log retrieval.
 * GET /api/v1/logs
 */

import { Router } from 'express';
import { prisma } from '../config/database.js';
import type { Prisma } from '@prisma/client';

export const logsRouter = Router();

logsRouter.get('/', async (req, res, next) => {
  try {
    const {
      level,
      source,
      search,
      limit = '100',
      offset = '0',
      scan_id,
    } = req.query as Record<string, string | undefined>;

    const where: Prisma.LogEntryWhereInput = {};

    if (level) {
      const levels = level.split(',').map((l) => l.trim().toUpperCase());
      where.level = { in: levels as any[] };
    }
    if (source) {
      where.source = { contains: source, mode: 'insensitive' };
    }
    if (search) {
      where.message = { contains: search, mode: 'insensitive' };
    }
    if (scan_id) {
      where.scanId = scan_id;
    }

    const [entries, total] = await Promise.all([
      prisma.logEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit, 10),
        skip: parseInt(offset, 10),
      }),
      prisma.logEntry.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        items: entries.map((e) => ({
          id: e.id,
          timestamp: e.createdAt.getTime(),
          level: e.level,
          source: e.source,
          message: e.message,
          metadata: e.metadata,
        })),
        total,
        hasMore: parseInt(offset, 10) + entries.length < total,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});
