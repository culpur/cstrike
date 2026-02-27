/**
 * Zod schemas for loot routes.
 * LootItem — collected intelligence produced by scan tools.
 */

import { z } from 'zod';
import { PaginationSchema } from './common.js';

// ── Enums (mirror Prisma) ────────────────────────────────────────────────────

export const LootCategorySchema = z.enum([
  'USERNAME',
  'PASSWORD',
  'HASH',
  'URL',
  'PORT',
  'CREDENTIAL',
  'FILE',
  'TOKEN',
  'API_KEY',
  'SESSION',
]);

// ── Create loot item ─────────────────────────────────────────────────────────

/**
 * Manual loot ingestion — e.g. from an MCP tool or external import.
 * Internal services create loot records directly via Prisma without going
 * through this schema.
 */
export const CreateLootItemSchema = z.object({
  targetId: z.string().min(1).optional(),
  category: LootCategorySchema,
  value: z.string().min(1, 'value is required').max(16_384),
  source: z.string().min(1, 'source is required').max(256),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateLootItemBody = z.infer<typeof CreateLootItemSchema>;

// ── Query — list loot by target ──────────────────────────────────────────────

export const ListLootQuerySchema = PaginationSchema.extend({
  category: LootCategorySchema.optional(),
  source: z.string().max(256).optional(),
});

export type ListLootQuery = z.infer<typeof ListLootQuerySchema>;

// ── Param schema for /:target route ─────────────────────────────────────────

/**
 * The /:target param accepts a URL fragment, hostname, or raw target ID —
 * the route builds an OR query across all three. We just ensure it is
 * non-empty and within a sane length.
 */
export const TargetParamSchema = z.object({
  target: z
    .string()
    .min(1, 'target is required')
    .max(2048, 'target identifier is too long'),
});

export type TargetParam = z.infer<typeof TargetParamSchema>;
