/**
 * Traceroute Service — runs traceroute against targets, resolves hop geo-IP
 * coordinates, and emits real-time WebSocket events for map visualization.
 *
 * Uses `mtr --json` for structured output, falls back to parsing `traceroute`.
 * Geo-IP resolution via ip-api.com (free, 45 req/min, batch endpoint).
 */

import { spawn } from 'node:child_process';
import { env } from '../config/env.js';
import { emitTracerouteHop, emitLogEntry } from '../websocket/emitter.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface TracerouteHop {
  hop: number;
  ip: string;
  hostname?: string;
  rtt: number;        // ms
  lat: number;
  lng: number;
  city?: string;
  country?: string;
  asn?: string;
  isp?: string;
}

export interface TracerouteResult {
  target: string;
  scanId?: string;
  hops: TracerouteHop[];
  duration: number;
}

// ── Geo-IP cache (in-memory, persists for process lifetime) ─────────────────

const geoCache = new Map<string, { lat: number; lng: number; city?: string; country?: string; asn?: string; isp?: string }>();

// ── Private IP detection ────────────────────────────────────────────────────

function isPrivateIP(ip: string): boolean {
  if (ip === '*' || ip === '???') return true;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return true;
  // 10.x.x.x, 172.16-31.x.x, 192.168.x.x, 127.x.x.x, 169.254.x.x
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254)
  );
}

// ── Geo-IP resolution via ip-api.com batch endpoint ─────────────────────────

async function resolveGeoIPs(ips: string[]): Promise<void> {
  // Filter to only public IPs not already cached
  const toResolve = ips.filter((ip) => !isPrivateIP(ip) && !geoCache.has(ip));
  if (toResolve.length === 0) return;

  // ip-api.com batch: POST http://ip-api.com/batch with JSON array of IPs
  // Max 100 per request, free for non-commercial
  const batches: string[][] = [];
  for (let i = 0; i < toResolve.length; i += 100) {
    batches.push(toResolve.slice(i, i + 100));
  }

  for (const batch of batches) {
    try {
      const resp = await fetch('http://ip-api.com/batch?fields=query,lat,lon,city,country,as,isp,status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(10_000),
      });

      if (!resp.ok) {
        console.warn(`[Traceroute] Geo-IP batch failed: HTTP ${resp.status}`);
        continue;
      }

      const results = await resp.json() as Array<{
        query: string;
        lat: number;
        lon: number;
        city: string;
        country: string;
        as: string;
        isp: string;
        status: string;
      }>;

      for (const r of results) {
        if (r.status === 'success') {
          geoCache.set(r.query, {
            lat: r.lat,
            lng: r.lon,
            city: r.city,
            country: r.country,
            asn: r.as,
            isp: r.isp,
          });
        }
      }
    } catch (err: any) {
      console.warn(`[Traceroute] Geo-IP batch error: ${err.message}`);
    }
  }
}

// ── MTR JSON output parser ──────────────────────────────────────────────────

interface MtrJsonOutput {
  report: {
    mtr: { src: string; dst: string };
    hubs: Array<{
      count: number;
      host: string;
      Loss?: number;
      Snt?: number;
      Last?: number;
      Avg?: number;
      Best?: number;
      Wrst?: number;
      StDev?: number;
    }>;
  };
}

function parseMtrJson(output: string): Array<{ hop: number; ip: string; rtt: number }> {
  try {
    const data = JSON.parse(output) as MtrJsonOutput;
    return data.report.hubs.map((hub, idx) => ({
      hop: idx + 1,
      ip: hub.host === '???' ? '*' : hub.host,
      rtt: hub.Avg ?? hub.Last ?? 0,
    }));
  } catch {
    return parseMtrText(output);
  }
}

// ── Fallback: parse mtr/traceroute text output ──────────────────────────────

function parseMtrText(output: string): Array<{ hop: number; ip: string; rtt: number }> {
  const hops: Array<{ hop: number; ip: string; rtt: number }> = [];
  const lines = output.split('\n');

  for (const line of lines) {
    // mtr report format: " 1.|-- 10.0.0.1   0.0%   1   1.2  1.2  1.2  1.2  0.0"
    const mtrMatch = line.match(/^\s*(\d+)\.\|--\s+(\S+)\s+[\d.]+%\s+\d+\s+([\d.]+)/);
    if (mtrMatch) {
      hops.push({
        hop: parseInt(mtrMatch[1], 10),
        ip: mtrMatch[2] === '???' ? '*' : mtrMatch[2],
        rtt: parseFloat(mtrMatch[3]) || 0,
      });
      continue;
    }

    // Standard traceroute format: " 1  10.0.0.1 (10.0.0.1)  1.234 ms  1.345 ms  1.456 ms"
    const trMatch = line.match(/^\s*(\d+)\s+(?:(\S+)\s+\((\d+\.\d+\.\d+\.\d+)\)|(\*\s*\*\s*\*))\s+(?:([\d.]+)\s+ms)?/);
    if (trMatch) {
      hops.push({
        hop: parseInt(trMatch[1], 10),
        ip: trMatch[3] || (trMatch[4] ? '*' : trMatch[2] || '*'),
        rtt: parseFloat(trMatch[5] || '0'),
      });
    }
  }

  return hops;
}

