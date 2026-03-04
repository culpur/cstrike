/**
 * Service Monitor — monitors service health and updates DB status.
 *
 * Docker-managed services (metasploit, zap): probed via HTTP health endpoints.
 * Local services (burp): checked via PID liveness, auto-restarted if crashed.
 */

import { execSync } from 'node:child_process';
import { prisma } from '../config/database.js';
import { serviceManager, isDockerManaged, isDockerServiceHealthy } from './serviceManager.js';
import { emitServiceAutoStart } from '../websocket/emitter.js';

const MONITOR_INTERVAL_MS = 15_000; // Check every 15 seconds
const MAX_CONSECUTIVE_FAILURES = 5;
let monitorTimer: ReturnType<typeof setInterval> | null = null;
const consecutiveFailures = new Map<string, number>();

/**
 * Run on API startup — probe Docker services and auto-start local services.
 */
export async function autoStartServices(): Promise<void> {
  const services = await prisma.service.findMany({
    where: { autoStart: true },
  });

  for (const svc of services) {
    try {
      if (isDockerManaged(svc.name)) {
        // Docker-managed: just probe health and update status
        const healthy = await isDockerServiceHealthy(svc.name);
        const newStatus = healthy ? 'RUNNING' : 'STOPPED';

        await prisma.service.update({
          where: { name: svc.name },
          data: { status: newStatus, pid: null, error: healthy ? null : 'Container not responding' },
        });

        console.log(`[Services] ${svc.name} (Docker): ${newStatus}`);
        emitServiceAutoStart({ service: svc.name, status: newStatus.toLowerCase() });
      } else {
        // Local service: attempt to start
        console.log(`[Services] Auto-starting ${svc.name}...`);
        await prisma.service.update({
          where: { name: svc.name },
          data: { status: 'STARTING' },
        });

        const result = await serviceManager.execute(svc.name, 'start');

        if (result.error) {
          console.warn(`[Services] ${svc.name} failed to start: ${result.error}`);
          await prisma.service.update({
            where: { name: svc.name },
            data: { status: 'ERROR', error: result.error },
          });
        } else {
          console.log(`[Services] ${svc.name} started (pid: ${result.pid})`);
          await prisma.service.update({
            where: { name: svc.name },
            data: { status: 'RUNNING', pid: result.pid ?? null, error: null },
          });
        }
      }
    } catch (err: any) {
      console.warn(`[Services] Failed to check/start ${svc.name}:`, err.message);
      await prisma.service.update({
        where: { name: svc.name },
        data: { status: 'ERROR', error: err.message },
      });
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    execSync(`ps -p ${pid} > /dev/null 2>&1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Monitor loop — runs every 15s to keep service statuses up to date.
 */
async function monitorLoop(): Promise<void> {
  try {
    const services = await prisma.service.findMany({
      where: { autoStart: true },
    });

    for (const svc of services) {
      if (isDockerManaged(svc.name)) {
        // Docker-managed: probe health endpoint
        await monitorDockerService(svc);
      } else {
        // Local: check PID and restart if needed
        await monitorLocalService(svc);
      }
    }
  } catch (err: any) {
    console.error('[Monitor] Error in monitor loop:', err.message);
  }
}

/**
 * Monitor a Docker-managed service by probing its health endpoint.
 */
async function monitorDockerService(svc: { name: string; status: string }): Promise<void> {
  const healthy = await isDockerServiceHealthy(svc.name);
  const expectedStatus = healthy ? 'RUNNING' : 'STOPPED';

  // Only update if status changed
  if (svc.status !== expectedStatus) {
    console.log(`[Monitor] ${svc.name} (Docker): ${svc.status} → ${expectedStatus}`);
    await prisma.service.update({
      where: { name: svc.name },
      data: {
        status: expectedStatus,
        pid: null,
        error: healthy ? null : 'Container not responding',
      },
    });
    emitServiceAutoStart({ service: svc.name, status: expectedStatus.toLowerCase() });
  }
}

/**
 * Monitor a locally-spawned service by PID liveness.
 */
async function monitorLocalService(svc: { name: string; status: string; pid: number | null }): Promise<void> {
  // If service has a PID and should be running, check it
  if (svc.status === 'RUNNING' && svc.pid) {
    if (!isProcessAlive(svc.pid)) {
      try {
        console.warn(`[Monitor] ${svc.name} (pid ${svc.pid}) died — restarting...`);
        await prisma.service.update({
          where: { name: svc.name },
          data: { status: 'STARTING', pid: null },
        });

        const result = await serviceManager.execute(svc.name, 'start');
        await prisma.service.update({
          where: { name: svc.name },
          data: {
            status: result.error ? 'ERROR' : 'RUNNING',
            pid: result.pid ?? null,
            error: result.error ?? null,
          },
        });
      } catch (restartErr: any) {
        console.warn(`[Monitor] Restart failed for ${svc.name}:`, restartErr.message);
      }
    }
  }

  // If service is in ERROR state and has autoStart, retry with backoff
  if (svc.status === 'ERROR') {
    const failures = consecutiveFailures.get(svc.name) ?? 0;
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      return;
    }

    try {
      console.log(`[Monitor] Retrying ${svc.name} (was in ERROR state, attempt ${failures + 1}/${MAX_CONSECUTIVE_FAILURES})...`);
      const result = await serviceManager.execute(svc.name, 'start');
      await prisma.service.update({
        where: { name: svc.name },
        data: {
          status: result.error ? 'ERROR' : 'RUNNING',
          pid: result.pid ?? null,
          error: result.error ?? null,
        },
      });

      if (result.error) {
        const newCount = failures + 1;
        consecutiveFailures.set(svc.name, newCount);
        if (newCount >= MAX_CONSECUTIVE_FAILURES) {
          console.warn(`[Monitor] ${svc.name} unavailable after ${MAX_CONSECUTIVE_FAILURES} retries — auto-retry disabled until manual restart`);
        }
      } else {
        consecutiveFailures.delete(svc.name);
      }
    } catch (retryErr: any) {
      const newCount = failures + 1;
      consecutiveFailures.set(svc.name, newCount);
      if (newCount >= MAX_CONSECUTIVE_FAILURES) {
        console.warn(`[Monitor] ${svc.name} unavailable after ${MAX_CONSECUTIVE_FAILURES} retries — auto-retry disabled until manual restart`);
      } else {
        console.warn(`[Monitor] Retry failed for ${svc.name}:`, retryErr.message);
      }
    }
  }
}

export function startServiceMonitor(): void {
  if (monitorTimer) return;
  monitorTimer = setInterval(monitorLoop, MONITOR_INTERVAL_MS);
  console.log(`[Monitor] Service health monitor started (interval: ${MONITOR_INTERVAL_MS / 1000}s)`);
}

export function stopServiceMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}

export function resetServiceRetry(name: string): void {
  consecutiveFailures.delete(name);
}
