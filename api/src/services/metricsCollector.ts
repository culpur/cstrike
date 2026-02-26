/**
 * System metrics collector — emits CPU, memory, VPN IP, uptime via WebSocket.
 */

import { execSync } from 'node:child_process';
import { env } from '../config/env.js';
import { emitSystemMetrics } from '../websocket/emitter.js';

const startTime = Date.now();

function getCpuUsage(): number {
  try {
    // Linux /proc/stat based CPU usage
    const output = execSync(
      "top -bn1 | head -3 | grep '%Cpu' | awk '{print $2+$4}'",
      { timeout: 3000, encoding: 'utf-8' },
    );
    return parseFloat(output.trim()) || 0;
  } catch {
    return 0;
  }
}

function getMemoryUsage(): number {
  try {
    const output = execSync(
      "free | grep Mem | awk '{printf \"%.1f\", $3/$2 * 100}'",
      { timeout: 3000, encoding: 'utf-8' },
    );
    return parseFloat(output.trim()) || 0;
  } catch {
    return 0;
  }
}

function getVpnIp(): string | null {
  try {
    // Check common VPN interfaces
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
