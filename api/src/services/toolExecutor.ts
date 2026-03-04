/**
 * Tool Executor — runs security tools via child_process.spawn.
 * Resolves binaries from host-mounted paths, enforces guardrails,
 * streams output to WebSocket, and parses results.
 */

import { spawn } from 'node:child_process';
import { accessSync } from 'node:fs';
import { env } from '../config/env.js';
import { emitReconOutput, emitLogEntry } from '../websocket/emitter.js';

/** Extract hostname (without port) from a URL or hostname string. */
function extractHost(target: string): string {
  try {
    const url = new URL(target);
    return url.hostname;
  } catch {
    // Not a URL — strip any port suffix
    return target.replace(/:\d+$/, '');
  }
}

/** Extract port from a URL, defaulting to 80/443 by scheme. */
function extractPort(target: string): number | undefined {
  try {
    const url = new URL(target);
    if (url.port) return parseInt(url.port, 10);
    return url.protocol === 'https:' ? 443 : 80;
  } catch {
    return undefined;
  }
}

/** Ensure a target has an HTTP(S) scheme for web tools. */
function ensureHttpUrl(target: string): string {
  if (/^https?:\/\//.test(target)) return target;
  const port = extractPort(target);
  return (port === 443 || port === 8443) ? `https://${target}` : `http://${target}`;
}

/** Find the first wordlist that exists. */
function findWordlist(candidates: string[]): string {
  for (const w of candidates) {
    try { accessSync(w); return w; } catch { continue; }
  }
  return candidates[0]; // fallback
}

interface ToolResult {
  tool: string;
  target: string;
  output: string;
  exitCode: number;
  duration: number;
  error?: string;
  // Parsed results
  vulnerability?: string;
  severity?: string;
  findings?: any[];
  credentials?: Array<{ username: string; password: string }>;
}

interface ToolOptions {
  mode?: string;
  service?: string;
  username?: string;
  wordlist?: string;
  port?: number;
  scanType?: string;
  timeout?: number;
  args?: string[];
}

// Common wordlist paths (container may have different paths than host)
const COMMON_WORDLIST = [
  '/opt/cstrike/data/wordlists/common.txt',
  '/usr/share/wordlists/dirb/common.txt',
  '/usr/share/dirb/wordlists/common.txt',
  '/usr/share/seclists/Discovery/Web-Content/common.txt',
];

// Tool command builders — tools that need hostnames get extractHost(),
// web tools get the full URL.
const TOOL_COMMANDS: Record<string, (target: string, opts: ToolOptions) => string[]> = {
  nmap: (target) => {
    const host = extractHost(target);
    const port = extractPort(target);
    const args = ['nmap', '-sV', '-sC', '-oN', '-'];
    if (port && port !== 80 && port !== 443) {
      // Scan specific port + common ports
      args.push('-p', `${port},21,22,23,25,53,80,443,3306,8080,8443`);
    } else {
      args.push('--top-ports', '1000');
    }
    args.push(host);
    return args;
  },
  subfinder: (target) => ['subfinder', '-d', extractHost(target), '-silent'],
  amass: (target) => ['amass', 'enum', '-d', extractHost(target), '-passive'],
  nikto: (target) => ['nikto', '-h', ensureHttpUrl(target), '-Format', 'txt'],
  httpx: (target) => ['httpx', '-u', target, '-silent', '-status-code', '-title', '-tech-detect'],
  waybackurls: (target) => ['waybackurls', extractHost(target)],
  gau: (target) => ['gau', extractHost(target)],
  dnsenum: (target) => ['dnsenum', extractHost(target)],
  nuclei: (target) => ['nuclei', '-u', ensureHttpUrl(target), '-severity', 'critical,high,medium,low'],
  ffuf: (target) => {
    const base = ensureHttpUrl(target).replace(/\/+$/, '');
    const wl = findWordlist(COMMON_WORDLIST);
    return ['ffuf', '-u', `${base}/FUZZ`, '-w', wl, '-mc', '200,301,302,403', '-t', '10'];
  },
  gobuster: (target) => {
    const wl = findWordlist(COMMON_WORDLIST);
    return ['gobuster', 'dir', '-u', ensureHttpUrl(target), '-w', wl, '-q', '-t', '10'];
  },
  dirb: (target) => ['dirb', ensureHttpUrl(target), '-S'],
  wfuzz: (target) => {
    const url = ensureHttpUrl(target);
    const wl = findWordlist(COMMON_WORDLIST);
    return ['wfuzz', '-c', '-z', `file,${wl}`, '--hc', '404', `${url}/FUZZ`];
  },
  sqlmap: (target) => {
    const url = ensureHttpUrl(target).replace(/\/+$/, '');
    return ['sqlmap', '-u', `${url}/login.php`, '--batch', '--level=1', '--risk=1', '--forms', '--smart'];
  },
  xsstrike: (target) => ['xsstrike', '-u', ensureHttpUrl(target), '--blind'],
  whatweb: (target) => ['whatweb', ensureHttpUrl(target), '-a', '3'],
  wafw00f: (target) => ['wafw00f', ensureHttpUrl(target)],
  sslscan: (target) => ['sslscan', extractHost(target)],
  sslyze: (target) => ['sslyze', extractHost(target)],
  testssl: (target) => ['testssl.sh', target],
  masscan: (target) => [
    'masscan', extractHost(target), '-p1-65535', '--rate=1000', '--open-only',
  ],
  rustscan: (target) => ['rustscan', '-a', extractHost(target), '--ulimit', '5000'],
  feroxbuster: (target) => {
    const wl = findWordlist(COMMON_WORDLIST);
    return ['feroxbuster', '-u', target, '-w', wl, '-q'];
  },
  katana: (target) => ['katana', '-u', target, '-d', '3', '-silent'],
  hydra: (target, opts) => {
    const host = extractHost(target);
    const args = ['hydra'];
    if (opts.username) args.push('-l', opts.username);
    else args.push('-L', findWordlist([
      '/opt/cstrike/data/wordlists/usernames.txt',
      '/opt/wordlists/usernames.txt',
      '/usr/share/wordlists/metasploit/unix_users.txt',
      '/usr/share/wordlists/nmap.lst',
    ]));

    const wordlistMap: Record<string, string> = {
      'rockyou.txt': findWordlist(['/opt/cstrike/data/wordlists/passwords.txt', '/opt/wordlists/passwords.txt', '/usr/share/wordlists/rockyou.txt']),
      rockyou: findWordlist(['/opt/cstrike/data/wordlists/passwords.txt', '/opt/wordlists/passwords.txt', '/usr/share/wordlists/rockyou.txt']),
      fasttrack: findWordlist(['/opt/cstrike/data/wordlists/passwords.txt', '/opt/wordlists/passwords.txt', '/usr/share/wordlists/fasttrack.txt']),
    };
    args.push('-P', wordlistMap[opts.wordlist ?? 'fasttrack'] ?? opts.wordlist ?? findWordlist(['/opt/cstrike/data/wordlists/passwords.txt']));

    if (opts.port) args.push('-s', String(opts.port));
    args.push('-t', '8');
    // Traditional positional format: hydra [opts] host service
    args.push(host || 'localhost');
    args.push((opts.service ?? 'ssh').toLowerCase());
    return args;
  },
  john: (target) => ['john', target],
  hashcat: (target) => ['hashcat', '-m', '0', target, '/usr/share/wordlists/rockyou.txt'],
  enum4linux: (target) => ['enum4linux', '-a', extractHost(target)],
  smbclient: (target) => ['smbclient', '-L', extractHost(target), '-N'],
  nbtscan: (target) => ['nbtscan', extractHost(target)],
  snmpwalk: (target) => ['snmpwalk', '-v2c', '-c', 'public', extractHost(target)],
  dnsrecon: (target) => ['dnsrecon', '-d', extractHost(target)],
  wpscan: (target) => ['wpscan', '--url', target, '--no-banner'],
  commix: (target) => ['commix', '--url', target, '--batch'],
  gowitness: (target) => ['gowitness', 'single', target],
  searchsploit: (target) => {
    // Search ExploitDB for known exploits matching the target's services
    const host = extractHost(target);
    return ['searchsploit', host, '--json'];
  },
};

class ToolExecutor {
  /**
   * Resolve a binary to its full path, checking host-mounted locations first.
   */
  private resolveBinary(name: string): string {
    const searchPaths = [
      // Check container-local paths first (tools installed in container)
      '/usr/local/bin',
      '/usr/bin',
      // Then check host-mounted paths
      env.HOST_LOCAL_BIN_PATH,
      env.HOST_BIN_PATH,
      env.HOST_SBIN_PATH,
      `${env.HOST_OPT_PATH}/metasploit-framework/bin`,
    ];

    for (const dir of searchPaths) {
      const full = `${dir}/${name}`;
      try {
        accessSync(full);
        return full;
      } catch {
        continue;
      }
    }

    // Fall back to bare name (relies on PATH)
    return name;
  }

  /**
   * Run a tool against a target.
   */
  async run(tool: string, target: string, opts: ToolOptions = {}): Promise<ToolResult> {
    const commandBuilder = TOOL_COMMANDS[tool];
    if (!commandBuilder) {
      return {
        tool,
        target,
        output: '',
        exitCode: 1,
        duration: 0,
        error: `Unknown tool: ${tool}`,
      };
    }

    const args = commandBuilder(target, opts);
    const binary = this.resolveBinary(args[0]);
    const spawnArgs = args.slice(1);
    const timeout = opts.timeout ?? 300_000; // 5 min default

    console.log(`[ToolExec] ${tool}: ${binary} ${spawnArgs.join(' ')}`);

    const startTime = Date.now();
    let output = '';

    emitLogEntry({
      level: 'INFO',
      source: tool,
      message: `Starting ${tool} against ${target}`,
    });

    return new Promise((resolve) => {
      const child = spawn(binary, spawnArgs, {
        timeout,
        env: {
          ...process.env,
          PATH: `/usr/local/bin:/usr/bin:${env.HOST_LOCAL_BIN_PATH}:${env.HOST_BIN_PATH}:${env.HOST_SBIN_PATH}:${process.env.PATH}`,
        },
      });

      child.stdout?.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;

        // Stream to WebSocket
        emitReconOutput({
          tool,
          target,
          output: chunk,
          complete: false,
        });
      });

      child.stderr?.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        const duration = Date.now() - startTime;

        emitReconOutput({
          tool,
          target,
          output: `[${tool}] Complete (${Math.round(duration / 1000)}s)`,
          complete: true,
        });

        resolve({
          tool,
          target,
          output,
          exitCode: code ?? 1,
          duration,
          error: code !== 0 ? `Exit code ${code}` : undefined,
        });
      });

      child.on('error', (err) => {
        resolve({
          tool,
          target,
          output,
          exitCode: 1,
          duration: Date.now() - startTime,
          error: err.message,
        });
      });
    });
  }
}

export const toolExecutor = new ToolExecutor();
