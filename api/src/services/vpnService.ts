/**
 * VPN Service — manages VPN connections for all supported providers.
 * Providers: wireguard, openvpn, tailscale, nordvpn, mullvad.
 * State is persisted to VpnConnection records; actual interface control
 * is delegated to the OS via child_process.execSync (runs on host via --network=host).
 * Also handles split-routing setup via iptables fwmark.
 *
 * New in v2: config file upload, per-provider authentication, Tailscale remote access.
 */

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import type { Prisma } from '@prisma/client';

// ── Types ─────────────────────────────────────────────────────────────────────

export type VpnProvider = 'wireguard' | 'openvpn' | 'tailscale' | 'nordvpn' | 'mullvad';

export interface VpnConnectOptions {
  server?: string;
  splitRouting?: boolean;
}

export interface VpnStatus {
  provider: VpnProvider;
  interface: string | null;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  publicIp: string | null;
  assignedIp: string | null;
  server: string | null;
  connectedAt: number | null;
  configPath: string | null;
  hasAuthToken: boolean;
  options: Record<string, unknown> | null;
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

// Config storage directory inside the apidata volume
const VPN_CONFIG_DIR = '/opt/cstrike/data/vpn';

// Valid extensions per provider for uploaded configs
const VALID_EXTENSIONS: Partial<Record<VpnProvider, string[]>> = {
  wireguard: ['.conf'],
  openvpn: ['.ovpn', '.conf'],
};

// Default fwmark table for split routing
const FWMARK_TABLE = 100;
const FWMARK_ID = 0x29a; // 666 decimal

// ── Core class ────────────────────────────────────────────────────────────────

class VpnService {

  // ── Config file management ─────────────────────────────────────────────────

  /**
   * Save an uploaded VPN config file to the data volume.
   * Writes to /opt/cstrike/data/vpn/<provider>-<timestamp>.<ext> with mode 0o600.
   * Stores the path in the DB record.
   */
  async saveConfigFile(provider: VpnProvider, buffer: Buffer, originalName: string): Promise<string> {
    const allowedProviders: VpnProvider[] = ['wireguard', 'openvpn'];
    if (!allowedProviders.includes(provider)) {
      throw new Error(`Config upload not supported for ${provider}`);
    }

    // Validate extension
    const ext = originalName.includes('.') ? '.' + originalName.split('.').pop()!.toLowerCase() : '';
    const validExts = VALID_EXTENSIONS[provider] ?? [];
    if (!validExts.includes(ext)) {
      throw new Error(`Invalid file extension "${ext}" for ${provider}. Expected: ${validExts.join(', ')}`);
    }

    // Ensure directory exists
    if (!existsSync(VPN_CONFIG_DIR)) {
      mkdirSync(VPN_CONFIG_DIR, { recursive: true, mode: 0o700 });
    }

    // Write file with restrictive permissions
    const filename = `${provider}-${Date.now()}${ext}`;
    const filePath = join(VPN_CONFIG_DIR, filename);
    writeFileSync(filePath, buffer, { mode: 0o600 });

    // Upsert DB record with config path
    const iface = PROVIDER_INTERFACES[provider];
    await prisma.vpnConnection.upsert({
      where: { provider },
      update: { configPath: filePath },
      create: {
        provider,
        interface: iface,
        status: 'DISCONNECTED',
        configPath: filePath,
      },
    });

    console.log(`[VPN] Saved ${provider} config: ${filePath}`);
    return filePath;
  }

  // ── Per-provider authentication ────────────────────────────────────────────

