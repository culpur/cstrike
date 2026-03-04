/**
 * Service lifecycle manager — start/stop/restart Metasploit, ZAP, Burp.
 *
 * Docker-managed services (metasploit, zap) use the Docker Engine API
 * via the mounted socket at /var/run/docker.sock.
 * Local services (burp) fall back to spawn-based management.
 */

import { spawn } from 'node:child_process';
import { accessSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { env } from '../config/env.js';
import { getConfigValue } from '../middleware/guardrails.js';

export interface ServiceResult {
  pid?: number;
  error?: string;
}

/** Docker-managed services — run as sibling containers */
const DOCKER_SERVICES: Record<string, {
  containerName: string;
  healthUrl?: string;   // HTTP health endpoint (ZAP)
  healthPort?: number;  // TCP port probe (MSF — msfrpcd has no REST API)
}> = {
  metasploit: {
    containerName: 'cstrike-msf',
    healthPort: env.MSF_PORT,
  },
  zap: {
    containerName: 'cstrike-zap',
    healthUrl: `http://127.0.0.1:${env.ZAP_PORT}/JSON/core/view/version/`,
  },
};

/** Locally-spawned services (not containerised) */
const LOCAL_SERVICE_COMMANDS: Record<string, {
  start: string[];
  stop: string[];
}> = {
  burp: {
    start: ['java', '-jar', '/opt/BurpSuitePro/burpsuite_pro.jar', '--unpause-spider-and-scanner'],
    stop: ['pkill', '-f', 'burpsuite'],
  },
};

function resolveCommand(cmd: string): string {
  const paths = [
    env.HOST_LOCAL_BIN_PATH,
    env.HOST_BIN_PATH,
    env.HOST_SBIN_PATH,
    `${env.HOST_OPT_PATH}/metasploit-framework/bin`,
  ];

  for (const p of paths) {
    const full = `${p}/${cmd}`;
    try {
      accessSync(full);
      return full;
    } catch {
      continue;
    }
  }
  return cmd;
}

/**
 * Call the Docker Engine API via the unix socket.
 * Returns the HTTP status code (204 = success, 304 = already in that state).
 */
function dockerApiPost(containerName: string, action: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: '/var/run/docker.sock',
        path: `/v1.41/containers/${containerName}/${action}`,
        method: 'POST',
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 500, body });
        });
      },
    );
    req.on('error', (err) => reject(err));
    req.setTimeout(30_000, () => {
      req.destroy(new Error('Docker API timeout'));
    });
    req.end();
  });
}

/**
 * Probe an HTTP health endpoint with a timeout.
 */
export async function probeHealth(url: string, timeoutMs = 5000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Probe a TCP port — returns true if the port accepts connections.
 * Used for services like msfrpcd that don't have a REST health endpoint.
 */
export function probeTcpPort(port: number, host = '127.0.0.1', timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

/**
 * Check if a Docker-managed service is healthy.
 */
export async function isDockerServiceHealthy(name: string): Promise<boolean> {
  const dSvc = DOCKER_SERVICES[name];
  if (!dSvc) return false;

  if (dSvc.healthUrl) {
    return probeHealth(dSvc.healthUrl);
  }
  if (dSvc.healthPort) {
    return probeTcpPort(dSvc.healthPort);
  }
  return false;
}

/**
 * Returns true if the given service name is managed by Docker Compose.
 */
export function isDockerManaged(name: string): boolean {
  return name in DOCKER_SERVICES;
}

class ServiceManager {
  async execute(name: string, action: 'start' | 'stop' | 'restart'): Promise<ServiceResult> {
    // Docker-managed services
    if (name in DOCKER_SERVICES) {
      return this.executeDocker(name, action);
    }

    // Local services
    return this.executeLocal(name, action);
  }

  private async executeDocker(name: string, action: 'start' | 'stop' | 'restart'): Promise<ServiceResult> {
    const dSvc = DOCKER_SERVICES[name];

    try {
      const result = await dockerApiPost(dSvc.containerName, action);

      // 204 = success, 304 = already in that state (both OK)
      if (result.statusCode === 204 || result.statusCode === 304) {
        // For start/restart, wait a moment then check health
        if (action === 'start' || action === 'restart') {
          await new Promise((r) => setTimeout(r, 3000));
          const healthy = await isDockerServiceHealthy(name);
          if (!healthy) {
            return { error: `${name} container started but health check failed` };
          }
        }
        return {};
      }

      // 404 = container not found
      if (result.statusCode === 404) {
        return { error: `Container ${dSvc.containerName} not found — is Docker Compose running?` };
      }

      return { error: `Docker API returned ${result.statusCode}: ${result.body}` };
    } catch (err: any) {
      // Docker socket not available
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
        return { error: `Docker socket unavailable — cannot manage ${name} container` };
      }
      return { error: `Docker API error: ${err.message}` };
    }
  }

  private async executeLocal(name: string, action: 'start' | 'stop' | 'restart'): Promise<ServiceResult> {
    const cmds = LOCAL_SERVICE_COMMANDS[name];
    if (!cmds) {
      return { error: `Unknown service: ${name}` };
    }

    if (action === 'restart') {
      await this.executeLocal(name, 'stop');
      await new Promise((r) => setTimeout(r, 2000));
      return this.executeLocal(name, 'start');
    }

    const cmdArgs = action === 'start' ? cmds.start : cmds.stop;
    const executable = resolveCommand(cmdArgs[0]);
    const args = cmdArgs.slice(1);

    return new Promise((resolve) => {
      try {
        const child = spawn(executable, args, {
          detached: true,
          stdio: 'ignore',
        });

        child.on('error', (err: any) => {
          resolve({ error: `${executable}: ${err.message}` });
        });

        child.unref();

        if (action === 'start') {
          setTimeout(() => {
            resolve({ pid: child.pid });
          }, 1500);
        } else {
          resolve({});
        }
      } catch (err: any) {
        resolve({ error: err.message });
      }
    });
  }
}

export const serviceManager = new ServiceManager();
