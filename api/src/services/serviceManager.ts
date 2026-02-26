/**
 * Service lifecycle manager — start/stop/restart Metasploit, ZAP, Burp.
 */

import { spawn } from 'node:child_process';
import { env } from '../config/env.js';
import { getConfigValue } from '../middleware/guardrails.js';

interface ServiceResult {
  pid?: number;
  error?: string;
}

// Map service names to their start/stop commands
const SERVICE_COMMANDS: Record<string, {
  start: string[];
  stop: string[];
}> = {
  metasploit: {
    start: ['msfrpcd', '-P', 'msf', '-S', '-a', '127.0.0.1', '-p', '55552'],
    stop: ['pkill', '-f', 'msfrpcd'],
  },
  zap: {
    start: ['zap.sh', '-daemon', '-port', '8090', '-host', '127.0.0.1', '-config', 'api.disablekey=true'],
    stop: ['pkill', '-f', 'zap'],
  },
  burp: {
    start: ['java', '-jar', '/opt/BurpSuitePro/burpsuite_pro.jar', '--unpause-spider-and-scanner'],
    stop: ['pkill', '-f', 'burpsuite'],
  },
};

function resolveCommand(cmd: string): string {
  // Check host-mounted paths first, then local
  const paths = [
    env.HOST_LOCAL_BIN_PATH,
    env.HOST_BIN_PATH,
    env.HOST_SBIN_PATH,
    `${env.HOST_OPT_PATH}/metasploit-framework/bin`,
  ];

  for (const p of paths) {
    const full = `${p}/${cmd}`;
    try {
      const { accessSync } = require('node:fs');
      accessSync(full);
      return full;
    } catch {
      continue;
    }
  }
  return cmd; // Fall back to PATH
}

class ServiceManager {
  async execute(name: string, action: 'start' | 'stop' | 'restart'): Promise<ServiceResult> {
    const cmds = SERVICE_COMMANDS[name];
    if (!cmds) {
      return { error: `Unknown service: ${name}` };
    }

    if (action === 'restart') {
      await this.execute(name, 'stop');
      await new Promise((r) => setTimeout(r, 2000));
      return this.execute(name, 'start');
    }

    const cmdArgs = action === 'start' ? cmds.start : cmds.stop;
    const executable = resolveCommand(cmdArgs[0]);
    const args = cmdArgs.slice(1);

    // Update Metasploit args with config values
    if (name === 'metasploit' && action === 'start') {
      const password = await getConfigValue('msf_password', 'msf');
      const port = await getConfigValue('msf_port', 55552);
      const host = await getConfigValue('msf_host', '127.0.0.1');
      args[1] = String(password);
      args[5] = String(host);
      args[7] = String(port);
    }

    return new Promise((resolve) => {
      try {
        const child = spawn(executable, args, {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();

        if (action === 'start') {
          // Give the service a moment to start
          setTimeout(() => {
            resolve({ pid: child.pid });
          }, 1000);
        } else {
          resolve({});
        }
      } catch (err: any) {
        resolve({ error: err.message });
      }
    });
  }
}

export const serviceManager = new ServiceManager();
