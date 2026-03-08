/**
 * MCP Bridge — communicates with the Python MCP (Model Context Protocol) server
 * via stdio JSON-RPC 2.0. The Python process is spawned on first use and kept alive
 * for the lifetime of the API process. Requests are serialized through a queue so
 * only one RPC is in-flight at a time (MCP stdio transport is single-threaded).
 *
 * Protocol: newline-delimited JSON-RPC 2.0 over stdin/stdout.
 * https://spec.modelcontextprotocol.io/specification/
 */

import { spawn, ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { env } from '../config/env.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MCPTool {
  name: string;
  description: string;
  category: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface MCPToolResult {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  error?: string;
  duration: number;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── Bridge class ──────────────────────────────────────────────────────────────

class MCPBridge {
  private process: ChildProcess | null = null;
  private pendingRequests = new Map<number, PendingRequest>();
  private nextId = 1;
  private initialized = false;
  private initializingPromise: Promise<void> | null = null;

  // Request timeout in ms
  private readonly REQUEST_TIMEOUT = 60_000;

  // Path to the Python MCP server entry point
  private readonly MCP_SERVER_PATH = process.env.MCP_SERVER_PATH ?? '/app/mcp/server.py';
  private readonly PYTHON_BIN = process.env.PYTHON_BIN ?? 'python3';

  /**
   * Send a JSON-RPC request to the MCP server and return the result.
   * Spawns the server process on first call.
   */
  async call(method: string, params?: unknown): Promise<unknown> {
    await this.ensureStarted();

    return new Promise((resolve, reject) => {
      const id = this.nextId++;

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request timed out: ${method} (id=${id})`));
      }, this.REQUEST_TIMEOUT);

      this.pendingRequests.set(id, { resolve, reject, timer });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      const line = JSON.stringify(request) + '\n';

      if (!this.process?.stdin?.writable) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(new Error('MCP server stdin is not writable'));
        return;
      }

      this.process.stdin.write(line, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendingRequests.delete(id);
          reject(new Error(`MCP write error: ${err.message}`));
        }
      });
    });
  }

  /**
   * List available tools from the MCP server.
   */
  async listTools(): Promise<MCPTool[]> {
    try {
      const result = await this.call('tools/list') as { tools?: MCPTool[] };
      return result?.tools ?? [];
    } catch (err: any) {
      console.error('[MCP] listTools error:', err.message);
      return [];
    }
  }

  /**
   * Execute a named tool with the given arguments.
   */
  async executeTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    const startTime = Date.now();

    try {
      const result = await this.call('tools/call', {
        name: toolName,
        arguments: args,
      });

      return {
        tool: toolName,
        args,
        result,
        duration: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        tool: toolName,
        args,
        result: null,
        error: err.message ?? String(err),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Initialize the MCP session (JSON-RPC initialize handshake).
   */
  async initialize(): Promise<void> {
    const result = await this.call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      clientInfo: {
        name: 'cstrike-api',
        version: '2.0.0',
      },
    });

    // Send initialized notification (no response expected)
    const notification = JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }) + '\n';

    this.process?.stdin?.write(notification);

    console.log('[MCP] Initialized:', JSON.stringify(result));
  }

  /**
   * Check if the MCP server process is alive.
   */
  isRunning(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  /**
   * Shutdown the MCP server process cleanly.
   */
  async shutdown(): Promise<void> {
    if (!this.process) return;

    try {
      await this.call('shutdown');
    } catch {
      // Best effort
    }

    this.process.kill('SIGTERM');
    this.process = null;
    this.initialized = false;
    this.initializingPromise = null;

    // Reject any pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('MCP server shut down'));
    }
    this.pendingRequests.clear();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Ensure the server is started and initialized. Thread-safe via promise lock.
   */
  private async ensureStarted(): Promise<void> {
    if (this.initialized && this.isRunning()) return;

    if (this.initializingPromise) {
      return this.initializingPromise;
    }

    this.initializingPromise = this.startServer();

    try {
      await this.initializingPromise;
    } finally {
      this.initializingPromise = null;
    }
  }

  private async startServer(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    console.log(`[MCP] Spawning Python MCP server: ${this.PYTHON_BIN} ${this.MCP_SERVER_PATH}`);

    this.process = spawn(this.PYTHON_BIN, [this.MCP_SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      uid: 1000,
      gid: 1000,
      env: {
        ...process.env,
        HOME: '/tmp',
        USER: 'cstrike-ops',
        PATH: `${env.HOST_LOCAL_BIN_PATH}:${env.HOST_BIN_PATH}:${env.HOST_SBIN_PATH}:${process.env.PATH}`,
        PYTHONUNBUFFERED: '1',
      },
    });

    // Route stderr to our console
    this.process.stderr?.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        console.log(`[MCP/Python] ${line}`);
      }
    });

    // Parse newline-delimited JSON-RPC responses from stdout
    const rl = createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      if (!line.trim()) return;
      this.handleResponse(line);
    });

    this.process.on('exit', (code, signal) => {
      console.warn(`[MCP] Python server exited (code=${code}, signal=${signal})`);
      this.initialized = false;
      this.process = null;

      // Reject all pending requests
      for (const pending of this.pendingRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`MCP server exited (code=${code})`));
      }
      this.pendingRequests.clear();
    });

    this.process.on('error', (err) => {
      console.error('[MCP] Process error:', err.message);
      this.initialized = false;
    });

    // Wait briefly for the process to be ready, then initialize
    await new Promise((r) => setTimeout(r, 500));

    if (!this.isRunning()) {
      throw new Error('MCP server process failed to start');
    }

    await this.initialize();
    this.initialized = true;
    console.log('[MCP] Bridge ready');
  }

  // ── JSON-RPC response handler ─────────────────────────────────────────────

  private handleResponse(line: string): void {
    let response: JsonRpcResponse;

    try {
      response = JSON.parse(line);
    } catch {
      console.warn('[MCP] Failed to parse response line:', line.substring(0, 200));
      return;
    }

    // Ignore notifications (no id field)
    if (response.id === undefined) return;

    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      console.warn(`[MCP] Received response for unknown id: ${response.id}`);
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(
        new Error(
          `MCP error ${response.error.code}: ${response.error.message}`,
        ),
      );
    } else {
      pending.resolve(response.result);
    }
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const mcpBridge = new MCPBridge();

// Graceful shutdown hook
process.on('SIGTERM', () => {
  mcpBridge.shutdown().catch(() => {});
});
process.on('SIGINT', () => {
  mcpBridge.shutdown().catch(() => {});
});
