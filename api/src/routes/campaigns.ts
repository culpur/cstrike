/**
 * Campaign routes — CRUD for top-level engagement grouping.
 *
 * POST   /api/v1/campaigns         — Create campaign
 * GET    /api/v1/campaigns         — List campaigns
 * GET    /api/v1/campaigns/:id     — Get campaign with cases
 * PUT    /api/v1/campaigns/:id     — Update campaign
 * DELETE /api/v1/campaigns/:id     — Delete campaign
 */

import { Router } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';

export const campaignsRouter = Router();

// Create campaign
campaignsRouter.post('/', async (req, res, next) => {
  try {
    const { name, description, color } = req.body;
    if (!name) throw new AppError(400, 'name is required');

    const campaign = await prisma.campaign.create({
      data: {
        name,
        description: description ?? '',
        color: color ?? '#2266ff',
        status: 'PLANNED',
      },
    });

    res.status(201).json({ success: true, data: campaign, timestamp: Date.now() });
  } catch (err) {
    next(err);
  }
});

// List campaigns
campaignsRouter.get('/', async (req, res, next) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      include: {
        _count: { select: { cases: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: campaigns, timestamp: Date.now() });
  } catch (err) {
    next(err);
  }
});

// Get campaign detail with cases
campaignsRouter.get('/:id', async (req, res, next) => {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: req.params.id },
      include: {
        cases: {
          include: {
            target: { select: { url: true, hostname: true } },
            _count: { select: { tasks: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!campaign) throw new AppError(404, 'Campaign not found');

    res.json({ success: true, data: campaign, timestamp: Date.now() });
  } catch (err) {
    next(err);
  }
});

// Update campaign
campaignsRouter.put('/:id', async (req, res, next) => {
  try {
    const { name, description, status, color } = req.body;
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (status !== undefined) data.status = status.toUpperCase();
    if (color !== undefined) data.color = color;

    const updated = await prisma.campaign.update({
      where: { id: req.params.id },
      data,
    });

    res.json({ success: true, data: updated, timestamp: Date.now() });
  } catch (err) {
    next(err);
  }
});

// Delete campaign
campaignsRouter.delete('/:id', async (req, res, next) => {
  try {
    await prisma.campaign.delete({ where: { id: req.params.id } });
    res.json({ success: true, timestamp: Date.now() });
  } catch (err) {
    next(err);
  }
});
