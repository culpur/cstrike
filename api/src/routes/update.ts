/**
 * Self-Update API Routes
 *
 * GET  /check   — force check for available updates
 * GET  /status  — poll current update state (used during update)
 * POST /execute — start the update process
 * POST /reset   — reset state to idle
 */

import { Router } from 'express';
import { updateService } from '../services/updateService.js';

export const updateRouter = Router();

updateRouter.get('/check', async (_req, res, next) => {
  try {
    const update = await updateService.checkForUpdates();
    res.json({
      success: true,
      data: { available: !!update, update },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

updateRouter.get('/status', async (_req, res) => {
  const state = updateService.getState();
  res.json({
    success: true,
    data: state,
    timestamp: Date.now(),
  });
});

updateRouter.post('/execute', async (_req, res, next) => {
  try {
    const state = updateService.getState();
    if (state.status === 'updating') {
      res.status(409).json({
        success: false,
        error: 'Update already in progress',
      });
      return;
    }

    // Fire and forget — the update runs asynchronously
    updateService.executeUpdate();

    res.json({
      success: true,
      data: { status: 'started' },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

updateRouter.post('/reset', async (_req, res) => {
  updateService.resetState();
  res.json({ success: true, timestamp: Date.now() });
});
