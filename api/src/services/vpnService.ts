/**
 * VPN Service — manages VPN connections for all supported providers.
 * Providers: wireguard, openvpn, tailscale, nordvpn, mullvad.
 * State is persisted to VpnConnection records; actual interface control
 * is delegated to the OS via child_process.execSync (runs on host via --network=host).
 * Also handles split-routing setup via iptables fwmark.
 */

import { execSync, spawnSync } from 'node:child_process';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type VpnProvider = 'wireguard' | 'openvpn' | 'tailscale' | 'nordvpn' | 'mullvad';

export interface VpnConnectOptions {
  server?: string;      // VPN server/region/endpoint
  config?: string;      // Config file path (wireguard/openvpn)
  fwmark?: number;      // iptables fwmark for split routing (default: none)
}

export interface VpnStatus {
  provider: VpnProvider;
  interface: string | null;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  publicIp: string | null;
  assignedIp: string | null;
  server: string | null;
  connectedAt: number | null;
}

export interface VpnResult {
  success: boolean;
  provider: VpnProvider;
  status: string;
  assignedIp?: string | null;
  error?: string;
}

// Provider → kernel interface name
const PROVIDER_INTERFACES: Record<VpnProvider, string> = {
  wireguard: 'wg0',
  openvpn: 'tun0',
  tailscale: 'tailscale0',
  nordvpn: 'nordlynx',
  mullvad: 'wg-mullvad',
};

// Default fwmark table for split routing
const FWMARK_TABLE = 100;
const FWMARK_ID = 0x29a; // 666 decimal

// ── Core class ────────────────────────────────────────────────────────────────

class VpnService {
  /**
   * Connect a VPN provider. Persists CONNECTING state, executes the OS command,
   * then updates to CONNECTED (or ERROR) with the assigned IP.
   */
  async connect(provider: VpnProvider, opts: VpnConnectOptions = {}): Promise<VpnResult> {
    const iface = PROVIDER_INTERFACES[provider];

    // Ensure DB record exists (upsert)
    await prisma.vpnConnection.upsert({
      where: { provider },
      update: { status: 'CONNECTING', server: opts.server ?? null },
      create: {
        provider,
        interface: iface,
        status: 'CONNECTING',
        server: opts.server ?? null,
      },
    });

    try {
      const cmd = this.buildConnectCommand(provider, opts);
      execSync(cmd, {
        timeout: 30_000,
        stdio: 'pipe',
        env: {
          ...process.env,
          PATH: `${env.HOST_LOCAL_BIN_PATH}:${env.HOST_BIN_PATH}:${env.HOST_SBIN_PATH}:${process.env.PATH}`,
        },
      });

      // Give the interface time to come up
      await this.waitForInterface(iface, 10_000);

      const assignedIp = this.getInterfaceIp(iface);

      await prisma.vpnConnection.update({
        where: { provider },
        data: {
          status: 'CONNECTED',
          interface: iface,
          assignedIp,
          connectedAt: new Date(),
        },
      });

      // Set up split routing if fwmark requested
      if (opts.fwmark !== undefined) {
        this.setupSplitRouting(iface, opts.fwmark ?? FWMARK_ID);
      }

      return { success: true, provider, status: 'connected', assignedIp };
    } catch (err: any) {
      await prisma.vpnConnection.update({
        where: { provider },
        data: { status: 'ERROR' },
      });

      return {
        success: false,
        provider,
        status: 'error',
        error: err.message ?? String(err),
      };
    }
  }

