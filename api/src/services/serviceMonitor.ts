/**
 * Service Monitor — auto-starts services marked with autoStart=true
 * and monitors them for crashes, restarting as needed.
 */

import { execSync } from 'node:child_process';
import { prisma } from '../config/database.js';
import { serviceManager } from './serviceManager.js';

const MONITOR_INTERVAL_MS = 30_000; // Check every 30 seconds
const MAX_CONSECUTIVE_FAILURES = 5;
let monitorTimer: ReturnType<typeof setInterval> | null = null;
const consecutiveFailures = new Map<string, number>();

/**
 * Attempt to start all services that have autoStart=true.
 * Called once during API server startup.
 */
export async function autoStartServices(): Promise<void> {
  const services = await prisma.service.findMany({
    where: { autoStart: true },
  });

  for (const svc of services) {
    try {
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
    } catch (err: any) {
      console.warn(`[Services] Failed to auto-start ${svc.name}:`, err.message);
      await prisma.service.update({
        where: { name: svc.name },
        data: { status: 'ERROR', error: err.message },
      });
    }
  }
}

/**
 * Check if a process is still alive by PID.
 */
function isProcessAlive(pid: number): boolean {
  try {
    execSync(`ps -p ${pid} > /dev/null 2>&1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Periodically checks autoStart services and restarts any that have died.
 */
async function monitorLoop(): Promise<void> {
  try {
    const services = await prisma.service.findMany({
      where: { autoStart: true },
    });

    for (const svc of services) {
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
          // Already logged the disable message — skip silently
          continue;
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
            // Success — reset counter
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
  } catch (err: any) {
    console.error('[Monitor] Error in monitor loop:', err.message);
  }
}

/**
 * Start the background service monitor.
 */
export function startServiceMonitor(): void {
  if (monitorTimer) return;
  monitorTimer = setInterval(monitorLoop, MONITOR_INTERVAL_MS);
  console.log(`[Monitor] Service health monitor started (interval: ${MONITOR_INTERVAL_MS / 1000}s)`);
}

/**
 * Stop the background service monitor.
 */
export function stopServiceMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}

/**
 * Reset the retry counter for a service (call when user manually starts/restarts).
 */
export function resetServiceRetry(name: string): void {
  consecutiveFailures.delete(name);
}
