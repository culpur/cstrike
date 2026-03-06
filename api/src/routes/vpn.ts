/**
 * VPN management routes — connect, disconnect, upload config, authenticate.
 * All logic delegates to vpnService; routes are thin request/response wrappers.
 *
 * GET    /api/v1/vpn                      — list all VPN connections
 * POST   /api/v1/vpn/:provider/connect    — connect (body: {server?, splitRouting?})
 * POST   /api/v1/vpn/:provider/disconnect — disconnect
 * POST   /api/v1/vpn/:provider/upload     — upload config file (multipart)
 * POST   /api/v1/vpn/:provider/authenticate — authenticate (body: {authToken, options?})
 */

import { Router } from 'express';
import multer from 'multer';
import { AppError } from '../middleware/errorHandler.js';
import { vpnService, type VpnProvider } from '../services/vpnService.js';

export const vpnRouter = Router();

// ── Multer config — memory storage, 5MB limit ──────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.toLowerCase();
    if (ext.endsWith('.conf') || ext.endsWith('.ovpn')) {
      cb(null, true);
    } else {
      cb(new Error('Only .conf and .ovpn files are allowed'));
    }
  },
});

// ── Valid providers ─────────────────────────────────────────────────────────

const VALID_PROVIDERS = new Set<string>(['wireguard', 'openvpn', 'tailscale', 'nordvpn', 'mullvad']);

function assertProvider(provider: string): asserts provider is VpnProvider {
  if (!VALID_PROVIDERS.has(provider)) {
    throw new AppError(400, `Invalid VPN provider "${provider}". Valid: ${[...VALID_PROVIDERS].join(', ')}`);
  }
}

// ── Routes ──────────────────────────────────────────────────────────────────

// GET / — list all VPN connections (authToken redacted)
vpnRouter.get('/', async (_req, res, next) => {
  try {
    const connections = await vpnService.getAll();

    res.json({
      success: true,
      data: connections.map((c) => ({
        provider: c.provider,
        interface: c.interface,
        status: c.status,
        publicIp: c.publicIp,
        assignedIp: c.assignedIp,
        server: c.server,
        connectedAt: c.connectedAt,
        configPath: c.configPath,
        hasAuthToken: c.hasAuthToken,
        options: c.options,
      })),
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// POST /:provider/connect
vpnRouter.post('/:provider/connect', async (req, res, next) => {
  try {
    const { provider } = req.params;
    assertProvider(provider);

    const { server, splitRouting } = req.body as { server?: string; splitRouting?: boolean };
    const result = await vpnService.connect(provider, { server, splitRouting });

    if (!result.success) {
      throw new AppError(500, `VPN connection failed: ${result.error}`);
    }

    res.json({
      success: true,
      data: {
        provider: result.provider,
        status: result.status,
        assignedIp: result.assignedIp,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// POST /:provider/disconnect
vpnRouter.post('/:provider/disconnect', async (req, res, next) => {
  try {
    const { provider } = req.params;
    assertProvider(provider);

    const result = await vpnService.disconnect(provider);

    res.json({
      success: true,
      data: {
        provider: result.provider,
        status: result.status,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// POST /:provider/upload — upload VPN config file (WireGuard/OpenVPN only)
vpnRouter.post('/:provider/upload', upload.single('config'), async (req, res, next) => {
  try {
    const provider = req.params.provider as string;
    assertProvider(provider);

    if (!req.file) {
      throw new AppError(400, 'No config file provided. Send as multipart with field name "config".');
    }

    const filePath = await vpnService.saveConfigFile(provider, req.file.buffer, req.file.originalname);

    res.json({
      success: true,
      data: {
        provider,
        configPath: filePath,
        filename: req.file.originalname,
        size: req.file.size,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// POST /:provider/authenticate — authenticate VPN CLI (Tailscale/NordVPN/Mullvad)
vpnRouter.post('/:provider/authenticate', async (req, res, next) => {
  try {
    const { provider } = req.params;
    assertProvider(provider);

    const { authToken, options } = req.body as { authToken: string; options?: Record<string, unknown> };
    if (!authToken) {
      throw new AppError(400, 'authToken is required');
    }

    const result = await vpnService.authenticate(provider, authToken, options);

    if (!result.success) {
      throw new AppError(500, `Authentication failed: ${result.error}`);
    }

    res.json({
      success: true,
      data: {
        provider: result.provider,
        status: result.status,
        assignedIp: result.assignedIp,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});
