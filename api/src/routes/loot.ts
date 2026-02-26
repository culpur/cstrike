/**
 * Loot routes — collected intelligence from scans.
 * GET /api/v1/loot/:target
 * GET /api/v1/loot/heatmap
 */

import { Router } from 'express';
import { prisma } from '../config/database.js';
import type { Prisma } from '@prisma/client';

export const lootRouter = Router();

// Get loot for a specific target
lootRouter.get('/heatmap', async (_req, res, next) => {
  try {
    const credentials = await prisma.credentialPair.findMany({
      where: { score: { not: null } },
      orderBy: { score: 'desc' },
      take: 100,
    });

    res.json({
      success: true,
      data: {
        credentials: credentials.map((c) => ({
          username: c.username,
          password: c.password,
          service: c.service,
          target: c.targetId,
          score: c.score,
          breakdown: c.scoreBreakdown,
        })),
        count: credentials.length,
        timestamp: new Date().toISOString(),
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

lootRouter.get('/:target', async (req, res, next) => {
  try {
    const { target } = req.params;

    const where: Prisma.LootItemWhereInput = {
      OR: [
        { target: { url: { contains: target, mode: 'insensitive' } } },
        { target: { hostname: { contains: target, mode: 'insensitive' } } },
        { targetId: target },
      ],
    };

    const items = await prisma.lootItem.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Group by category
    const byCategory: Record<string, unknown[]> = {};
    for (const item of items) {
      const cat = item.category.toLowerCase();
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push({
        id: item.id,
        value: item.value,
        source: item.source,
        metadata: item.metadata,
        timestamp: item.createdAt.getTime(),
      });
    }

    res.json({
      success: true,
      data: {
        target,
        items: byCategory,
        total: items.length,
        stats: {
          totalItems: items.length,
          byCategory: Object.fromEntries(
            Object.entries(byCategory).map(([k, v]) => [k, v.length]),
          ),
        },
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});
