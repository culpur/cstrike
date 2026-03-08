/**
 * Loot Service — manages loot items collected during scans.
 * Handles auto-extraction from tool output, categorization, and deduplication.
 * Mirrors the Python loot_tracker.py logic ported to TypeScript with DB persistence.
 */

import { prisma } from '../config/database.js';
import { emitLootItem, emitLogEntry } from '../websocket/emitter.js';
import { credentialValidator } from './credentialValidator.js';

// ── Scoring tables (ported from loot_tracker.py) ─────────────────────────────

const SERVICE_WEIGHTS: Record<string, number> = {
  ssh: 10,
  rdp: 10,
  telnet: 9,
  ftp: 8,
  smb: 8,
  vnc: 8,
  mssql: 7,
  mysql: 7,
  postgres: 7,
  mongodb: 6,
  redis: 6,
  https: 5,
  http: 5,
  default: 3,
};

const HIGH_VALUE_USERNAMES: Record<string, number> = {
  root: 10,
  admin: 9,
  administrator: 9,
  sa: 8,
  system: 8,
  sysadmin: 8,
  superuser: 8,
  wheel: 7,
  sudo: 7,
  postgres: 7,
  mysql: 7,
  operator: 6,
  service: 5,
  user: 2,
};

const PORT_TO_SERVICE: Record<number, string> = {
  22: 'ssh',
  21: 'ftp',
  23: 'telnet',
  3389: 'rdp',
  445: 'smb',
  139: 'smb',
  3306: 'mysql',
  5432: 'postgres',
  1433: 'mssql',
  27017: 'mongodb',
  6379: 'redis',
  5900: 'vnc',
  80: 'http',
  443: 'https',
};

// ── Types ─────────────────────────────────────────────────────────────────────

export type LootCategoryInput =
  | 'USERNAME'
  | 'PASSWORD'
  | 'HASH'
  | 'URL'
  | 'PORT'
  | 'CREDENTIAL'
  | 'FILE'
  | 'TOKEN'
  | 'API_KEY'
  | 'SESSION';

export interface ExtractedLoot {
  category: LootCategoryInput;
  value: string;
  metadata?: Record<string, unknown>;
}

export interface LootAddInput {
  targetId?: string;
  category: LootCategoryInput;
  value: string;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface CredentialScoreResult {
  score: number;
  breakdown: {
    reuse_count: number;
    reuse_score: number;
    username_weight: number;
    service_weight: number;
    complexity_score: number;
    complexity_penalty: number;
  };
}

// ── Loot extraction regexes ───────────────────────────────────────────────────

// Username patterns from common tool outputs
const USERNAME_PATTERNS = [
  /\[(?:\+|SUCCESS)\]\s+(?:username|user)[:=]\s*(\S+)/gi,
  /login\s+successful.*?for\s+(\w[\w.-]*)/gi,
  /\[hydra\].*?login:\s*(\S+)\s+password:/gi,
];

// Password patterns
const PASSWORD_PATTERNS = [
  /\[(?:\+|SUCCESS)\]\s+password[:=]\s*(\S+)/gi,
  /\[hydra\].*?password:\s*(\S+)/gi,
  /password\s+found[:\s]+(\S+)/gi,
];

// Hash patterns (md5/sha1/sha256/ntlm/bcrypt)
const HASH_PATTERNS = [
  /\b([a-f0-9]{32})\b/gi,  // MD5
  /\b([a-f0-9]{40})\b/gi,  // SHA1
  /\b([a-f0-9]{64})\b/gi,  // SHA256
  /\b([a-f0-9]{16}:[a-f0-9]{32})\b/gi, // NTLM
  /(\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53})/g, // bcrypt
];

