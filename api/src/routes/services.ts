/**
 * Services routes — start, stop, restart managed services.
 * GET  /api/v1/services
 * POST /api/v1/services/:name        (action: start|stop)
 * POST /api/v1/services/:name/restart
 */

import { Router } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { emitServiceAutoStart } from '../websocket/emitter.js';
import { serviceManager } from '../services/serviceManager.js';

export const servicesRouter = Router();

servicesRouter.get('/', async (_req, res, next) => {
  try {
    const services = await prisma.service.findMany({
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: services, timestamp: Date.now() });
  } catch (err) {
    next(err);
  }
});

servicesRouter.post('/:name', async (req, res, next) => {
  try {
    const { name } = req.params;
    const { action } = req.body as { action: 'start' | 'stop' };

    if (!['start', 'stop'].includes(action)) {
      throw new AppError(400, 'action must be "start" or "stop"');
    }

    const service = await prisma.service.findUnique({ where: { name } });
    if (!service) throw new AppError(404, `Service "${name}" not found`);
    if (!service.optional) throw new AppError(400, `Service "${name}" cannot be controlled`);

    // Update status to transitional state
    const transitionalStatus = action === 'start' ? 'STARTING' : 'STOPPING';
    await prisma.service.update({
      where: { name },
      data: { status: transitionalStatus as any },
    });

    emitServiceAutoStart({ service: name, status: transitionalStatus.toLowerCase() });

    // Execute the action
    const result = await serviceManager.execute(name, action);

    // Update final status
    const finalStatus = action === 'start' ? 'RUNNING' : 'STOPPED';
    await prisma.service.update({
      where: { name },
      data: {
        status: finalStatus as any,
        pid: result.pid ?? null,
        error: result.error ?? null,
      },
    });

    res.json({
      success: true,
      data: { service: name, action, status: finalStatus.toLowerCase() },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

servicesRouter.post('/:name/restart', async (req, res, next) => {
  try {
    const { name } = req.params;
    const service = await prisma.service.findUnique({ where: { name } });
    if (!service) throw new AppError(404, `Service "${name}" not found`);
    if (!service.optional) throw new AppError(400, `Service "${name}" cannot be controlled`);

    await prisma.service.update({
      where: { name },
      data: { status: 'STARTING' },
    });

    const result = await serviceManager.execute(name, 'restart');

    await prisma.service.update({
      where: { name },
      data: {
        status: result.error ? 'ERROR' : 'RUNNING',
        pid: result.pid ?? null,
        error: result.error ?? null,
      },
    });

    res.json({
      success: true,
      data: { service: name, action: 'restart', status: result.error ? 'error' : 'running' },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});
