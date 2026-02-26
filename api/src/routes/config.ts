/**
 * Configuration routes — database-backed key-value config.
 * GET /api/v1/config          — get all config as flat object
 * PUT /api/v1/config          — update config entries
 * GET /api/v1/config/history  — get version history for a key
 */

import { Router } from 'express';
import { prisma } from '../config/database.js';

export const configRouter = Router();

// GET all config as a flat object (matches Flask API contract)
configRouter.get('/', async (_req, res, next) => {
  try {
    const entries = await prisma.configEntry.findMany();

    const config: Record<string, unknown> = {};
    for (const entry of entries) {
      config[entry.key] = entry.value;
    }

    res.json({ success: true, data: config, timestamp: Date.now() });
  } catch (err) {
    next(err);
  }
});

// PUT update config — accepts partial object with key:value pairs
configRouter.put('/', async (req, res, next) => {
  try {
    const updates = req.body as Record<string, unknown>;

    for (const [key, value] of Object.entries(updates)) {
      await prisma.configEntry.upsert({
        where: { key },
        update: {
          value: value as any,
          version: { increment: 1 },
          updatedBy: 'api',
        },
        create: {
          key,
          value: value as any,
          updatedBy: 'api',
        },
      });
    }

    // Return updated config
    const entries = await prisma.configEntry.findMany();
    const config: Record<string, unknown> = {};
    for (const entry of entries) {
      config[entry.key] = entry.value;
    }

    res.json({ success: true, data: config, timestamp: Date.now() });
  } catch (err) {
    next(err);
  }
});

// GET config history for a specific key
configRouter.get('/history/:key', async (req, res, next) => {
  try {
    const { key } = req.params;
    const entry = await prisma.configEntry.findUnique({ where: { key } });

    if (!entry) {
      res.json({ success: true, data: null, timestamp: Date.now() });
      return;
    }

    res.json({
      success: true,
      data: {
        key: entry.key,
        currentValue: entry.value,
        version: entry.version,
        updatedBy: entry.updatedBy,
        updatedAt: entry.updatedAt,
        createdAt: entry.createdAt,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});
