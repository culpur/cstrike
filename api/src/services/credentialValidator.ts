/**
 * Credential Validator — validates discovered credentials against target services.
 */

import { spawn } from 'node:child_process';
import { env } from '../config/env.js';

interface ValidateInput {
  id?: string;
  username: string;
  password: string;
  target: string;
  service: string;
  port?: number;
}

interface ValidateResult {
  id?: string;
  username: string;
  target: string;
  service: string;
  valid: boolean;
  message: string;
  duration: number;
}

class CredentialValidator {
  /**
   * Validate a single credential pair.
   */
  async validate(input: ValidateInput): Promise<ValidateResult> {
    const startTime = Date.now();

    const serviceValidators: Record<string, () => Promise<boolean>> = {
      ssh: () => this.validateSSH(input),
      ftp: () => this.validateFTP(input),
      http: () => this.validateHTTP(input),
      smb: () => this.validateSMB(input),
    };

    const validator = serviceValidators[input.service];
    if (!validator) {
      return {
        id: input.id,
        username: input.username,
        target: input.target,
        service: input.service,
        valid: false,
        message: `Unsupported service: ${input.service}`,
        duration: Date.now() - startTime,
      };
    }

    try {
      const valid = await validator();
      return {
        id: input.id,
        username: input.username,
        target: input.target,
        service: input.service,
        valid,
        message: valid ? 'Authentication successful' : 'Authentication failed',
        duration: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        id: input.id,
        username: input.username,
        target: input.target,
        service: input.service,
        valid: false,
        message: `Error: ${err.message}`,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Validate a batch of credentials.
   */
  async validateBatch(inputs: ValidateInput[]): Promise<ValidateResult[]> {
    const results: ValidateResult[] = [];
    for (const input of inputs) {
      results.push(await this.validate(input));
    }
    return results;
  }

  private async validateSSH(input: ValidateInput): Promise<boolean> {
    return this.runCommand('hydra', [
      '-l', input.username,
      '-p', input.password,
      '-s', String(input.port ?? 22),
      input.target,
      'ssh',
      '-t', '1',
      '-f',
    ]);
  }

  private async validateFTP(input: ValidateInput): Promise<boolean> {
    return this.runCommand('hydra', [
      '-l', input.username,
      '-p', input.password,
      '-s', String(input.port ?? 21),
      input.target,
      'ftp',
      '-t', '1',
      '-f',
    ]);
  }

  private async validateHTTP(input: ValidateInput): Promise<boolean> {
    return this.runCommand('hydra', [
      '-l', input.username,
      '-p', input.password,
      '-s', String(input.port ?? 80),
      input.target,
      'http-get',
      '-t', '1',
      '-f',
    ]);
  }

  private async validateSMB(input: ValidateInput): Promise<boolean> {
    return this.runCommand('hydra', [
      '-l', input.username,
      '-p', input.password,
      '-s', String(input.port ?? 445),
      input.target,
      'smb',
      '-t', '1',
      '-f',
    ]);
  }

  private runCommand(cmd: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        timeout: 30_000,
        env: {
          ...process.env,
          PATH: `${env.HOST_LOCAL_BIN_PATH}:${env.HOST_BIN_PATH}:${process.env.PATH}`,
        },
      });

      let output = '';
      child.stdout?.on('data', (d) => { output += d.toString(); });
      child.stderr?.on('data', (d) => { output += d.toString(); });

      child.on('close', (code) => {
        // hydra returns 0 and prints "successfully completed" on success
        resolve(code === 0 && output.includes('successfully'));
      });

      child.on('error', () => resolve(false));
    });
  }
}

export const credentialValidator = new CredentialValidator();
