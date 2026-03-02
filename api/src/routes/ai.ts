/**
 * AI routes — AI provider management, analysis, and thought stream.
 * GET  /api/v1/ai/thoughts
 * POST /api/v1/ai/analyze
 * GET  /api/v1/ai/provider
 * PUT  /api/v1/ai/provider
 */

import { Router } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { getConfigValue } from '../middleware/guardrails.js';
import { emitAIThought } from '../websocket/emitter.js';
import { aiService } from '../services/aiService.js';

export const aiRouter = Router();

// Get AI thoughts (recent stream)
aiRouter.get('/thoughts', async (req, res, next) => {
  try {
    const { limit = '50', scan_id } = req.query as Record<string, string | undefined>;

    const where: any = {};
    if (scan_id) where.scanId = scan_id;

    const thoughts = await prisma.aIThought.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit, 10),
    });

    res.json({
      success: true,
      data: thoughts.map((t) => ({
        id: t.id,
        timestamp: t.createdAt.getTime(),
        thoughtType: t.thoughtType.toLowerCase(),
        content: t.content,
        command: t.command,
        metadata: t.metadata,
      })),
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// AI analysis request
aiRouter.post('/analyze', async (req, res, next) => {
  try {
    const { target, prompt, context, mode } = req.body as {
      target?: string;
      prompt: string;
      context?: unknown;
      mode?: 'analyze' | 'tools';
    };

    if (!prompt) throw new AppError(400, 'prompt is required');

    const provider = await getConfigValue('ai_provider', 'openai');
    const temperature = await getConfigValue('ai_temperature', 0.7);
    const maxTokens = await getConfigValue('ai_max_tokens', 4096);

    // Record the prompt as a thought
    const thought = await prisma.aIThought.create({
      data: {
        thoughtType: 'AI_PROMPT',
        content: prompt,
        metadata: { target, provider, mode } as any,
      },
    });

    emitAIThought({
      thoughtType: 'ai_prompt',
      content: `Analyzing: ${prompt.substring(0, 100)}...`,
      metadata: { target, provider },
    });

    // Respond immediately, then run AI analysis in background
    res.json({
      success: true,
      data: {
        thought_id: thought.id,
        provider,
        status: 'processing',
        config: { temperature, maxTokens },
      },
      timestamp: Date.now(),
    });

    // Fire-and-forget: dispatch to aiService for actual inference
    setImmediate(() => {
      aiService.analyze({ prompt, target, mode }).catch((err) => {
        console.error('[AI] Async analysis failed:', err.message);
      });
    });
  } catch (err) {
    next(err);
  }
});

// Get current AI provider info
aiRouter.get('/provider', async (_req, res, next) => {
  try {
    const provider = await getConfigValue('ai_provider', 'openai');

    let model = '';
    let status = 'unconfigured';

    switch (provider) {
      case 'openai': {
        const key = await getConfigValue('openai_api_key', '');
        model = await getConfigValue('openai_model', 'gpt-4o');
        status = key ? 'configured' : 'unconfigured';
        break;
      }
      case 'anthropic': {
        const key = await getConfigValue('anthropic_api_key', '');
        model = await getConfigValue('anthropic_model', 'claude-sonnet-4-20250514');
        status = key ? 'configured' : 'unconfigured';
        break;
      }
      case 'grok': {
        const key = await getConfigValue('grok_api_key', '');
        model = await getConfigValue('grok_model', 'grok-2');
        status = key ? 'configured' : 'unconfigured';
        break;
      }
      case 'ollama': {
        model = await getConfigValue('ollama_model', 'llama3');
        status = 'configured'; // Ollama doesn't need an API key
        break;
      }
    }

    res.json({
      success: true,
      data: { provider, model, status },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// Update AI provider
aiRouter.put('/provider', async (req, res, next) => {
  try {
    const { provider, model, api_key } = req.body as {
      provider: string;
      model?: string;
      api_key?: string;
    };

    if (!provider) throw new AppError(400, 'provider is required');

    // Update provider
    await prisma.configEntry.upsert({
      where: { key: 'ai_provider' },
      update: { value: provider as any, version: { increment: 1 } },
      create: { key: 'ai_provider', value: provider as any },
    });

    // Update model if provided
    if (model) {
      await prisma.configEntry.upsert({
        where: { key: `${provider}_model` },
        update: { value: model as any, version: { increment: 1 } },
        create: { key: `${provider}_model`, value: model as any },
      });
    }

    // Update API key if provided
    if (api_key) {
      await prisma.configEntry.upsert({
        where: { key: `${provider}_api_key` },
        update: { value: api_key as any, version: { increment: 1 } },
        create: { key: `${provider}_api_key`, value: api_key as any },
      });
    }

    res.json({
      success: true,
      data: { provider, model: model ?? 'unchanged', status: 'updated' },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});
