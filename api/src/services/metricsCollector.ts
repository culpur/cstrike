/**
 * System metrics collector — emits CPU, memory, VPN IP, uptime via WebSocket.
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { env } from '../config/env.js';
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

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startMetricsCollector() {
  if (intervalId) return;

  intervalId = setInterval(() => {
    const metrics = {
      cpu: getCpuUsage(),
      memory: getMemoryUsage(),
      vpnIp: getVpnIp(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      timestamp: Date.now(),
    };
    emitSystemMetrics(metrics);
  }, env.METRICS_INTERVAL);

  console.log(`[Metrics] Collecting every ${env.METRICS_INTERVAL}ms`);
}

export function stopMetricsCollector() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
