/**
 * Global error handling middleware.
 */

import type { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      details: err.details,
      timestamp: Date.now(),
    });
    return;
  }

  console.error('[Error]', err);

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    timestamp: Date.now(),
  });
}
