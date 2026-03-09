/**
 * VPN Rotation Service — pre-generates WireGuard config pools and rotates
 * VPN connections during scans to obfuscate scanner origin IP.
 *
 * Config generation:
 *  - NordVPN: uses `nordgen` pip package (nord-config-generator)
 *  - Mullvad: native TypeScript — fetches relay list from Mullvad API
 *
 * Rotation:
 *  - Swaps `wg-quick down` / `wg-quick up` (~5-10s per rotation)
 *  - Sets up split routing (fwmark) so only tool traffic exits through VPN
 *  - Three strategies: per-tool, periodic (default every 3 tools), phase-based
 *  - Non-fatal: 3 consecutive failures disable rotation for the rest of the scan
 *
 * Checkpoint:
 *  - Serializes rotation state for pause/resume
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { env } from '../config/env.js';
import { prisma } from '../config/database.js';
import { getConfigValue } from '../middleware/guardrails.js';
import { emitVpnRotation, emitLogEntry } from '../websocket/emitter.js';
import { vpnService } from './vpnService.js';

// ── Types ───────────────────────────────────────────────────────────────────

export type RotationStrategy = 'per-tool' | 'periodic' | 'phase-based';

export interface RotationConfig {
  enabled: boolean;
  strategy: RotationStrategy;
  periodicInterval: number;
  providers: ('nordvpn' | 'mullvad')[];
  avoidRecentCount: number;
}

export interface RotationHistoryEntry {
  configFile: string;
  provider: string;
  ip: string | null;
  timestamp: number;
  duration: number;
  toolIndex: number;
  success: boolean;
  error?: string;
}

interface RotationState {
  scanId: string;
  config: RotationConfig;
  history: RotationHistoryEntry[];
  toolsSinceLastRotation: number;
  currentPhase: string;
  currentConfigPath: string | null;
  recentConfigs: string[];
  consecutiveFailures: number;
  disabled: boolean;
}

export interface RotationCheckpoint {
  config: RotationConfig;
  history: RotationHistoryEntry[];
  toolsSinceLastRotation: number;
  currentConfigPath: string | null;
  recentConfigs: string[];
}

// ── Constants ───────────────────────────────────────────────────────────────

const ROTATION_DIR = '/opt/cstrike/data/vpn/rotation';
const NORDVPN_DIR = join(ROTATION_DIR, 'nordvpn');
const MULLVAD_DIR = join(ROTATION_DIR, 'mullvad');
const FWMARK_TABLE = 100;
const FWMARK_ID = 0x29a;
const MAX_CONSECUTIVE_FAILURES = 3;

// ── Service ─────────────────────────────────────────────────────────────────

class VpnRotationService {
  private scanStates = new Map<string, RotationState>();

  // ── Config pool generation ──────────────────────────────────────────────

  /**
   * Generate NordVPN WireGuard configs by calling the NordVPN API directly.
   * 1. Exchange token for WireGuard private key via /v1/users/services/credentials
   * 2. Fetch WireGuard server list via /v1/servers
   * 3. Write flat .conf files to NORDVPN_DIR
   */
  async generateNordConfigs(token: string): Promise<{ count: number; dir: string }> {
    this.ensureDir(NORDVPN_DIR);

    // Step 1: Exchange token for NordLynx private key
    const auth = Buffer.from(`token:${token}`).toString('base64');
    const credResp = await fetch('https://api.nordvpn.com/v1/users/services/credentials', {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!credResp.ok) {
      throw new Error(`NordVPN token rejected (HTTP ${credResp.status})`);
    }
    const creds = (await credResp.json()) as { nordlynx_private_key?: string };
    const privateKey = creds.nordlynx_private_key;
    if (!privateKey) {
      throw new Error('NordVPN API did not return a WireGuard private key — invalid token?');
    }
    console.log('[VPN-ROTATION] NordVPN token validated, private key obtained');

    // Step 2: Fetch WireGuard servers
    const srvResp = await fetch(
      'https://api.nordvpn.com/v1/servers?limit=16384&filters[servers_technologies][identifier]=wireguard_udp',
      { signal: AbortSignal.timeout(30_000) },
    );
    if (!srvResp.ok) {
      throw new Error(`NordVPN server list fetch failed (HTTP ${srvResp.status})`);
    }
    const servers = (await srvResp.json()) as Array<{
      name: string;
      hostname: string;
      station: string;
      load: number;
      locations: Array<{
        country: { name: string; code: string; city: { name: string } };
      }>;
      technologies: Array<{
        identifier: string;
        metadata: Array<{ name: string; value: string }>;
      }>;
    }>;

    // Step 3: Clean existing configs
    for (const f of this.listConfigs(NORDVPN_DIR)) {
      try { unlinkSync(join(NORDVPN_DIR, f)); } catch { /* ignore */ }
    }

    // Step 4: Write flat .conf files — one per server
    let count = 0;
    const seen = new Set<string>();
    for (const srv of servers) {
      // Extract WireGuard public key
      const wgTech = srv.technologies?.find((t) => t.identifier === 'wireguard_udp');
      const pubKeyMeta = wgTech?.metadata?.find((m) => m.name === 'public_key');
      if (!pubKeyMeta?.value) continue;

      const loc = srv.locations?.[0];
      if (!loc) continue;

      const cc = loc.country.code.toLowerCase();
      const city = loc.country.city.name.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
      // Extract server number from name (e.g. "United States #1234" → "1234")
      const numMatch = srv.name.match(/#(\d+)/);
      const num = numMatch ? numMatch[1] : srv.hostname.replace(/\./g, '');
      const filename = `${cc}${num}-${city}.conf`;

      if (seen.has(filename)) continue;
      seen.add(filename);

      // No DNS line — resolvconf not available, VM DNS works fine for scanning
      const content = [
        '[Interface]',
        `PrivateKey = ${privateKey}`,
        'Address = 10.5.0.2/16',
        '',
        '[Peer]',
        `PublicKey = ${pubKeyMeta.value}`,
        'AllowedIPs = 0.0.0.0/0, ::/0',
        `Endpoint = ${srv.hostname}:51820`,
        'PersistentKeepalive = 25',
      ].join('\n');

      writeFileSync(join(NORDVPN_DIR, filename), content, { mode: 0o600 });
      count++;
    }

    console.log(`[VPN-ROTATION] Generated ${count} NordVPN WireGuard configs`);
    return { count, dir: NORDVPN_DIR };
  }

  /**
   * Generate Mullvad WireGuard configs by fetching the relay list from
   * the Mullvad API and writing template .conf files.
   */
  async generateMullvadConfigs(
    address: string,
    privateKey: string,
  ): Promise<{ count: number; dir: string }> {
    this.ensureDir(MULLVAD_DIR);

    // Fetch relay list
    const response = await fetch('https://api.mullvad.net/www/relays/all/');
    if (!response.ok) {
      throw new Error(`Mullvad API returned ${response.status}`);
    }
    const relays = (await response.json()) as Array<{
      hostname: string;
      type: string;
      ipv4_addr_in: string;
      public_key: string;
      city_name: string;
      country_name: string;
      active: boolean;
    }>;

    // Filter for active WireGuard relays
    const wgRelays = relays.filter(
      (r) => r.type === 'wireguard' && r.active && r.ipv4_addr_in && r.public_key,
    );

    if (wgRelays.length === 0) {
      throw new Error('No active WireGuard relays found from Mullvad API');
    }

    // Clean existing configs
    for (const f of this.listConfigs(MULLVAD_DIR)) {
      try { unlinkSync(join(MULLVAD_DIR, f)); } catch { /* ignore */ }
    }

    // Generate .conf files
    let count = 0;
    for (const relay of wgRelays) {
      const sanitizedHost = relay.hostname.replace(/[^a-zA-Z0-9-]/g, '');
      const sanitizedCity = relay.city_name.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
      const filename = `${sanitizedHost}-${sanitizedCity}.conf`;
      // No DNS line — resolvconf not available, VM DNS works fine for scanning
      const content = [
        '[Interface]',
        `PrivateKey = ${privateKey}`,
        `Address = ${address}`,
        '',
        '[Peer]',
        `PublicKey = ${relay.public_key}`,
        'AllowedIPs = 0.0.0.0/0, ::/0',
        `Endpoint = ${relay.ipv4_addr_in}:51820`,
      ].join('\n');

      writeFileSync(join(MULLVAD_DIR, filename), content, { mode: 0o600 });
      count++;
    }

    console.log(`[VPN-ROTATION] Generated ${count} Mullvad WireGuard configs`);
    return { count, dir: MULLVAD_DIR };
  }

  /**
   * Get all available configs in the rotation pool.
   */
  getConfigPool(): { nordvpn: string[]; mullvad: string[] } {
    return {
      nordvpn: existsSync(NORDVPN_DIR) ? this.listConfigs(NORDVPN_DIR) : [],
      mullvad: existsSync(MULLVAD_DIR) ? this.listConfigs(MULLVAD_DIR) : [],
    };
  }

  // ── Scan lifecycle ────────────────────────────────────────────────────────

  /**
   * Initialize rotation state for a new scan. Reads config from ConfigEntry.
   */
  async initForScan(scanId: string): Promise<void> {
    const enabled = await getConfigValue<boolean>('vpn_rotation_enabled', false);
    if (!enabled) return;

    const strategy = await getConfigValue<string>('vpn_rotation_strategy', 'periodic') as RotationStrategy;
    const periodicInterval = await getConfigValue<number>('vpn_rotation_interval', 3);
    const providersRaw = await getConfigValue<string[]>('vpn_rotation_providers', ['nordvpn']);
    const avoidRecentCount = await getConfigValue<number>('vpn_rotation_avoid_recent', 5);

    const providers = providersRaw.filter(
      (p): p is 'nordvpn' | 'mullvad' => p === 'nordvpn' || p === 'mullvad',
    );

    // Validate pool
    const pool = this.getConfigPool();
    const totalConfigs = providers.reduce(
      (sum, p) => sum + (pool[p]?.length ?? 0),
      0,
    );

    if (totalConfigs === 0) {
      emitLogEntry({
        level: 'WARN',
        source: 'vpn-rotation',
        message: 'VPN rotation enabled but no config pool found — rotation disabled for this scan',
      });
      return;
    }

    const config: RotationConfig = {
      enabled: true,
      strategy,
      periodicInterval,
      providers,
      avoidRecentCount,
    };

    this.scanStates.set(scanId, {
      scanId,
      config,
      history: [],
      toolsSinceLastRotation: 0,
      currentPhase: 'RECON',
      currentConfigPath: null,
      recentConfigs: [],
      consecutiveFailures: 0,
      disabled: false,
    });

    emitLogEntry({
      level: 'INFO',
      source: 'vpn-rotation',
      message: `Rotation initialized: strategy=${strategy}, interval=${periodicInterval}, pool=${totalConfigs} configs (${providers.join(', ')})`,
    });

    // Perform initial rotation to start the scan from a random IP
    await this.performRotation(this.scanStates.get(scanId)!, 0);
  }

  /**
   * Check if rotation should occur and execute if so.
   * Called before each tool execution in the orchestrator.
   * Auto-initializes rotation state if missing (e.g., after container restart).
   */
  async shouldRotateAndExecute(scanId: string, toolIndex: number, phase: string): Promise<void> {
    let state = this.scanStates.get(scanId);

    // Auto-initialize if state is missing (container restart wiped in-memory map)
    if (!state) {
      try {
        await this.initForScan(scanId);
        state = this.scanStates.get(scanId);
      } catch (err: any) {
        console.warn(`[VPN-ROTATION] Auto-init failed for scan ${scanId}: ${err.message}`);
      }
      if (!state) return;
    }

    if (!state.config.enabled || state.disabled) return;

    state.toolsSinceLastRotation++;

    if (!this.shouldRotate(state, phase)) return;

    state.currentPhase = phase;
    await this.performRotation(state, toolIndex);
  }

  /**
   * Get rotation history for a scan.
   */
  getHistory(scanId: string): RotationHistoryEntry[] {
    return this.scanStates.get(scanId)?.history ?? [];
  }

  /**
   * Serialize rotation state for checkpoint.
   */
  getCheckpointData(scanId: string): RotationCheckpoint | null {
    const state = this.scanStates.get(scanId);
    if (!state) return null;

    return {
      config: state.config,
      history: state.history,
      toolsSinceLastRotation: state.toolsSinceLastRotation,
      currentConfigPath: state.currentConfigPath,
      recentConfigs: state.recentConfigs,
    };
  }

  /**
   * Restore rotation state from checkpoint (on resume).
   */
  restoreFromCheckpoint(scanId: string, checkpoint: RotationCheckpoint): void {
    this.scanStates.set(scanId, {
      scanId,
      config: checkpoint.config,
      history: checkpoint.history,
      toolsSinceLastRotation: 0, // Reset — first tool after resume triggers rotation
      currentPhase: 'RECON',
      currentConfigPath: checkpoint.currentConfigPath,
      recentConfigs: checkpoint.recentConfigs,
      consecutiveFailures: 0,
      disabled: false,
    });

    emitLogEntry({
      level: 'INFO',
      source: 'vpn-rotation',
      message: `Rotation state restored from checkpoint (${checkpoint.history.length} prior rotations)`,
    });
  }

  /**
   * Clean up when a scan completes or is cancelled.
   */
  cleanupScan(scanId: string): void {
    const state = this.scanStates.get(scanId);
    if (!state) return;

    // Tear down WireGuard if we have an active config
    if (state.currentConfigPath) {
      try {
        execSync('wg-quick down wg0 2>/dev/null || true', {
          timeout: 10_000,
          stdio: 'pipe',
          env: this.buildEnv(),
        });
      } catch { /* best effort */ }

      // Tear down split routing
      vpnService.teardownSplitRouting('wg0', FWMARK_ID);
    }

    this.scanStates.delete(scanId);
  }

  // ── Core rotation logic ───────────────────────────────────────────────────

  private shouldRotate(state: RotationState, phase: string): boolean {
    switch (state.config.strategy) {
      case 'per-tool':
        return true;
      case 'periodic':
        return state.toolsSinceLastRotation >= state.config.periodicInterval;
      case 'phase-based':
        return phase !== state.currentPhase;
      default:
        return false;
    }
  }

  private async performRotation(state: RotationState, toolIndex: number): Promise<void> {
    const startTime = Date.now();
    const nextConfig = this.selectNextConfig(state);

    if (!nextConfig) {
      emitLogEntry({
        level: 'WARN',
        source: 'vpn-rotation',
        message: 'No available configs in pool — skipping rotation',
      });
      return;
    }

    const oldIp = this.getCurrentPublicIp();
    let newIp: string | null = null;
    let success = false;
    let error: string | undefined;

    try {
      // ── Kill-switch: DROP all uid 1000 outbound traffic during rotation ──
      // This prevents ANY traffic leak through the direct connection while
      // wg0 is down and split routing rules are being re-established.
      try {
        execSync(
          'iptables -I OUTPUT -m owner --uid-owner 1000 -j DROP 2>/dev/null || true',
          { timeout: 3_000, stdio: 'pipe', env: this.buildEnv() },
        );
      } catch { /* non-critical */ }

      // Always tear down wg0 before rotation — it may exist from a manual
      // VPN connect or a previous rotation. wg-quick fails if wg0 already exists.
      try {
        execSync('wg-quick down wg0 2>/dev/null || true', {
          timeout: 10_000,
          stdio: 'pipe',
          env: this.buildEnv(),
        });
      } catch { /* interface may already be down */ }
      // Force-remove lingering interface (wg-quick down can fail silently)
      try {
        execSync('ip link del wg0 2>/dev/null || true', {
          timeout: 3_000,
          stdio: 'pipe',
          env: this.buildEnv(),
        });
      } catch { /* already gone */ }
      // Brief pause for interface teardown
      await this.sleep(500);

      // Copy next config to /etc/wireguard/wg0.conf
      // Strip DNS (no resolvconf) and add Table=off (split routing handled separately)
      mkdirSync('/etc/wireguard', { recursive: true });
      const rawConf = readFileSync(nextConfig, 'utf-8');
      const lines = rawConf.split('\n').filter((l) => !l.trim().startsWith('DNS'));
      const ifaceIdx = lines.findIndex((l) => l.trim() === '[Interface]');
      if (ifaceIdx >= 0) lines.splice(ifaceIdx + 1, 0, 'Table = off');
      writeFileSync('/etc/wireguard/wg0.conf', lines.join('\n'), { mode: 0o600 });
      execSync('wg-quick up wg0', {
        timeout: 15_000,
        stdio: 'pipe',
        env: this.buildEnv(),
      });

      // Wait for wg0 interface
      await this.waitForInterface('wg0', 10_000);

      // Set up split routing (this flushes mangle OUTPUT and re-adds rules)
      vpnService.setupSplitRouting('wg0', FWMARK_ID);

      // ── Remove kill-switch: split routing is now active, traffic can flow ──
      try {
        execSync(
          'iptables -D OUTPUT -m owner --uid-owner 1000 -j DROP 2>/dev/null || true',
          { timeout: 3_000, stdio: 'pipe', env: this.buildEnv() },
        );
      } catch { /* non-critical */ }

      // Resolve new public IP
      newIp = this.getCurrentPublicIp();
      success = true;
      state.consecutiveFailures = 0;
      state.currentConfigPath = nextConfig;
      state.toolsSinceLastRotation = 0;

      // Update recent configs (circular buffer)
      state.recentConfigs.push(nextConfig);
      if (state.recentConfigs.length > state.config.avoidRecentCount) {
        state.recentConfigs.shift();
      }

      const configName = basename(nextConfig);
      const provider = nextConfig.includes('/nordvpn/') ? 'nordvpn' : 'mullvad';
      const duration = Date.now() - startTime;

      // Update DB publicIp so the VPN status endpoint and battle map have the current exit IP
      if (newIp) {
        try {
          await prisma.vpnConnection.updateMany({
            where: { status: 'CONNECTED', interface: 'wg0' },
            data: { publicIp: newIp },
          });
        } catch { /* non-critical */ }
      }

      console.log(
        `[VPN-ROTATION] wg0: ${state.history.length > 0 ? basename(state.history[state.history.length - 1].configFile) : 'none'} → ${configName} (IP: ${oldIp} → ${newIp}) [${(duration / 1000).toFixed(1)}s]`,
      );

      emitVpnRotation({
        scanId: state.scanId,
        configFile: configName,
        provider,
        oldIp,
        newIp,
        duration,
        rotationIndex: state.history.length,
        success: true,
      });

      state.history.push({
        configFile: configName,
        provider,
        ip: newIp,
        timestamp: Date.now(),
        duration,
        toolIndex,
        success: true,
      });
    } catch (err: any) {
      state.consecutiveFailures++;
      error = err.message || String(err);
      const duration = Date.now() - startTime;

      emitLogEntry({
        level: 'WARN',
        source: 'vpn-rotation',
        message: `Rotation failed (${state.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${error}`,
      });

      emitVpnRotation({
        scanId: state.scanId,
        configFile: basename(nextConfig),
        provider: nextConfig.includes('/nordvpn/') ? 'nordvpn' : 'mullvad',
        oldIp,
        newIp: null,
        duration,
        rotationIndex: state.history.length,
        success: false,
        error,
      });

      state.history.push({
        configFile: basename(nextConfig),
        provider: nextConfig.includes('/nordvpn/') ? 'nordvpn' : 'mullvad',
        ip: null,
        timestamp: Date.now(),
        duration,
        toolIndex,
        success: false,
        error,
      });

      // If this config failed, try a different one
      if (state.consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
        emitLogEntry({
          level: 'INFO',
          source: 'vpn-rotation',
          message: 'Retrying rotation with a different config...',
        });
        // Add the failed config to recent to avoid retrying it
        state.recentConfigs.push(nextConfig);
        return this.performRotation(state, toolIndex);
      }

      // Too many failures — disable rotation for this scan
      state.disabled = true;

      // Remove kill-switch so tools can still run (via direct or existing VPN)
      try {
        execSync(
          'iptables -D OUTPUT -m owner --uid-owner 1000 -j DROP 2>/dev/null || true',
          { timeout: 3_000, stdio: 'pipe', env: this.buildEnv() },
        );
      } catch { /* non-critical */ }

      emitLogEntry({
        level: 'ERROR',
        source: 'vpn-rotation',
        message: `${MAX_CONSECUTIVE_FAILURES} consecutive rotation failures — rotation disabled for remainder of scan`,
      });
    }
  }

  /**
   * Select next config from pool, avoiding recently used ones.
   * Picks randomly from all configured providers.
   */
  private selectNextConfig(state: RotationState): string | null {
    const pool = this.getConfigPool();
    const recentSet = new Set(state.recentConfigs.map((c) => basename(c)));

    // Build candidate list from all configured providers
    const candidates: string[] = [];
    for (const provider of state.config.providers) {
      const dir = provider === 'nordvpn' ? NORDVPN_DIR : MULLVAD_DIR;
      const files = pool[provider] ?? [];
      for (const file of files) {
        if (!recentSet.has(file)) {
          candidates.push(join(dir, file));
        }
      }
    }

    if (candidates.length === 0) {
      // All configs recently used — clear recent and try again
      state.recentConfigs = [];
      return this.selectNextConfig(state);
    }

    // Random selection
    const idx = Math.floor(Math.random() * candidates.length);
    return candidates[idx];
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private getCurrentPublicIp(): string | null {
    try {
      // Run as uid 1000 so traffic goes through VPN via fwmark routing
      return execSync("su -s /bin/sh -c 'curl -s --max-time 5 https://ifconfig.me 2>/dev/null' node", {
        timeout: 10_000,
        encoding: 'utf-8',
        env: this.buildEnv(),
      }).trim() || null;
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

  private isInterfaceUp(iface: string): boolean {
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      PATH: `${env.HOST_LOCAL_BIN_PATH}:${env.HOST_BIN_PATH}:${env.HOST_SBIN_PATH}:${process.env.PATH}`,
    };
  }

  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  private listConfigs(dir: string): string[] {
    try {
      return readdirSync(dir).filter((f) => f.endsWith('.conf')).sort();
    } catch {
      return [];
    }
  }
}

export const vpnRotationService = new VpnRotationService();
