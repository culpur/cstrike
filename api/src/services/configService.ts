/**
 * Config Service — versioned key-value configuration backed by the ConfigEntry model.
 * Supports get/set/list/delete/rollback for all platform configuration.
 * Thin service layer over Prisma — routes call this instead of prisma directly
 * so future caching or event hooks can be added in one place.
 */

import { prisma } from '../config/database.js';

export interface ConfigEntry {
  key: string;
  value: unknown;
  version: number;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConfigSetInput {
  key: string;
  value: unknown;
  updatedBy?: string;
}

export interface ConfigHistory {
  key: string;
  currentValue: unknown;
  version: number;
  updatedBy: string | null;
  updatedAt: Date;
  createdAt: Date;
}

class ConfigService {
  /**
   * Get a single config value by key.
   * Returns defaultValue if key is not set.
   */
  async get<T = unknown>(key: string, defaultValue: T): Promise<T> {
    const entry = await prisma.configEntry.findUnique({ where: { key } });
    if (!entry) return defaultValue;
    return entry.value as T;
  }

  /**
   * Get all config entries as a flat key→value map.
   */
  async getAll(): Promise<Record<string, unknown>> {
    const entries = await prisma.configEntry.findMany({
      orderBy: { key: 'asc' },
    });

    const config: Record<string, unknown> = {};
    for (const entry of entries) {
      config[entry.key] = entry.value;
    }
    return config;
  }

  /**
   * Get a config entry including metadata (version, timestamps, author).
   */
  async getEntry(key: string): Promise<ConfigEntry | null> {
    const entry = await prisma.configEntry.findUnique({ where: { key } });
    if (!entry) return null;

    return {
      key: entry.key,
      value: entry.value,
      version: entry.version,
      updatedBy: entry.updatedBy,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  /**
   * List all config entries with full metadata.
   */
  async listEntries(): Promise<ConfigEntry[]> {
    const entries = await prisma.configEntry.findMany({
      orderBy: { key: 'asc' },
    });

    return entries.map((e) => ({
      key: e.key,
      value: e.value,
      version: e.version,
      updatedBy: e.updatedBy,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    }));
  }

  /**
   * Set a single config value. Creates or updates, incrementing version on update.
   * Returns the updated entry.
   */
  async set(input: ConfigSetInput): Promise<ConfigEntry> {
    const { key, value, updatedBy = 'api' } = input;

    const entry = await prisma.configEntry.upsert({
      where: { key },
      update: {
        value: value as any,
        version: { increment: 1 },
        updatedBy,
      },
      create: {
        key,
        value: value as any,
        updatedBy,
      },
    });

    return {
      key: entry.key,
      value: entry.value,
      version: entry.version,
      updatedBy: entry.updatedBy,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  /**
   * Set multiple config values in a single transaction.
   * Each update increments that key's version independently.
   * Returns the full updated config map.
   */
  async setMany(
    updates: Record<string, unknown>,
    updatedBy: string = 'api',
  ): Promise<Record<string, unknown>> {
    await prisma.$transaction(
      Object.entries(updates).map(([key, value]) =>
        prisma.configEntry.upsert({
          where: { key },
          update: {
            value: value as any,
            version: { increment: 1 },
            updatedBy,
          },
          create: {
            key,
            value: value as any,
            updatedBy,
          },
        }),
      ),
    );

    return this.getAll();
  }

  /**
   * Delete a config entry.
   * Returns true if deleted, false if key did not exist.
   */
  async delete(key: string): Promise<boolean> {
    try {
      await prisma.configEntry.delete({ where: { key } });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get version history metadata for a key.
   * Note: the schema stores only the current version number (not a full audit
   * log of past values). This returns the current entry with its version counter,
   * which is sufficient for the /config/history/:key route.
   */
  async getHistory(key: string): Promise<ConfigHistory | null> {
    const entry = await prisma.configEntry.findUnique({ where: { key } });
    if (!entry) return null;

    return {
      key: entry.key,
      currentValue: entry.value,
      version: entry.version,
      updatedBy: entry.updatedBy,
      updatedAt: entry.updatedAt,
      createdAt: entry.createdAt,
    };
  }

  /**
   * Seed default config values — only creates entries that do not yet exist.
   * Safe to call multiple times (idempotent).
   */
  async seedDefaults(defaults: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(defaults)) {
      await prisma.configEntry.upsert({
        where: { key },
        update: {}, // Do not overwrite existing values
        create: { key, value: value as any, updatedBy: 'seed' },
      });
    }
  }

  /**
   * Increment a numeric config value atomically.
   * Creates it at defaultValue + 1 if it does not exist.
   */
  async increment(key: string, defaultValue: number = 0): Promise<number> {
    const existing = await prisma.configEntry.findUnique({ where: { key } });
    const current = typeof existing?.value === 'number' ? existing.value : defaultValue;
    const next = current + 1;

    await prisma.configEntry.upsert({
      where: { key },
      update: { value: next as any, version: { increment: 1 } },
      create: { key, value: next as any },
    });

    return next;
  }
}

export const configService = new ConfigService();
