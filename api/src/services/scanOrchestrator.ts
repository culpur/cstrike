/**
 * Scan Orchestrator — manages the multi-phase scan pipeline.
 * Coordinates tool execution, result storage, and phase transitions.
 */

import { prisma } from '../config/database.js';
import { toolExecutor } from './toolExecutor.js';
import { lootService } from './lootService.js';
import { getConfigValue } from '../middleware/guardrails.js';
import { emitPhaseChange, emitReconOutput, emitScanComplete, emitLogEntry, emitPortDiscovered, emitSubdomainDiscovered } from '../websocket/emitter.js';

// Active scan tracking for cancellation
const activeScans = new Map<string, { cancelled: boolean }>();

class ScanOrchestrator {
  /**
   * Start a scan — runs the full pipeline asynchronously.
   */
  startScan(scanId: string, target: string, tools?: string[], mode?: string) {
    const state = { cancelled: false };
    activeScans.set(scanId, state);

    setImmediate(() => this.runPipeline(scanId, target, tools, mode, state));
  }

  /**
   * Cancel a running scan.
   */
  cancelScan(scanId: string) {
    const state = activeScans.get(scanId);
    if (state) state.cancelled = true;
  }

  /**
   * Main scan pipeline — phases run sequentially.
   */
  private async runPipeline(
    scanId: string,
    target: string,
    requestedTools?: string[],
    mode?: string,
    state?: { cancelled: boolean },
  ) {
    try {
      // Mark as running
      const scanRecord = await prisma.scan.update({
        where: { id: scanId },
        data: { status: 'RUNNING', startedAt: new Date(), phase: 'RECON' },
      });
      const targetId = scanRecord.targetId;

      // Get allowed tools from config
      const allowedTools = await getConfigValue<string[]>('allowed_tools', []);
      const scanTools = requestedTools?.length
        ? requestedTools.filter((t) => allowedTools.length === 0 || allowedTools.includes(t))
        : this.getDefaultTools(mode ?? 'full');

      const totalTools = scanTools.length;
      let completedTools = 0;

      emitPhaseChange({ phase: 'recon', target, status: 'running' });

      // Run each tool
      for (const tool of scanTools) {
        if (state?.cancelled) {
          emitLogEntry({ level: 'WARN', source: 'orchestrator', message: `Scan ${scanId} cancelled` });
          break;
        }

        completedTools++;
        const progress = `${completedTools}/${totalTools}`;

        await prisma.scan.update({
          where: { id: scanId },
          data: { progress },
        });

        emitReconOutput({
          tool,
          target,
          output: `Starting ${tool}...`,
          complete: false,
          event: 'tool_start',
          progress,
          scan_id: scanId,
        });

        const result = await toolExecutor.run(tool, target);

        // Store result
        await prisma.scanResult.create({
          data: {
            scanId,
            resultType: this.toolToResultType(tool),
            data: {
              tool: result.tool,
              output: result.output,
              exitCode: result.exitCode,
              duration: result.duration,
            } as any,
            source: tool,
          },
        });

        // Emit structured discoveries from tool output
        if (result.output && !result.error) {
          this.emitDiscoveries(tool, target, result.output, scanId);
        }

        // Extract loot from tool output (credentials, ports, URLs, etc.)
        if (result.output && !result.error) {
          try {
            const lootCount = await lootService.extractFromOutput(result.output, tool, targetId);
            if (lootCount > 0) {
              emitLogEntry({
                level: 'INFO',
                source: 'loot',
                message: `Extracted ${lootCount} loot items from ${tool}`,
              });
            }
          } catch (err: any) {
            console.error(`[Loot] Extraction failed for ${tool}:`, err.message);
          }
        }

        // Log to DB
        await prisma.logEntry.create({
          data: {
            scanId,
            level: result.error ? 'ERROR' : 'INFO',
            source: tool,
            message: result.error
              ? `${tool} failed: ${result.error}`
              : `${tool} complete (${Math.round(result.duration / 1000)}s)`,
          },
        });

        emitReconOutput({
          tool,
          target,
          output: result.error ? `[${tool}] Error: ${result.error}` : `[${tool}] Complete`,
          complete: true,
          event: result.error ? 'tool_error' : 'tool_complete',
          progress,
          scan_id: scanId,
        });
      }

      // Mark complete
      const finalStatus = state?.cancelled ? 'CANCELLED' : 'COMPLETED';
      await prisma.scan.update({
        where: { id: scanId },
        data: {
          status: finalStatus as any,
          phase: 'COMPLETE',
          endedAt: new Date(),
        },
      });

      // Update target status
      const scan = await prisma.scan.findUnique({
        where: { id: scanId },
        include: { target: true },
      });
      if (scan) {
        await prisma.target.update({
          where: { id: scan.targetId },
          data: { status: finalStatus === 'COMPLETED' ? 'COMPLETE' : 'FAILED' },
        });
      }

      emitPhaseChange({ phase: 'recon', target, status: 'complete' });
      emitScanComplete({ target, scan_id: scanId });

    } catch (err: any) {
      console.error(`[Orchestrator] Scan ${scanId} failed:`, err.message);

      await prisma.scan.update({
        where: { id: scanId },
        data: {
          status: 'FAILED',
          error: err.message,
          endedAt: new Date(),
        },
      }).catch(() => {});

    } finally {
      activeScans.delete(scanId);
    }
  }

