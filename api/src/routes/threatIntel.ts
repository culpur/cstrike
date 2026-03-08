/**
 * Threat Intelligence routes — OpenCTI GraphQL proxy.
 *
 * The frontend cannot call OpenCTI directly due to CORS restrictions,
 * so we proxy GraphQL requests through the API server.
 *
 * Config (URL + token) is stored in the ConfigEntry table.
 *
 * GET    /api/v1/threat-intel/config   — read OpenCTI config
 * PUT    /api/v1/threat-intel/config   — save OpenCTI config
 * POST   /api/v1/threat-intel/test     — test connection
 * POST   /api/v1/threat-intel/graphql  — proxy GraphQL query
 */

import { Router } from 'express';
import { prisma } from '../config/database.js';

export const threatIntelRouter = Router();

const CONFIG_URL_KEY = 'opencti_url';
const CONFIG_TOKEN_KEY = 'opencti_token';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getOpenCTIConfig(): Promise<{ url: string; token: string }> {
  const entries = await prisma.configEntry.findMany({
    where: { key: { in: [CONFIG_URL_KEY, CONFIG_TOKEN_KEY] } },
  });

  const map = new Map(entries.map((e) => [e.key, e.value as string]));
  return {
    url: map.get(CONFIG_URL_KEY) ?? '',
    token: map.get(CONFIG_TOKEN_KEY) ?? '',
  };
}

async function proxyGraphQL(
  url: string,
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${url}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });

  const body = await res.json();
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// GET /config — read OpenCTI config (token is masked)
// ---------------------------------------------------------------------------

threatIntelRouter.get('/config', async (_req, res, next) => {
  try {
    const { url, token } = await getOpenCTIConfig();

    res.json({
      success: true,
      data: {
        url,
        token: token ? `${token.slice(0, 8)}${'*'.repeat(Math.max(0, token.length - 8))}` : '',
        configured: !!(url && token),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /config — save OpenCTI config
// ---------------------------------------------------------------------------

threatIntelRouter.put('/config', async (req, res, next) => {
  try {
    const { url, token } = req.body as { url?: string; token?: string };

    if (url !== undefined) {
      // Strip trailing slash
      const cleanUrl = url.replace(/\/+$/, '');
      await prisma.configEntry.upsert({
        where: { key: CONFIG_URL_KEY },
        update: { value: cleanUrl, version: { increment: 1 }, updatedBy: 'api' },
        create: { key: CONFIG_URL_KEY, value: cleanUrl, updatedBy: 'api' },
      });
    }

    if (token !== undefined) {
      await prisma.configEntry.upsert({
        where: { key: CONFIG_TOKEN_KEY },
        update: { value: token, version: { increment: 1 }, updatedBy: 'api' },
        create: { key: CONFIG_TOKEN_KEY, value: token, updatedBy: 'api' },
      });
    }

    const config = await getOpenCTIConfig();
    res.json({
      success: true,
      data: {
        url: config.url,
        token: config.token ? `${config.token.slice(0, 8)}${'*'.repeat(Math.max(0, config.token.length - 8))}` : '',
        configured: !!(config.url && config.token),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /test — test OpenCTI connection
// ---------------------------------------------------------------------------

threatIntelRouter.post('/test', async (_req, res, next) => {
  try {
    const { url, token } = await getOpenCTIConfig();
    if (!url || !token) {
      res.json({ success: true, data: { ok: false, error: 'OpenCTI not configured' } });
      return;
    }

    const result = await proxyGraphQL(url, token, `query { about { version } }`);

    if (result.status === 200 && (result.body as any)?.data?.about?.version) {
      res.json({
        success: true,
        data: { ok: true, version: (result.body as any).data.about.version },
      });
    } else {
      const errMsg = (result.body as any)?.errors?.[0]?.message ?? `HTTP ${result.status}`;
      res.json({ success: true, data: { ok: false, error: errMsg } });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Connection failed';
    res.json({ success: true, data: { ok: false, error: errMsg } });
  }
});

// ---------------------------------------------------------------------------
// POST /graphql — proxy GraphQL query to OpenCTI
// ---------------------------------------------------------------------------

threatIntelRouter.post('/graphql', async (req, res, next) => {
  try {
    const { url, token } = await getOpenCTIConfig();
    if (!url || !token) {
      res.status(400).json({ success: false, error: 'OpenCTI not configured' });
      return;
    }

    const { query, variables } = req.body as {
      query: string;
      variables?: Record<string, unknown>;
    };

    if (!query) {
      res.status(400).json({ success: false, error: 'Missing query' });
      return;
    }

    const result = await proxyGraphQL(url, token, query, variables ?? {});
    res.status(result.status).json(result.body);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Proxy error';
    res.status(502).json({ errors: [{ message: errMsg }] });
  }
});
