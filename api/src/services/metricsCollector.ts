/**
 * System metrics collector — emits CPU, memory, VPN IP, uptime via WebSocket.
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { env } from '../config/env.js';
import { getConfigValue } from '../middleware/guardrails.js';
import { emitSystemMetrics } from '../websocket/emitter.js';

const startTime = Date.now();

// Previous /proc/stat snapshot for delta-based CPU calculation
let prevCpuIdle = 0;
let prevCpuTotal = 0;

function getCpuUsage(): number {
  try {
    const stat = readFileSync('/proc/stat', 'utf-8');
    const cpuLine = stat.split('\n')[0]; // "cpu  user nice system idle ..."
    const fields = cpuLine.split(/\s+/).slice(1).map(Number);
    const idle = fields[3] + (fields[4] || 0); // idle + iowait
    const total = fields.reduce((a, b) => a + b, 0);

    if (prevCpuTotal === 0) {
      prevCpuIdle = idle;
      prevCpuTotal = total;
      return 0;
    }

    const deltaIdle = idle - prevCpuIdle;
    const deltaTotal = total - prevCpuTotal;
    prevCpuIdle = idle;
    prevCpuTotal = total;

    if (deltaTotal === 0) return 0;
    return Math.round((1 - deltaIdle / deltaTotal) * 1000) / 10;
  } catch {
    return 0;
  }
}

function getMemoryUsage(): number {
  try {
    const meminfo = readFileSync('/proc/meminfo', 'utf-8');
    const lines = meminfo.split('\n');
    const getValue = (key: string) => {
      const line = lines.find(l => l.startsWith(key));
      return line ? parseInt(line.split(/\s+/)[1], 10) : 0;
    };
    const total = getValue('MemTotal:');
    const available = getValue('MemAvailable:');
    if (total === 0) return 0;
    return Math.round((1 - available / total) * 1000) / 10;
  } catch {
    return 0;
  }
}

function getVpnIp(): string | null {
  try {
    for (const iface of ['wg0', 'tun0', 'tailscale0', 'nordlynx']) {
      const output = execSync(
        `ip -4 addr show ${iface} 2>/dev/null | grep -oP '(?<=inet )\\S+' | cut -d/ -f1`,
        { timeout: 2000, encoding: 'utf-8' },
      );
      const ip = output.trim();
      if (ip) return ip;
    }
    return null;
  } catch {
    return null;
  }
}

// Network interface cache (polled every 2 minutes, not every 2 seconds)
let networkCache = {
  mgmtIpInternal: null as string | null,
  mgmtIpPublic: null as string | null,
  opsIpInternal: null as string | null,
  opsIpPublic: null as string | null,
  lastPoll: 0,
};

// Parse Redis host:port from REDIS_URL (e.g. redis://:password@host:port)
function parseRedisHostPort(): { host: string; port: string } {
  try {
    const url = new URL(env.REDIS_URL);
    return { host: url.hostname || 'localhost', port: url.port || '6379' };
  } catch {
    return { host: 'localhost', port: '6379' };
  }
}

const redisConn = parseRedisHostPort();

// Cached Ollama URL (re-read from config every 5 min)
let ollamaUrlCache = 'http://localhost:11434';
let ollamaUrlLastFetch = 0;

async function refreshOllamaUrl() {
  const now = Date.now();
  if (now - ollamaUrlLastFetch < 300_000) return; // 5 min cache
  ollamaUrlLastFetch = now;
  try {
    const val = await getConfigValue('ollama_url', 'http://localhost:11434');
    ollamaUrlCache = String(val).replace(/\/$/, '');
  } catch { /* config DB not ready yet — keep default */ }
}

function parseHostPort(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    return `${url.hostname}:${url.port || '11434'}`;
  } catch {
    return urlStr;
  }
}

// Service health cache (polled every 30 seconds)
let serviceHealthCache = {
  postgresql: 'stopped' as string,
  redis: 'stopped' as string,
  ollama: 'stopped' as string,
  docker: 'stopped' as string,
  lastPoll: 0,
};

