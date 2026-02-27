/**
 * credentialScoring — score a credential pair on a 0-100 scale.
 *
 * A higher score means the credential is more likely to be operationally
 * useful: it was found on an interesting service, the password is complex
 * (not a trivial default), and it has been confirmed valid.
 *
 * The score is stored on the CredentialPair model alongside a breakdown object
 * so analysts can understand why a credential ranked highly.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface CredentialInput {
  username: string;
  password: string;
  service?: string | null;
  port?: number | null;
  validationStatus?: string | null;
  source?: string | null;
}

export interface ScoreBreakdown {
  /** 0-30 — how complex the password is. */
  passwordComplexity: number;
  /** 0-25 — how sensitive the service is. */
  serviceValue: number;
  /** 0-30 — validation confirmation bonus. */
  validationBonus: number;
  /** 0-10 — source reliability. */
  sourceReliability: number;
  /** 0-5 — penalty reduction for default/well-known credentials. */
  defaultCredentialPenalty: number;
  /** Sum of all dimensions. */
  total: number;
}

export interface ScoringResult {
  score: number;
  breakdown: ScoreBreakdown;
}

// ── Service sensitivity table ────────────────────────────────────────────────

/**
 * Services ordered by operational value to a red-team operator.
 * Higher = more interesting (root shell > web login).
 */
const SERVICE_VALUES: Record<string, number> = {
  // Remote execution
  ssh: 25,
  winrm: 24,
  rdp: 23,
  telnet: 22,
  // File systems and storage
  smb: 20,
  nfs: 18,
  ftp: 15,
  sftp: 15,
  // Databases (often lead to data exfil or further pivot)
  mssql: 22,
  mysql: 20,
  postgres: 20,
  postgresql: 20,
  oracle: 20,
  mongodb: 18,
  redis: 16,
  memcached: 12,
  // Directory services
  ldap: 20,
  ldaps: 20,
  kerberos: 22,
  // Mail
  smtp: 14,
  imap: 12,
  pop3: 10,
  // Web
  http: 10,
  https: 10,
  // Message queues
  mqtt: 14,
  amqp: 14,
  kafka: 14,
  // Monitoring / management
  snmp: 18,
  vnc: 20,
  // Misc
  docker: 22,
  kubernetes: 22,
};

// ── Default credential lists ─────────────────────────────────────────────────

/**
 * Credential pairs that are so well-known they should be treated as
 * low-value discoveries. The scoring penalises these.
 */
const DEFAULT_PAIRS: Set<string> = new Set([
  'admin:admin',
  'admin:password',
  'admin:123456',
  'admin:',
  'root:root',
  'root:toor',
  'root:',
  'root:password',
  'admin:admin123',
  'guest:guest',
  'guest:',
  'test:test',
  'user:user',
  'user:password',
  'administrator:administrator',
  'administrator:password',
  'postgres:postgres',
  'mysql:mysql',
  'sa:', // MSSQL
  'pi:raspberry', // Raspberry Pi default
  'ubnt:ubnt', // Ubiquiti
  'cisco:cisco',
  'enable:enable',
]);

const DEFAULT_USERNAMES: Set<string> = new Set([
  'admin', 'root', 'guest', 'test', 'user',
  'administrator', 'postgres', 'mysql', 'sa', 'pi',
]);

const DEFAULT_PASSWORDS: Set<string> = new Set([
  'password', '123456', '12345678', 'qwerty', 'letmein',
  'admin', 'root', '', 'password1', 'welcome',
]);

// ── Scoring functions ────────────────────────────────────────────────────────

/**
 * Score password complexity on a 0-30 scale.
 *
 * Factors (cumulative):
 *   - Length bands: >=8(+5), >=12(+5), >=16(+5), >=24(+5)
 *   - Has lowercase                  +2
 *   - Has uppercase                  +2
 *   - Has digits                     +2
 *   - Has symbols                    +4
 *   - Not a dictionary/default       implied by the caller combining this score
 */
function scorePasswordComplexity(password: string): number {
  if (!password) return 0;

  let score = 0;

  // Length bands
  if (password.length >= 8) score += 5;
  if (password.length >= 12) score += 5;
  if (password.length >= 16) score += 5;
  if (password.length >= 24) score += 5;

  // Character class diversity
  if (/[a-z]/.test(password)) score += 2;
  if (/[A-Z]/.test(password)) score += 2;
  if (/[0-9]/.test(password)) score += 2;
  if (/[^a-zA-Z0-9]/.test(password)) score += 4;

  return Math.min(score, 30);
}

