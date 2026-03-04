/**
 * Exploit Case routes — intelligence-driven exploitation pipeline.
 *
 * POST   /api/v1/cases                 — Create case (auto-starts intelligence analysis)
 * GET    /api/v1/cases                 — List cases
 * GET    /api/v1/cases/:id             — Get case with tasks
 * PUT    /api/v1/cases/:id             — Update case
 * DELETE /api/v1/cases/:id             — Delete case
 * POST   /api/v1/cases/:id/approve     — Approve gated phase
 * POST   /api/v1/cases/:id/tasks       — Manual task launch
 * GET    /api/v1/cases/:id/tasks/:tid  — Task detail
 * DELETE /api/v1/cases/:id/tasks/:tid  — Cancel task
 * POST   /api/v1/cases/:id/analyze     — Re-run intelligence analysis
 */

import { Router } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { intelligenceEngine } from '../services/intelligenceEngine.js';
import { toolExecutor } from '../services/toolExecutor.js';
import { lootService } from '../services/lootService.js';
import { aiService } from '../services/aiService.js';
import {
  emitTaskCreated,
  emitTaskStarted,
  emitTaskOutput,
  emitTaskCompleted,
  emitTaskFailed,
  emitCaseGateReached,
  emitCasePhaseChanged,
} from '../websocket/emitter.js';

export const casesRouter = Router();

// Active task processes for cancellation
export const activeProcesses = new Map<string, { cancelled: boolean }>();

// ---------------------------------------------------------------------------
// Helper: run a task in background
// ---------------------------------------------------------------------------

