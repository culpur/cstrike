/**
 * Zod schemas for credential management routes.
 * Covers: list query, single validate, batch validate.
 */

import { z } from 'zod';
import { PortSchema, PaginationSchema } from './common.js';

// ── Enums (mirror Prisma) ────────────────────────────────────────────────────

export const ValidationStatusSchema = z.enum([
  'UNTESTED',
  'VALID',
  'INVALID',
  'ERROR',
  'EXPIRED',
]);

/**
 * Services that the credential validator and Hydra know how to handle.
 * Additional values are accepted (passed through to the underlying tool).
 */
export const ServiceNameSchema = z
  .string()
  .min(1, 'service is required')
  .max(64)
  .regex(
    /^[a-z][a-z0-9_-]*$/,
    'service must start with a letter and contain only lowercase alphanumeric, hyphens, or underscores',
  );

// ── List / filter ────────────────────────────────────────────────────────────

export const ListCredentialsQuerySchema = PaginationSchema.extend({
  target: z.string().max(2048).optional(),
  status: ValidationStatusSchema.optional(),
  service: ServiceNameSchema.optional(),
});

export type ListCredentialsQuery = z.infer<typeof ListCredentialsQuerySchema>;

// ── Single validate ──────────────────────────────────────────────────────────

export const ValidateCredentialSchema = z.object({
  /** If present, the matching DB record is updated with the result. */
  id: z.string().min(1).optional(),
  username: z.string().min(1, 'username is required').max(256),
  password: z.string().min(1, 'password is required').max(1024),
  target: z.string().min(1, 'target is required').max(2048),
  service: ServiceNameSchema,
  port: PortSchema.optional(),
});

export type ValidateCredentialBody = z.infer<typeof ValidateCredentialSchema>;

// ── Batch validate ───────────────────────────────────────────────────────────

export const BatchValidateItemSchema = z.object({
  id: z.string().min(1).optional(),
  username: z.string().min(1).max(256),
  password: z.string().min(1).max(1024),
  target: z.string().min(1).max(2048),
  service: ServiceNameSchema,
  port: PortSchema.optional(),
});

export const BatchValidateCredentialsSchema = z.object({
  credentials: z
    .array(BatchValidateItemSchema)
    .min(1, 'credentials array must not be empty')
    .max(200, 'cannot validate more than 200 credentials at once'),
});

export type BatchValidateCredentialsBody = z.infer<typeof BatchValidateCredentialsSchema>;

// ── Create (internal / from scan results) ───────────────────────────────────

export const CreateCredentialSchema = z.object({
  targetId: z.string().min(1).optional(),
  username: z.string().min(1).max(256),
  password: z.string().min(1).max(1024),
  service: ServiceNameSchema.optional(),
  port: PortSchema.optional(),
  source: z.string().min(1, 'source is required').max(256),
  validationStatus: ValidationStatusSchema.default('UNTESTED'),
});

export type CreateCredentialBody = z.infer<typeof CreateCredentialSchema>;