  /**
   * Disconnect a VPN provider. Tears down split routing before bringing
   * the interface down, then marks the record DISCONNECTED.
   */
  async disconnect(provider: VpnProvider): Promise<VpnResult> {
    const iface = PROVIDER_INTERFACES[provider];

    // Tear down split routing first (best-effort)
    try {
      this.teardownSplitRouting(iface);
    } catch {
      // Non-fatal — may not have been set up
    }

    try {
      const cmd = this.buildDisconnectCommand(provider);
      execSync(cmd, {
        timeout: 15_000,
        stdio: 'pipe',
        env: {
          ...process.env,
          PATH: `${env.HOST_LOCAL_BIN_PATH}:${env.HOST_BIN_PATH}:${env.HOST_SBIN_PATH}:${process.env.PATH}`,
        },
      });
    } catch {
      // Disconnect errors are non-fatal — interface may already be down
    }

    await prisma.vpnConnection.upsert({
      where: { provider },
      update: {
        status: 'DISCONNECTED',
        assignedIp: null,
        publicIp: null,
        connectedAt: null,
      },
      create: {
        provider,
        interface: iface,
        status: 'DISCONNECTED',
      },
    });

    return { success: true, provider, status: 'disconnected' };
  }

  /**
   * Get status of all known VPN connections.
   * Refreshes interface state from the OS before returning.
   */
  async getAll(): Promise<VpnStatus[]> {
    const connections = await prisma.vpnConnection.findMany({
      orderBy: { provider: 'asc' },
    });

    // If no records exist yet, return seeded defaults for all providers
    if (connections.length === 0) {
      return (Object.keys(PROVIDER_INTERFACES) as VpnProvider[]).map((p) => ({
        provider: p,
        interface: PROVIDER_INTERFACES[p],
        status: 'disconnected' as const,
        publicIp: null,
        assignedIp: null,
        server: null,
        connectedAt: null,
      }));
    }

    const results: VpnStatus[] = [];
    for (const conn of connections) {
      const iface = conn.interface ?? '';
      const actualUp = this.isInterfaceUp(iface);
      const dbConnected = conn.status === 'CONNECTED';

      // Reconcile DB state with actual OS state
      if (dbConnected && !actualUp) {
        await prisma.vpnConnection.update({
          where: { provider: conn.provider },
          data: { status: 'DISCONNECTED', assignedIp: null, publicIp: null, connectedAt: null },
        });
      }

      const effectiveStatus = actualUp ? 'connected' : 'disconnected';

      results.push({
        provider: conn.provider as VpnProvider,
        interface: conn.interface,
        status: effectiveStatus,
        publicIp: actualUp ? this.getInterfaceIp(iface) : null,
        assignedIp: actualUp ? (conn.assignedIp ?? this.getInterfaceIp(iface)) : null,
        server: conn.server,
        connectedAt: conn.connectedAt?.getTime() ?? null,
      });
    }

    return results;
  }

  /**
   * Get status of a single provider.
   */
  async getStatus(provider: VpnProvider): Promise<VpnStatus> {
    const conn = await prisma.vpnConnection.findUnique({ where: { provider } });
    const iface = PROVIDER_INTERFACES[provider];
    const actualUp = this.isInterfaceUp(iface);

    return {
      provider,
      interface: conn?.interface ?? iface,
      status: actualUp ? 'connected' : 'disconnected',
      publicIp: actualUp ? this.getInterfaceIp(iface) : null,
      assignedIp: actualUp ? (conn?.assignedIp ?? this.getInterfaceIp(iface)) : null,
      server: conn?.server ?? null,
      connectedAt: conn?.connectedAt?.getTime() ?? null,
    };
  }

  // ── Split routing (iptables fwmark) ──────────────────────────────────────

  /**
   * Set up policy routing: packets marked with fwmark are routed through the VPN
   * interface. Implements the redteam split-routing design from the plan.
   *
   * This creates:
   *   - ip rule: fwmark 0x29a → table 100
   *   - ip route in table 100: default via VPN interface
   *   - iptables OUTPUT mark: mark outgoing traffic from the api process
   */
  setupSplitRouting(iface: string, fwmark: number = FWMARK_ID): void {
    const mark = `0x${fwmark.toString(16)}`;

    const commands = [
      // Add routing table entry (idempotent — ignore error if exists)
      `ip rule add fwmark ${mark} table ${FWMARK_TABLE} 2>/dev/null || true`,
      // Route all traffic in table 100 via the VPN interface
      `ip route replace default dev ${iface} table ${FWMARK_TABLE}`,
      // Mark packets from the API container process (uid-based if running as non-root)
      `iptables -t mangle -C OUTPUT -m owner --uid-owner 1000 -j MARK --set-mark ${mark} 2>/dev/null || ` +
        `iptables -t mangle -A OUTPUT -m owner --uid-owner 1000 -j MARK --set-mark ${mark}`,
    ];

    for (const cmd of commands) {
      try {
        execSync(cmd, { timeout: 5_000, stdio: 'pipe' });
      } catch {
        // Best-effort — log but continue
        console.warn(`[VPN] Split routing command failed: ${cmd}`);
      }
    }

    console.log(`[VPN] Split routing via ${iface} active (fwmark=${mark})`);
  }

