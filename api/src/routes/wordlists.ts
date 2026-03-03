/**
 * Wordlist routes — list and scan available wordlists.
 *
 * GET  /api/v1/wordlists      — List registered wordlists
 * POST /api/v1/wordlists/scan — Scan filesystem for wordlists and register them
 */

import { Router } from 'express';
import { prisma } from '../config/database.js';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

export const wordlistsRouter = Router();

const WORDLIST_DIRS = [
  '/opt/cstrike/data/wordlists',
  '/usr/share/wordlists',
  '/usr/share/seclists',
];

function countLines(filePath: string): number {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content.split('\n').filter((l) => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}

function categorizeWordlist(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('password') || lower.includes('rockyou') || lower.includes('pass') || lower.includes('fasttrack')) {
    return 'PASSWORDS';
  }
  if (lower.includes('user') || lower.includes('name') || lower.includes('login')) {
    return 'USERNAMES';
  }
  if (lower.includes('dir') || lower.includes('web') || lower.includes('common') || lower.includes('content')) {
    return 'WEB_CONTENT';
  }
  if (lower.includes('subdomain') || lower.includes('dns') || lower.includes('host')) {
    return 'SUBDOMAINS';
  }
  return 'CUSTOM';
}

// List registered wordlists
wordlistsRouter.get('/', async (_req, res, next) => {
  try {
    const wordlists = await prisma.wordlist.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    res.json({ success: true, data: wordlists, timestamp: Date.now() });
  } catch (err) {
    next(err);
  }
});

// Scan filesystem and register wordlists
wordlistsRouter.post('/scan', async (_req, res, next) => {
  try {
    const found: Array<{ name: string; path: string; category: string; lineCount: number; sizeBytes: number }> = [];

    for (const dir of WORDLIST_DIRS) {
      if (!existsSync(dir)) continue;

      try {
        const files = readdirSync(dir, { recursive: true }) as string[];
        for (const file of files) {
          const filePath = join(dir, file);
          try {
            const stat = statSync(filePath);
            if (!stat.isFile()) continue;

            const ext = extname(file).toLowerCase();
            if (!['.txt', '.lst', '.list', ''].includes(ext)) continue;
            if (stat.size > 500 * 1024 * 1024) continue; // Skip files > 500MB

            const name = basename(file, ext);
            found.push({
              name,
              path: filePath,
              category: categorizeWordlist(name),
              lineCount: stat.size < 50 * 1024 * 1024 ? countLines(filePath) : Math.floor(stat.size / 12), // estimate for large files
              sizeBytes: stat.size,
            });
          } catch { /* skip inaccessible files */ }
        }
      } catch { /* skip inaccessible dirs */ }
    }

    // Upsert into database
    let created = 0;
    let updated = 0;
    for (const wl of found) {
      const existing = await prisma.wordlist.findUnique({ where: { name: wl.name } });
      if (existing) {
        await prisma.wordlist.update({
          where: { name: wl.name },
          data: { path: wl.path, lineCount: wl.lineCount, sizeBytes: wl.sizeBytes },
        });
        updated++;
      } else {
        await prisma.wordlist.create({
          data: {
            name: wl.name,
            path: wl.path,
            category: wl.category as any,
            lineCount: wl.lineCount,
            sizeBytes: wl.sizeBytes,
          },
        });
        created++;
      }
    }

    res.json({
      success: true,
      data: { scanned: found.length, created, updated },
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});
