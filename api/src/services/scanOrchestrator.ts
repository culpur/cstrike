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
import { scanContextService, type ExecutionState } from './scanContextService.js';

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
]);

const EXPLOIT_TOOLS = new Set([
  'sqlmap', 'xsstrike', 'commix',
  'hydra', 'john', 'hashcat',
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
    const operationMode = await getConfigValue<string>('operation_mode', 'semi-auto') as OperationMode;

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
      const operationMode = await getConfigValue<string>('operation_mode', 'semi-auto') as OperationMode;

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

      emitPhaseChange({ phase: 'recon', target, status: 'complete' });
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
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Manual Pipeline — fixed tool list, no AI
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

    const totalTools = scanTools.length;
    let completedTools = 0;

    emitPhaseChange({ phase: 'recon', target, status: 'running' });
    emitScanStarted({ target, scan_id: scanId, tools: scanTools });

    // Run each tool
    for (const tool of scanTools) {
      if (state?.cancelled) {
        emitLogEntry({ level: 'WARN', source: 'orchestrator', message: `Scan ${scanId} cancelled` });
        break;
      }

      // Check for pause
      if (state?.paused) {
        await this.handlePause(scanId, targetId, target, [], completedTools);
        return;
      }

      completedTools++;
      const progress = `${completedTools}/${totalTools}`;

      await this.executeTool(scanId, targetId, target, tool, progress);
    }
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

      for (const tool of initialTools) {
        if (state?.cancelled) break;
        if (state?.paused) {
          await this.handlePause(scanId, targetId, target, toolHistory, iteration);
          return;
        }
        iteration++;

        const result = await this.executeTool(scanId, targetId, target, tool, `${iteration}/?`);
        toolHistory.push(this.summarizeResult(result));
      }
    }

    // ── Phase 2: AI-driven loop ─────────────────────────────────────────
    while (iteration < MAX_AI_ITERATIONS && !state?.cancelled && !gateHit) {
      // Check for pause at top of loop
      if (state?.paused) {
        await this.handlePause(scanId, targetId, target, toolHistory, iteration, consecutiveSkips, gateHit, operationMode);
        return;
      }
      // Check if there are any tools left to run
      const executedSet = new Set(toolHistory.map((h) => h.tool));
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
      const analysisPrompt = await this.buildAIPrompt(target, targetId, toolHistory, operationMode);

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
        // AI says we're done
        await aiService.recordDecision({
          decision: 'Scan complete — all valuable reconnaissance paths explored',
          rationale: recommendation.reasoning,
          scanId,
        });

        emitLogEntry({
          level: 'INFO',
          source: 'ai',
          message: `AI recommends stopping: ${recommendation.reasoning}`,
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
        // Gate: pause for operator approval
        await aiService.recordDecision({
          decision: `GATE — exploitation tool ${recommendation.tool} requires operator approval`,
          rationale: recommendation.reasoning,
          selectedTool: recommendation.tool,
          scanId,
        });

        emitCaseGateReached({
          caseId: scanId,
          pendingTasks: 1,
          phase: 'exploitation',
        });

        emitLogEntry({
          level: 'WARN',
          source: 'orchestrator',
          message: `GATE: AI wants to run ${recommendation.tool} but semi-auto mode requires approval — skipping exploitation tools`,
        });

        // In semi-auto, skip exploitation tools and continue with recon
        // Record observation about what we would have done
        await aiService.recordObservation({
          observation: `Skipped ${recommendation.tool}: semi-auto gate. AI reasoning: ${recommendation.reasoning}`,
          source: 'gate',
          scanId,
        });

        // Ask AI for next recon tool instead
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

      // Execute the tool
      iteration++;
      const result = await this.executeTool(
        scanId,
        targetId,
        target,
        recommendation.tool,
        `${iteration}/?`,
      );
      toolHistory.push(this.summarizeResult(result));

      // Periodic checkpoint save (every 3 tools)
      if (iteration % 3 === 0) {
        await scanContextService.saveExecutionState(targetId, scanId, {
          scanId,
          iteration,
          consecutiveSkips,
          gateHit,
          mode: operationMode,
          toolsRun: toolHistory.map((h) => h.tool),
        }).catch(() => {});
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
    // Truncate output to ~2000 chars for the AI prompt
    const maxLen = 2000;
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
  ): Promise<string> {
    const executedSet = new Set(toolHistory.map((h) => h.tool));
    const remainingTools = ALL_AVAILABLE_TOOLS.filter((t) => !executedSet.has(t));
    const toolList = remainingTools.length > 0 ? remainingTools.join(', ') : 'NONE';
    const alreadyRan = toolHistory.map((h) => h.tool).join(', ');

    const resultsSummary = toolHistory
      .map((h) => {
        const status = h.error ? `FAILED (${h.error})` : `OK (${Math.round(h.duration / 1000)}s)`;
        return `### ${h.tool.toUpperCase()} — ${status}\n${h.outputSnippet}`;
      })
      .join('\n\n');

    const gateNote = operationMode === 'semi-auto'
      ? '\nIMPORTANT: Exploitation tools (sqlmap, xsstrike, commix, hydra, john, hashcat) require operator approval in semi-auto mode. Only recommend them if you believe exploitation is warranted based on findings.'
      : operationMode === 'full-auto'
        ? '\nFull-auto mode: you may recommend exploitation tools without restriction.'
        : '';

    // Add concurrent exploitation context if available
    let exploitSection = '';
    const exploitCtx = await exploitTrackManager.getExploitContext(targetId);
    if (exploitCtx) {
      exploitSection = `\n\n## CONCURRENT EXPLOITATION FINDINGS\n${exploitCtx}\n`;
    }

    // Add historical context from previous scans
    let historicalSection = '';
    const historicalCtx = await scanContextService.getContextForAIPrompt(targetId);
    if (historicalCtx) {
      historicalSection = `\n\n## HISTORICAL CONTEXT (from previous scans)\n${historicalCtx}\n`;
    }

    return `You are the AI orchestrator for CStrike, an offensive security automation platform.
You are conducting a security assessment of target: ${target}

OPERATION MODE: ${operationMode.toUpperCase()}${gateNote}

TOOLS NOT YET EXECUTED (choose from these ONLY): ${toolList}
ALREADY EXECUTED (do NOT recommend these again): ${alreadyRan || 'none'}

## RESULTS SO FAR

${resultsSummary || 'No tools have been executed yet.'}
${exploitSection}${historicalSection}
## YOUR TASK

Analyze the scan results above and decide what to do next.
IMPORTANT: You must ONLY recommend a tool from the "TOOLS NOT YET EXECUTED" list above. Do NOT recommend any tool from the "ALREADY EXECUTED" list.
Consider:
1. What attack surface has been revealed?
2. What services, technologies, and potential vulnerabilities have been identified?
3. What tool from the NOT YET EXECUTED list would provide the most value next?
4. Are we done with reconnaissance? If all valuable paths are explored, say DONE.

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
