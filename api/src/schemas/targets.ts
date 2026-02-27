/**
 * Zod schemas for target management routes.
 * Covers: create/upsert, update, list query filters, and ID params.
 */

import { z } from 'zod';
import { UrlStringSchema, Ipv4Schema, PaginationSchema, TargetIdParamSchema } from './common.js';

// ── Enums (mirror Prisma) ────────────────────────────────────────────────────

export const TargetStatusSchema = z.enum(['PENDING', 'SCANNING', 'COMPLETE', 'FAILED']);

// ── Create / Upsert ──────────────────────────────────────────────────────────

export const CreateTargetSchema = z.object({
  /** URL is required and gets normalized to https:// if no protocol is present. */
  url: UrlStringSchema,
  /** Optional override IP (e.g. when the hostname resolves differently). */
  ip: Ipv4Schema.optional(),
  /** Arbitrary tags for grouping and filtering. */
  tags: z
    .array(z.string().min(1).max(64))
    .max(50, 'cannot attach more than 50 tags')
    .optional(),
  /** Free-text operator notes. */
  notes: z.string().max(4000).optional(),
});

export type CreateTargetBody = z.infer<typeof CreateTargetSchema>;

// ── Update ───────────────────────────────────────────────────────────────────

export const UpdateTargetSchema = z
  .object({
    ip: Ipv4Schema.optional(),
    tags: z.array(z.string().min(1).max(64)).max(50).optional(),
    notes: z.string().max(4000).optional(),
    status: TargetStatusSchema.optional(),
  })
  .refine(
    (data) => Object.values(data).some((v) => v !== undefined),
    { message: 'at least one field must be provided' },
  );

export type UpdateTargetBody = z.infer<typeof UpdateTargetSchema>;

// ── List query filters ───────────────────────────────────────────────────────

export const ListTargetsQuerySchema = PaginationSchema.extend({
  status: TargetStatusSchema.optional(),
  tag: z.string().min(1).max(64).optional(),
  search: z.string().max(255).optional(),
});

export type ListTargetsQuery = z.infer<typeof ListTargetsQuerySchema>;

// ── Param schemas ────────────────────────────────────────────────────────────

export { TargetIdParamSchema };