// ── Main service ────────────────────────────────────────────────────────────

class TracerouteService {
  /**
   * Run traceroute against a target, resolve geo-IP for each hop,
   * and emit real-time WebSocket events.
   */
  async runTraceroute(target: string, scanId?: string): Promise<TracerouteResult> {
    const host = this.extractHost(target);
    const startTime = Date.now();

    emitLogEntry({
      level: 'INFO',
      source: 'traceroute',
      message: `Starting traceroute to ${host}`,
    });

    // Try mtr --json first, fall back to traceroute
    const rawHops = await this.executeMtr(host);

    if (rawHops.length === 0) {
      emitLogEntry({
        level: 'WARN',
        source: 'traceroute',
        message: `No hops returned for ${host}`,
      });
      return { target, scanId, hops: [], duration: Date.now() - startTime };
    }

    // Collect all non-private IPs for batch geo resolution
    const publicIPs = rawHops
      .map((h) => h.ip)
      .filter((ip) => ip !== '*' && !isPrivateIP(ip));

    await resolveGeoIPs(publicIPs);

    // Build full hop list with geo data
    const hops: TracerouteHop[] = [];
    let lastKnownLat = 0;
    let lastKnownLng = 0;

    for (const raw of rawHops) {
      const geo = geoCache.get(raw.ip);
      let lat: number, lng: number;

      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
        lastKnownLat = lat;
        lastKnownLng = lng;
      } else if (raw.ip === '*' || isPrivateIP(raw.ip)) {
        // Private/unknown hops: interpolate between last known and next known
        lat = lastKnownLat;
        lng = lastKnownLng;
      } else {
        lat = lastKnownLat;
        lng = lastKnownLng;
      }

      const hop: TracerouteHop = {
        hop: raw.hop,
        ip: raw.ip,
        rtt: raw.rtt,
        lat,
        lng,
        city: geo?.city,
        country: geo?.country,
        asn: geo?.asn,
        isp: geo?.isp,
      };

      hops.push(hop);

      // Emit each hop in real-time for animated visualization
      emitTracerouteHop({
        target,
        scanId,
        hop: hop.hop,
        ip: hop.ip,
        rtt: hop.rtt,
        lat: hop.lat,
        lng: hop.lng,
        city: hop.city,
        country: hop.country,
        asn: hop.asn,
        totalHops: rawHops.length,
      });
    }

    const duration = Date.now() - startTime;

    emitLogEntry({
      level: 'INFO',
      source: 'traceroute',
      message: `Traceroute to ${host} complete: ${hops.length} hops in ${Math.round(duration / 1000)}s`,
    });

    return { target, scanId, hops, duration };
  }

  private extractHost(target: string): string {
    try {
      return new URL(target).hostname;
    } catch {
      return target.replace(/:\d+$/, '');
    }
  }

  private async executeMtr(host: string): Promise<Array<{ hop: number; ip: string; rtt: number }>> {
    // Resolve binary from host-mounted paths
    const searchPaths = [
      '/usr/local/bin', '/usr/bin', '/usr/sbin',
      env.HOST_LOCAL_BIN_PATH, env.HOST_BIN_PATH, env.HOST_SBIN_PATH,
    ];

    let mtrBin = 'mtr';
    for (const dir of searchPaths) {
      try {
        const { accessSync } = await import('node:fs');
        accessSync(`${dir}/mtr`);
        mtrBin = `${dir}/mtr`;
        break;
      } catch { continue; }
    }

    return new Promise((resolve) => {
      let output = '';
      const child = spawn(mtrBin, [
        '--report', '--report-cycles', '1', '--no-dns', '--json', host,
      ], {
        timeout: 30_000,
        env: {
          ...process.env,
          PATH: `/usr/local/bin:/usr/bin:/usr/sbin:${env.HOST_LOCAL_BIN_PATH}:${env.HOST_BIN_PATH}:${env.HOST_SBIN_PATH}:${process.env.PATH}`,
        },
      });

      child.stdout?.on('data', (d) => { output += d.toString(); });
      child.stderr?.on('data', (d) => { output += d.toString(); });

      child.on('close', (code) => {
        if (code === 0 || output.trim().length > 0) {
          resolve(parseMtrJson(output));
        } else {
          // Fall back to traceroute
          this.executeTraceroute(host).then(resolve);
        }
      });

      child.on('error', () => {
        // mtr not available, fall back to traceroute
        this.executeTraceroute(host).then(resolve);
      });
    });
  }

  private async executeTraceroute(host: string): Promise<Array<{ hop: number; ip: string; rtt: number }>> {
    return new Promise((resolve) => {
      let output = '';
      const child = spawn('traceroute', ['-n', '-m', '30', '-w', '2', host], {
        timeout: 60_000,
        env: {
          ...process.env,
          PATH: `/usr/local/bin:/usr/bin:/usr/sbin:${process.env.PATH}`,
        },
      });

      child.stdout?.on('data', (d) => { output += d.toString(); });
      child.stderr?.on('data', (d) => { output += d.toString(); });

      child.on('close', () => {
        resolve(parseMtrText(output));
      });

      child.on('error', () => {
        resolve([]);
      });
    });
  }
}

export const tracerouteService = new TracerouteService();
