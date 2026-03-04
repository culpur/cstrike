/**
 * Terminal routes — interactive shell sessions and one-shot command execution.
 *
 * POST   /api/v1/terminal/execute                 — streaming command (local)
 * POST   /api/v1/terminal/sessions                — create SSH/shell session
 * GET    /api/v1/terminal/sessions                — list active sessions
 * DELETE /api/v1/terminal/sessions/:id            — close a session
 * POST   /api/v1/terminal/sessions/:id/execute    — execute in specific session
 */

import { Router } from 'express';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { AppError } from '../middleware/errorHandler.js';
import {
  emitTerminalOutput,
  emitTerminalSessionCreated,
  emitTerminalSessionClosed,
} from '../websocket/emitter.js';

export const terminalRouter = Router();

// ── In-memory session registry ────────────────────────────────────────────────

export type SessionType = 'local' | 'ssh' | 'reverse_shell' | 'bind_shell';

export interface SessionInfo {
  id: string;
  type: SessionType;
  target: string;
  host: string;
  port: number;
  user?: string;
  password?: string;
  createdAt: number;
  lastActivity: number;
  active: boolean;
  process?: ChildProcess;
  outputBuffer: string[];
}

const sessions = new Map<string, SessionInfo>();

// Maximum lines to keep in the per-session output buffer
const MAX_BUFFER_LINES = 2000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function appendToBuffer(session: SessionInfo, chunk: string) {
  const lines = chunk.split('\n');
  session.outputBuffer.push(...lines);
  if (session.outputBuffer.length > MAX_BUFFER_LINES) {
    session.outputBuffer = session.outputBuffer.slice(-MAX_BUFFER_LINES);
  }
  session.lastActivity = Date.now();
}

/** Strip ANSI escape codes for clean log output while preserving them in WS emit */
function cleanForLog(s: string) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[mGKHF]/g, '').replace(/\r/g, '');
}

// ── POST /terminal/execute ────────────────────────────────────────────────────

