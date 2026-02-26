/**
 * Tool Executor — runs security tools via child_process.spawn.
 * Resolves binaries from host-mounted paths, enforces guardrails,
 * streams output to WebSocket, and parses results.
 */

import { spawn } from 'node:child_process';
import { accessSync } from 'node:fs';
import { env } from '../config/env.js';
import { emitReconOutput, emitLogEntry } from '../websocket/emitter.js';

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

// Tool command builders
const TOOL_COMMANDS: Record<string, (target: string, opts: ToolOptions) => string[]> = {
  nmap: (target, opts) => [
    'nmap', '-sV', '-sC', '--top-ports', '1000', '-oN', '-', target,
  ],
  subfinder: (target) => ['subfinder', '-d', target, '-silent'],
  amass: (target) => ['amass', 'enum', '-d', target, '-passive'],
  nikto: (target) => ['nikto', '-h', target, '-Format', 'txt'],
  httpx: (target) => ['httpx', '-u', target, '-silent', '-status-code', '-title', '-tech-detect'],
  waybackurls: (target) => ['waybackurls', target],
  gau: (target) => ['gau', target],
  dnsenum: (target) => ['dnsenum', target],
  nuclei: (target) => ['nuclei', '-u', target, '-severity', 'critical,high,medium'],
  ffuf: (target, opts) => [
    'ffuf', '-u', `${target}/FUZZ`, '-w',
    '/usr/share/wordlists/dirb/common.txt', '-mc', '200,301,302,403',
  ],
  gobuster: (target) => [
    'gobuster', 'dir', '-u', target, '-w',
    '/usr/share/wordlists/dirb/common.txt', '-q',
  ],
  dirb: (target) => ['dirb', target, '-S'],
  wfuzz: (target) => [
    'wfuzz', '-c', '-z', 'file,/usr/share/wordlists/dirb/common.txt',
    '--hc', '404', `${target}/FUZZ`,
  ],
  sqlmap: (target) => [
    'sqlmap', '-u', target, '--batch', '--level=1', '--risk=1',
  ],
  xsstrike: (target) => ['xsstrike', '-u', target, '--blind'],
  whatweb: (target) => ['whatweb', target, '-a', '3'],
  wafw00f: (target) => ['wafw00f', target],
  sslscan: (target) => ['sslscan', target],
  sslyze: (target) => ['sslyze', target],
  testssl: (target) => ['testssl.sh', target],
  masscan: (target) => [
    'masscan', target, '-p1-65535', '--rate=1000', '--open-only',
  ],
  rustscan: (target) => ['rustscan', '-a', target, '--ulimit', '5000'],
  feroxbuster: (target) => [
    'feroxbuster', '-u', target, '-w',
    '/usr/share/wordlists/dirb/common.txt', '-q',
  ],
  katana: (target) => ['katana', '-u', target, '-d', '3', '-silent'],
  hydra: (target, opts) => {
    const args = ['hydra'];
    if (opts.username) args.push('-l', opts.username);
    else args.push('-L', '/usr/share/wordlists/metasploit/unix_users.txt');

    const wordlistMap: Record<string, string> = {
      rockyou: '/usr/share/wordlists/rockyou.txt',
      fasttrack: '/usr/share/wordlists/fasttrack.txt',
    };
    args.push('-P', wordlistMap[opts.wordlist ?? 'fasttrack'] ?? opts.wordlist ?? wordlistMap.fasttrack);

    if (opts.port) args.push('-s', String(opts.port));
    args.push(target, opts.service ?? 'ssh');
    return args;
  },
  john: (target) => ['john', target],
  hashcat: (target, opts) => ['hashcat', '-m', '0', target, '/usr/share/wordlists/rockyou.txt'],
  enum4linux: (target) => ['enum4linux', '-a', target],
  smbclient: (target) => ['smbclient', '-L', target, '-N'],
  nbtscan: (target) => ['nbtscan', target],
  snmpwalk: (target) => ['snmpwalk', '-v2c', '-c', 'public', target],
  dnsrecon: (target) => ['dnsrecon', '-d', target],
  wpscan: (target) => ['wpscan', '--url', target, '--no-banner'],
  commix: (target) => ['commix', '--url', target, '--batch'],
  gowitness: (target) => ['gowitness', 'single', target],
};

class ToolExecutor {
  /**
   * Resolve a binary to its full path, checking host-mounted locations first.
   */
  private resolveBinary(name: string): string {
    const searchPaths = [
      env.HOST_LOCAL_BIN_PATH,
      env.HOST_BIN_PATH,
      env.HOST_SBIN_PATH,
      `${env.HOST_OPT_PATH}/metasploit-framework/bin`,
      '/usr/local/bin',
      '/usr/bin',
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
          PATH: `${env.HOST_LOCAL_BIN_PATH}:${env.HOST_BIN_PATH}:${env.HOST_SBIN_PATH}:${process.env.PATH}`,
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