/**
 * Score service value on a 0-25 scale.
 */
function scoreServiceValue(service?: string | null, port?: number | null): number {
  if (!service && !port) return 5; // Unknown service — some value

  const serviceKey = service?.toLowerCase().trim();

  if (serviceKey && SERVICE_VALUES[serviceKey] !== undefined) {
    return SERVICE_VALUES[serviceKey];
  }

  // Port-based heuristics when no service name is present or it's unrecognised.
  if (port) {
    if ([22, 23].includes(port)) return 22;   // ssh / telnet
    if ([3389, 5900, 5985, 5986].includes(port)) return 20; // rdp / vnc / winrm
    if ([445, 139].includes(port)) return 18; // smb
    if ([3306, 5432, 1433, 1521, 27017].includes(port)) return 18; // db
    if ([21, 69].includes(port)) return 12;   // ftp / tftp
    if ([80, 8080, 443, 8443].includes(port)) return 8; // http
  }

  return 5; // Unknown
}

/**
 * Validation status bonus on a 0-30 scale.
 */
function scoreValidationBonus(status?: string | null): number {
  switch (status?.toUpperCase()) {
    case 'VALID':    return 30;
    case 'UNTESTED': return 10; // Could still be valid
    case 'EXPIRED':  return 5;  // Was valid once — interesting context
    case 'ERROR':    return 2;  // Inconclusive
    case 'INVALID':  return 0;
    default:         return 10;
  }
}

/**
 * Source reliability on a 0-10 scale.
 *
 * Active exploitation evidence (hydra, metasploit) ranks higher than passive
 * harvesting (waybackurls, scrapers) because the credential was tested live.
 */
function scoreSourceReliability(source?: string | null): number {
  const s = source?.toLowerCase() ?? '';
  if (['hydra', 'medusa', 'ncrack', 'patator'].some((t) => s.includes(t))) return 10;
  if (['metasploit', 'msfconsole', 'meterpreter'].some((t) => s.includes(t))) return 9;
  if (['sqlmap', 'nmap', 'nuclei'].some((t) => s.includes(t))) return 7;
  if (['manual', 'operator'].some((t) => s.includes(t))) return 8;
  if (['scrape', 'wayback', 'gau', 'katana'].some((t) => s.includes(t))) return 4;
  return 5; // Unknown source
}

/**
 * Default credential penalty — reduces score by up to 5 points.
 * A negative number so it can be subtracted from the total.
 */
function computeDefaultPenalty(username: string, password: string): number {
  const pair = `${username.toLowerCase()}:${password.toLowerCase()}`;
  if (DEFAULT_PAIRS.has(pair)) return -5;

  const userIsDefault = DEFAULT_USERNAMES.has(username.toLowerCase());
  const passIsDefault = DEFAULT_PASSWORDS.has(password.toLowerCase());

  if (userIsDefault && passIsDefault) return -4;
  if (userIsDefault || passIsDefault) return -2;

  return 0;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Score a credential pair and return the numeric score (0-100) plus a
 * breakdown explaining each dimension.
 *
 * The score is deterministic — same inputs always produce the same output.
 */
export function scoreCredential(cred: CredentialInput): ScoringResult {
  const passwordComplexity = scorePasswordComplexity(cred.password);
  const serviceValue = scoreServiceValue(cred.service, cred.port);
  const validationBonus = scoreValidationBonus(cred.validationStatus);
  const sourceReliability = scoreSourceReliability(cred.source);
  const defaultCredentialPenalty = computeDefaultPenalty(cred.username, cred.password);

  const raw =
    passwordComplexity +
    serviceValue +
    validationBonus +
    sourceReliability +
    defaultCredentialPenalty;

  const total = Math.max(0, Math.min(100, raw));

  return {
    score: total,
    breakdown: {
      passwordComplexity,
      serviceValue,
      validationBonus,
      sourceReliability,
      defaultCredentialPenalty,
      total,
    },
  };
}

/**
 * Batch score an array of credentials. Returns results in the same order as
 * the input.
 */
export function scoreCredentials(creds: CredentialInput[]): ScoringResult[] {
  return creds.map(scoreCredential);
}

/**
 * Re-score a stored credential pair after validation status has been updated.
 * Convenience wrapper that only requires the fields that affect the score.
 */
export function rescoreAfterValidation(
  cred: CredentialInput,
  newStatus: 'VALID' | 'INVALID' | 'ERROR' | 'EXPIRED',
): ScoringResult {
  return scoreCredential({ ...cred, validationStatus: newStatus });
}
