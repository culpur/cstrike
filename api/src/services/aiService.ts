/**
 * AI Service — manages AI reasoning for agentic scan mode.
 * Stores/retrieves AIThought records, streams thought events via WebSocket,
 * and dispatches to the configured AI provider (openai/anthropic/grok/ollama).
 *
 * The route layer handles provider selection config; this service owns
 * thought persistence and the streaming side-channel.
 */

import { prisma } from '../config/database.js';
import { getConfigValue } from '../middleware/guardrails.js';
import { emitAIThought, emitAICommandExecution, emitLogEntry } from '../websocket/emitter.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AIThoughtType =
  | 'REASONING'
  | 'COMMAND'
  | 'DECISION'
  | 'OBSERVATION'
  | 'AI_PROMPT'
  | 'AI_RESPONSE'
  | 'AI_DECISION'
  | 'AI_EXECUTION';

export interface AIThoughtRecord {
  id: string;
  scanId: string | null;
  thoughtType: AIThoughtType;
  content: string;
  command: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface AIAnalyzeInput {
  prompt: string;
  target?: string;
  context?: unknown;
  scanId?: string;
  mode?: 'analyze' | 'tools';
}

export interface AIAnalyzeResult {
  thoughtId: string;
  provider: string;
  model: string;
  content: string;
  commands?: string[];
  status: 'complete' | 'error';
  error?: string;
}

export interface AIProviderConfig {
  provider: string;
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  ollamaUrl: string;
}

// ── Core class ────────────────────────────────────────────────────────────────

class AIService {
  /**
   * Store a new thought and emit it via WebSocket.
   */
  async recordThought(input: {
    thoughtType: AIThoughtType;
    content: string;
    command?: string;
    scanId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AIThoughtRecord> {
    const thought = await prisma.aIThought.create({
      data: {
        thoughtType: input.thoughtType as any,
        content: input.content,
        command: input.command ?? null,
        scanId: input.scanId ?? null,
        metadata: input.metadata as any ?? undefined,
      },
    });

    // Stream to WebSocket
    emitAIThought({
      thoughtType: thought.thoughtType.toLowerCase(),
      content: thought.content,
      command: thought.command ?? undefined,
      metadata: thought.metadata,
    });

    return {
      id: thought.id,
      scanId: thought.scanId,
      thoughtType: thought.thoughtType as AIThoughtType,
      content: thought.content,
      command: thought.command,
      metadata: thought.metadata,
      createdAt: thought.createdAt,
    };
  }

  /**
   * Retrieve recent thoughts, optionally filtered by scan.
   */
  async getThoughts(opts: {
    scanId?: string;
    limit?: number;
    thoughtType?: AIThoughtType;
  } = {}): Promise<AIThoughtRecord[]> {
    const { scanId, limit = 50, thoughtType } = opts;

    const where: any = {};
    if (scanId) where.scanId = scanId;
    if (thoughtType) where.thoughtType = thoughtType;

    const thoughts = await prisma.aIThought.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return thoughts.map((t) => ({
      id: t.id,
      scanId: t.scanId,
      thoughtType: t.thoughtType as AIThoughtType,
      content: t.content,
      command: t.command,
      metadata: t.metadata,
      createdAt: t.createdAt,
    }));
  }

  /**
   * Get a single thought by ID.
   */
  async getThought(id: string): Promise<AIThoughtRecord | null> {
    const t = await prisma.aIThought.findUnique({ where: { id } });
    if (!t) return null;

    return {
      id: t.id,
      scanId: t.scanId,
      thoughtType: t.thoughtType as AIThoughtType,
      content: t.content,
      command: t.command,
      metadata: t.metadata,
      createdAt: t.createdAt,
    };
  }

  /**
   * Perform an AI analysis request against the configured provider.
   * Records the prompt as AI_PROMPT, calls the provider, records the
   * response as AI_RESPONSE, and emits both via WebSocket.
   */
  async analyze(input: AIAnalyzeInput): Promise<AIAnalyzeResult> {
    const config = await this.getProviderConfig();

    const systemPrompt = this.buildSystemPrompt(input.target);

    // Record the prompt — include full prompt details for the AI Stream UI
    const promptThought = await this.recordThought({
      thoughtType: 'AI_PROMPT',
      content: input.prompt,
      scanId: input.scanId,
      metadata: {
        target: input.target,
        provider: config.provider,
        model: config.model,
        mode: input.mode,
        system_prompt: systemPrompt,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
      },
    });

    emitLogEntry({
      level: 'INFO',
      source: 'ai',
      message: `AI analysis via ${config.provider}/${config.model} (scan: ${input.scanId ?? 'none'})`,
    });

    try {
      const responseContent = await this.callProvider(config, input);

      // Extract any commands from the response (lines starting with $ or >)
      const commands = this.extractCommands(responseContent);

      // Record the response — include full response for the AI Stream UI
      await this.recordThought({
        thoughtType: 'AI_RESPONSE',
        content: responseContent,
        scanId: input.scanId,
        metadata: {
          provider: config.provider,
          model: config.model,
          promptId: promptThought.id,
          commandCount: commands.length,
          response: responseContent,
          commands: commands.length > 0 ? commands : undefined,
        },
      });

      // Emit any extracted commands
      for (const cmd of commands) {
        emitAICommandExecution({ command: cmd, status: 'pending' });

        await this.recordThought({
          thoughtType: 'AI_EXECUTION',
          content: `Command extracted: ${cmd}`,
          command: cmd,
          scanId: input.scanId,
        });
      }

      return {
        thoughtId: promptThought.id,
        provider: config.provider,
        model: config.model,
        content: responseContent,
        commands: commands.length > 0 ? commands : undefined,
        status: 'complete',
      };
    } catch (err: any) {
      const errMsg = err.message ?? String(err);

      await this.recordThought({
        thoughtType: 'AI_RESPONSE',
        content: `Error: ${errMsg}`,
        scanId: input.scanId,
        metadata: { error: errMsg, provider: config.provider },
      });

      emitLogEntry({
        level: 'ERROR',
        source: 'ai',
        message: `AI provider error (${config.provider}): ${errMsg}`,
      });

      return {
        thoughtId: promptThought.id,
        provider: config.provider,
        model: config.model,
        content: '',
        status: 'error',
        error: errMsg,
      };
    }
  }

  /**
   * Record an AI decision (used by agentic scan pipeline when the AI decides
   * which tool to run next).
   */
  async recordDecision(opts: {
    decision: string;
    rationale: string;
    selectedTool?: string;
    scanId?: string;
  }): Promise<AIThoughtRecord> {
    return this.recordThought({
      thoughtType: 'AI_DECISION',
      content: opts.decision,
      command: opts.selectedTool,
      scanId: opts.scanId,
      metadata: { rationale: opts.rationale },
    });
  }

  /**
   * Record an observation (used when AI processes scan results).
   */
  async recordObservation(opts: {
    observation: string;
    source: string;
    scanId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AIThoughtRecord> {
    return this.recordThought({
      thoughtType: 'OBSERVATION',
      content: opts.observation,
      scanId: opts.scanId,
      metadata: { source: opts.source, ...opts.metadata },
    });
  }

  // ── Provider dispatching ──────────────────────────────────────────────────

  private async callProvider(config: AIProviderConfig, input: AIAnalyzeInput): Promise<string> {
    switch (config.provider) {
      case 'openai':
        return this.callOpenAI(config, input);
      case 'anthropic':
        return this.callAnthropic(config, input);
      case 'grok':
        return this.callGrok(config, input);
      case 'ollama':
        return this.callOllama(config, input);
      default:
        throw new Error(`Unknown AI provider: ${config.provider}`);
    }
  }

  private async callOpenAI(config: AIProviderConfig, input: AIAnalyzeInput): Promise<string> {
    if (!config.apiKey) throw new Error('OpenAI API key not configured');

    const body = {
      model: config.model,
      messages: [
        { role: 'system', content: this.buildSystemPrompt(input.target) },
        { role: 'user', content: input.prompt },
      ],
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${text}`);
    }

    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content ?? '';
  }

  private async callAnthropic(config: AIProviderConfig, input: AIAnalyzeInput): Promise<string> {
    if (!config.apiKey) throw new Error('Anthropic API key not configured');

    const body = {
      model: config.model,
      system: this.buildSystemPrompt(input.target),
      messages: [{ role: 'user', content: input.prompt }],
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${text}`);
    }

    const data = await response.json() as any;
    return data.content?.[0]?.text ?? '';
  }

  private async callGrok(config: AIProviderConfig, input: AIAnalyzeInput): Promise<string> {
    if (!config.apiKey) throw new Error('Grok API key not configured');

    // Grok uses OpenAI-compatible API
    const body = {
      model: config.model,
      messages: [
        { role: 'system', content: this.buildSystemPrompt(input.target) },
        { role: 'user', content: input.prompt },
      ],
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    };

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Grok API error ${response.status}: ${text}`);
    }

    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content ?? '';
  }

  private async callOllama(config: AIProviderConfig, input: AIAnalyzeInput): Promise<string> {
    const baseUrl = config.ollamaUrl.replace(/\/$/, '');

    // Use /api/chat (supports both local and cloud/remote models)
    const body = {
      model: config.model,
      messages: [
        { role: 'system', content: this.buildSystemPrompt(input.target) },
        { role: 'user', content: input.prompt },
      ],
      stream: false,
      think: false, // Disable CoT reasoning for speed (qwen3, etc.)
      options: {
        temperature: config.temperature,
        num_predict: config.maxTokens,
      },
    };

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000), // 2 min timeout
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${text}`);
    }

    const data = await response.json() as any;
    return data.message?.content ?? '';
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async getProviderConfig(): Promise<AIProviderConfig> {
    const [
      provider,
      temperature,
      maxTokens,
      ollamaUrl,
    ] = await Promise.all([
      getConfigValue('ai_provider', 'openai'),
      getConfigValue('ai_temperature', 0.7),
      getConfigValue('ai_max_tokens', 4096),
      getConfigValue('ollama_url', 'http://localhost:11434'),
    ]);

    const providerStr = String(provider);

    // Fetch model and API key for the active provider
    const [model, apiKey] = await Promise.all([
      getConfigValue(`${providerStr}_model`, this.defaultModel(providerStr)),
      getConfigValue(`${providerStr}_api_key`, ''),
    ]);

    return {
      provider: providerStr,
      model: String(model),
      apiKey: String(apiKey),
      temperature: Number(temperature),
      maxTokens: Number(maxTokens),
      ollamaUrl: String(ollamaUrl),
    };
  }

  private defaultModel(provider: string): string {
    const defaults: Record<string, string> = {
      openai: 'gpt-4o',
      anthropic: 'claude-sonnet-4-20250514',
      grok: 'grok-2',
      ollama: 'llama3',
    };
    return defaults[provider] ?? 'gpt-4o';
  }

  private buildSystemPrompt(target?: string): string {
    const base = `You are an expert offensive security analyst and red team operator.
Your role is to analyze scan results, identify vulnerabilities, and suggest next steps.
Always prioritize critical and high severity findings.
When recommending commands, use standard security tool syntax.
Format any commands on their own line prefixed with "$ ".`;

    return target ? `${base}\nCurrent target: ${target}` : base;
  }

  /**
   * Extract shell commands from AI response text.
   * Looks for lines starting with "$ " or enclosed in code blocks.
   */
  private extractCommands(text: string): string[] {
    const commands: string[] = [];
    const seen = new Set<string>();

    // Lines starting with "$ "
    const lineRe = /^\$\s+(.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = lineRe.exec(text)) !== null) {
      const cmd = m[1].trim();
      if (!seen.has(cmd)) {
        seen.add(cmd);
        commands.push(cmd);
      }
    }

    // Fenced code blocks (```\ncommand\n```)
    const blockRe = /```(?:bash|sh)?\n([\s\S]*?)```/g;
    while ((m = blockRe.exec(text)) !== null) {
      const lines = m[1].split('\n');
      for (const line of lines) {
        const trimmed = line.replace(/^\$\s*/, '').trim();
        if (trimmed && !seen.has(trimmed)) {
          seen.add(trimmed);
          commands.push(trimmed);
        }
      }
    }

    return commands;
  }
}

export const aiService = new AIService();