// URL/endpoint patterns
const URL_PATTERNS = [
  /https?:\/\/[^\s"'<>]+/gi,
  /(?:^|\s)(\/[a-zA-Z0-9_\-./]+(?:\?[^\s]*)?)/gm,
];

// Token/API key patterns
const TOKEN_PATTERNS = [
  /Bearer\s+([A-Za-z0-9\-._~+/]+=*)/gi,
  /api[-_]?key['":\s]+([A-Za-z0-9_\-]{20,})/gi,
  /token['":\s]+([A-Za-z0-9_\-]{20,})/gi,
];

// ── Core class ────────────────────────────────────────────────────────────────

class LootService {
  /**
   * Add a single loot item, skipping exact duplicates per target+category+value.
   */
  async addLoot(input: LootAddInput): Promise<string | null> {
    // Deduplication: check for existing exact match
    const existing = await prisma.lootItem.findFirst({
      where: {
        targetId: input.targetId ?? null,
        category: input.category as any,
        value: input.value,
      },
    });

    if (existing) {
      return null; // Deduplicated — already stored
    }

    const item = await prisma.lootItem.create({
      data: {
        targetId: input.targetId ?? null,
        category: input.category as any,
        value: input.value,
        source: input.source,
        metadata: input.metadata as any ?? undefined,
      },
      include: {
        target: { select: { url: true } },
      },
    });

    // Emit WebSocket event
    emitLootItem({
      category: item.category.toLowerCase(),
      value: item.value,
      source: item.source,
      target: item.target?.url ?? item.targetId ?? 'unknown',
    });

    return item.id;
  }

  /**
   * Add multiple loot items in bulk, skipping duplicates.
   * Returns count of newly created items.
   */
  async addBulk(items: LootAddInput[]): Promise<number> {
    let created = 0;
    for (const item of items) {
      const id = await this.addLoot(item);
      if (id) created++;
    }
    return created;
  }

  /**
   * Extract loot from raw tool output and persist it.
   * Called by scanOrchestrator after each tool completes.
   * Also creates CredentialPair records when username+password pairs are found.
   */
  async extractFromOutput(
    output: string,
    source: string,
    targetId?: string,
  ): Promise<number> {
    const extracted = this.parseOutput(output, source);
    if (extracted.length === 0) return 0;

    const count = await this.addBulk(
      extracted.map((e) => ({ ...e, source, targetId })),
    );

    // Create CredentialPair records from extracted username+password pairs
    await this.pairCredentials(extracted, source, targetId).catch(() => {});

    // Extract credentials from http_fetch file downloads (SQL dumps, env files, configs)
    if (source === 'http_fetch' && targetId) {
      await this.extractHttpFetchCredentials(output, targetId).catch(() => {});
    }

    return count;
  }

  /**
   * Pair extracted usernames and passwords into CredentialPair records with scoring.
   * Handles hydra/medusa-style combined output as well as separate matches.
   */
  private async pairCredentials(
    extracted: ExtractedLoot[],
    source: string,
    targetId?: string,
  ): Promise<void> {
    const usernames = extracted.filter((e) => e.category === 'USERNAME').map((e) => e.value);
    const passwords = extracted.filter((e) => e.category === 'PASSWORD').map((e) => e.value);

    if (usernames.length === 0 || passwords.length === 0) return;

    // Pair them 1:1 when counts match (same tool output), otherwise cross-product
    const pairs: Array<{ username: string; password: string }> = [];
    if (usernames.length === passwords.length) {
      for (let i = 0; i < usernames.length; i++) {
        pairs.push({ username: usernames[i], password: passwords[i] });
      }
    } else {
      // Cross-product but capped to prevent explosion
      for (const u of usernames) {
        for (const p of passwords) {
          pairs.push({ username: u, password: p });
          if (pairs.length >= 50) break;
        }
        if (pairs.length >= 50) break;
      }
    }

    // Build a map of per-credential metadata from CREDENTIAL loot items (hydra/medusa output)
    const credMeta = new Map<string, { service: string; port: number | null; host: string }>();
    for (const e of extracted) {
      if (e.category === 'CREDENTIAL' && e.metadata) {
        const key = e.value; // "user:pass"
        credMeta.set(key, {
          service: (e.metadata.service as string) ?? 'unknown',
          port: (e.metadata.port as number) ?? null,
          host: (e.metadata.host as string) ?? '',
        });
      }
    }

    // Fallback service from source tool (only when no per-credential metadata)
    const serviceMap: Record<string, string> = {
      medusa: 'ssh', ncrack: 'ssh',
      sqlmap: 'mysql', enum4linux: 'smb', smbclient: 'smb',
      ftp: 'ftp', smtp: 'smtp',
    };
    const fallbackService = serviceMap[source.toLowerCase()] ?? 'unknown';

    for (const { username, password } of pairs) {
      // Use per-credential metadata if available (hydra output includes service/port)
      const meta = credMeta.get(`${username}:${password}`);
      const service = meta?.service ?? fallbackService;
      const port = meta?.port ?? null;

      // Deduplicate: skip if this exact pair already exists for this target
      const existing = await prisma.credentialPair.findFirst({
        where: { targetId: targetId ?? null, username, password },
      });
      if (existing) continue;

      // Score the credential
      const scoreResult = await this.scoreCredential(username, password, service);

      const credPair = await prisma.credentialPair.create({
        data: {
          targetId: targetId ?? null,
          username,
          password,
          service,
          port,
          score: scoreResult.score,
          scoreBreakdown: scoreResult.breakdown as any,
          source,
        },
      });

      // Emit credential_extracted WebSocket event
      emitLootItem({
        category: 'credential',
        value: `${username}:***`,
        source,
        target: targetId ?? 'unknown',
      });

      // Auto-validate credential in background (non-blocking)
      if (targetId && service !== 'unknown') {
        setImmediate(async () => {
          try {
            const targetRecord = await prisma.target.findUnique({ where: { id: targetId } });
            const host = targetRecord?.hostname ?? targetRecord?.url?.replace(/^https?:\/\//, '').replace(/[:/].*$/, '') ?? 'localhost';
            const result = await credentialValidator.validate({
              id: credPair.id,
              username,
              password,
              target: host,
              service,
              port: credPair.port ?? undefined,
            });
            await prisma.credentialPair.update({
              where: { id: credPair.id },
              data: { validationStatus: result.valid ? 'VALID' : 'INVALID' },
            });
            emitLogEntry({
              level: result.valid ? 'INFO' : 'DEBUG',
              source: 'credential_validator',
              message: `Auto-validated ${username}@${host}:${service} → ${result.valid ? 'VALID' : 'INVALID'}`,
            });
          } catch {
            // Non-critical — validation can be retried later
          }
        });
      }
    }
  }

  /**
   * Extract credentials from http_fetch output (SQL dumps, env files, PHP configs,
   * connection strings, htpasswd files) and store them as CredentialPair records.
   */
  private async extractHttpFetchCredentials(
    output: string,
    targetId: string,
  ): Promise<void> {
    const pairs: Array<{ username: string; password: string; service: string }> = [];
    const seen = new Set<string>();

    const addPair = (username: string, password: string, service: string) => {
      const u = username.trim();
      const p = password.trim();
      if (!u || !p) return;
      // Strip surrounding quotes from values
      const cleanU = u.replace(/^['"]|['"]$/g, '');
      const cleanP = p.replace(/^['"]|['"]$/g, '');
      if (!cleanP) return;
      const key = `${cleanU}:${cleanP}:${service}`;
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push({ username: cleanU || 'unknown', password: cleanP, service });
      }
    };

    // 1. SQL: IDENTIFIED BY 'password'
    const identifiedByRe = /(?:CREATE\s+USER\s+['"]?(\S+?)['"]?\s+)?IDENTIFIED\s+BY\s+['"]([^'"]+)['"]/gi;
    let m: RegExpExecArray | null;
    while ((m = identifiedByRe.exec(output)) !== null) {
      addPair(m[1] ?? 'unknown', m[2], 'mysql');
    }

    // 2. SQL: INSERT INTO users/accounts ... VALUES(...) — extract username/password positionally
    //    Matches VALUES rows and extracts quoted string fields
    const insertRe = /INSERT\s+INTO\s+(?:users|accounts|admins|members|logins)\s+.*?VALUES\s*\(([^)]+)\)/gi;
    while ((m = insertRe.exec(output)) !== null) {
      const valuesStr = m[1];
      // Extract all quoted string values from the VALUES clause
      const quotedVals: string[] = [];
      const quotedRe = /'([^']*)'/g;
      let qm: RegExpExecArray | null;
      while ((qm = quotedRe.exec(valuesStr)) !== null) {
        quotedVals.push(qm[1]);
      }
      // Heuristic: first quoted string = username, second = password
      if (quotedVals.length >= 2) {
        addPair(quotedVals[0], quotedVals[1], 'mysql');
      }
    }

    // 3. Environment variables: *PASSWORD*=value, *SECRET*=value, *KEY*=value
    const envRe = /^([A-Z_]*(?:PASSWORD|SECRET|KEY)[A-Z_]*)=(.+)$/gim;
    while ((m = envRe.exec(output)) !== null) {
      const varName = m[1].trim();
      const value = m[2].trim().replace(/^['"]|['"]$/g, '');
      if (!value) continue;
      // Infer service from variable name
      let service = 'unknown';
      const vLower = varName.toLowerCase();
      if (vLower.includes('mysql') || vLower.includes('maria')) service = 'mysql';
      else if (vLower.includes('postgres') || vLower.includes('pg')) service = 'postgres';
      else if (vLower.includes('redis')) service = 'redis';
      else if (vLower.includes('mongo')) service = 'mongodb';
      else if (vLower.includes('smtp') || vLower.includes('mail')) service = 'smtp';
      else if (vLower.includes('ssh')) service = 'ssh';
      else if (vLower.includes('ftp')) service = 'ftp';
      else if (vLower.includes('db') || vLower.includes('database')) service = 'mysql';
      else if (vLower.includes('api')) service = 'http';
      addPair('unknown', value, service);
    }

    // 4. PHP: $db_pass = 'value' style assignments
    const phpVarRe = /\$(?:db_pass(?:word)?|password|passwd|pass|secret|db_pwd)\s*=\s*['"]([^'"]+)['"]/gi;
    while ((m = phpVarRe.exec(output)) !== null) {
      addPair('unknown', m[1], 'mysql');
    }

    // 5. PHP: define('DB_PASSWORD', 'value')
    const phpDefineRe = /define\s*\(\s*['"](?:DB_PASSWORD|DB_PASS|MYSQL_PASSWORD|DB_SECRET|AUTH_KEY|SECURE_AUTH_KEY)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/gi;
    while ((m = phpDefineRe.exec(output)) !== null) {
      addPair('unknown', m[1], 'mysql');
    }

    // 6. Connection strings: mysql://user:pass@host, postgres://user:pass@host
    const connStrRe = /(mysql|postgres|postgresql|mongodb|redis|amqp|mssql):\/\/([^:]+):([^@]+)@/gi;
    while ((m = connStrRe.exec(output)) !== null) {
      const proto = m[1].toLowerCase();
      let service = proto;
      if (service === 'postgresql') service = 'postgres';
      if (service === 'amqp') service = 'rabbitmq';
      addPair(m[2], m[3], service);
    }

    // 7. htpasswd format: user:$apr1$... or user:{SHA}...
    const htpasswdRe = /^([a-zA-Z0-9_.\-]+):(\$apr1\$[^\s]+|\{SHA\}[^\s]+|\$2[aby]\$[^\s]+)/gm;
    while ((m = htpasswdRe.exec(output)) !== null) {
      // For htpasswd, the "password" is actually a hash, but store it for cracking
      addPair(m[1], m[2], 'http');
    }

    // Cap at 100 pairs to prevent runaway
    const capped = pairs.slice(0, 100);

    for (const { username, password, service } of capped) {
      // Deduplicate against existing DB records
      const existing = await prisma.credentialPair.findFirst({
        where: { targetId, username, password },
      });
      if (existing) continue;

      const scoreResult = await this.scoreCredential(username, password, service);

      await prisma.credentialPair.create({
        data: {
          targetId,
          username,
          password,
          service,
          port: null,
          score: scoreResult.score,
          scoreBreakdown: scoreResult.breakdown as any,
          source: 'http_fetch',
          validationStatus: 'UNTESTED',
        },
      });

      emitLootItem({
        category: 'credential',
        value: `${username}:***`,
        source: 'http_fetch',
        target: targetId,
      });
    }
  }

  /**
   * Parse raw tool output into typed loot items.
   * Pure function — no DB access.
   */
  parseOutput(output: string, source: string): ExtractedLoot[] {
    const found: ExtractedLoot[] = [];
    const seen = new Set<string>();

    const push = (category: LootCategoryInput, value: string, metadata?: Record<string, unknown>) => {
      const key = `${category}:${value}`;
      if (!seen.has(key) && value.length > 0) {
        seen.add(key);
        found.push({ category, value, metadata });
      }
    };

    // Usernames
    for (const pattern of USERNAME_PATTERNS) {
      let m: RegExpExecArray | null;
      const re = new RegExp(pattern.source, pattern.flags);
      while ((m = re.exec(output)) !== null) {
        push('USERNAME', m[1].trim());
      }
    }

    // Passwords
    for (const pattern of PASSWORD_PATTERNS) {
      let m: RegExpExecArray | null;
      const re = new RegExp(pattern.source, pattern.flags);
      while ((m = re.exec(output)) !== null) {
        push('PASSWORD', m[1].trim());
      }
    }

    // Hashes — only from hash-focused tools to avoid false positives
    if (['john', 'hashcat', 'hydra', 'enum4linux', 'smbclient', 'metasploit'].includes(source)) {
      for (const pattern of HASH_PATTERNS) {
        let m: RegExpExecArray | null;
        const re = new RegExp(pattern.source, pattern.flags);
        while ((m = re.exec(output)) !== null) {
          push('HASH', m[1].trim(), { pattern: pattern.source });
        }
      }
    }

    // URLs — from web-focused tools
    if (['waybackurls', 'gau', 'gobuster', 'ffuf', 'feroxbuster', 'dirb', 'katana', 'httpx', 'nuclei', 'nikto', 'zap', 'wpscan'].includes(source)) {
      for (const pattern of URL_PATTERNS) {
        let m: RegExpExecArray | null;
        const re = new RegExp(pattern.source, pattern.flags);
        while ((m = re.exec(output)) !== null) {
          const url = m[1] ?? m[0];
          if (url && !url.includes('FUZZ')) {
            push('URL', url.trim());
          }
        }
      }
    }

    // Tokens / API keys
    for (const pattern of TOKEN_PATTERNS) {
      let m: RegExpExecArray | null;
      const re = new RegExp(pattern.source, pattern.flags);
      while ((m = re.exec(output)) !== null) {
        const category: LootCategoryInput = pattern.source.startsWith('Bearer') ? 'SESSION' : 'API_KEY';
        push(category, m[1].trim());
      }
    }

    // Credential pairs — hydra/medusa combined output: "[22][ssh] host: 10.10.10.100  login: admin  password: secret"
    const hydraRe = /\[(\d+)\]\[(\w+)\]\s+host:\s*(\S+)\s+login:\s*(\S+)\s+password:\s*(\S+)/gi;
    {
      let m: RegExpExecArray | null;
      const re = new RegExp(hydraRe.source, hydraRe.flags);
      while ((m = re.exec(output)) !== null) {
        push('USERNAME', m[4].trim());
        push('PASSWORD', m[5].trim());
        // Store port/service/host as metadata on the credential
        push('CREDENTIAL', `${m[4].trim()}:${m[5].trim()}`, {
          port: parseInt(m[1], 10),
          service: m[2].trim(),
          host: m[3].trim(),
        });
      }
    }
    // Generic credential pair format: "[+] user:pass" — exclude IP:port patterns
    const genericCredRe = /\[\+\]\s+(?!(?:\d{1,3}\.){3}\d{1,3}:)(\S+):(\S+)\s/gi;
    {
      let m: RegExpExecArray | null;
      const re = new RegExp(genericCredRe.source, genericCredRe.flags);
      while ((m = re.exec(output)) !== null) {
        push('USERNAME', m[1].trim());
        push('PASSWORD', m[2].trim());
      }
    }

    // Open ports from nmap/masscan/rustscan
    if (['nmap', 'masscan', 'rustscan'].includes(source)) {
      const portRe = /(\d{1,5})\/(?:tcp|udp)\s+open/gi;
      let m: RegExpExecArray | null;
      while ((m = portRe.exec(output)) !== null) {
        const port = m[1];
        const service = PORT_TO_SERVICE[parseInt(port, 10)];
        push('PORT', port, { service: service ?? 'unknown' });
      }
    }

    return found;
  }

  /**
   * Score a credential pair using the ported Python scoring algorithm.
   */
  async scoreCredential(
    username: string,
    password: string,
    service: string = 'default',
  ): Promise<CredentialScoreResult> {
    // Count how many distinct targets have this username or password in loot
    const [usernameCount, passwordCount] = await Promise.all([
      prisma.lootItem.count({
        where: { category: 'USERNAME', value: username },
      }),
      prisma.lootItem.count({
        where: { category: 'PASSWORD', value: password },
      }),
    ]);

    const reuseCount = Math.max(usernameCount, passwordCount);
    const usernameWeight = this.getUsernameWeight(username);
    const serviceWeight = this.getServiceWeight(service);
    const complexityScore = this.calculatePasswordComplexity(password);

    const score =
      reuseCount * 10 + usernameWeight + serviceWeight - complexityScore / 2;

    return {
      score: Math.round(score * 100) / 100,
      breakdown: {
        reuse_count: reuseCount,
        reuse_score: reuseCount * 10,
        username_weight: usernameWeight,
        service_weight: serviceWeight,
        complexity_score: complexityScore,
        complexity_penalty: Math.round((complexityScore / 2) * 100) / 100,
      },
    };
  }

  /**
   * Get loot items for a target, grouped by category.
   */
  async getLootByTarget(targetIdentifier: string): Promise<{
    items: Record<string, Array<{ id: string; value: string; source: string; metadata: unknown; timestamp: number }>>;
    total: number;
  }> {
    const items = await prisma.lootItem.findMany({
      where: {
        OR: [
          { target: { url: { contains: targetIdentifier, mode: 'insensitive' } } },
          { target: { hostname: { contains: targetIdentifier, mode: 'insensitive' } } },
          { targetId: targetIdentifier },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    const byCategory: Record<string, Array<{ id: string; value: string; source: string; metadata: unknown; timestamp: number }>> = {};
    for (const item of items) {
      const cat = item.category.toLowerCase();
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push({
        id: item.id,
        value: item.value,
        source: item.source,
        metadata: item.metadata,
        timestamp: item.createdAt.getTime(),
      });
    }

    return { items: byCategory, total: items.length };
  }

  /**
   * Get all loot items with optional filters.
   */
  async list(opts: {
    category?: LootCategoryInput;
    targetId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: unknown[]; total: number }> {
    const { category, targetId, limit = 100, offset = 0 } = opts;

    const where: any = {};
    if (category) where.category = category;
    if (targetId) where.targetId = targetId;

    const [items, total] = await Promise.all([
      prisma.lootItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { target: { select: { url: true } } },
      }),
      prisma.lootItem.count({ where }),
    ]);

    return { items, total };
  }

  // ── Private scoring helpers (ported from Python) ──────────────────────────

  private calculatePasswordComplexity(password: string): number {
    if (!password) return 0;

    let score = 0;
    const length = password.length;

    if (length >= 12) score += 6;
    else if (length >= 8) score += 3;
    else if (length >= 6) score += 1;

    if (/[a-z]/.test(password)) score += 2;
    if (/[A-Z]/.test(password)) score += 3;
    if (/[0-9]/.test(password)) score += 2;
    if (/[^a-zA-Z0-9]/.test(password)) score += 4;

    const commonPatterns = [
      '123456', 'password', 'qwerty', 'admin', 'letmein',
      'welcome', 'monkey', 'dragon', 'master', 'shadow',
    ];
    for (const pattern of commonPatterns) {
      if (password.toLowerCase().includes(pattern)) {
        score = Math.max(0, score - 5);
        break;
      }
    }

    if (/(.)\1{2,}/.test(password)) {
      score = Math.max(0, score - 2);
    }

    return Math.min(score, 20);
  }

  private getUsernameWeight(username: string): number {
    const lower = username.toLowerCase();
    if (HIGH_VALUE_USERNAMES[lower] !== undefined) {
      return HIGH_VALUE_USERNAMES[lower];
    }
    for (const [key, weight] of Object.entries(HIGH_VALUE_USERNAMES)) {
      if (lower.includes(key)) return weight;
    }
    return 1;
  }

  private getServiceWeight(service: string): number {
    const lower = service.toLowerCase();
    for (const [key, weight] of Object.entries(SERVICE_WEIGHTS)) {
      if (lower.includes(key)) return weight;
    }
    return SERVICE_WEIGHTS.default;
  }
}

export const lootService = new LootService();
