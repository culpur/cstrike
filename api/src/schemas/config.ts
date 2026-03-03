/**
 * Zod schemas for config routes.
 * ConfigEntry is a versioned key-value store — keys are well-known strings,
 * values are arbitrary JSON.
 */

import { z } from 'zod';

// ── Key constraint ───────────────────────────────────────────────────────────

/**
 * Config keys use snake_case and must not be empty. No strict enum — the
 * platform uses open-ended keys (e.g. openai_api_key, nuclei_template_path).
 */
export const ConfigKeySchema = z
  .string()
  .min(1, 'key is required')
  .max(128, 'key is too long')
  .regex(
    /^[a-z][a-z0-9_]*$/,
    'key must start with a lowercase letter and contain only lowercase alphanumeric and underscores',
  );

// ── Update config — PUT /api/v1/config ──────────────────────────────────────

/**
 * Accepts any non-empty object whose keys pass the key constraint.
 * Values are arbitrary JSON scalars or objects — validated at the Prisma
 * layer by the `Json` column type.
 */
export const UpdateConfigSchema = z
  .record(ConfigKeySchema, z.unknown())
  .refine(
    (obj) => Object.keys(obj).length > 0,
    { message: 'request body must contain at least one key' },
  );

export type UpdateConfigBody = z.infer<typeof UpdateConfigSchema>;

// ── History param — GET /api/v1/config/history/:key ─────────────────────────

export const ConfigKeyParamSchema = z.object({
  key: ConfigKeySchema,
});

export type ConfigKeyParam = z.infer<typeof ConfigKeyParamSchema>;

// ── Well-known config keys (for documentation and auto-complete) ─────────────

/**
 * The set of keys the platform reads internally. Callers may use others —
 * this list is not enforced at the schema layer, only documented here.
 */
export const KNOWN_CONFIG_KEYS = [
  'target_scope',
  'allowed_tools',
  'allow_exploitation',
  'ai_provider',
  'ai_temperature',
  'ai_max_tokens',
  'openai_api_key',
  'openai_model',
  'anthropic_api_key',
  'anthropic_model',
  'grok_api_key',
  'grok_model',
  'ollama_model',
  'nuclei_template_path',
  'wordlist_path',
  'report_output_dir',
  'max_concurrent_scans',
  'operation_mode',
] as const;

export type KnownConfigKey = (typeof KNOWN_CONFIG_KEYS)[number];
