/**
 * Zod schemas for VPN connection routes.
 * Covers: connect, disconnect, provider param.
 */

import { z } from 'zod';

// ── Enums (mirror Prisma) ────────────────────────────────────────────────────

export const VpnStatusSchema = z.enum([
  'CONNECTED',
  'CONNECTING',
  'DISCONNECTED',
  'ERROR',
]);

/**
 * VPN providers the platform manages. The vpn.ts route uses a switch
 * statement on provider — unknown values reach the default branch and throw.
 * Validating here gives callers a clean 400 before that happens.
 */
export const VpnProviderSchema = z.enum([
  'wireguard',
  'openvpn',
  'tailscale',
  'nordvpn',
  'mullvad',
]);

export type VpnProvider = z.infer<typeof VpnProviderSchema>;

// ── Route param ──────────────────────────────────────────────────────────────

export const VpnProviderParamSchema = z.object({
  provider: VpnProviderSchema,
});

export type VpnProviderParam = z.infer<typeof VpnProviderParamSchema>;

// ── Connect ──────────────────────────────────────────────────────────────────

export const VpnConnectSchema = z.object({
  /**
   * For nordvpn: a region/city string (e.g. "us-newyork").
   * For mullvad: a --location value (e.g. "se-got-wg-001").
   * Not used by wireguard/openvpn/tailscale.
   */
  server: z.string().max(256).optional(),
  /**
   * For wireguard: the wg-quick config name (default "wg0").
   * For openvpn: path to the .conf or .ovpn file.
   * Not used by other providers.
   */
  config: z
    .string()
    .max(512)
    .regex(
      /^[a-zA-Z0-9_./-]+$/,
      'config must be an alphanumeric filename or path — no shell metacharacters',
    )
    .optional(),
});

export type VpnConnectBody = z.infer<typeof VpnConnectSchema>;

// ── Disconnect ───────────────────────────────────────────────────────────────

/**
 * Disconnect takes no body. This empty schema is exported so route handlers
 * can pass it to validateRequest for consistency.
 */
export const VpnDisconnectSchema = z.object({});

export type VpnDisconnectBody = z.infer<typeof VpnDisconnectSchema>;
