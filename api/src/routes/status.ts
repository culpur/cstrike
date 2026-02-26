/**
 * Status routes — system health, metrics, service states.
 * GET /api/v1/status
 */

import { Router } from 'express';
import { prisma } from '../config/database.js';

export const statusRouter = Router();

statusRouter.get('/', async (_req, res, next) => {
  try {
    // Get all services
    const services = await prisma.service.findMany();
    const serviceMap: Record<string, string> = {};
    for (const svc of services) {
      serviceMap[svc.name] = svc.status.toLowerCase();
    }

    // Get VPN connections
    const vpns = await prisma.vpnConnection.findMany();
    const activeVpn = vpns.find((v) => v.status === 'CONNECTED');

    res.json({
      success: true,
      data: {
        metrics: {
          cpu: 0,
          memory: 0,
          vpnIp: activeVpn?.assignedIp ?? activeVpn?.publicIp ?? null,
          uptime: Math.floor(process.uptime()),
          timestamp: Date.now(),
        },
        services: {
          metasploitRpc: serviceMap['metasploit'] ?? 'stopped',
          zap: serviceMap['zap'] ?? 'stopped',
          burp: serviceMap['burp'] ?? 'stopped',
          api_server: 'running',
          frontend: 'running',
        },
        connected: true,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});
