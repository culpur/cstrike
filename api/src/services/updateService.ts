/**
 * Self-Update Service — checks for and applies updates from git.
 *
 * Update check:  git fetch + rev-list comparison
 * Update execute: git pull → docker compose build → docker compose up -d
 *
 * State persistence: writes /opt/cstrike/data/update-state.json so the
 * frontend can poll status even across API container restarts.
 */

import { execSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { emitUpdateAvailable, emitLogEntry } from '../websocket/emitter.js';

const STATE_FILE = '/opt/cstrike/data/update-state.json';
const REPO_DIR = '/opt/cstrike';

// ── Types ──────────────────────────────────────────────────

interface UpdateStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  output: string;
  startedAt?: number;
  completedAt?: number;
}

interface UpdateInfo {
  commits: number;
  latestCommit: string;
  latestMessage: string;
  latestTag?: string;
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'updating' | 'completed' | 'error';
  currentStep: number;
  totalSteps: number;
  steps: UpdateStep[];
  availableUpdate?: UpdateInfo;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

const DEFAULT_STEPS: Array<{ id: string; label: string }> = [
  { id: 'git_pull', label: 'Pulling latest changes' },
  { id: 'build_api', label: 'Building API container' },
  { id: 'build_frontend', label: 'Building frontend container' },
  { id: 'restart_api', label: 'Restarting API service' },
  { id: 'restart_frontend', label: 'Restarting frontend service' },
  { id: 'healthcheck', label: 'Verifying services' },
];

// ── Service ────────────────────────────────────────────────

class UpdateService {
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  getState(): UpdateState {
    try {
      if (existsSync(STATE_FILE)) {
        return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
      }
    } catch { /* corrupt file — return default */ }
    return this.defaultState();
  }

  private defaultState(): UpdateState {
    return {
      status: 'idle',
      currentStep: 0,
      totalSteps: DEFAULT_STEPS.length,
      steps: DEFAULT_STEPS.map(s => ({ ...s, output: '', status: 'pending' as const })),
    };
  }

  private saveState(state: UpdateState): void {
    try {
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err: any) {
      console.error('[Update] Failed to save state:', err.message);
    }
  }

  // ── Check for updates ──────────────────────────────────────

  async checkForUpdates(): Promise<UpdateInfo | null> {
    try {
      // git fetch
      execSync('git fetch origin main 2>&1', {
        timeout: 60_000,
        encoding: 'utf-8',
        cwd: REPO_DIR,
      });

      const behindCount = execSync(
        'git rev-list --count HEAD..origin/main 2>/dev/null',
        { timeout: 10_000, encoding: 'utf-8', cwd: REPO_DIR },
      ).trim();

      const commits = parseInt(behindCount, 10);
      if (isNaN(commits) || commits === 0) {
        // No update — clear any stale "available" state
        const current = this.getState();
        if (current.status === 'available') {
          this.saveState(this.defaultState());
        }
        return null;
      }

      const latestCommit = execSync(
        'git log origin/main -1 --format="%h" 2>/dev/null',
        { timeout: 5_000, encoding: 'utf-8', cwd: REPO_DIR },
      ).trim();

      const latestMessage = execSync(
        'git log origin/main -1 --format="%s" 2>/dev/null',
        { timeout: 5_000, encoding: 'utf-8', cwd: REPO_DIR },
      ).trim();

      let latestTag: string | undefined;
      try {
        latestTag = execSync(
          'git describe --tags --abbrev=0 origin/main 2>/dev/null',
          { timeout: 5_000, encoding: 'utf-8', cwd: REPO_DIR },
        ).trim() || undefined;
      } catch { /* no tags */ }

      const update: UpdateInfo = { commits, latestCommit, latestMessage, latestTag };

      // Persist and emit
      const state = this.getState();
      state.status = 'available';
      state.availableUpdate = update;
      this.saveState(state);

      emitUpdateAvailable(update);
      console.log(`[Update] ${commits} new commit(s) available: ${latestCommit} - ${latestMessage}`);

      return update;
    } catch (err: any) {
      console.error('[Update] Check failed:', err.message);
      return null;
    }
  }

  // ── Execute update ─────────────────────────────────────────

