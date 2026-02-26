/**
 * Target management routes.
 * GET    /api/v1/targets
 * POST   /api/v1/targets
 * DELETE /api/v1/targets/:targetId
 */

import { Router } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';

export const targetsRouter = Router();

targetsRouter.get('/', async (_req, res, next) => {
  try {
    const targets = await prisma.target.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { scans: true, lootItems: true, credentials: true } },
      },
    });
    res.json({ success: true, data: targets, timestamp: Date.now() });
  } catch (err) {
    next(err);
  }
});

targetsRouter.post('/', async (req, res, next) => {
  try {
    const { url, ip, tags, notes } = req.body as {
      url: string;
      ip?: string;
      tags?: string[];
      notes?: string;
    };

    if (!url) throw new AppError(400, 'url is required');

    // Normalize URL
    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;

    const target = await prisma.target.upsert({
      where: { url: normalizedUrl },
      update: { ip, tags, notes },
      create: {
        url: normalizedUrl,
        ip: ip ?? null,
        hostname: new URL(normalizedUrl).hostname,
        tags: tags ?? [],
        notes: notes ?? null,
      },
    });

    res.status(201).json({ success: true, data: target, timestamp: Date.now() });
  } catch (err) {
    next(err);
  }
});

targetsRouter.delete('/:targetId', async (req, res, next) => {
  try {
    const { targetId } = req.params;

    await prisma.target.delete({ where: { id: targetId } }).catch(() => {
      throw new AppError(404, `Target "${targetId}" not found`);
    });

    res.json({ success: true, data: { deleted: targetId }, timestamp: Date.now() });
  } catch (err) {
    next(err);
  }
});
