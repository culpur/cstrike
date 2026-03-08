/**
 * Scan Orchestrator — manages the multi-phase scan pipeline.
 * Coordinates tool execution, AI analysis, result storage, and phase transitions.
 *
 * Three operation modes:
 *  - manual:    fixed tool list, no AI involvement
 *  - semi-auto: AI-driven tool selection with exploitation gate
 *  - full-auto: AI-driven, no gates
 */

import { prisma } from '../config/database.js';
import { toolExecutor } from './toolExecutor.js';
import { aiService } from './aiService.js';
import { lootService } from './lootService.js';
import { getConfigValue } from '../middleware/guardrails.js';
import {
  emitPhaseChange,
  emitReconOutput,
  emitScanComplete,
  emitScanStarted,
  emitLogEntry,
  emitPortDiscovered,
  emitSubdomainDiscovered,
  emitCaseGateReached,
  emitScanPaused,
  emitScanResumed,
} from '../websocket/emitter.js';
import { exploitTrackManager } from './exploitTrackManager.js';
import { executeTask } from '../routes/cases.js';
import { scanContextService, type ExecutionState } from './scanContextService.js';
import { tracerouteService } from './tracerouteService.js';
import { vpnRotationService } from './vpnRotationService.js';

// Active scan tracking for cancellation and pause
const activeScans = new Map<string, { cancelled: boolean; paused: boolean }>();

// ── Tool safety categories ──────────────────────────────────────────────────

const RECON_TOOLS = new Set([
  'nmap', 'masscan', 'rustscan',
  'subfinder', 'amass', 'dnsenum', 'dnsrecon',
  'httpx', 'whatweb', 'wafw00f',
  'sslscan', 'sslyze', 'testssl',
  'gobuster', 'dirb', 'ffuf', 'wfuzz', 'feroxbuster',
  'nikto', 'nuclei', 'wpscan',
  'waybackurls', 'gau', 'katana', 'gowitness',
  'enum4linux', 'smbclient', 'nbtscan', 'snmpwalk',
  'searchsploit', 'traceroute',
]);

const EXPLOIT_TOOLS = new Set([
  'sqlmap', 'xsstrike', 'commix',
  'hydra', 'john', 'hashcat',
  'metasploit', 'zap',
]);

const ALL_AVAILABLE_TOOLS = [...RECON_TOOLS, ...EXPLOIT_TOOLS];

const MAX_AI_ITERATIONS = 20;

// ── Types ───────────────────────────────────────────────────────────────────

type OperationMode = 'manual' | 'semi-auto' | 'full-auto';

interface ToolRunSummary {
  tool: string;
  exitCode: number;
  duration: number;
  outputSnippet: string;
  error?: string;
}

class ScanOrchestrator {
  /**
   * Start a scan — runs the full pipeline asynchronously.
   */
  startScan(scanId: string, target: string, tools?: string[], mode?: string) {
    const state = { cancelled: false, paused: false };
    activeScans.set(scanId, state);

    setImmediate(() => this.runPipeline(scanId, target, tools, mode, state));
  }

  /**
   * Cancel a running scan.
   */
  cancelScan(scanId: string) {
    const state = activeScans.get(scanId);
    if (state) state.cancelled = true;
  }

  /**
   * Pause a running scan — the current tool finishes, then state is saved.
   */
  pauseScan(scanId: string) {
    const state = activeScans.get(scanId);
    if (state) state.paused = true;
  }

  /**
   * Resume a previously paused scan.
   */
  async resumeScan(scanId: string): Promise<void> {
    // Validate scan is paused
    const scan = await prisma.scan.findUnique({
      where: { id: scanId },
      include: { target: true },
    });
    if (!scan) throw new Error('Scan not found');
    if (scan.status !== 'PAUSED') throw new Error(`Scan status is ${scan.status}, expected PAUSED`);

    const targetId = scan.targetId;
    const target = scan.target.url;

    // Load saved execution state
    const savedState = await scanContextService.loadExecutionState(targetId);

    // Rebuild tool history from ScanResult (authoritative)
    const toolHistory = await this.rebuildToolHistory(scanId);

    // Rebuild exploit fingerprints from ExploitTask
    const exploitTasks = await prisma.exploitTask.findMany({
      where: { case: { targetId } },
      select: { tool: true, target: true },
    });
    exploitTrackManager.rebuildFingerprints(targetId, exploitTasks);

    // Get operation mode
    const operationMode = await getConfigValue<string>('operation_mode', 'full-auto') as OperationMode;

    // Mark as running
    await prisma.scan.update({
      where: { id: scanId },
      data: { status: 'RUNNING' },
    });

    // Register in active scans + exploit track manager
    const state = { cancelled: false, paused: false };
    activeScans.set(scanId, state);
    exploitTrackManager.registerScan(scanId, targetId, operationMode);

    emitScanResumed({ scan_id: scanId, target });
    emitLogEntry({
      level: 'INFO',
      source: 'orchestrator',
      message: `Scan resuming in ${operationMode.toUpperCase()} mode against ${target} (iteration ${savedState?.iteration ?? toolHistory.length})`,
    });

    // Resume the pipeline
    const resumeState = savedState ? {
      toolHistory,
      iteration: savedState.iteration,
      consecutiveSkips: savedState.consecutiveSkips,
      gateHit: savedState.gateHit,
    } : {
      toolHistory,
      iteration: toolHistory.length,
      consecutiveSkips: 0,
      gateHit: false,
    };

    setImmediate(() => this.runPipeline(scanId, target, undefined, undefined, state, resumeState));
  }

  /**
   * Rebuild tool history from persisted ScanResult records.
   */
  private async rebuildToolHistory(scanId: string): Promise<ToolRunSummary[]> {
    const results = await prisma.scanResult.findMany({
      where: { scanId },
      orderBy: { createdAt: 'asc' },
    });

    return results.map((r) => {
      const data = r.data as Record<string, any>;
      const output = String(data?.output || '');
      const maxLen = 2000;
      return {
        tool: data?.tool || r.source || 'unknown',
        exitCode: data?.exitCode ?? 0,
        duration: data?.duration ?? 0,
        outputSnippet: output.length > maxLen ? output.slice(0, maxLen) + '\n... [output truncated]' : output,
        error: undefined,
      };
    });
  }

