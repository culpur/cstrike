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
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
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
  nordvpn: 'wg0',       // WireGuard via nordgen config pool (no CLI)
  mullvad: 'wg0',         // WireGuard via Mullvad config pool
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
      if (provider === 'nordvpn') {
        // NordVPN: validate token by exchanging for WireGuard key + generate config pool
        const { vpnRotationService } = await import('./vpnRotationService.js');
        const result = await vpnRotationService.generateNordConfigs(authToken);
        console.log(`[VPN] NordVPN token validated — ${result.count} WireGuard configs generated`);
      } else if (provider === 'mullvad') {
        // Mullvad: authToken = WireGuard address, options.privateKey = WireGuard private key
        // Generate config pool from Mullvad relay API
        const privateKey = options?.privateKey as string | undefined;
        if (!privateKey) throw new Error('Mullvad requires both WireGuard address and private key');
        const { vpnRotationService } = await import('./vpnRotationService.js');
        const result = await vpnRotationService.generateMullvadConfigs(authToken, privateKey);
        console.log(`[VPN] Mullvad validated — ${result.count} WireGuard configs generated`);
      } else {
        // Tailscale: use CLI
        const cmd = this.buildAuthCommand(provider, authToken, options);
        execSync(cmd, {
          timeout: 30_000,
          stdio: 'pipe',
          env: this.buildEnv(),
        });
      }

      // Store auth token and options in DB (also refresh interface name)
      await prisma.vpnConnection.upsert({
        where: { provider },
        update: {
          authToken,
          interface: iface,
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
        let cmd = `tailscale up --authkey=${authToken} --reset`;
        if (options?.exitNode) cmd += ' --advertise-exit-node';
        if (options?.acceptRoutes) cmd += ' --accept-routes';
        if (options?.hostname) cmd += ` --hostname=${options.hostname}`;
        return cmd;
      }
      case 'nordvpn':
        return `nordvpn login --token ${authToken}`;
      case 'mullvad':
        return `mullvad account login ${authToken}`;
      default:
        throw new Error(`No auth command for provider: ${provider}`);
    }
  }

  /**
   * Check if a provider's CLI is currently logged in.
   * Returns true if authenticated, false otherwise.
   */
  async checkProviderLoginStatus(provider: VpnProvider): Promise<boolean> {
    try {
      switch (provider) {
        case 'nordvpn': {
          // NordVPN: check if we have a stored auth token and generated configs
          // The nordvpn CLI is not installed — we use nordgen (pip package) instead
          const conn = await prisma.vpnConnection.findUnique({ where: { provider: 'nordvpn' } });
          return !!(conn?.authToken);
        }
        case 'mullvad': {
          // Mullvad: check if we have a stored auth token and generated configs (no CLI needed)
          const mConn = await prisma.vpnConnection.findUnique({ where: { provider: 'mullvad' } });
          return !!(mConn?.authToken);
        }
        case 'tailscale': {
          const out = execSync('tailscale status 2>&1', {
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
      const out = execSync('tailscale ip -4 2>/dev/null', {
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
      if (!(await this.checkProviderLoginStatus(provider)) && existing?.authToken) {
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
      let configPath = existing?.configPath ?? undefined;
      let effectiveIface = iface;

      // WireGuard-based providers: NordVPN, Mullvad, generic WireGuard
      // All use wg-quick with /etc/wireguard/wg0.conf (Table=off, DNS stripped)
      if (provider === 'nordvpn' || provider === 'mullvad' || provider === 'wireguard') {
        let srcConfig: string | undefined;
        let serverLabel: string | undefined;

        if (provider === 'nordvpn' || provider === 'mullvad') {
          const { vpnRotationService } = await import('./vpnRotationService.js');
          const pool = vpnRotationService.getConfigPool();
          const providerPool = provider === 'nordvpn' ? pool.nordvpn : pool.mullvad;
          const providerDir = provider === 'nordvpn'
            ? '/opt/cstrike/data/vpn/rotation/nordvpn'
            : '/opt/cstrike/data/vpn/rotation/mullvad';

          if (providerPool.length === 0) {
            return { success: false, provider, status: 'error', error: `No ${provider} WireGuard configs generated — authenticate first to generate config pool` };
          }

          let selectedConfig: string;
          if (opts.server) {
            const match = providerPool.find((f) => f.toLowerCase().includes(opts.server!.toLowerCase()));
            selectedConfig = match ?? providerPool[Math.floor(Math.random() * providerPool.length)];
          } else {
            selectedConfig = providerPool[Math.floor(Math.random() * providerPool.length)];
          }

          srcConfig = `${providerDir}/${selectedConfig}`;
          serverLabel = selectedConfig.replace(/\.conf$/, '');
        } else {
          // Generic WireGuard: use uploaded config
          if (!configPath) {
            return { success: false, provider, status: 'error', error: 'No WireGuard config file uploaded — upload a .conf file first' };
          }
          srcConfig = configPath;
        }

        effectiveIface = 'wg0';

        // Copy to /etc/wireguard/wg0.conf with DNS stripped and Table=off
        mkdirSync('/etc/wireguard', { recursive: true });
        const wgConf = '/etc/wireguard/wg0.conf';
        const rawConf = readFileSync(srcConfig, 'utf-8');
        const lines = rawConf.split('\n').filter((l) => !l.trim().startsWith('DNS'));
        if (!lines.some((l) => l.trim().startsWith('Table'))) {
          const ifaceIdx = lines.findIndex((l) => l.trim() === '[Interface]');
          if (ifaceIdx >= 0) lines.splice(ifaceIdx + 1, 0, 'Table = off');
        }
        writeFileSync(wgConf, lines.join('\n'), { mode: 0o600 });
        configPath = wgConf;

        // Tear down any existing wg0 first (prevents "wg0 already exists" errors)
        try {
          execSync('wg-quick down wg0 2>/dev/null || ip link del wg0 2>/dev/null || true', {
            timeout: 10_000, stdio: 'pipe', env: this.buildEnv(),
          });
        } catch { /* not running */ }

        execSync('wg-quick up wg0', {
          timeout: 30_000,
          stdio: 'pipe',
          env: this.buildEnv(),
        });

        await prisma.vpnConnection.update({
          where: { provider },
          data: { configPath: wgConf, ...(serverLabel ? { server: serverLabel } : {}) },
        });
      } else {
        // Non-WireGuard providers: openvpn, tailscale
        const cmd = this.buildConnectCommand(provider, opts, configPath);
        execSync(cmd, {
          timeout: 30_000,
          stdio: 'pipe',
          env: this.buildEnv(),
        });
      }

      // Give the interface time to come up
      await this.waitForInterface(effectiveIface, 10_000);

      // Get assigned IP — Tailscale uses its own command
      let assignedIp: string | null;
      if (provider === 'tailscale') {
        assignedIp = this.getTailscaleIp() ?? this.getInterfaceIp(effectiveIface);
      } else {
        assignedIp = this.getInterfaceIp(effectiveIface);
      }

      // Set up split routing FIRST (before public IP resolution) so uid 1000
      // traffic goes through VPN when we resolve the exit IP
      let shouldSplit = opts.splitRouting ?? false;
      if (!shouldSplit) {
        try {
          const entry = await prisma.configEntry.findUnique({ where: { key: 'vpn_split_routing_enabled' } });
          shouldSplit = entry?.value === true;
        } catch { /* non-critical */ }
      }
      if (shouldSplit) {
        this.setupSplitRouting(effectiveIface, FWMARK_ID);
      }

      // Resolve public exit IP through VPN — run as uid 1000 (fwmark-routed
      // through wg0) instead of --interface which breaks DNS resolution
      let publicIp: string | null = null;
      try {
        if (shouldSplit) {
          // uid 1000 traffic goes through VPN via fwmark routing
          publicIp = execSync(`su -s /bin/sh -c 'curl -s --max-time 5 https://ifconfig.me 2>/dev/null' node`, {
            timeout: 10_000,
            encoding: 'utf-8',
            env: this.buildEnv(),
          }).trim() || null;
        } else {
          // No split routing — try --interface as fallback
          publicIp = execSync(`curl -s --max-time 5 --interface ${effectiveIface} ifconfig.me 2>/dev/null`, {
            timeout: 8_000,
            encoding: 'utf-8',
            env: this.buildEnv(),
          }).trim() || null;
        }
      } catch { /* non-critical */ }

      await prisma.vpnConnection.update({
        where: { provider },
        data: {
          status: 'CONNECTED',
          interface: effectiveIface,
          assignedIp,
          publicIp,
          connectedAt: new Date(),
        },
      });

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
   * Check if split routing is currently active by looking for the MARK rule.
   */
  isSplitRoutingActive(): boolean {
    try {
      const out = execSync(
        `iptables -t mangle -S OUTPUT 2>/dev/null | grep -- '--set-xmark 0x29a'`,
        { timeout: 3_000, encoding: 'utf-8', stdio: 'pipe', env: this.buildEnv() },
      );
      return out.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Set up policy routing: packets marked with fwmark are routed through the VPN
   * interface. Implements the redteam split-routing design.
   */
  setupSplitRouting(iface: string, fwmark: number = FWMARK_ID): void {
    const mark = `0x${fwmark.toString(16)}`;

    // Read DNS server to exclude from VPN routing
    let dnsServer: string | null = null;
    try {
      const resolv = readFileSync('/etc/resolv.conf', 'utf-8');
      const m = resolv.match(/^nameserver\s+(\S+)/m);
      if (m) dnsServer = m[1];
    } catch { /* use fallback exclusions */ }

    // Get VPN interface IP for source routing (packets must come FROM the wg address)
    const vpnIp = this.getInterfaceIp(iface);

    // Get WireGuard endpoint + default gateway to prevent routing loop.
    // WireGuard inherits fwmark from inner packets to outer UDP, so without an
    // explicit route, the outer encrypted packets get routed back through wg0.
    const { endpointIp, gateway, gatewayDev } = this.getWgEndpointAndGateway(iface);

    const commands = [
      // ── Clean up stale rules from previous calls ──
      // Remove ALL existing fwmark ip rules (prevents duplicates after restarts)
      `while ip rule del fwmark ${mark} table ${FWMARK_TABLE} 2>/dev/null; do :; done`,

      // Policy routing: marked packets → table with VPN default route
      `ip rule add fwmark ${mark} table ${FWMARK_TABLE}`,
      // Source IP must be the VPN address so the peer accepts the traffic
      vpnIp
        ? `ip route replace default dev ${iface} src ${vpnIp} table ${FWMARK_TABLE}`
        : `ip route replace default dev ${iface} table ${FWMARK_TABLE}`,

      // Prevent routing loop: WireGuard outer UDP must go via default gateway,
      // not back through wg0. The /32 route is more specific than the default.
      ...(endpointIp && gateway && gatewayDev
        ? [`ip route replace ${endpointIp}/32 via ${gateway} dev ${gatewayDev} table ${FWMARK_TABLE}`]
        : []),

      // Flush existing mangle OUTPUT rules (clean slate)
      `iptables -t mangle -F OUTPUT 2>/dev/null || true`,

      // Exclude local/management traffic from marking (RETURN = skip)
      `iptables -t mangle -A OUTPUT -d 127.0.0.0/8 -j RETURN`,
      `iptables -t mangle -A OUTPUT -d 10.0.0.0/8 -j RETURN`,
      `iptables -t mangle -A OUTPUT -d 172.16.0.0/12 -j RETURN`,
      `iptables -t mangle -A OUTPUT -d 192.168.0.0/16 -j RETURN`,
      `iptables -t mangle -A OUTPUT -d 100.64.0.0/10 -j RETURN`,  // Tailscale CGNAT
      ...(dnsServer ? [`iptables -t mangle -A OUTPUT -d ${dnsServer} -j RETURN`] : []),

      // MSS clamping: uid 1000 SYN packets get MSS based on enp0s1 (1460) during
      // initial routing, then fwmark re-routes them through wg0 (MTU 1420). Without
      // clamping, the server sends segments too large for the WireGuard tunnel,
      // breaking TLS handshakes (Server Hello + certs exceed the tunnel MTU).
      `iptables -t mangle -A OUTPUT -m owner --uid-owner 1000 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1280`,

      // Mark all remaining uid 1000 traffic → routed through VPN
      `iptables -t mangle -A OUTPUT -m owner --uid-owner 1000 -j MARK --set-mark ${mark}`,

      // Flush old MASQUERADE rules for this interface, then add fresh one.
      // NAT POSTROUTING is NOT flushed entirely (Docker adds its own rules).
      `while iptables -t nat -D POSTROUTING -o ${iface} -j MASQUERADE 2>/dev/null; do :; done`,

      // MASQUERADE: rewrite source IP to VPN address for outgoing packets.
      `iptables -t nat -A POSTROUTING -o ${iface} -j MASQUERADE`,

      // NOTE: We do NOT add a filter OUTPUT DROP on enp0s1 for uid 1000 here.
      // That approach kills fwmark-routed packets before re-routing can happen
      // (filter runs after mangle but before policy routing redirect).
      // Instead, raw socket tools (masscan, nmap, rustscan) are bound directly
      // to wg0 via --adapter / -e flags in toolExecutor.ts.
    ];

    for (const cmd of commands) {
      try {
        execSync(cmd, { timeout: 5_000, stdio: 'pipe', env: this.buildEnv() });
      } catch {
        console.warn(`[VPN] Split routing command failed: ${cmd}`);
      }
    }

    console.log(`[VPN] Split routing via ${iface} active (fwmark=${mark}, endpoint=${endpointIp}, dns=${dnsServer})`);
  }

  /**
   * Remove split-routing rules for an interface.
   */
  teardownSplitRouting(iface: string, fwmark: number = FWMARK_ID): void {
    const mark = `0x${fwmark.toString(16)}`;

    const commands = [
      // Remove all fwmark ip rules
      `while ip rule del fwmark ${mark} table ${FWMARK_TABLE} 2>/dev/null; do :; done`,
      `ip route flush table ${FWMARK_TABLE} 2>/dev/null || true`,
      `iptables -t mangle -F OUTPUT 2>/dev/null || true`,
      // Only remove VPN MASQUERADE rules — DO NOT flush entire chain
      // (Docker adds its own bridge MASQUERADE rules that must be preserved)
      `while iptables -t nat -D POSTROUTING -o ${iface} -j MASQUERADE 2>/dev/null; do :; done`,
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

  /**
   * Get WireGuard endpoint IP and default gateway for routing loop prevention.
   * WireGuard inherits fwmark from inner to outer SKBs, so the encrypted UDP
   * must be explicitly routed through the physical interface.
   */
  private getWgEndpointAndGateway(iface: string): {
    endpointIp: string | null;
    gateway: string | null;
    gatewayDev: string | null;
  } {
    let endpointIp: string | null = null;
    let gateway: string | null = null;
    let gatewayDev: string | null = null;

    try {
      const endpoints = execSync(`wg show ${iface} endpoints 2>/dev/null`, {
        timeout: 3_000, encoding: 'utf-8', stdio: 'pipe', env: this.buildEnv(),
      });
      // Format: "<pubkey>\t<ip>:<port>"
      const epMatch = endpoints.match(/\t(\d+\.\d+\.\d+\.\d+):\d+/);
      if (epMatch) endpointIp = epMatch[1];
    } catch { /* non-fatal */ }

    try {
      const route = execSync('ip -4 route show default 2>/dev/null', {
        timeout: 3_000, encoding: 'utf-8', stdio: 'pipe', env: this.buildEnv(),
      });
      // Format: "default via <gw> dev <dev> ..."
      const gwMatch = route.match(/via\s+(\S+)\s+dev\s+(\S+)/);
      if (gwMatch) {
        gateway = gwMatch[1];
        gatewayDev = gwMatch[2];
      }
    } catch { /* non-fatal */ }

    return { endpointIp, gateway, gatewayDev };
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
      case 'openvpn':
        return `openvpn --config ${configPath ?? '/etc/openvpn/client.conf'} --daemon`;

      case 'tailscale':
        return opts.server
          ? `tailscale up --exit-node=${opts.server}`
          : 'tailscale up';

      // WireGuard-based providers are handled inline in connect() — should never reach here
      case 'wireguard':
      case 'nordvpn':
      case 'mullvad':
        throw new Error(`${provider} connect is handled via wg-quick inline, not buildConnectCommand`);

      default:
        throw new Error(`Unknown VPN provider: ${provider}`);
    }
  }

  private buildDisconnectCommand(provider: VpnProvider, _configPath?: string): string {
    switch (provider) {
      case 'wireguard':
      case 'nordvpn':
      case 'mullvad':
        // All WireGuard-based providers use wg0 interface
        return 'wg-quick down wg0';
      case 'openvpn':
        return 'pkill -TERM openvpn';
      case 'tailscale':
        return 'tailscale down';
      default:
        throw new Error(`Unknown VPN provider: ${provider}`);
    }
  }
}

export const vpnService = new VpnService();