function getInterfaceIp(iface: string): string | null {
  try {
    const output = execSync(
      `ip -4 addr show ${iface} 2>/dev/null | grep -oP '(?<=inet )\\S+' | cut -d/ -f1`,
      { timeout: 2000, encoding: 'utf-8' },
    );
    return output.trim() || null;
  } catch {
    return null;
  }
}

function getPublicIp(): string | null {
  try {
    return execSync('curl -s --max-time 3 ifconfig.me 2>/dev/null', { timeout: 5000, encoding: 'utf-8' }).trim() || null;
  } catch {
    return null;
  }
}

function pollNetworkInterfaces() {
  const now = Date.now();
  if (now - networkCache.lastPoll < 120_000) return; // 2 min cache
  networkCache.lastPoll = now;

  networkCache.mgmtIpInternal = getInterfaceIp('eth0') ?? getInterfaceIp('ens18') ?? getInterfaceIp('ens3');
  networkCache.mgmtIpPublic = getPublicIp();
  networkCache.opsIpInternal = getInterfaceIp('tun0') ?? getInterfaceIp('wg0');
  networkCache.opsIpPublic = null; // VPN public IP tracked via vpnIp
}

function checkServiceCmd(cmd: string): string {
  try {
    execSync(cmd, { timeout: 3000, encoding: 'utf-8', stdio: 'pipe' });
    return 'running';
  } catch {
    return 'stopped';
  }
}

async function pollServiceHealth() {
  const now = Date.now();
  if (now - serviceHealthCache.lastPoll < 30_000) return; // 30s cache
  serviceHealthCache.lastPoll = now;

  await refreshOllamaUrl();

  serviceHealthCache.postgresql = checkServiceCmd('pg_isready -h localhost -p 5432 2>/dev/null');
  serviceHealthCache.redis = checkServiceCmd(`redis-cli -h ${redisConn.host} -p ${redisConn.port} ping 2>/dev/null`);
  serviceHealthCache.ollama = checkServiceCmd(`curl -s --max-time 2 ${ollamaUrlCache}/api/version 2>/dev/null`);
  serviceHealthCache.docker = checkServiceCmd('docker info --format "{{.ServerVersion}}" 2>/dev/null');
}

let intervalId: ReturnType<typeof setInterval> | null = null;
let latestMetrics: {
  cpu: number; memory: number; vpnIp: string | null; uptime: number; timestamp: number;
  mgmtIpInternal?: string | null; mgmtIpPublic?: string | null;
  opsIpInternal?: string | null; opsIpPublic?: string | null;
  serviceHealth?: Record<string, string>;
  serviceHosts?: Record<string, string>;
} = { cpu: 0, memory: 0, vpnIp: null, uptime: 0, timestamp: 0 };

export function getLatestMetrics() {
  return latestMetrics;
}

export function startMetricsCollector() {
  if (intervalId) return;

  // Initial network poll
  pollNetworkInterfaces();
  pollServiceHealth();

  intervalId = setInterval(() => {
    // These run on their own interval caching internally
    pollNetworkInterfaces();
    pollServiceHealth();

    latestMetrics = {
      cpu: getCpuUsage(),
      memory: getMemoryUsage(),
      vpnIp: getVpnIp(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      timestamp: Date.now(),
      mgmtIpInternal: networkCache.mgmtIpInternal,
      mgmtIpPublic: networkCache.mgmtIpPublic,
      opsIpInternal: networkCache.opsIpInternal,
      opsIpPublic: networkCache.opsIpPublic,
      serviceHealth: {
        postgresql: serviceHealthCache.postgresql,
        redis: serviceHealthCache.redis,
        ollama: serviceHealthCache.ollama,
        docker: serviceHealthCache.docker,
      },
      serviceHosts: {
        redis: `${redisConn.host}:${redisConn.port}`,
        ollama: parseHostPort(ollamaUrlCache),
      },
    };
    emitSystemMetrics(latestMetrics);
  }, env.METRICS_INTERVAL);

  console.log(`[Metrics] Collecting every ${env.METRICS_INTERVAL}ms`);
}

export function stopMetricsCollector() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
