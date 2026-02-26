/**
 * Credential routes — credential management and validation.
 * GET  /api/v1/loot/credentials
 * POST /api/v1/loot/credentials/validate
 * POST /api/v1/loot/credentials/validate/batch
 */

import { Router } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { credentialValidator } from '../services/credentialValidator.js';

export const credentialsRouter = Router();

// Get all credentials
credentialsRouter.get('/', async (req, res, next) => {
  try {
    const { target, status, limit = '50', offset = '0' } = req.query as Record<string, string | undefined>;

    const where: any = {};
    if (target) {
      where.OR = [
        { target: { url: { contains: target, mode: 'insensitive' } } },
        { targetId: target },
      ];
    }
    if (status) {
      where.validationStatus = status.toUpperCase();
    }

    const [credentials, total] = await Promise.all([
      prisma.credentialPair.findMany({
        where,
        include: { target: true },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit, 10),
        skip: parseInt(offset, 10),
      }),
      prisma.credentialPair.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        items: credentials.map((c) => ({
          id: c.id,
          username: c.username,
          password: c.password,
          service: c.service,
          port: c.port,
          target: c.target?.url,
          validation_status: c.validationStatus.toLowerCase(),
          score: c.score,
          score_breakdown: c.scoreBreakdown,
          source: c.source,
          timestamp: c.createdAt.getTime(),
        })),
        total,
        hasMore: parseInt(offset, 10) + credentials.length < total,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// Validate a single credential
credentialsRouter.post('/validate', async (req, res, next) => {
  try {
    const { id, username, password, target, service, port } = req.body;

    if (!username || !password || !target || !service) {
      throw new AppError(400, 'username, password, target, and service are required');
    }

    const result = await credentialValidator.validate({
      username,
      password,
      target,
      service,
      port,
    });

    // Update credential record if ID provided
    if (id) {
      await prisma.credentialPair.update({
        where: { id },
        data: {
          validationStatus: result.valid ? 'VALID' : 'INVALID',
        },
      });
    }

    res.json({
      success: true,
      data: result,
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// Batch validate credentials
credentialsRouter.post('/validate/batch', async (req, res, next) => {
  try {
    const { credentials } = req.body as {
      credentials: Array<{
        id?: string;
        username: string;
        password: string;
        target: string;
        service: string;
        port?: number;
      }>;
    };

    if (!credentials?.length) {
      throw new AppError(400, 'credentials array is required');
    }

    const results = await credentialValidator.validateBatch(credentials);

    // Update records
    for (const result of results) {
      if (result.id) {
        await prisma.credentialPair.update({
          where: { id: result.id },
          data: {
            validationStatus: result.valid ? 'VALID' : 'INVALID',
          },
        }).catch(() => {}); // Ignore if not found
      }
    }

    res.json({
      success: true,
      data: { results, total: results.length },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});