  async executeUpdate(): Promise<void> {
    const state: UpdateState = {
      status: 'updating',
      currentStep: 0,
      totalSteps: DEFAULT_STEPS.length,
      steps: DEFAULT_STEPS.map(s => ({ ...s, output: '', status: 'pending' as const })),
      startedAt: Date.now(),
    };
    this.saveState(state);

    emitLogEntry({
      level: 'INFO',
      source: 'updater',
      message: 'Self-update started',
    });

    try {
      // Step 0: git pull
      await this.runStep(state, 0, 'git pull origin main 2>&1');

      // Step 1: Build API container
      await this.runStep(state, 1, 'docker compose build api 2>&1');

      // Step 2: Build frontend container
      await this.runStep(state, 2, 'docker compose build frontend 2>&1');

      // Step 3: Restart services — spawn detached so it survives our death
      state.currentStep = 3;
      state.steps[3].status = 'running';
      state.steps[3].startedAt = Date.now();
      this.saveState(state);

      // Detached process: restart api, wait, restart frontend
      const child = spawn('sh', ['-c',
        `docker compose -f ${REPO_DIR}/docker-compose.yml up -d api && ` +
        `sleep 5 && ` +
        `docker compose -f ${REPO_DIR}/docker-compose.yml up -d frontend`,
      ], {
        detached: true,
        stdio: 'ignore',
        cwd: REPO_DIR,
      });
      child.unref();

      // The API container will now restart. The new instance picks up from
      // the state file via checkPostUpdateState().

    } catch (err: any) {
      // Error already saved in runStep
      emitLogEntry({
        level: 'ERROR',
        source: 'updater',
        message: `Update failed at step ${state.currentStep}: ${err.message}`,
      });
    }
  }

  private async runStep(state: UpdateState, stepIndex: number, cmd: string): Promise<void> {
    state.currentStep = stepIndex;
    state.steps[stepIndex].status = 'running';
    state.steps[stepIndex].startedAt = Date.now();
    this.saveState(state);

    try {
      const output = execSync(cmd, {
        timeout: 600_000, // 10 min per step
        encoding: 'utf-8',
        cwd: REPO_DIR,
      });
      state.steps[stepIndex].output = output.slice(-10_000); // keep last 10K chars
      state.steps[stepIndex].status = 'completed';
      state.steps[stepIndex].completedAt = Date.now();
      this.saveState(state);
    } catch (err: any) {
      state.steps[stepIndex].output = (err.stdout || err.stderr || err.message).slice(-10_000);
      state.steps[stepIndex].status = 'error';
      state.steps[stepIndex].completedAt = Date.now();
      state.error = `Step "${state.steps[stepIndex].label}" failed`;
      state.status = 'error';
      this.saveState(state);
      throw err;
    }
  }

  // ── Post-update recovery (called on startup) ──────────────

  async checkPostUpdateState(): Promise<void> {
    const state = this.getState();
    if (state.status !== 'updating') return;

    // Step 3 (restart_api) was "running" when we died — we're the new instance
    if (state.steps[3]?.status === 'running') {
      console.log('[Update] Post-update recovery: marking restart steps complete');

      state.steps[3].status = 'completed';
      state.steps[3].completedAt = Date.now();
      state.steps[3].output = 'API restarted successfully';

      // Step 4: frontend restart was triggered by the detached process
      state.steps[4].status = 'completed';
      state.steps[4].completedAt = Date.now();
      state.steps[4].output = 'Frontend restart triggered';

      // Step 5: healthcheck — wait for frontend
      state.currentStep = 5;
      state.steps[5].status = 'running';
      state.steps[5].startedAt = Date.now();
      this.saveState(state);

      let healthy = false;
      for (let i = 0; i < 30; i++) {
        try {
          const resp = await fetch('http://127.0.0.1:3000/', {
            signal: AbortSignal.timeout(3000),
          });
          if (resp.ok) { healthy = true; break; }
        } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 2000));
      }

      state.steps[5].status = healthy ? 'completed' : 'error';
      state.steps[5].completedAt = Date.now();
      state.steps[5].output = healthy ? 'All services healthy' : 'Frontend health check timed out';

      state.status = healthy ? 'completed' : 'error';
      if (!healthy) state.error = 'Frontend health check failed after update';
      state.completedAt = Date.now();
      this.saveState(state);

      console.log(`[Update] Post-update recovery complete: ${state.status}`);
    }
  }

  // ── Periodic check ─────────────────────────────────────────

  startPeriodicCheck(): void {
    if (this.checkInterval) return;

    // Check every 5 minutes
    this.checkInterval = setInterval(() => {
      this.checkForUpdates().catch(() => {});
    }, 5 * 60 * 1000);

    // Initial check after 30 seconds
    setTimeout(() => this.checkForUpdates().catch(() => {}), 30_000);
    console.log('[Update] Periodic update check started (every 5 min)');
  }

  stopPeriodicCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  // ── Reset ──────────────────────────────────────────────────

  resetState(): void {
    this.saveState(this.defaultState());
  }
}

export const updateService = new UpdateService();
