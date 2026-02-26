/**
 * VPN management routes — connect, disconnect, status for all VPN providers.
 * GET  /api/v1/vpn
 * POST /api/v1/vpn/:provider/connect
 * POST /api/v1/vpn/:provider/disconnect
 */

import { Router } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { execSync } from 'node:child_process';

export const vpnRouter = Router();

// Get all VPN connection states
vpnRouter.get('/', async (_req, res, next) => {
  try {
    const connections = await prisma.vpnConnection.findMany({
      orderBy: { provider: 'asc' },
    });

    // Refresh actual interface status
    for (const conn of connections) {
      const actualStatus = checkInterfaceStatus(conn.interface ?? '');
      if (actualStatus !== conn.status.toLowerCase()) {
        await prisma.vpnConnection.update({
          where: { id: conn.id },
          data: {
            status: actualStatus === 'connected' ? 'CONNECTED' : 'DISCONNECTED',
            publicIp: actualStatus === 'connected' ? getInterfaceIp(conn.interface ?? '') : null,
          },
        });
        conn.status = actualStatus === 'connected' ? 'CONNECTED' : 'DISCONNECTED';
      }
    }

    res.json({
      success: true,
      data: connections.map((c) => ({
        provider: c.provider,
        interface: c.interface,
        status: c.status.toLowerCase(),
        publicIp: c.publicIp,
        assignedIp: c.assignedIp,
        server: c.server,
        connectedAt: c.connectedAt?.getTime(),
      })),
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// Connect VPN
vpnRouter.post('/:provider/connect', async (req, res, next) => {
  try {
    const { provider } = req.params;
    const { server, config } = req.body as { server?: string; config?: string };

    const conn = await prisma.vpnConnection.findUnique({ where: { provider } });
    if (!conn) throw new AppError(404, `VPN provider "${provider}" not found`);

    await prisma.vpnConnection.update({
      where: { provider },
      data: { status: 'CONNECTING', server },
    });

    // Execute VPN connection command
    try {
      const cmd = getConnectCommand(provider, server, config);
      execSync(cmd, { timeout: 30_000 });

      const ip = getInterfaceIp(conn.interface ?? '');

      await prisma.vpnConnection.update({
        where: { provider },
        data: {
          status: 'CONNECTED',
          assignedIp: ip,
          connectedAt: new Date(),
        },
      });

      res.json({
        success: true,
        data: { provider, status: 'connected', assignedIp: ip },
        timestamp: Date.now(),
      });
    } catch (err: any) {
      await prisma.vpnConnection.update({
        where: { provider },
        data: { status: 'ERROR' },
      });
      throw new AppError(500, `VPN connection failed: ${err.message}`);
    }
  } catch (err) {
    next(err);
  }
});

// Disconnect VPN
vpnRouter.post('/:provider/disconnect', async (req, res, next) => {
  try {
    const { provider } = req.params;

    const conn = await prisma.vpnConnection.findUnique({ where: { provider } });
    if (!conn) throw new AppError(404, `VPN provider "${provider}" not found`);

    try {
      const cmd = getDisconnectCommand(provider);
      execSync(cmd, { timeout: 15_000 });
    } catch {
      // Ignore disconnect errors
    }

    await prisma.vpnConnection.update({
      where: { provider },
      data: {
        status: 'DISCONNECTED',
        assignedIp: null,
        publicIp: null,
        connectedAt: null,
      },
    });

    res.json({
      success: true,
      data: { provider, status: 'disconnected' },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// ── Helpers ─────────────────────────────────────────────────

function checkInterfaceStatus(iface: string): string {
  if (!iface) return 'disconnected';
  try {
    const output = execSync(`ip link show ${iface} 2>/dev/null`, {
      timeout: 3000,
      encoding: 'utf-8',
    });
    return output.includes('UP') ? 'connected' : 'disconnected';
  } catch {
    return 'disconnected';
  }
}

function getInterfaceIp(iface: string): string | null {
  if (!iface) return null;
  try {
    const output = execSync(
      `ip -4 addr show ${iface} 2>/dev/null | grep -oP '(?<=inet )\\S+' | cut -d/ -f1`,
      { timeout: 3000, encoding: 'utf-8' },
    );
    return output.trim() || null;
  } catch {
    return null;
  }
}

function getConnectCommand(provider: string, server?: string, config?: string): string {
  switch (provider) {
    case 'wireguard':
      return `sudo wg-quick up ${config ?? 'wg0'}`;
    case 'openvpn':
      return `sudo openvpn --config ${config ?? '/etc/openvpn/client.conf'} --daemon`;
    case 'tailscale':
      return 'sudo tailscale up';
    case 'nordvpn':
      return `sudo nordvpn connect ${server ?? ''}`.trim();
    case 'mullvad':
      return `sudo mullvad connect${server ? ` --location ${server}` : ''}`;
    default:
      throw new Error(`Unknown VPN provider: ${provider}`);
  }
}

function getDisconnectCommand(provider: string): string {
  switch (provider) {
    case 'wireguard':
      return 'sudo wg-quick down wg0';
    case 'openvpn':
      return 'sudo pkill openvpn';
    case 'tailscale':
      return 'sudo tailscale down';
    case 'nordvpn':
      return 'sudo nordvpn disconnect';
    case 'mullvad':
      return 'sudo mullvad disconnect';
    default:
      throw new Error(`Unknown VPN provider: ${provider}`);
  }
}