  /**
   * Get default tools for a scan mode.
   */
  private getDefaultTools(mode: string): string[] {
    switch (mode) {
      case 'quick':
        return ['nmap', 'httpx', 'whatweb'];
      case 'web':
        return ['nmap', 'httpx', 'nikto', 'gobuster', 'whatweb', 'sslscan', 'nuclei'];
      case 'stealth':
        return ['nmap', 'subfinder', 'httpx'];
      case 'full':
      default:
        return [
          'nmap', 'subfinder', 'httpx', 'nikto', 'waybackurls',
          'gobuster', 'whatweb', 'sslscan', 'nuclei',
        ];
    }
  }

  /**
   * Parse tool output and emit structured port/subdomain discoveries.
   */
  private emitDiscoveries(tool: string, target: string, output: string, scanId: string) {
    // Parse nmap output for open ports
    if (['nmap', 'masscan', 'rustscan'].includes(tool)) {
      const portRegex = /^(\d+)\/(tcp|udp)\s+(open)\s+(\S+)\s*(.*)/gm;
      let match;
      while ((match = portRegex.exec(output)) !== null) {
        emitPortDiscovered({
          port: parseInt(match[1], 10),
          protocol: match[2],
          state: match[3],
          service: match[4],
          version: (match[5] || '').trim(),
          target,
          scan_id: scanId,
        });
      }
    }

    // Parse subfinder/amass output for subdomains
    if (['subfinder', 'amass', 'dnsenum', 'dnsrecon'].includes(tool)) {
      const lines = output.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        const subdomain = line.trim();
        if (subdomain && subdomain.includes('.') && !subdomain.startsWith('[')) {
          emitSubdomainDiscovered({
            subdomain,
            target,
            source: tool,
            scan_id: scanId,
          });
        }
      }
    }
  }

  /**
   * Map tool name to ScanResultType.
   */
  private toolToResultType(tool: string): any {
    const map: Record<string, string> = {
      nmap: 'PORT_SCAN',
      masscan: 'PORT_SCAN',
      rustscan: 'PORT_SCAN',
      subfinder: 'SUBDOMAIN',
      amass: 'SUBDOMAIN',
      dnsenum: 'SUBDOMAIN',
      dnsrecon: 'SUBDOMAIN',
      httpx: 'HTTP_ENDPOINT',
      whatweb: 'TECHNOLOGY',
      wafw00f: 'TECHNOLOGY',
      nuclei: 'VULNERABILITY',
      nikto: 'WEB_SCAN',
      sqlmap: 'EXPLOIT_RESULT',
      xsstrike: 'EXPLOIT_RESULT',
      gobuster: 'HTTP_ENDPOINT',
      ffuf: 'HTTP_ENDPOINT',
      dirb: 'HTTP_ENDPOINT',
      feroxbuster: 'HTTP_ENDPOINT',
      sslscan: 'RAW_OUTPUT',
      sslyze: 'RAW_OUTPUT',
      testssl: 'RAW_OUTPUT',
    };
    return map[tool] ?? 'RAW_OUTPUT';
  }
}

export const scanOrchestrator = new ScanOrchestrator();
