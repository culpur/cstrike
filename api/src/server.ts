/**
 * CStrike v2 — API Server Entry Point
 * Express 5 + Socket.IO + Prisma + Redis
 */

import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { prisma } from './config/database.js';
import { redis } from './config/redis.js';
import { errorHandler } from './middleware/errorHandler.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { setupWebSocket } from './websocket/setup.js';

// Routes
import { statusRouter } from './routes/status.js';
import { servicesRouter } from './routes/services.js';
import { targetsRouter } from './routes/targets.js';
import { configRouter } from './routes/config.js';
import { logsRouter } from './routes/logs.js';
import { scansRouter } from './routes/scans.js';
import { resultsRouter } from './routes/results.js';
import { lootRouter } from './routes/loot.js';
import { credentialsRouter } from './routes/credentials.js';
import { aiRouter } from './routes/ai.js';
import { vulnapiRouter } from './routes/vulnapi.js';
import { mcpRouter } from './routes/mcp.js';
import { vpnRouter } from './routes/vpn.js';
import { exploitRouter } from './routes/exploit.js';
import { casesRouter } from './routes/cases.js';
import { campaignsRouter } from './routes/campaigns.js';
import { wordlistsRouter } from './routes/wordlists.js';

// Services
import { startMetricsCollector } from './services/metricsCollector.js';
import { autoStartServices, startServiceMonitor, stopServiceMonitor } from './services/serviceMonitor.js';

const app = express();
const httpServer = createServer(app);

// ── Middleware ───────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // CSP handled by Traefik
app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('short'));
app.use(rateLimiter(100, 60_000)); // 100 req/min per IP

// ── Routes ──────────────────────────────────────────────────
const api = express.Router();

api.use('/status', statusRouter);
api.use('/services', servicesRouter);
api.use('/targets', targetsRouter);
api.use('/config', configRouter);
api.use('/logs', logsRouter);
api.use('/recon', scansRouter);       // /api/v1/recon/* (legacy compat)
api.use('/results', resultsRouter);
// Credentials must be mounted before /loot (which has /:target catch-all)
api.use('/loot/credentials', credentialsRouter);
api.use('/loot', lootRouter);
api.use('/exploit', exploitRouter);
api.use('/cases', casesRouter);
api.use('/campaigns', campaignsRouter);
api.use('/wordlists', wordlistsRouter);
api.use('/ai', aiRouter);
api.use('/vulnapi', vulnapiRouter);
api.use('/mcp', mcpRouter);
api.use('/vpn', vpnRouter);

app.use('/api/v1', api);

// Health check (outside versioned API) — verifies DB + Redis connectivity
app.get('/health', async (_req, res) => {
  const checks: Record<string, string> = {};
  let healthy = true;

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
    healthy = false;
  }

  try {
    const pong = await redis.ping();
    checks.redis = pong === 'PONG' ? 'ok' : 'error';
  } catch {
    checks.redis = 'error';
    healthy = false;
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    checks,
    uptime: Math.floor(process.uptime()),
    timestamp: Date.now(),
  });
});

// ── Error handler (must be last) ────────────────────────────
app.use(errorHandler);

// ── WebSocket ───────────────────────────────────────────────
const io = setupWebSocket(httpServer);

// ── Start ───────────────────────────────────────────────────
async function start() {
  try {
    // Connect to database
    await prisma.$connect();
    console.log('[DB] PostgreSQL connected');

    // Connect to Redis
    await redis.connect();

    // Start metrics collector (emits system_metrics every 2s)
    startMetricsCollector();

    // Auto-start services marked with autoStart=true (metasploit, zap, burp)
    autoStartServices().catch((err) => {
      console.warn('[CStrike API] Service auto-start error:', err.message);
    });

    // Start service health monitor (restart crashed services every 30s)
    startServiceMonitor();

    // Start HTTP server
    httpServer.listen(env.PORT, env.HOST, () => {
      console.log(`[CStrike API] v2.0.0 listening on ${env.HOST}:${env.PORT}`);
      console.log(`[CStrike API] Environment: ${env.NODE_ENV}`);
    });
  } catch (err) {
    console.error('[CStrike API] Failed to start:', err);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`\n[CStrike API] ${signal} received, shutting down...`);
  stopServiceMonitor();
  httpServer.close();
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();

export { app, httpServer, io };