  /**
   * Main scan pipeline — dispatches to manual or AI-driven mode.
   */
  private async runPipeline(
    scanId: string,
    target: string,
    requestedTools?: string[],
    mode?: string,
    state?: { cancelled: boolean; paused: boolean },
    resumeState?: { toolHistory: ToolRunSummary[]; iteration: number; consecutiveSkips: number; gateHit: boolean },
  ) {
    let wasPaused = false;
    try {
      const scanRecord = await prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
      const targetId = scanRecord.targetId;

      // Only mark RUNNING + set startedAt for fresh scans (not resumes)
      if (!resumeState) {
        await prisma.scan.update({
          where: { id: scanId },
          data: { status: 'RUNNING', startedAt: new Date(), phase: 'RECON' },
        });
      }

      // Check operation mode
      const operationMode = await getConfigValue<string>('operation_mode', 'full-auto') as OperationMode;

      if (!resumeState) {
        emitLogEntry({
          level: 'INFO',
          source: 'orchestrator',
          message: `Scan starting in ${operationMode.toUpperCase()} mode against ${target}`,
        });
        // Register scan with exploit track manager for concurrent exploitation
        exploitTrackManager.registerScan(scanId, targetId, operationMode);
      }

      // Ensure ScanContext record exists
      await scanContextService.getOrCreate(targetId);

      // ── VPN Rotation — initialize for scan if enabled ──────────────────
      if (!resumeState) {
        await vpnRotationService.initForScan(scanId);
      } else {
        // Restore rotation state from checkpoint if available
        const savedExecState = await scanContextService.loadExecutionState(targetId);
        const checkpoint = (savedExecState as any)?.vpnRotation;
        if (checkpoint) {
          vpnRotationService.restoreFromCheckpoint(scanId, checkpoint);
        }
      }

      // ── Traceroute — run at scan start for visual path mapping ──────────
      if (!resumeState && !state?.cancelled) {
        tracerouteService.runTraceroute(target, scanId)
          .then(async (result) => {
            if (result.hops.length > 0) {
              await prisma.scanResult.create({
                data: {
                  scanId,
                  resultType: 'TRACEROUTE',
                  data: { hops: result.hops, duration: result.duration } as any,
                  source: 'traceroute',
                },
              }).catch(() => {});
            }
          })
          .catch((err) => {
            console.warn(`[Orchestrator] Traceroute failed (non-fatal): ${err.message}`);
          });
        // Don't await — traceroute runs concurrently with the scan pipeline
      }

      if (operationMode === 'manual') {
        await this.runManualPipeline(scanId, target, targetId, requestedTools, mode, state);
      } else {
        await this.runAIPipeline(scanId, target, targetId, operationMode, requestedTools, state, resumeState);
      }

      // Check if we paused instead of finishing
      const currentScan = await prisma.scan.findUnique({ where: { id: scanId } });
      if (currentScan?.status === 'PAUSED') {
        wasPaused = true;
        return; // Don't mark complete — scan is paused
      }

      // Mark complete
      const finalStatus = state?.cancelled ? 'CANCELLED' : 'COMPLETED';
      await prisma.scan.update({
        where: { id: scanId },
        data: {
          status: finalStatus as any,
          phase: 'COMPLETE',
          endedAt: new Date(),
        },
      });

      // Update target status
      const scan = await prisma.scan.findUnique({
        where: { id: scanId },
        include: { target: true },
      });
      if (scan) {
        await prisma.target.update({
          where: { id: scan.targetId },
          data: { status: finalStatus === 'COMPLETED' ? 'COMPLETE' : 'FAILED' },
        });

        // Refresh context documents on completion
        await scanContextService.refreshFindingsSummary(scan.targetId).catch(() => {});
        await scanContextService.refreshAIReasoningSummary(scan.targetId, scanId).catch(() => {});
        await scanContextService.refreshExploitSnapshot(scan.targetId).catch(() => {});
        await scanContextService.clearActiveScan(scan.targetId).catch(() => {});
      }

      emitPhaseChange({ phase: 'complete', target, status: 'complete' });
      emitScanComplete({ target, scan_id: scanId });

    } catch (err: any) {
      console.error(`[Orchestrator] Scan ${scanId} failed:`, err.message);

      await prisma.scan.update({
        where: { id: scanId },
        data: {
          status: 'FAILED',
          error: err.message,
          endedAt: new Date(),
        },
      }).catch(() => {});

    } finally {
      activeScans.delete(scanId);
      // Only clean up exploit tracking if the scan actually finished
      if (!wasPaused) {
        exploitTrackManager.cleanupScan(scanId);
        vpnRotationService.cleanupScan(scanId);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Manual Pipeline — fixed tool list, parallel groups, no AI
  // ══════════════════════════════════════════════════════════════════════════

  private async runManualPipeline(
    scanId: string,
    target: string,
    targetId: string,
    requestedTools?: string[],
    mode?: string,
    state?: { cancelled: boolean; paused: boolean },
  ) {
    // Get allowed tools from config
    const allowedTools = await getConfigValue<string[]>('allowed_tools', []);
    const scanTools = requestedTools?.length
      ? requestedTools.filter((t) => allowedTools.length === 0 || allowedTools.includes(t))
      : this.getDefaultTools(mode ?? 'full');

    emitPhaseChange({ phase: 'recon', target, status: 'running' });
    emitScanStarted({ target, scan_id: scanId, tools: scanTools });

    // Group tools into parallel execution batches
    const groups = this.groupToolsForParallel(scanTools);
    let completedTools = 0;
    const totalTools = scanTools.length;

    for (const group of groups) {
      if (state?.cancelled) {
        emitLogEntry({ level: 'WARN', source: 'orchestrator', message: `Scan ${scanId} cancelled` });
        break;
      }
      if (state?.paused) {
        await this.handlePause(scanId, targetId, target, [], completedTools);
        return;
      }

      if (group.length === 1) {
        // Single tool — run sequentially (no overhead)
        completedTools++;
        await this.executeTool(scanId, targetId, target, group[0], `${completedTools}/${totalTools}`);
      } else {
        // Multiple tools — run in parallel
        emitLogEntry({
          level: 'INFO',
          source: 'orchestrator',
          message: `Running ${group.length} tools in parallel: ${group.join(', ')}`,
        });

        const promises = group.map((tool) => {
          completedTools++;
          return this.executeTool(scanId, targetId, target, tool, `${completedTools}/${totalTools}`);
        });
        await Promise.allSettled(promises);
      }
    }
  }

  /**
   * Group tools into parallel execution batches.
   * Tools that can safely run concurrently are grouped together.
   * Port scanners run first (they feed everything else), then enum tools in parallel.
   */
  private groupToolsForParallel(tools: string[]): string[][] {
    // Phase 1: Port scanners must run first (nmap is primary, others are supplementary)
    const portScanners = tools.filter((t) => ['nmap', 'masscan', 'rustscan'].includes(t));
    // Phase 2: DNS tools can run in parallel
    const dnsTools = tools.filter((t) => ['subfinder', 'amass', 'dnsenum', 'dnsrecon'].includes(t));
    // Phase 3: HTTP fingerprinting tools can run in parallel
    const httpFingerprint = tools.filter((t) => ['httpx', 'whatweb', 'wafw00f', 'sslscan', 'sslyze', 'testssl'].includes(t));
    // Phase 4: Directory/content discovery tools can run in parallel
    const dirDiscovery = tools.filter((t) => ['gobuster', 'dirb', 'ffuf', 'wfuzz', 'feroxbuster'].includes(t));
    // Phase 5: Vulnerability scanners can run in parallel
    const vulnScanners = tools.filter((t) => ['nikto', 'nuclei', 'wpscan'].includes(t));
    // Phase 6: Everything else — sequential
    const covered = new Set([...portScanners, ...dnsTools, ...httpFingerprint, ...dirDiscovery, ...vulnScanners]);
    const remaining = tools.filter((t) => !covered.has(t));

    const groups: string[][] = [];
    // Port scanners run sequentially (nmap first for best data, then supplementary)
    for (const ps of portScanners) groups.push([ps]);
    // DNS tools in parallel
    if (dnsTools.length > 0) groups.push(dnsTools);
    // HTTP fingerprinting in parallel
    if (httpFingerprint.length > 0) groups.push(httpFingerprint);
    // Directory discovery in parallel (but cap at 3 concurrent to not overwhelm target)
    for (let i = 0; i < dirDiscovery.length; i += 3) {
      groups.push(dirDiscovery.slice(i, i + 3));
    }
    // Vuln scanners in parallel
    if (vulnScanners.length > 0) groups.push(vulnScanners);
    // Remaining tools sequentially
    for (const r of remaining) groups.push([r]);

    return groups.filter((g) => g.length > 0);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // AI-Driven Pipeline — AI analyzes results and selects next tool
  // ══════════════════════════════════════════════════════════════════════════

  private async runAIPipeline(
    scanId: string,
    target: string,
    targetId: string,
    operationMode: OperationMode,
    requestedTools?: string[],
    state?: { cancelled: boolean; paused: boolean },
    resumeState?: { toolHistory: ToolRunSummary[]; iteration: number; consecutiveSkips: number; gateHit: boolean },
  ) {
    let toolHistory: ToolRunSummary[];
    let iteration: number;
    let consecutiveSkips: number;
    const MAX_CONSECUTIVE_SKIPS = 3;
    let gateHit: boolean;

    if (resumeState) {
      // ── Resume: skip Phase 1, restore state ───────────────────────────
      toolHistory = resumeState.toolHistory;
      iteration = resumeState.iteration;
      consecutiveSkips = resumeState.consecutiveSkips;
      gateHit = resumeState.gateHit;

      emitLogEntry({
        level: 'INFO',
        source: 'orchestrator',
        message: `Resuming AI pipeline at iteration ${iteration} with ${toolHistory.length} tools already completed`,
      });

      await aiService.recordDecision({
        decision: `Resuming AI-driven scan in ${operationMode} mode`,
        rationale: `Continuing from iteration ${iteration} — ${toolHistory.length} tools already completed: ${toolHistory.map((h) => h.tool).join(', ')}`,
        scanId,
      });
    } else {
      // ── Fresh start ──────────────────────────────────────────────────
      toolHistory = [];
      iteration = 0;
      consecutiveSkips = 0;
      gateHit = false;

      // ── Check for prior scan history on this target ─────────────────
      // If recon has already been done, load that history and skip ahead
      const priorResults = await prisma.scanResult.findMany({
        where: { scan: { targetId } },
        orderBy: { createdAt: 'asc' },
      });

      if (priorResults.length > 0) {
        // Rebuild toolHistory from prior scans — ONLY recon tools go into toolHistory
        // (so the AI won't mark exploitation tools as "already executed")
        // Exploitation tool outputs are included as read-only context in findings summary
        const exploitFindings: string[] = [];
        for (const r of priorResults) {
          const data = r.data as Record<string, any>;
          const toolName = data?.tool || r.source || 'unknown';
          const output = String(data?.output || '');
          const maxLen = 2000;
          const snippet = output.length > maxLen ? output.slice(0, maxLen) + '\n... [output truncated]' : output;

          if (RECON_TOOLS.has(toolName)) {
            // Recon tools → full history entry (marks them as already-executed)
            toolHistory.push({
              tool: toolName,
              exitCode: data?.exitCode ?? 0,
              duration: data?.duration ?? 0,
              outputSnippet: snippet,
            });
          } else if (EXPLOIT_TOOLS.has(toolName)) {
            // Exploitation tools → capture findings as context but do NOT mark as executed
            exploitFindings.push(`### PRIOR ${toolName.toUpperCase()} FINDINGS\n${snippet}`);
          }
        }

        // Store exploit findings context for the AI prompt (appended to recon findings)
        if (exploitFindings.length > 0) {
          toolHistory.push({
            tool: '__prior_exploit_findings__',
            exitCode: 0,
            duration: 0,
            outputSnippet: `## PRIOR EXPLOITATION RESULTS (for context — these tools should be RE-RUN with targeted parameters)\n\n${exploitFindings.join('\n\n')}`,
          });
        }

        iteration = toolHistory.length;

        // Check if recon tools have already been run
        const reconToolsRan = toolHistory.filter((h) => RECON_TOOLS.has(h.tool));
        const hasReconData = reconToolsRan.length >= 3; // At minimum 3 recon tools ran previously

        emitLogEntry({
          level: 'INFO',
          source: 'orchestrator',
          message: `Found ${priorResults.length} prior results (${reconToolsRan.length} recon tools) — ${hasReconData ? 'skipping recon, starting at exploitation' : 'continuing recon'}`,
        });

        await aiService.recordDecision({
          decision: hasReconData
            ? `Skipping recon — prior scan data available (${reconToolsRan.map((h) => h.tool).join(', ')})`
            : `Partial history loaded — continuing reconnaissance`,
          rationale: `${priorResults.length} tool results from prior scans loaded into context`,
          scanId,
        });

        if (hasReconData) {
          // Jump straight to exploitation phase
          emitPhaseChange({ phase: 'exploit', target, status: 'running' });
          emitScanStarted({ target, scan_id: scanId, tools: ['ai-exploitation'] });

          await prisma.scan.update({
            where: { id: scanId },
            data: { phase: 'EXPLOITATION' },
          });
        } else {
          emitPhaseChange({ phase: 'recon', target, status: 'running' });
          emitScanStarted({ target, scan_id: scanId, tools: ['ai-recon'] });
        }
      } else {
        // No prior history — run initial recon
        emitPhaseChange({ phase: 'recon', target, status: 'running' });

        // ── Phase 1: Initial reconnaissance ─────────────────────────────
        const initialTools = requestedTools?.length
          ? requestedTools
          : ['nmap'];

        emitScanStarted({ target, scan_id: scanId, tools: initialTools });

        await aiService.recordDecision({
          decision: `Starting AI-driven scan in ${operationMode} mode`,
          rationale: `Initial reconnaissance with ${initialTools.join(', ')} to understand the target attack surface`,
          selectedTool: initialTools[0],
          scanId,
        });

        // Run initial recon tools — nmap first, then rest in parallel
        const [nmap, ...otherInitial] = initialTools;
        if (nmap && !state?.cancelled && !state?.paused) {
          iteration++;
          const result = await this.executeTool(scanId, targetId, target, nmap, `${iteration}/?`);
          toolHistory.push(this.summarizeResult(result));
        }
        if (otherInitial.length > 0 && !state?.cancelled && !state?.paused) {
          // Run remaining initial tools in parallel
          const parallelResults = await Promise.allSettled(
            otherInitial.map(async (tool) => {
              iteration++;
              const result = await this.executeTool(scanId, targetId, target, tool, `${iteration}/?`);
              return this.summarizeResult(result);
            }),
          );
          for (const r of parallelResults) {
            if (r.status === 'fulfilled') toolHistory.push(r.value);
          }
        }
      }
    }

    // ── Phase 2: AI-driven loop ─────────────────────────────────────────
    // Determine starting phase based on prior history
    const reconToolsExecuted = toolHistory.filter((h) => RECON_TOOLS.has(h.tool));
    let currentPhase: 'recon' | 'exploitation' = reconToolsExecuted.length >= 3 ? 'exploitation' : 'recon';
    while (iteration < MAX_AI_ITERATIONS && !state?.cancelled && !gateHit) {
      // Check for pause at top of loop
      if (state?.paused) {
        await this.handlePause(scanId, targetId, target, toolHistory, iteration, consecutiveSkips, gateHit, operationMode);
        return;
      }
      // Check if there are any tools left to run (include exploit track manager tools)
      const executedSet = new Set(toolHistory.map((h) => h.tool));
      try {
        const etmTasks = await prisma.exploitTask.findMany({
          where: { case: { targetId }, status: { in: ['COMPLETED', 'RUNNING', 'QUEUED', 'FAILED'] } },
          select: { tool: true },
        });
        for (const et of etmTasks) executedSet.add(et.tool);
      } catch { /* best effort */ }
      const remainingCount = ALL_AVAILABLE_TOOLS.filter((t) => !executedSet.has(t)).length;
      if (remainingCount === 0) {
        emitLogEntry({
          level: 'INFO',
          source: 'orchestrator',
          message: 'All available tools have been executed — scan complete',
        });
        await aiService.recordDecision({
          decision: 'Scan complete — all available tools exhausted',
          rationale: `Executed ${toolHistory.length} tools against target, no remaining tools available`,
          scanId,
        });
        break;
      }

      // Build context for AI analysis
      const analysisPrompt = await this.buildAIPrompt(target, targetId, toolHistory, operationMode, currentPhase);

      emitLogEntry({
        level: 'INFO',
        source: 'ai',
        message: `AI analyzing results after ${iteration} tools — requesting next action`,
      });

      // Call AI for analysis and next tool recommendation
      const aiResult = await aiService.analyze({
        prompt: analysisPrompt,
        target,
        scanId,
        mode: 'tools',
      });

      if (aiResult.status === 'error') {
        emitLogEntry({
          level: 'ERROR',
          source: 'ai',
          message: `AI analysis failed: ${aiResult.error} — falling back to manual pipeline`,
        });
        // Fall back to remaining default tools
        const remainingTools = this.getDefaultTools('full')
          .filter((t) => !toolHistory.some((h) => h.tool === t));
        for (const tool of remainingTools) {
          if (state?.cancelled) break;
          iteration++;
          const result = await this.executeTool(scanId, targetId, target, tool, `${iteration}/?`);
          toolHistory.push(this.summarizeResult(result));
        }
        break;
      }

      // Parse AI recommendation
      const recommendation = this.parseAIRecommendation(aiResult.content);

      if (recommendation.done) {
        // Check if we should transition from recon to exploitation phase
        if (currentPhase === 'recon' && operationMode !== 'manual') {
          // Transition to exploitation planning phase
          currentPhase = 'exploitation';

          await aiService.recordDecision({
            decision: 'Reconnaissance complete — transitioning to exploitation planning',
            rationale: recommendation.reasoning,
            scanId,
          });

          emitLogEntry({
            level: 'INFO',
            source: 'ai',
            message: `Recon phase complete — entering exploitation planning phase`,
          });

          emitPhaseChange({ phase: 'exploit', target, status: 'running' });

          await prisma.scan.update({
            where: { id: scanId },
            data: { phase: 'EXPLOITATION' },
          });

          // Reset skip counter and re-enter the loop with exploitation-focused prompt
          consecutiveSkips = 0;
          continue;
        }

        // Exploitation phase done — truly complete
        await aiService.recordDecision({
          decision: 'Exploitation planning complete — all attack vectors explored',
          rationale: recommendation.reasoning,
          scanId,
        });

        emitLogEntry({
          level: 'INFO',
          source: 'ai',
          message: `AI exploitation planning complete: ${recommendation.reasoning}`,
        });
        break;
      }

      if (!recommendation.tool) {
        emitLogEntry({
          level: 'WARN',
          source: 'ai',
          message: 'AI did not recommend a specific tool — ending scan',
        });
        break;
      }

      // Check if the recommended tool is an exploitation tool
      if (EXPLOIT_TOOLS.has(recommendation.tool) && operationMode === 'semi-auto') {
        // Spawn as a gated exploitation task instead of silently skipping
        try {
          const caseId = await this.findOrCreateExploitCase(targetId, target);
          if (caseId) {
            await prisma.exploitTask.create({
              data: {
                caseId,
                tool: recommendation.tool,
                target,
                phase: 'EXPLOITATION',
                status: 'QUEUED',
                trigger: `ai:${recommendation.reasoning}`,
                config: {},
              },
            });

            // Count total pending gated tasks for this case
            const pendingCount = await prisma.exploitTask.count({
              where: { caseId, status: 'QUEUED', phase: { in: ['EXPLOITATION', 'PERSISTENCE'] } },
            });

            emitCaseGateReached({ caseId, pendingTasks: pendingCount, phase: 'EXPLOITATION' });

            await prisma.exploitCase.update({
              where: { id: caseId },
              data: { gateStatus: 'PENDING_APPROVAL' },
            });

            emitLogEntry({
              level: 'WARN',
              source: 'orchestrator',
              message: `GATE: ${recommendation.tool} queued for operator approval on Exploitation page (${pendingCount} pending)`,
            });
          }
        } catch (err: any) {
          console.error(`[Orchestrator] Failed to create gated exploit task:`, err.message);
        }

        await aiService.recordDecision({
          decision: `${recommendation.tool} queued for operator approval (semi-auto gate)`,
          rationale: recommendation.reasoning,
          selectedTool: recommendation.tool,
          scanId,
        });

        // Add to toolHistory so AI doesn't re-recommend it
        toolHistory.push({
          tool: recommendation.tool,
          exitCode: -1,
          duration: 0,
          outputSnippet: 'Queued for operator approval (semi-auto gate)',
        });
        continue;
      }

      // Validate the tool exists
      if (!ALL_AVAILABLE_TOOLS.includes(recommendation.tool)) {
        consecutiveSkips++;
        emitLogEntry({
          level: 'WARN',
          source: 'ai',
          message: `AI recommended unknown tool "${recommendation.tool}" — skipping (${consecutiveSkips}/${MAX_CONSECUTIVE_SKIPS})`,
        });
        await aiService.recordObservation({
          observation: `Skipped unknown tool: ${recommendation.tool}`,
          source: 'ai',
          scanId,
        });
        if (consecutiveSkips >= MAX_CONSECUTIVE_SKIPS) {
          emitLogEntry({
            level: 'WARN',
            source: 'orchestrator',
            message: `${MAX_CONSECUTIVE_SKIPS} consecutive invalid recommendations — ending AI loop`,
          });
          await aiService.recordDecision({
            decision: 'Scan ended — AI could not recommend a valid next tool',
            rationale: `After ${MAX_CONSECUTIVE_SKIPS} consecutive skipped recommendations, the AI pipeline was terminated`,
            scanId,
          });
          break;
        }
        continue;
      }

      // Skip tools we've already run
      if (toolHistory.some((h) => h.tool === recommendation.tool)) {
        consecutiveSkips++;
        emitLogEntry({
          level: 'INFO',
          source: 'ai',
          message: `AI recommended ${recommendation.tool} but already ran — asking for alternative (${consecutiveSkips}/${MAX_CONSECUTIVE_SKIPS})`,
        });
        await aiService.recordObservation({
          observation: `Skipped ${recommendation.tool}: already executed`,
          source: 'ai',
          scanId,
        });
        if (consecutiveSkips >= MAX_CONSECUTIVE_SKIPS) {
          emitLogEntry({
            level: 'WARN',
            source: 'orchestrator',
            message: `${MAX_CONSECUTIVE_SKIPS} consecutive skipped tools — AI keeps recommending already-executed tools, ending scan`,
          });
          await aiService.recordDecision({
            decision: 'Scan complete — AI exhausted available tool recommendations',
            rationale: `AI repeatedly recommended already-executed tools after ${toolHistory.length} tools completed`,
            scanId,
          });
          break;
        }
        continue;
      }

      // Valid tool selected — reset skip counter
      consecutiveSkips = 0;

      // Record the AI's decision
      await aiService.recordDecision({
        decision: `Run ${recommendation.tool}`,
        rationale: recommendation.reasoning,
        selectedTool: recommendation.tool,
        scanId,
      });

      // Execute the tool (wrapped in try-catch so a single tool failure
      // doesn't crash the entire AI pipeline)
      iteration++;
      try {
        const result = await this.executeTool(
          scanId,
          targetId,
          target,
          recommendation.tool,
          `${iteration}/?`,
        );
        toolHistory.push(this.summarizeResult(result));
      } catch (toolErr: any) {
        console.error(`[Orchestrator] Tool ${recommendation.tool} crashed: ${toolErr.message}`);
        emitLogEntry({
          level: 'ERROR',
          source: 'orchestrator',
          message: `Tool ${recommendation.tool} failed: ${toolErr.message}`,
        });
        // Push a failure summary so the AI knows this tool failed
        toolHistory.push({
          tool: recommendation.tool,
          outputSnippet: `ERROR: ${recommendation.tool} failed to execute — ${toolErr.message}`,
          exitCode: -1,
          duration: 0,
          error: toolErr.message,
        });
      }

      // Periodic checkpoint save (every 3 tools)
      if (iteration % 3 === 0) {
        await scanContextService.saveExecutionState(targetId, scanId, {
          scanId,
          iteration,
          consecutiveSkips,
          gateHit,
          mode: operationMode,
          toolsRun: toolHistory.map((h) => h.tool),
          vpnRotation: vpnRotationService.getCheckpointData(scanId),
        } as ExecutionState).catch(() => {});
      }

      // Record AI's observations about the result
      if (recommendation.observations) {
        await aiService.recordObservation({
          observation: recommendation.observations,
          source: recommendation.tool,
          scanId,
        });
      }
    }

    if (iteration >= MAX_AI_ITERATIONS) {
      emitLogEntry({
        level: 'WARN',
        source: 'orchestrator',
        message: `AI pipeline hit max iterations (${MAX_AI_ITERATIONS}) — stopping`,
      });
    }

    // ── Phase 3: Wait for concurrent exploitation to finish ────────────
    if (!state?.cancelled && !state?.paused) {
      await this.waitForExploitTasks(scanId, targetId, target, state);
    }

    // ── Phase 4: AI-driven exploitation loop ─────────────────────────
    // After ETM tasks complete, run the AI exploitation planning loop
    // to recommend targeted exploitation tools (sqlmap, zap, metasploit, hydra, etc.)
    if (!state?.cancelled && !state?.paused && operationMode !== 'manual') {
      emitLogEntry({
        level: 'INFO',
        source: 'orchestrator',
        message: 'Starting AI exploitation planning loop',
      });

      emitPhaseChange({ phase: 'exploit', target, status: 'running' });
      await prisma.scan.update({
        where: { id: scanId },
        data: { phase: 'EXPLOITATION' },
      });

      // ── Inject completed ETM results into toolHistory to prevent Phase 4 re-running them ──
      const etmCompletedTasks = await prisma.exploitTask.findMany({
        where: { case: { targetId }, status: 'COMPLETED' },
        select: { tool: true, exitCode: true, duration: true, output: true, findings: true },
      });
      const etmCompletedTools = new Set<string>();
      for (const etmTask of etmCompletedTasks) {
        etmCompletedTools.add(etmTask.tool);
        // Only inject if not already in toolHistory (avoid duplicates from prior phases)
        if (!toolHistory.some((h) => h.tool === etmTask.tool)) {
          toolHistory.push({
            tool: etmTask.tool,
            exitCode: etmTask.exitCode ?? 0,
            duration: etmTask.duration ?? 0,
            outputSnippet: (etmTask.output || '').slice(0, 1000),
          });
        }
      }
      if (etmCompletedTools.size > 0) {
        emitLogEntry({
          level: 'INFO',
          source: 'orchestrator',
          message: `Phase 4: Injected ${etmCompletedTools.size} completed ETM results into history — ${[...etmCompletedTools].join(', ')}`,
        });
      }

      const MAX_EXPLOIT_ITERATIONS = 10;
      let exploitIteration = 0;

      while (exploitIteration < MAX_EXPLOIT_ITERATIONS) {
        if (state?.cancelled || state?.paused) break;
        exploitIteration++;

        const exploitPrompt = await this.buildAIPrompt(target, targetId, toolHistory, operationMode, 'exploitation');
        const aiResult = await aiService.analyze({
          prompt: exploitPrompt,
          target,
          scanId,
          mode: 'tools',
        });

        if (aiResult.status === 'error') {
          emitLogEntry({ level: 'WARN', source: 'orchestrator', message: `AI exploitation analysis failed: ${aiResult.error}` });
          break;
        }

        const recommendation = this.parseAIRecommendation(aiResult.content);

        await aiService.recordDecision({
          decision: recommendation.done
            ? 'Exploitation planning complete'
            : `Run ${recommendation.tool} for exploitation`,
          rationale: recommendation.reasoning,
          selectedTool: recommendation.done ? undefined : recommendation.tool ?? undefined,
          scanId,
        });

        if (recommendation.done) {
          emitLogEntry({
            level: 'INFO',
            source: 'orchestrator',
            message: `AI exploitation loop complete — ${recommendation.reasoning}`,
          });
          break;
        }

        // Dedup: skip tools already executed in the exploitation phase OR completed by ETM
        const exploitTool = recommendation.tool!;
        const alreadyRan = toolHistory.filter((h) => h.tool === exploitTool);
        const ranByEtm = etmCompletedTools.has(exploitTool);
        if (alreadyRan.length > 0 || ranByEtm) {
          emitLogEntry({
            level: 'WARN',
            source: 'orchestrator',
            message: `AI recommended already-executed tool "${exploitTool}" — skipping (history: ${alreadyRan.length}x${ranByEtm ? ', ETM: completed' : ''})`,
          });
          // Count as a wasted iteration so the loop still terminates
          continue;
        }

        // Execute the recommended exploitation tool
        iteration++;
        const result = await this.executeTool(scanId, targetId, target, exploitTool, `${iteration}/?`);

        const summary = this.summarizeResult(result);
        toolHistory.push(summary);

        // Store result
        await prisma.scanResult.create({
          data: {
            scanId,
            resultType: this.toolToResultType(exploitTool),
            source: exploitTool,
            data: {
              tool: exploitTool,
              output: result.output,
              exitCode: result.exitCode,
              duration: result.duration,
              error: result.error,
              phase: 'exploitation',
            } as any,
          },
        });

        // Parse and store loot
        await lootService.extractFromOutput(result.output, exploitTool, targetId);

        emitReconOutput({
          target,
          tool: exploitTool,
          output: result.output,
          complete: true,
          exitCode: result.exitCode,
          duration: result.duration,
        });
      }
    }

    // ── Phase 5: Post-exploitation — obtain shells + escalate privileges ──
    if (!state?.cancelled && !state?.paused && operationMode !== 'manual') {
      try {
        const { postExploitService } = await import('./postExploitService.js');
        const results = await postExploitService.run(scanId, targetId, target, operationMode);

        await aiService.recordDecision({
          decision: `Post-exploitation complete: ${results.shellsObtained} shells, ${results.credentialsValidated} creds validated`,
          rationale: `Phase 5 used ${results.iterationsUsed} iterations. Highest privilege: ${results.privilegeLevel}`,
          scanId,
        });
      } catch (err: any) {
        emitLogEntry({
          level: 'ERROR',
          source: 'post_exploit',
          message: `Phase 5 failed: ${err.message}`,
        });
      }
    }
  }

  /**
   * After recon completes, wait for any in-flight exploitation tasks to finish.
   * Polls every 5s for up to 10 minutes.
   */
  private async waitForExploitTasks(
    scanId: string,
    targetId: string,
    target: string,
    state?: { cancelled: boolean; paused: boolean } | null,
  ) {
    const MAX_WAIT_MS = 600_000; // 10 minutes
    const POLL_INTERVAL_MS = 5_000;
    const startWait = Date.now();

    // Check if there are any active exploit cases with running/queued tasks
    const activeTasks = await prisma.exploitTask.count({
      where: {
        case: { targetId },
        status: { in: ['RUNNING', 'QUEUED'] },
      },
    });

    // Also check for gated tasks awaiting operator approval
    const gatedTasks = await prisma.exploitTask.count({
      where: {
        case: { targetId },
        status: 'QUEUED',
        phase: { in: ['EXPLOITATION', 'PERSISTENCE'] },
      },
    });

    if (activeTasks === 0 && gatedTasks > 0) {
      const operationMode = await getConfigValue<string>('operation_mode', 'full-auto');
      if (operationMode === 'full-auto') {
        // Auto-approve all gated cases and execute queued tasks
        const gatedCases = await prisma.exploitCase.findMany({
          where: { targetId, gateStatus: 'PENDING_APPROVAL' },
        });
        for (const ec of gatedCases) {
          await prisma.exploitCase.update({
            where: { id: ec.id },
            data: { gateStatus: 'APPROVED' },
          });
        }
        const queuedTasks = await prisma.exploitTask.findMany({
          where: { case: { targetId }, status: 'QUEUED', phase: { in: ['EXPLOITATION', 'PERSISTENCE'] } },
        });
        emitLogEntry({
          level: 'INFO',
          source: 'orchestrator',
          message: `Full-auto: auto-approved ${gatedCases.length} case(s), executing ${queuedTasks.length} gated task(s)`,
        });
        for (const task of queuedTasks) {
          setImmediate(() => executeTask(task.id, task.caseId));
        }
      } else {
        emitLogEntry({
          level: 'WARN',
          source: 'orchestrator',
          message: `Recon complete — ${gatedTasks} exploitation task(s) awaiting approval on the Exploitation page`,
        });
        return;
      }
    }

    if (activeTasks === 0) return;

    emitPhaseChange({ phase: 'exploit', target, status: 'running' });
    await prisma.scan.update({
      where: { id: scanId },
      data: { phase: 'EXPLOITATION' },
    });

    emitLogEntry({
      level: 'INFO',
      source: 'orchestrator',
      message: `Recon complete — waiting for ${activeTasks} exploitation task(s) to finish`,
    });

    await aiService.recordDecision({
      decision: 'Transitioning to exploitation phase',
      rationale: `Recon complete. ${activeTasks} exploitation task(s) still running/queued. Waiting for completion.`,
      scanId,
    });

    while (Date.now() - startWait < MAX_WAIT_MS) {
      if (state?.cancelled || state?.paused) break;

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      const remaining = await prisma.exploitTask.count({
        where: {
          case: { targetId },
          status: { in: ['RUNNING', 'QUEUED'] },
        },
      });

      if (remaining === 0) {
        // All exploit tasks finished
        const completedTasks = await prisma.exploitTask.count({
          where: {
            case: { targetId },
            status: 'COMPLETED',
          },
        });

        emitLogEntry({
          level: 'INFO',
          source: 'orchestrator',
          message: `All exploitation tasks complete (${completedTasks} total)`,
        });

        await aiService.recordDecision({
          decision: 'Exploitation phase complete',
          rationale: `${completedTasks} exploit task(s) finished. Scan fully complete.`,
          scanId,
        });
        return;
      }
    }

    // Timed out
    const stillRunning = await prisma.exploitTask.count({
      where: {
        case: { targetId },
        status: { in: ['RUNNING', 'QUEUED'] },
      },
    });

    emitLogEntry({
      level: 'WARN',
      source: 'orchestrator',
      message: `Exploitation wait timed out — ${stillRunning} task(s) still pending`,
    });
  }

  /**
   * Find or create an exploit case for a target. Used by the semi-auto gate
   * to spawn gated tasks in the exploitation pipeline.
   */
  private async findOrCreateExploitCase(targetId: string, targetUrl: string): Promise<string | null> {
    const existing = await prisma.exploitCase.findFirst({
      where: { targetId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return existing.id;

    const newCase = await prisma.exploitCase.create({
      data: {
        name: `Auto: ${targetUrl}`,
        description: 'Created by scan orchestrator for gated exploitation tasks',
        targetId,
        status: 'ACTIVE',
        currentPhase: 'ENUMERATION',
        gateStatus: 'NONE',
      },
    });
    console.log(`[Orchestrator] Created exploit case ${newCase.id} for ${targetUrl}`);
    return newCase.id;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Pause handler
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Save state and mark scan as PAUSED.
   */
  private async handlePause(
    scanId: string,
    targetId: string,
    target: string,
    toolHistory: ToolRunSummary[],
    iteration: number,
    consecutiveSkips = 0,
    gateHit = false,
    mode = 'semi-auto',
  ) {
    // Save execution state
    await scanContextService.saveExecutionState(targetId, scanId, {
      scanId,
      iteration,
      consecutiveSkips,
      gateHit,
      mode,
      toolsRun: toolHistory.map((h) => h.tool),
    });

    // Refresh context documents
    await scanContextService.refreshFindingsSummary(targetId).catch(() => {});
    await scanContextService.refreshAIReasoningSummary(targetId, scanId).catch(() => {});

    // Mark scan as paused
    await prisma.scan.update({
      where: { id: scanId },
      data: { status: 'PAUSED' },
    });

    emitScanPaused({ scan_id: scanId, target });
    emitLogEntry({
      level: 'INFO',
      source: 'orchestrator',
      message: `Scan ${scanId} paused at iteration ${iteration} (${toolHistory.length} tools completed)`,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Shared helpers
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Execute a single tool, store results, emit events, extract loot.
   * Returns the raw tool result.
   */
  private async executeTool(
    scanId: string,
    targetId: string,
    target: string,
    tool: string,
    progress: string,
  ) {
    // ── VPN Rotation — rotate IP before tool execution if strategy demands it
    const toolIndex = parseInt(progress.split('/')[0], 10) || 0;
    const scan = await prisma.scan.findUnique({ where: { id: scanId }, select: { phase: true } });
    await vpnRotationService.shouldRotateAndExecute(scanId, toolIndex, scan?.phase ?? 'RECON');

    await prisma.scan.update({
      where: { id: scanId },
      data: { progress },
    });

    emitReconOutput({
      tool,
      target,
      output: `Starting ${tool}...`,
      complete: false,
      event: 'tool_start',
      progress,
      scan_id: scanId,
    });

    const result = await toolExecutor.run(tool, target);

    // Store result
    await prisma.scanResult.create({
      data: {
        scanId,
        resultType: this.toolToResultType(tool),
        data: {
          tool: result.tool,
          output: result.output,
          exitCode: result.exitCode,
          duration: result.duration,
        } as any,
        source: tool,
      },
    });

    // Emit structured discoveries from tool output
    if (result.output && !result.error) {
      this.emitDiscoveries(tool, target, result.output, scanId);
    }

    // Extract loot from tool output
    if (result.output && !result.error) {
      try {
        const lootCount = await lootService.extractFromOutput(result.output, tool, targetId);
        if (lootCount > 0) {
          emitLogEntry({
            level: 'INFO',
            source: 'loot',
            message: `Extracted ${lootCount} loot items from ${tool}`,
          });

          // Trigger concurrent exploitation evaluation if findings warrant it
          const ctx = exploitTrackManager.getScanContext(scanId);
          if (ctx && ctx.operationMode !== 'manual') {
            setImmediate(() => {
              exploitTrackManager.evaluateFindings(scanId, targetId, tool, ctx.operationMode)
                .catch((err) => console.error('[ExploitTrack] Evaluation failed:', err.message));
            });
          }
        }
      } catch (err: any) {
        console.error(`[Loot] Extraction failed for ${tool}:`, err.message);
      }
    }

    // Port scan tools always produce actionable findings — trigger evaluation
    if (['nmap', 'masscan', 'rustscan'].includes(tool) && result.output && !result.error) {
      const ctx = exploitTrackManager.getScanContext(scanId);
      if (ctx && ctx.operationMode !== 'manual') {
        setImmediate(() => {
          exploitTrackManager.evaluateFindings(scanId, targetId, tool, ctx.operationMode)
            .catch((err) => console.error('[ExploitTrack] Port evaluation failed:', err.message));
        });
      }
    }

    // Log to DB
    await prisma.logEntry.create({
      data: {
        scanId,
        level: result.error ? 'ERROR' : 'INFO',
        source: tool,
        message: result.error
          ? `${tool} failed: ${result.error}`
          : `${tool} complete (${Math.round(result.duration / 1000)}s)`,
      },
    });

    emitReconOutput({
      tool,
      target,
      output: result.error ? `[${tool}] Error: ${result.error}` : `[${tool}] Complete`,
      complete: true,
      event: result.error ? 'tool_error' : 'tool_complete',
      progress,
      scan_id: scanId,
      rawOutput: result.output?.substring(0, 50_000),
      exitCode: result.exitCode,
      duration: result.duration,
      targetId,
    });

    return result;
  }

  /**
   * Summarize a tool result for inclusion in AI prompts.
   */
  private summarizeResult(result: { tool: string; output: string; exitCode: number; duration: number; error?: string }): ToolRunSummary {
    // Truncate output to ~1000 chars for the AI prompt (keep prompts manageable for local models)
    const maxLen = 1000;
    const snippet = result.output.length > maxLen
      ? result.output.slice(0, maxLen) + '\n... [output truncated]'
      : result.output;

    return {
      tool: result.tool,
      exitCode: result.exitCode,
      duration: result.duration,
      outputSnippet: snippet,
      error: result.error,
    };
  }

  // ── AI prompt construction ────────────────────────────────────────────────

  private async buildAIPrompt(
    target: string,
    targetId: string,
    toolHistory: ToolRunSummary[],
    operationMode: OperationMode,
    phase: 'recon' | 'exploitation' = 'recon',
  ): Promise<string> {
    // Build executed set including exploit track manager tools
    // Filter out pseudo-entries (like __prior_exploit_findings__) from the executed set
    const executedSet = new Set(toolHistory.map((h) => h.tool).filter((t) => !t.startsWith('__')));
    try {
      // Include active + completed ETM tasks as executed to prevent AI from recommending them
      const etmTasks = await prisma.exploitTask.findMany({
        where: { case: { targetId }, status: { in: ['RUNNING', 'QUEUED', 'COMPLETED'] } },
        select: { tool: true },
      });
      for (const et of etmTasks) executedSet.add(et.tool);
    } catch { /* best effort */ }

    const allExecuted = [...executedSet];
    const remainingTools = ALL_AVAILABLE_TOOLS.filter((t) => !executedSet.has(t));
    const toolList = remainingTools.length > 0 ? remainingTools.join(', ') : 'NONE';
    const alreadyRan = allExecuted.join(', ');

    const resultsSummary = toolHistory
      .map((h) => {
        const status = h.error ? `FAILED (${h.error})` : `OK (${Math.round(h.duration / 1000)}s)`;
        return `### ${h.tool.toUpperCase()} — ${status}\n${h.outputSnippet}`;
      })
      .join('\n\n');

    // Add concurrent exploitation context if available
    let exploitSection = '';
    const exploitCtx = await exploitTrackManager.getExploitContext(targetId);
    if (exploitCtx) {
      exploitSection = `\n\n## EXPLOITATION TRACK MANAGER RESULTS\n${exploitCtx}\n`;
    }

    // Add historical context from previous scans
    let historicalSection = '';
    const historicalCtx = await scanContextService.getContextForAIPrompt(targetId);
    if (historicalCtx) {
      historicalSection = `\n\n## HISTORICAL CONTEXT (from previous scans)\n${historicalCtx}\n`;
    }

    // ── Exploitation planning phase prompt ──────────────────────────────
    if (phase === 'exploitation') {
      const remainingExploitTools = [...EXPLOIT_TOOLS].filter((t) => !executedSet.has(t));
      const exploitToolList = remainingExploitTools.length > 0
        ? remainingExploitTools.join(', ')
        : 'NONE (all exploitation tools have been executed)';

      const gateNote = operationMode === 'semi-auto'
        ? '\nIMPORTANT: Exploitation tools require operator approval in semi-auto mode. Recommend them — they will be queued for the operator.'
        : '';

      return `You are the AI orchestrator for CStrike, an offensive security automation platform.
You have completed reconnaissance of target: ${target} and are now in the EXPLOITATION PLANNING phase.

OPERATION MODE: ${operationMode.toUpperCase()}${gateNote}

## PHASE: EXPLOITATION PLANNING

Reconnaissance is complete. Your job now is to ANALYZE the findings and plan TARGETED EXPLOITATION.

EXPLOITATION TOOLS AVAILABLE: ${exploitToolList}
ALL TOOLS NOT YET EXECUTED: ${toolList}
ALREADY EXECUTED (do NOT recommend these again): ${alreadyRan || 'none'}

## RECONNAISSANCE FINDINGS

${resultsSummary || 'No results available.'}
${exploitSection}${historicalSection}
## YOUR TASK

You are in the EXPLOITATION PLANNING phase. Analyze ALL reconnaissance findings above and plan targeted attacks.

Step 1 — ANALYZE: What specific vulnerabilities, misconfigurations, exposed services, or weak credentials were discovered?
Step 2 — PLAN: Which exploitation tool targets the most critical weakness found?
Step 3 — RECOMMEND: Pick the most impactful tool from the available list.

Attack vector analysis:
- Web application vulnerabilities (SQL injection, XSS, command injection) → sqlmap, xsstrike, commix, zap
- Comprehensive web app security scanning (OWASP Top 10, spider, active scan) → zap
- Service-level exploitation (EternalBlue, Heartbleed, known CVEs) → metasploit
- Weak/default credentials on exposed services (SSH, FTP, SMB, HTTP auth) → hydra
- Password hashes discovered → john, hashcat
- Known CVEs found by nuclei/nmap → searchsploit for exploit research, then metasploit
- Directory/file discovery gaps → remaining fuzzing tools (ffuf, feroxbuster, dirb)

Tool priority for exploitation:
1. zap — Comprehensive web application security scan (spider + active scan + OWASP checks)
2. metasploit — Service-level vulnerability scanning and exploitation (auxiliary modules)
3. sqlmap/xsstrike/commix — Targeted injection attacks
4. hydra — Credential brute-forcing
5. john/hashcat — Hash cracking

CRITICAL RULE: You MUST NEVER recommend a tool that appears in the "ALREADY EXECUTED" list above. If a tool has already been executed, it is FINISHED. Pick a DIFFERENT tool.
Say DONE when all remaining exploitation tools would provide no value against the discovered attack surface.

## RESPONSE FORMAT

Respond with EXACTLY this format:

NEXT_TOOL: <tool_name from available list, or DONE if exploitation is exhausted>
REASONING: <which specific vulnerability/weakness is being targeted and why this tool is appropriate>
OBSERVATIONS: <summary of attack vectors identified from recon, exploitation progress so far>`;
    }

    // ── Reconnaissance phase prompt ─────────────────────────────────────
    const gateNote = operationMode === 'semi-auto'
      ? '\nIMPORTANT: Exploitation tools (sqlmap, xsstrike, commix, hydra, john, hashcat) require operator approval in semi-auto mode.'
      : operationMode === 'full-auto'
        ? '\nFull-auto mode: you may recommend any tool without restriction.'
        : '';

    return `You are the AI orchestrator for CStrike, an offensive security automation platform.
You are conducting a security assessment of target: ${target}

OPERATION MODE: ${operationMode.toUpperCase()}${gateNote}

## PHASE: RECONNAISSANCE

Your goal is to discover as much attack surface as possible before transitioning to exploitation.
The exploit track manager is running some exploitation tools concurrently in the background — tools it has run are listed in ALREADY EXECUTED.

TOOLS NOT YET EXECUTED (choose from these ONLY): ${toolList}
ALREADY EXECUTED (do NOT recommend these again): ${alreadyRan || 'none'}

## RESULTS SO FAR

${resultsSummary || 'No tools have been executed yet.'}
${exploitSection}${historicalSection}
## YOUR TASK

Analyze the scan results above and decide what RECONNAISSANCE tool to run next.
IMPORTANT: You must ONLY recommend a tool from the "TOOLS NOT YET EXECUTED" list above. Do NOT recommend any tool from the "ALREADY EXECUTED" list.
Consider:
1. What attack surface has been revealed so far?
2. What services, technologies, and potential vulnerabilities have been identified?
3. What tool from the NOT YET EXECUTED list would reveal the most NEW attack surface?
4. Say DONE only when additional reconnaissance tools would not reveal significant new information. After recon, the system will automatically transition to exploitation planning.

## RESPONSE FORMAT

Respond with EXACTLY this format:

NEXT_TOOL: <tool_name from NOT YET EXECUTED list, or DONE>
REASONING: <1-3 sentences explaining why>
OBSERVATIONS: <key findings from the latest results — ports, services, technologies, potential attack vectors>

If all valuable reconnaissance is complete, respond with:
NEXT_TOOL: DONE
REASONING: <why we have sufficient information>
OBSERVATIONS: <summary of all findings>`;
  }

  /**
   * Parse the AI's response for tool recommendation.
   */
  private parseAIRecommendation(content: string): {
    tool: string | null;
    done: boolean;
    reasoning: string;
    observations: string;
  } {
    const toolMatch = content.match(/NEXT_TOOL:\s*(\S+)/i);
    const reasonMatch = content.match(/REASONING:\s*(.+?)(?=\nOBSERVATIONS:|$)/is);
    const obsMatch = content.match(/OBSERVATIONS:\s*(.+)/is);

    const tool = toolMatch?.[1]?.trim().toLowerCase() ?? null;
    const done = tool === 'done' || tool === null;

    return {
      tool: done ? null : tool,
      done,
      reasoning: reasonMatch?.[1]?.trim() ?? 'No reasoning provided',
      observations: obsMatch?.[1]?.trim() ?? '',
    };
  }

  // ── Default tool lists (manual mode) ──────────────────────────────────────

  private getDefaultTools(mode: string): string[] {
    switch (mode) {
      case 'quick':
        return ['nmap', 'httpx', 'whatweb'];
      case 'web':
        return ['nmap', 'httpx', 'nikto', 'gobuster', 'whatweb', 'sslscan', 'nuclei'];
      case 'stealth':
        return ['nmap', 'subfinder', 'httpx'];
      case 'full':
      default:
        return [
          'nmap', 'subfinder', 'httpx', 'nikto', 'waybackurls',
          'gobuster', 'whatweb', 'sslscan', 'nuclei',
        ];
    }
  }

  /**
   * Parse tool output and emit structured port/subdomain discoveries.
   */
  private emitDiscoveries(tool: string, target: string, output: string, scanId: string) {
    // Parse nmap output for open ports
    if (['nmap', 'masscan', 'rustscan'].includes(tool)) {
      const portRegex = /^(\d+)\/(tcp|udp)\s+(open)\s+(\S+)\s*(.*)/gm;
      let match;
      while ((match = portRegex.exec(output)) !== null) {
        emitPortDiscovered({
          port: parseInt(match[1], 10),
          protocol: match[2],
          state: match[3],
          service: match[4],
          version: (match[5] || '').trim(),
          target,
          scan_id: scanId,
        });
      }
    }

    // Parse subfinder/amass output for subdomains
    if (['subfinder', 'amass', 'dnsenum', 'dnsrecon'].includes(tool)) {
      const lines = output.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        const subdomain = line.trim();
        if (subdomain && subdomain.includes('.') && !subdomain.startsWith('[')) {
          emitSubdomainDiscovered({
            subdomain,
            target,
            source: tool,
            scan_id: scanId,
          });
        }
      }
    }
  }

  /**
   * Map tool name to ScanResultType.
   */
  private toolToResultType(tool: string): any {
    const map: Record<string, string> = {
      nmap: 'PORT_SCAN',
      masscan: 'PORT_SCAN',
      rustscan: 'PORT_SCAN',
      subfinder: 'SUBDOMAIN',
      amass: 'SUBDOMAIN',
      dnsenum: 'SUBDOMAIN',
      dnsrecon: 'SUBDOMAIN',
      httpx: 'HTTP_ENDPOINT',
      whatweb: 'TECHNOLOGY',
      wafw00f: 'TECHNOLOGY',
      nuclei: 'VULNERABILITY',
      nikto: 'WEB_SCAN',
      sqlmap: 'EXPLOIT_RESULT',
      xsstrike: 'EXPLOIT_RESULT',
      gobuster: 'HTTP_ENDPOINT',
      ffuf: 'HTTP_ENDPOINT',
      dirb: 'HTTP_ENDPOINT',
      feroxbuster: 'HTTP_ENDPOINT',
      sslscan: 'RAW_OUTPUT',
      sslyze: 'RAW_OUTPUT',
      testssl: 'RAW_OUTPUT',
    };
    return map[tool] ?? 'RAW_OUTPUT';
  }
}

export const scanOrchestrator = new ScanOrchestrator();
