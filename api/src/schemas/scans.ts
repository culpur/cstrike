/**
 * Zod schemas for scan (recon) routes.
 * Covers: start, batch start, phase advance, mode selection, and ID params.
 */

import { z } from 'zod';
import { ScanIdParamSchema, PaginationSchema } from './common.js';

// ── Enums (mirror Prisma) ────────────────────────────────────────────────────

export const ScanStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export const ScanPhaseSchema = z.enum([
  'IDLE',
  'RECON',
  'AI_ANALYSIS_1',
  'WEB_SCANS',
  'VULNAPI',
  'METASPLOIT',
  'AI_ANALYSIS_2',
  'EXPLOITATION',
  'REPORTING',
  'COMPLETE',
]);

/**
 * The known tool names the platform supports. Additional unknown names are
 * allowed (the executor returns a clean error for unrecognised tools) so we
 * use a string schema with a non-empty constraint rather than a strict enum.
 */
export const ToolNameSchema = z
  .string()
  .min(1, 'tool name cannot be empty')
  .max(64, 'tool name is too long')
  .regex(/^[a-z0-9_-]+$/, 'tool name must be lowercase alphanumeric with hyphens/underscores');

// ── Start scan ───────────────────────────────────────────────────────────────

export const StartScanSchema = z.object({
  /**
   * Target URL or hostname. Routes normalise to https:// internally — raw
   * strings are fine here so the guardrail check receives the un-modified value
   * that the operator typed.
   */
  target: z.string().min(1, 'target is required').max(2048),
  /** Optional subset of tools to run. Empty array means "all phase tools". */
  tools: z.array(ToolNameSchema).max(50).optional(),
  /**
   * Scan mode.
   * - "full"    — all phases
   * - "passive" — no active probing
   * - "stealth" — low-and-slow timing
   * - "quick"   — top-1000 ports / reduced tool set
   */
  mode: z.enum(['full', 'passive', 'stealth', 'quick']).default('full'),
});

export type StartScanBody = z.infer<typeof StartScanSchema>;

// ── Batch scan ───────────────────────────────────────────────────────────────

export const BatchScanSchema = z.object({
  targets: z
    .array(z.string().min(1).max(2048))
    .min(1, 'targets array must not be empty')
    .max(50, 'cannot batch more than 50 targets at once'),
  tools: z.array(ToolNameSchema).max(50).optional(),
  mode: z.enum(['full', 'passive', 'stealth', 'quick']).default('full'),
});

export type BatchScanBody = z.infer<typeof BatchScanSchema>;

// ── List active scans query ──────────────────────────────────────────────────

export const ListScansQuerySchema = PaginationSchema.extend({
  status: ScanStatusSchema.optional(),
  targetId: z.string().min(1).optional(),
  phase: ScanPhaseSchema.optional(),
});

export type ListScansQuery = z.infer<typeof ListScansQuerySchema>;

// ── Param schemas ────────────────────────────────────────────────────────────

export { ScanIdParamSchema };

// Individual scan ID path param alias for the delete route (/scans/:scanId).
export const ScanDeleteParamSchema = ScanIdParamSchema;