export async function executeTask(taskId: string, caseId: string) {
  const task = await prisma.exploitTask.findUnique({ where: { id: taskId } });
  if (!task || task.status !== 'QUEUED') return;

  const ctrl = { cancelled: false };
  activeProcesses.set(taskId, ctrl);

  // Mark running
  await prisma.exploitTask.update({
    where: { id: taskId },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  emitTaskStarted({ caseId, taskId, tool: task.tool, target: task.target, startedAt: Date.now() });

  try {
    // Build tool options from config
    const config = task.config as Record<string, any> ?? {};
    const opts: Record<string, any> = {};
    if (config.service) opts.service = config.service;
    if (config.port) opts.port = config.port;
    if (config.wordlist) opts.wordlist = config.wordlist;
    if (config.timeout) opts.timeout = config.timeout;

    // Determine tool target — use config.targetUrl if present, else task.target
    const toolTarget = config.targetUrl ?? task.target;

    const result = await toolExecutor.run(task.tool, toolTarget, opts);

    if (ctrl.cancelled) return;

    // Extract loot from output
    const caseRecord = await prisma.exploitCase.findUnique({ where: { id: caseId } });
    if (result.output && caseRecord) {
      try {
        await lootService.extractFromOutput(result.output, task.tool, caseRecord.targetId);
      } catch { /* best effort */ }
    }

    // Parse findings from output
    const findings = parseFindingsFromOutput(result.output ?? '', task.tool);

    // Update task
    await prisma.exploitTask.update({
      where: { id: taskId },
      data: {
        status: result.exitCode === 0 || (result.output?.length ?? 0) > 0 ? 'COMPLETED' : 'FAILED',
        output: result.output ?? '',
        findings: findings as any,
        exitCode: result.exitCode,
        error: result.error ?? null,
        endedAt: new Date(),
        duration: result.duration,
      },
    });

    emitTaskCompleted({
      caseId,
      taskId,
      tool: task.tool,
      target: task.target,
      exitCode: result.exitCode,
      duration: result.duration,
      findingsCount: findings.length,
      credentialsCount: result.credentials?.length ?? 0,
    });

    console.log(`[Case:${caseId}] ${task.tool} completed — exit=${result.exitCode}, findings=${findings.length}, output=${(result.output?.length ?? 0)} chars`);

    // After task completes, re-analyze for new opportunities
    await reanalyzeAfterTask(caseId, caseRecord?.targetId ?? '');

    // Feed findings to AI for strategic analysis
    setImmediate(() => feedFindingsToAI(caseId, caseRecord?.targetId ?? ''));
  } catch (err: any) {
    if (ctrl.cancelled) return;

    await prisma.exploitTask.update({
      where: { id: taskId },
      data: {
        status: 'FAILED',
        error: err.message,
        endedAt: new Date(),
        duration: Date.now() - (task.startedAt?.getTime() ?? Date.now()),
      },
    });

    emitTaskFailed({ caseId, taskId, tool: task.tool, error: err.message });
    console.error(`[Case:${caseId}] ${task.tool} failed:`, err.message);
  } finally {
    activeProcesses.delete(taskId);
  }
}

export async function reanalyzeAfterTask(caseId: string, targetId: string) {
  if (!targetId) return;
  try {
    const recs = await intelligenceEngine.analyzeFindings(caseId, targetId);
    if (recs.length === 0) return;

    const { autoTasks, gatedTasks } = await intelligenceEngine.materializeTasks(caseId, recs);

    // Auto-run enumeration tasks
    for (const tid of autoTasks) {
      setImmediate(() => executeTask(tid, caseId));
    }

    // If new gated tasks, emit gate event
    if (gatedTasks.length > 0) {
      emitCaseGateReached({ caseId, pendingTasks: gatedTasks.length, phase: 'EXPLOITATION' });
    }
  } catch (err: any) {
    console.error(`[Case:${caseId}] Re-analysis failed:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// Feed findings to AI for strategic analysis
// ---------------------------------------------------------------------------

export async function feedFindingsToAI(caseId: string, targetId: string) {
  if (!targetId) return;
  try {
    const target = await prisma.target.findUnique({ where: { id: targetId } });
    if (!target) return;

    // Recent completed tasks
    const recentTasks = await prisma.exploitTask.findMany({
      where: { caseId, status: { in: ['COMPLETED', 'FAILED'] } },
      orderBy: { endedAt: 'desc' },
      take: 5,
      select: { tool: true, target: true, exitCode: true, findings: true, output: true, duration: true },
    });

    // Loot items grouped by category
    const lootItems = await prisma.lootItem.findMany({
      where: { targetId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Validated credentials
    const credentials = await prisma.credentialPair.findMany({
      where: { targetId, validationStatus: 'VALID' },
    });

    // Build prompt sections
    const sections: string[] = [`Target: ${target.url}`];

    // Ports
    const ports = lootItems.filter(l => l.category === 'PORT');
    if (ports.length > 0) {
      sections.push('\n== Open Ports ==');
      for (const p of ports) {
        const svc = (p.metadata as any)?.service || 'unknown';
        sections.push(`Port ${p.value} (${svc}) — found by ${p.source}`);
      }
    }

    // URLs
    const urls = lootItems.filter(l => l.category === 'URL');
    if (urls.length > 0) {
      sections.push('\n== Discovered URLs ==');
      for (const u of urls.slice(0, 15)) {
        sections.push(`${u.value} — ${u.source}`);
      }
      if (urls.length > 15) sections.push(`... and ${urls.length - 15} more`);
    }

    // Credentials
    if (credentials.length > 0) {
      sections.push(`\n== Credentials ==`);
      sections.push(`${credentials.length} valid credential(s) found`);
      for (const c of credentials) {
        sections.push(`- ${c.username}:*** on ${c.service || 'unknown'} port ${c.port || '?'}`);
      }
    }

    // Recent task results
    if (recentTasks.length > 0) {
      sections.push('\n== Recent Task Results ==');
      for (const t of recentTasks) {
        const findings = Array.isArray(t.findings) ? t.findings : [];
        const outputPreview = t.output ? t.output.slice(0, 200) : '';
        sections.push(`[${t.tool}] target=${t.target} exit=${t.exitCode} findings=${findings.length} duration=${t.duration}ms`);
        if (outputPreview) sections.push(`  output: ${outputPreview}...`);
      }
    }

    sections.push('\nAnalyze these findings and recommend the highest-priority attack vectors.');
    sections.push('What specific tools and commands should be run next? Explain your reasoning.');

    const prompt = sections.join('\n');

    console.log(`[Case:${caseId}] Feeding findings to AI (${prompt.length} chars)`);

    await aiService.analyze({
      prompt,
      target: target.url,
      mode: 'analyze',
    });
  } catch (err: any) {
    console.error(`[Case:${caseId}] AI analysis failed:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// Simple findings parser
// ---------------------------------------------------------------------------

export interface Finding {
  type: 'vulnerability' | 'credential' | 'endpoint' | 'info';
  severity?: string;
  title: string;
  detail: string;
}

export function parseFindingsFromOutput(output: string, tool: string): Finding[] {
  const findings: Finding[] = [];
  if (!output) return findings;

  // Hydra credentials
  const credRegex = /\[(\d+)\]\[(\w+)\]\s+host:\s+\S+\s+login:\s+(\S+)\s+password:\s+(\S+)/g;
  let match;
  while ((match = credRegex.exec(output)) !== null) {
    findings.push({
      type: 'credential',
      title: `${match[3]}:${match[4]}`,
      detail: `Found via ${match[2]} on port ${match[1]}`,
    });
  }

  // Nuclei findings
  const nucleiRegex = /\[(\w+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)/g;
  while ((match = nucleiRegex.exec(output)) !== null) {
    findings.push({
      type: 'vulnerability',
      severity: match[1].toLowerCase(),
      title: match[2],
      detail: match[4],
    });
  }

  // Gobuster/ffuf directories
  if (['gobuster', 'ffuf', 'feroxbuster', 'dirb'].includes(tool)) {
    const urlRegex = /(\/\S+)\s+.*(?:Status|→):\s*(\d+)/g;
    while ((match = urlRegex.exec(output)) !== null) {
      findings.push({
        type: 'endpoint',
        title: match[1],
        detail: `HTTP ${match[2]}`,
      });
    }
  }

  // SQLMap injection points
  if (tool === 'sqlmap' && output.includes('is vulnerable')) {
    findings.push({
      type: 'vulnerability',
      severity: 'high',
      title: 'SQL Injection',
      detail: 'SQLMap detected injectable parameter',
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Create a new case
casesRouter.post('/', async (req, res, next) => {
  try {
    const { name, targetId, description, campaignId } = req.body;
    if (!name || !targetId) throw new AppError(400, 'name and targetId are required');

    // Verify target exists and has completed recon
    const target = await prisma.target.findUnique({ where: { id: targetId } });
    if (!target) throw new AppError(404, 'Target not found');

    const exploitCase = await prisma.exploitCase.create({
      data: {
        name,
        description: description ?? '',
        targetId,
        campaignId: campaignId ?? null,
        status: 'ACTIVE',
        currentPhase: 'ENUMERATION',
        gateStatus: 'NONE',
      },
    });

    // Run intelligence analysis to generate initial tasks
    setImmediate(async () => {
      try {
        const recs = await intelligenceEngine.analyzeFindings(exploitCase.id, targetId);
        console.log(`[Case:${exploitCase.id}] Intelligence engine generated ${recs.length} recommendations (${recs.filter(r => r.autoRun).length} auto, ${recs.filter(r => !r.autoRun).length} gated)`);

        if (recs.length === 0) return;

        const { autoTasks, gatedTasks } = await intelligenceEngine.materializeTasks(exploitCase.id, recs);

        // Auto-run enumeration tasks immediately
        for (const tid of autoTasks) {
          setImmediate(() => executeTask(tid, exploitCase.id));
        }

        // Emit gate event if exploitation tasks are queued
        if (gatedTasks.length > 0) {
          emitCaseGateReached({
            caseId: exploitCase.id,
            pendingTasks: gatedTasks.length,
            phase: 'EXPLOITATION',
          });
        }

        // Feed initial findings to AI for strategic analysis
        setImmediate(() => feedFindingsToAI(exploitCase.id, targetId));
      } catch (err: any) {
        console.error(`[Case:${exploitCase.id}] Initial analysis failed:`, err.message);
      }
    });

    res.status(201).json({
      success: true,
      data: exploitCase,
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// List cases
casesRouter.get('/', async (req, res, next) => {
  try {
    const { status, targetId } = req.query as Record<string, string | undefined>;
    const where: any = {};
    if (status) where.status = status.toUpperCase();
    if (targetId) where.targetId = targetId;

    const cases = await prisma.exploitCase.findMany({
      where,
      include: {
        target: { select: { url: true, hostname: true } },
        campaign: { select: { id: true, name: true } },
        _count: { select: { tasks: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Enrich with task summary
    const enriched = await Promise.all(
      cases.map(async (c) => {
        const taskStats = await prisma.exploitTask.groupBy({
          by: ['status'],
          where: { caseId: c.id },
          _count: true,
        });
        const statusCounts: Record<string, number> = {};
        for (const s of taskStats) statusCounts[s.status] = s._count;

        return {
          ...c,
          taskSummary: statusCounts,
        };
      }),
    );

    res.json({ success: true, data: enriched, timestamp: Date.now() });
  } catch (err) {
    next(err);
  }
});

// Get case detail with tasks
casesRouter.get('/:id', async (req, res, next) => {
  try {
    const exploitCase = await prisma.exploitCase.findUnique({
      where: { id: req.params.id },
      include: {
        target: { select: { url: true, hostname: true, ip: true } },
        campaign: { select: { id: true, name: true } },
        tasks: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!exploitCase) throw new AppError(404, 'Case not found');

    res.json({ success: true, data: exploitCase, timestamp: Date.now() });
  } catch (err) {
    next(err);
  }
});

// Update case
casesRouter.put('/:id', async (req, res, next) => {
  try {
    const { name, description, status, campaignId } = req.body;
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (status !== undefined) data.status = status.toUpperCase();
    if (campaignId !== undefined) data.campaignId = campaignId;

    const updated = await prisma.exploitCase.update({
      where: { id: req.params.id },
      data,
    });

    res.json({ success: true, data: updated, timestamp: Date.now() });
  } catch (err) {
    next(err);
  }
});

// Delete case
casesRouter.delete('/:id', async (req, res, next) => {
  try {
    await prisma.exploitCase.delete({ where: { id: req.params.id } });
    res.json({ success: true, timestamp: Date.now() });
  } catch (err) {
    next(err);
  }
});

// Approve gated phase — runs all queued exploitation/persistence tasks
casesRouter.post('/:id/approve', async (req, res, next) => {
  try {
    const exploitCase = await prisma.exploitCase.findUnique({
      where: { id: req.params.id },
      include: { tasks: { where: { status: 'QUEUED' } } },
    });

    if (!exploitCase) throw new AppError(404, 'Case not found');

    // Find all queued tasks in gated phases (exploitation or persistence)
    const gatedTasks = exploitCase.tasks.filter(
      (t) => t.status === 'QUEUED' && (t.phase === 'EXPLOITATION' || t.phase === 'PERSISTENCE'),
    );

    if (gatedTasks.length === 0) {
      throw new AppError(400, 'No queued tasks to approve');
    }

    // Determine next phase from the queued tasks
    const nextPhase = gatedTasks.some((t) => t.phase === 'EXPLOITATION') ? 'EXPLOITATION' : 'PERSISTENCE';

    // Update gate status and phase
    await prisma.exploitCase.update({
      where: { id: req.params.id },
      data: {
        gateStatus: 'APPROVED',
        currentPhase: nextPhase as any,
      },
    });

    emitCasePhaseChanged({ caseId: exploitCase.id, phase: nextPhase });

    console.log(`[Case:${exploitCase.id}] Gate approved — launching ${gatedTasks.length} ${nextPhase} tasks`);

    // Launch all gated tasks
    for (const task of gatedTasks) {
      setImmediate(() => executeTask(task.id, exploitCase.id));
    }

    // Reset gate for next phase
    setImmediate(async () => {
      await prisma.exploitCase.update({
        where: { id: req.params.id },
        data: { gateStatus: 'NONE' },
      });
    });

    res.json({
      success: true,
      data: { launched: gatedTasks.length, phase: nextPhase },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// Manual task launch (operator override)
casesRouter.post('/:id/tasks', async (req, res, next) => {
  try {
    const { tool, config } = req.body;
    if (!tool) throw new AppError(400, 'tool is required');

    const exploitCase = await prisma.exploitCase.findUnique({ where: { id: req.params.id } });
    if (!exploitCase) throw new AppError(404, 'Case not found');

    const task = await prisma.exploitTask.create({
      data: {
        caseId: exploitCase.id,
        tool,
        target: exploitCase.targetId,
        phase: exploitCase.currentPhase,
        status: 'QUEUED',
        trigger: 'operator:manual',
        config: config ?? {},
      },
    });

    emitTaskCreated({
      caseId: exploitCase.id,
      taskId: task.id,
      tool,
      target: task.target,
      config: config ?? {},
    });

    // Execute immediately
    setImmediate(() => executeTask(task.id, exploitCase.id));

    res.status(201).json({ success: true, data: task, timestamp: Date.now() });
  } catch (err) {
    next(err);
  }
});

// Get task detail
casesRouter.get('/:id/tasks/:tid', async (req, res, next) => {
  try {
    const task = await prisma.exploitTask.findFirst({
      where: { id: req.params.tid, caseId: req.params.id },
    });
    if (!task) throw new AppError(404, 'Task not found');

    res.json({ success: true, data: task, timestamp: Date.now() });
  } catch (err) {
    next(err);
  }
});

// Cancel task
casesRouter.delete('/:id/tasks/:tid', async (req, res, next) => {
  try {
    const ctrl = activeProcesses.get(req.params.tid);
    if (ctrl) ctrl.cancelled = true;

    await prisma.exploitTask.update({
      where: { id: req.params.tid },
      data: { status: 'CANCELLED', endedAt: new Date() },
    });

    res.json({ success: true, timestamp: Date.now() });
  } catch (err) {
    next(err);
  }
});

// Re-run intelligence analysis
casesRouter.post('/:id/analyze', async (req, res, next) => {
  try {
    const exploitCase = await prisma.exploitCase.findUnique({ where: { id: req.params.id } });
    if (!exploitCase) throw new AppError(404, 'Case not found');

    const recs = await intelligenceEngine.analyzeFindings(exploitCase.id, exploitCase.targetId);
    const { autoTasks, gatedTasks } = await intelligenceEngine.materializeTasks(exploitCase.id, recs);

    // Auto-run new enumeration tasks
    for (const tid of autoTasks) {
      setImmediate(() => executeTask(tid, exploitCase.id));
    }

    if (gatedTasks.length > 0) {
      emitCaseGateReached({ caseId: exploitCase.id, pendingTasks: gatedTasks.length, phase: 'EXPLOITATION' });
    }

    res.json({
      success: true,
      data: {
        newRecommendations: recs.length,
        autoLaunched: autoTasks.length,
        awaitingApproval: gatedTasks.length,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});