  /**
   * Remove split-routing rules for an interface.
   */
  teardownSplitRouting(iface: string, fwmark: number = FWMARK_ID): void {
    const mark = `0x${fwmark.toString(16)}`;

    const commands = [
      `ip rule del fwmark ${mark} table ${FWMARK_TABLE} 2>/dev/null || true`,
      `ip route flush table ${FWMARK_TABLE} 2>/dev/null || true`,
      `iptables -t mangle -D OUTPUT -m owner --uid-owner 1000 -j MARK --set-mark ${mark} 2>/dev/null || true`,
    ];

    for (const cmd of commands) {
      try {
        execSync(cmd, { timeout: 5_000, stdio: 'pipe' });
      } catch {
        // Non-fatal
      }
    }
  }

  // ── OS helpers ────────────────────────────────────────────────────────────

  private isInterfaceUp(iface: string): boolean {
    if (!iface) return false;
    try {
      const out = execSync(`ip link show ${iface} 2>/dev/null`, {
        timeout: 3_000,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      return out.includes('UP');
    } catch {
      return false;
    }
  }

  private getInterfaceIp(iface: string): string | null {
    if (!iface) return null;
    try {
      const out = execSync(
        `ip -4 addr show ${iface} 2>/dev/null | grep -oP '(?<=inet )\\S+' | cut -d/ -f1`,
        { timeout: 3_000, encoding: 'utf-8', stdio: 'pipe' },
      );
      return out.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Poll until the interface comes UP or timeout is reached.
   */
  private waitForInterface(iface: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const start = Date.now();
      const poll = setInterval(() => {
        if (this.isInterfaceUp(iface) || Date.now() - start > timeoutMs) {
          clearInterval(poll);
          resolve();
        }
      }, 500);
    });
  }

  // ── Command builders ──────────────────────────────────────────────────────

  private buildConnectCommand(provider: VpnProvider, opts: VpnConnectOptions): string {
    switch (provider) {
      case 'wireguard':
        return `sudo wg-quick up ${opts.config ?? 'wg0'}`;

      case 'openvpn':
        return `sudo openvpn --config ${opts.config ?? '/etc/openvpn/client.conf'} --daemon`;

      case 'tailscale':
        return opts.server
          ? `sudo tailscale up --exit-node=${opts.server}`
          : 'sudo tailscale up';

      case 'nordvpn':
        return opts.server
          ? `sudo nordvpn connect ${opts.server}`
          : 'sudo nordvpn connect';

      case 'mullvad':
        return opts.server
          ? `sudo mullvad connect --location ${opts.server}`
          : 'sudo mullvad connect';

      default:
        throw new Error(`Unknown VPN provider: ${provider}`);
    }
  }

  private buildDisconnectCommand(provider: VpnProvider): string {
    switch (provider) {
      case 'wireguard':
        return 'sudo wg-quick down wg0';
      case 'openvpn':
        return 'sudo pkill -TERM openvpn';
      case 'tailscale':
        return 'sudo tailscale down';
      case 'nordvpn':
        return 'sudo nordvpn disconnect';
      case 'mullvad':
        return 'sudo mullvad disconnect';
      default:
        throw new Error(`Unknown VPN provider: ${provider}`);
    }
  }
}

export const vpnService = new VpnService();