  /**
   * Authenticate a VPN provider CLI. Runs the provider-specific auth command
   * and stores the token/key in the DB for re-authentication on connect.
   */
  async authenticate(
    provider: VpnProvider,
    authToken: string,
    options?: Record<string, unknown>,
  ): Promise<VpnResult> {
    const authProviders: VpnProvider[] = ['tailscale', 'nordvpn', 'mullvad'];
    if (!authProviders.includes(provider)) {
      throw new Error(`Authentication not applicable for ${provider} — use config upload instead`);
    }

    const iface = PROVIDER_INTERFACES[provider];

    try {
      const cmd = this.buildAuthCommand(provider, authToken, options);
      execSync(cmd, {
        timeout: 30_000,
        stdio: 'pipe',
        env: this.buildEnv(),
      });

      // Store auth token and options in DB
      await prisma.vpnConnection.upsert({
        where: { provider },
        update: {
          authToken,
          options: (options ?? undefined) as Prisma.InputJsonValue | undefined,
        },
        create: {
          provider,
          interface: iface,
          status: 'DISCONNECTED',
          authToken,
          options: (options ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });

      // For Tailscale, grab the assigned IP after auth
      let assignedIp: string | null = null;
      if (provider === 'tailscale') {
        assignedIp = this.getTailscaleIp();
        if (assignedIp) {
          await prisma.vpnConnection.update({
            where: { provider },
            data: { assignedIp },
          });
        }
      }

      console.log(`[VPN] ${provider} authenticated successfully`);
      return { success: true, provider, status: 'authenticated', assignedIp };
    } catch (err: any) {
      return {
        success: false,
        provider,
        status: 'error',
        error: err.stderr?.toString() || err.message || String(err),
      };
    }
  }

  /**
   * Build the CLI auth command for a provider.
   */
  private buildAuthCommand(
    provider: VpnProvider,
    authToken: string,
    options?: Record<string, unknown>,
  ): string {
    switch (provider) {
      case 'tailscale': {
        let cmd = `sudo tailscale up --authkey=${authToken} --reset`;
        if (options?.exitNode) cmd += ' --advertise-exit-node';
        if (options?.acceptRoutes) cmd += ' --accept-routes';
        if (options?.hostname) cmd += ` --hostname=${options.hostname}`;
        return cmd;
      }
      case 'nordvpn':
        return `sudo nordvpn login --token ${authToken}`;
      case 'mullvad':
        return `sudo mullvad account login ${authToken}`;
      default:
        throw new Error(`No auth command for provider: ${provider}`);
    }
  }

  /**
   * Check if a provider's CLI is currently logged in.
   * Returns true if authenticated, false otherwise.
   */
  checkProviderLoginStatus(provider: VpnProvider): boolean {
    try {
      switch (provider) {
        case 'nordvpn': {
          const out = execSync('sudo nordvpn account 2>&1', {
            timeout: 10_000,
            encoding: 'utf-8',
            stdio: 'pipe',
            env: this.buildEnv(),
          });
          return !out.toLowerCase().includes('not logged in');
        }
        case 'mullvad': {
          const out = execSync('sudo mullvad account get 2>&1', {
            timeout: 10_000,
            encoding: 'utf-8',
            stdio: 'pipe',
            env: this.buildEnv(),
          });
          return !out.toLowerCase().includes('not logged in') && !out.toLowerCase().includes('no account');
        }
        case 'tailscale': {
          const out = execSync('sudo tailscale status 2>&1', {
            timeout: 10_000,
            encoding: 'utf-8',
            stdio: 'pipe',
            env: this.buildEnv(),
          });
          return !out.toLowerCase().includes('stopped') && !out.toLowerCase().includes('needs login');
        }
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Get the Tailscale IPv4 address.
   */
  getTailscaleIp(): string | null {
    try {
      const out = execSync('sudo tailscale ip -4 2>/dev/null', {
        timeout: 5_000,
        encoding: 'utf-8',
        stdio: 'pipe',
        env: this.buildEnv(),
      });
      return out.trim() || null;
    } catch {
      return null;
    }
  }

  // ── Connect / Disconnect ───────────────────────────────────────────────────

  /**
   * Connect a VPN provider. For WG/OVPN, uses the stored config path.
   * For Nord/Mullvad, checks login status and re-auths from stored token if needed.
   * Optionally sets up split routing after connection.
   */
  async connect(provider: VpnProvider, opts: VpnConnectOptions = {}): Promise<VpnResult> {
    const iface = PROVIDER_INTERFACES[provider];

    // Read existing DB record for config path / auth token
    const existing = await prisma.vpnConnection.findUnique({ where: { provider } });

    // For Nord/Mullvad — check login status, re-auth from stored token if needed
    if (provider === 'nordvpn' || provider === 'mullvad') {
      if (!this.checkProviderLoginStatus(provider) && existing?.authToken) {
        console.log(`[VPN] ${provider} not logged in — re-authenticating from stored token`);
        const authResult = await this.authenticate(provider, existing.authToken);
        if (!authResult.success) {
          return { success: false, provider, status: 'error', error: `Re-auth failed: ${authResult.error}` };
        }
      }
    }

    // Upsert DB record to CONNECTING
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
      // Build connect command — pass config path from DB if available
      const configPath = existing?.configPath ?? undefined;
      const cmd = this.buildConnectCommand(provider, opts, configPath);
      execSync(cmd, {
        timeout: 30_000,
        stdio: 'pipe',
        env: this.buildEnv(),
      });

      // Give the interface time to come up
      await this.waitForInterface(iface, 10_000);

      // Get assigned IP — Tailscale uses its own command
      let assignedIp: string | null;
      if (provider === 'tailscale') {
        assignedIp = this.getTailscaleIp() ?? this.getInterfaceIp(iface);
      } else {
        assignedIp = this.getInterfaceIp(iface);
      }

      // Resolve public IP through VPN
      let publicIp: string | null = null;
      try {
        publicIp = execSync('curl -s --max-time 5 ifconfig.me 2>/dev/null', {
          timeout: 8_000,
          encoding: 'utf-8',
          env: this.buildEnv(),
        }).trim() || null;
      } catch { /* non-critical */ }

      await prisma.vpnConnection.update({
        where: { provider },
        data: {
          status: 'CONNECTED',
          interface: iface,
          assignedIp,
          publicIp,
          connectedAt: new Date(),
        },
      });

      // Set up split routing if requested
      if (opts.splitRouting) {
        this.setupSplitRouting(iface, FWMARK_ID);
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
        error: err.stderr?.toString() || err.message || String(err),
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
      // For WG, we need the config path to bring down the right interface
      const existing = await prisma.vpnConnection.findUnique({ where: { provider } });
      const cmd = this.buildDisconnectCommand(provider, existing?.configPath ?? undefined);
      execSync(cmd, {
        timeout: 15_000,
        stdio: 'pipe',
        env: this.buildEnv(),
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
   * Redacts authToken → hasAuthToken boolean.
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
        configPath: null,
        hasAuthToken: false,
        options: null,
      }));
    }

    // Ensure all 5 providers are represented
    const providerSet = new Set(connections.map((c) => c.provider));
    const results: VpnStatus[] = [];

    for (const provider of Object.keys(PROVIDER_INTERFACES) as VpnProvider[]) {
      const conn = connections.find((c) => c.provider === provider);

      if (!conn) {
        results.push({
          provider,
          interface: PROVIDER_INTERFACES[provider],
          status: 'disconnected',
          publicIp: null,
          assignedIp: null,
          server: null,
          connectedAt: null,
          configPath: null,
          hasAuthToken: false,
          options: null,
        });
        continue;
      }

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
        publicIp: actualUp ? (conn.publicIp ?? this.getInterfaceIp(iface)) : null,
        assignedIp: actualUp ? (conn.assignedIp ?? this.getInterfaceIp(iface)) : null,
        server: conn.server,
        connectedAt: conn.connectedAt?.getTime() ?? null,
        configPath: conn.configPath ?? null,
        hasAuthToken: !!conn.authToken,
        options: (conn.options as Record<string, unknown>) ?? null,
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
      publicIp: actualUp ? (conn?.publicIp ?? this.getInterfaceIp(iface)) : null,
      assignedIp: actualUp ? (conn?.assignedIp ?? this.getInterfaceIp(iface)) : null,
      server: conn?.server ?? null,
      connectedAt: conn?.connectedAt?.getTime() ?? null,
      configPath: conn?.configPath ?? null,
      hasAuthToken: !!conn?.authToken,
      options: (conn?.options as Record<string, unknown>) ?? null,
    };
  }

  // ── Split routing (iptables fwmark) ──────────────────────────────────────

  /**
   * Set up policy routing: packets marked with fwmark are routed through the VPN
   * interface. Implements the redteam split-routing design.
   */
  setupSplitRouting(iface: string, fwmark: number = FWMARK_ID): void {
    const mark = `0x${fwmark.toString(16)}`;

    const commands = [
      `ip rule add fwmark ${mark} table ${FWMARK_TABLE} 2>/dev/null || true`,
      `ip route replace default dev ${iface} table ${FWMARK_TABLE}`,
      `iptables -t mangle -C OUTPUT -m owner --uid-owner 1000 -j MARK --set-mark ${mark} 2>/dev/null || ` +
        `iptables -t mangle -A OUTPUT -m owner --uid-owner 1000 -j MARK --set-mark ${mark}`,
    ];

    for (const cmd of commands) {
      try {
        execSync(cmd, { timeout: 5_000, stdio: 'pipe', env: this.buildEnv() });
      } catch {
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
        execSync(cmd, { timeout: 5_000, stdio: 'pipe', env: this.buildEnv() });
      } catch {
        // Non-fatal
      }
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Build env with host tool paths injected.
   * Centralizes PATH construction — no more duplicated env spreads.
   */
  private buildEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      PATH: `${env.HOST_LOCAL_BIN_PATH}:${env.HOST_BIN_PATH}:${env.HOST_SBIN_PATH}:${process.env.PATH}`,
    };
  }

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

  // ── Command builders ────────────────────────────────────────────────────────

  private buildConnectCommand(provider: VpnProvider, opts: VpnConnectOptions, configPath?: string): string {
    switch (provider) {
      case 'wireguard':
        // wg-quick accepts full paths — use uploaded config or default interface name
        return `sudo wg-quick up ${configPath ?? 'wg0'}`;

      case 'openvpn':
        return `sudo openvpn --config ${configPath ?? '/etc/openvpn/client.conf'} --daemon`;

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

  private buildDisconnectCommand(provider: VpnProvider, configPath?: string): string {
    switch (provider) {
      case 'wireguard':
        // Use the same config path for bringing down
        return `sudo wg-quick down ${configPath ?? 'wg0'}`;
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
