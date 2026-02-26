/**
 * Security guardrails — enforced before every tool execution.
 * Validates target scope, tool allowlist, exploitation gate.
 */

import { prisma } from '../config/database.js';
import { AppError } from './errorHandler.js';

/**
 * Check if a target URL/IP is within the configured target scope.
 */
export async function validateTargetScope(target: string): Promise<void> {
  const scopeEntry = await prisma.configEntry.findUnique({
    where: { key: 'target_scope' },
  });

  const scope = (scopeEntry?.value as string[] | undefined) ?? [];

  // Empty scope = no restriction (operator accepts responsibility)
  if (scope.length === 0) return;

  const targetLower = target.toLowerCase();
  const inScope = scope.some((s) => {
    const scopeLower = s.toLowerCase();
    return (
      targetLower === scopeLower ||
      targetLower.includes(scopeLower) ||
      scopeLower.includes(targetLower)
    );
  });

  if (!inScope) {
    throw new AppError(403, `Target "${target}" is outside configured scope`);
  }
}

/**
 * Check if a tool is in the allowed tools list.
 */
export async function validateToolAllowed(toolName: string): Promise<void> {
  const allowedEntry = await prisma.configEntry.findUnique({
    where: { key: 'allowed_tools' },
  });

  const allowed = (allowedEntry?.value as string[] | undefined) ?? [];

  if (allowed.length > 0 && !allowed.includes(toolName)) {
    throw new AppError(403, `Tool "${toolName}" is not in the allowed tools list`);
  }
}

/**
 * Check if exploitation is allowed.
 */
export async function validateExploitationGate(): Promise<void> {
  const entry = await prisma.configEntry.findUnique({
    where: { key: 'allow_exploitation' },
  });

  if (entry?.value !== true) {
    throw new AppError(
      403,
      'Exploitation is disabled. Enable allow_exploitation in configuration.',
    );
  }
}

/**
 * Get a config value by key, with a typed default.
 */
export async function getConfigValue<T>(key: string, defaultValue: T): Promise<T> {
  const entry = await prisma.configEntry.findUnique({
    where: { key },
  });
  return (entry?.value as T) ?? defaultValue;
}