terminalRouter.post('/execute', async (req, res, next) => {
  try {
    const { command, sessionId, target } = req.body as {
      command?: string;
      sessionId?: string;
      target?: string;
    };

    if (!command || !command.trim()) {
      throw new AppError(400, 'command is required');
    }

    // If a sessionId is provided and the session exists, delegate to that session
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      if (!session.active) {
        throw new AppError(400, `Session ${sessionId} is no longer active`);
      }

      if (session.process && session.process.stdin) {
        // Write command to the running process stdin
        session.process.stdin.write(`${command.trim()}\n`);
        session.lastActivity = Date.now();
        return res.json({
          success: true,
          data: {
            sessionId,
            output: '',
            exitCode: 0,
            message: 'Command sent to session stdin',
          },
          timestamp: Date.now(),
        });
      }
    }

    // Streaming local execution via spawn
    const execSessionId = sessionId ?? `local-${Date.now()}`;

    // Create a transient session so the process is tracked and can receive stdin
    const now = Date.now();
    const transientSession: SessionInfo = {
      id: execSessionId,
      type: 'local',
      target: 'localhost',
      host: 'localhost',
      port: 0,
      createdAt: now,
      lastActivity: now,
      active: true,
      outputBuffer: [],
    };

    const proc = spawn('/bin/bash', ['-c', command], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    transientSession.process = proc;
    sessions.set(execSessionId, transientSession);

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      appendToBuffer(transientSession, text);
      emitTerminalOutput({ sessionId: execSessionId, output: text });
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      appendToBuffer(transientSession, text);
      emitTerminalOutput({ sessionId: execSessionId, output: text });
    });

    proc.on('close', (code) => {
      const s = sessions.get(execSessionId);
      if (s) {
        s.active = false;
        s.process = undefined;
      }
      emitTerminalOutput({
        sessionId: execSessionId,
        output: `\n[Process exited with code ${code ?? 0}]`,
      });
    });

    proc.on('error', (err) => {
      emitTerminalOutput({
        sessionId: execSessionId,
        output: `[ERROR] ${err.message}\n`,
      });
      const s = sessions.get(execSessionId);
      if (s) {
        s.active = false;
        s.process = undefined;
      }
    });

    // Return immediately — output streams via WebSocket
    return res.json({
      success: true,
      data: { sessionId: execSessionId, output: '', exitCode: 0, streaming: true },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /terminal/sessions ───────────────────────────────────────────────────

terminalRouter.post('/sessions', async (req, res, next) => {
  try {
    const { type, host, port, user, password, target } = req.body as {
      type?: SessionType;
      host?: string;
      port?: number;
      user?: string;
      password?: string;
      target?: string;
    };

    const sessionType: SessionType = type ?? 'local';
    const sessionHost = host ?? target ?? 'localhost';
    const sessionPort = port ?? (sessionType === 'ssh' ? 22 : 4444);
    const sessionUser = user;

    const id = randomUUID();
    const now = Date.now();

    const session: SessionInfo = {
      id,
      type: sessionType,
      target: target ?? sessionHost,
      host: sessionHost,
      port: sessionPort,
      user: sessionUser,
      password: password,
      createdAt: now,
      lastActivity: now,
      active: true,
      outputBuffer: [],
    };

    // For SSH sessions, spawn a persistent SSH connection
    if (sessionType === 'ssh') {
      if (!sessionHost || sessionHost === 'localhost') {
        throw new AppError(400, 'host is required for SSH sessions');
      }

      const sshArgs: string[] = [
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'ConnectTimeout=10',
        '-o', 'ServerAliveInterval=30',
        '-o', 'ServerAliveCountMax=3',
        '-tt',
        '-p', String(sessionPort),
      ];

      if (sessionUser) {
        sshArgs.push(`${sessionUser}@${sessionHost}`);
      } else {
        sshArgs.push(sessionHost);
      }

      // Use sshpass for password-based authentication
      let spawnCmd: string;
      let spawnArgs: string[];
      if (password) {
        spawnCmd = 'sshpass';
        spawnArgs = ['-p', password, 'ssh', ...sshArgs];
      } else {
        spawnCmd = 'ssh';
        spawnArgs = sshArgs;
      }

      const sshProcess = spawn(spawnCmd, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, TERM: 'xterm-256color' },
      });

      session.process = sshProcess;

      sshProcess.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        appendToBuffer(session, text);
        emitTerminalOutput({ sessionId: id, output: text });
      });

      sshProcess.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        appendToBuffer(session, text);
        emitTerminalOutput({ sessionId: id, output: text });
      });

      sshProcess.on('close', (code) => {
        console.log(`[Terminal] Session ${id} SSH process exited (code=${code})`);
        const s = sessions.get(id);
        if (s) {
          s.active = false;
          s.process = undefined;
        }
        emitTerminalSessionClosed({ sessionId: id });
      });

      sshProcess.on('error', (err) => {
        console.error(`[Terminal] Session ${id} SSH error:`, err.message);
        const s = sessions.get(id);
        if (s) {
          s.active = false;
        }
        emitTerminalOutput({ sessionId: id, output: `[SSH ERROR] ${err.message}\n` });
        emitTerminalSessionClosed({ sessionId: id });
      });
    }

    sessions.set(id, session);

    const responseData = {
      id: session.id,
      type: session.type,
      target: session.target,
      host: session.host,
      port: session.port,
      user: session.user,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      active: session.active,
    };

    emitTerminalSessionCreated({
      sessionId: id,
      type: sessionType,
      target: session.target,
    });

    console.log(`[Terminal] Session created: ${id} (${sessionType} → ${sessionHost}:${sessionPort})`);

    return res.status(201).json({
      success: true,
      data: responseData,
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /terminal/sessions ────────────────────────────────────────────────────

terminalRouter.get('/sessions', (_req, res) => {
  const list = Array.from(sessions.values()).map((s) => ({
    id: s.id,
    type: s.type,
    target: s.target,
    host: s.host,
    port: s.port,
    user: s.user,
    createdAt: s.createdAt,
    lastActivity: s.lastActivity,
    active: s.active,
    bufferedLines: s.outputBuffer.length,
  }));

  res.json({
    success: true,
    data: list,
    timestamp: Date.now(),
  });
});

// ── DELETE /terminal/sessions/:id ─────────────────────────────────────────────

terminalRouter.delete('/sessions/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const session = sessions.get(id);

    if (!session) {
      throw new AppError(404, `Session ${id} not found`);
    }

    // Kill the subprocess if present
    if (session.process) {
      try {
        session.process.kill('SIGTERM');
      } catch {
        // process may have already exited
      }
    }

    session.active = false;
    sessions.delete(id);

    emitTerminalSessionClosed({ sessionId: id });

    console.log(`[Terminal] Session closed: ${id}`);

    res.json({
      success: true,
      data: { sessionId: id, closed: true },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /terminal/sessions/:id/execute ──────────────────────────────────────

terminalRouter.post('/sessions/:id/execute', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { command } = req.body as { command?: string };

    if (!command || !command.trim()) {
      throw new AppError(400, 'command is required');
    }

    const session = sessions.get(id);
    if (!session) {
      throw new AppError(404, `Session ${id} not found`);
    }
    if (!session.active) {
      throw new AppError(400, `Session ${id} is no longer active`);
    }

    session.lastActivity = Date.now();

    // If session has a live process (SSH, etc.) write to its stdin
    if (session.process && session.process.stdin) {
      session.process.stdin.write(`${command.trim()}\n`);

      return res.json({
        success: true,
        data: {
          sessionId: id,
          output: '',
          exitCode: 0,
          message: 'Command sent to session',
        },
        timestamp: Date.now(),
      });
    }

    // Spawn a streaming local process for this session
    const proc = spawn('/bin/bash', ['-c', command.trim()], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    session.process = proc;

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      appendToBuffer(session, text);
      emitTerminalOutput({ sessionId: id, output: text });
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      appendToBuffer(session, text);
      emitTerminalOutput({ sessionId: id, output: text });
    });

    proc.on('close', (code) => {
      session.process = undefined;
      emitTerminalOutput({
        sessionId: id,
        output: `\n[Process exited with code ${code ?? 0}]`,
      });
      console.log(
        `[Terminal] ${id} executed: ${cleanForLog(command.trim()).substring(0, 80)}, exit=${code}`,
      );
    });

    proc.on('error', (err) => {
      session.process = undefined;
      emitTerminalOutput({ sessionId: id, output: `[ERROR] ${err.message}\n` });
    });

    return res.json({
      success: true,
      data: { sessionId: id, output: '', exitCode: 0, streaming: true },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /terminal/sessions/:id/output ────────────────────────────────────────
// Returns buffered output for a session (useful on reconnect / tab switch)

terminalRouter.get('/sessions/:id/output', (req, res, next) => {
  try {
    const { id } = req.params;
    const session = sessions.get(id);

    if (!session) {
      throw new AppError(404, `Session ${id} not found`);
    }

    res.json({
      success: true,
      data: {
        sessionId: id,
        lines: session.outputBuffer,
        active: session.active,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});
