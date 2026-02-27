/**
 * safeTargetPath — sanitize user-supplied target strings before they are
 * embedded in file system paths (report directories, wordlist overrides, etc).
 *
 * The platform uses target URLs as directory names when writing scan reports
 * and tool output. Without sanitization an attacker could supply something like
 * "../../etc/passwd" and escape the intended output directory.
 *
 * This module is intentionally narrowly scoped: it does NOT validate whether a
 * target is in scope (that is handled by guardrails.ts). It only makes a string
 * safe to embed in a file system path.
 */

import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

// Characters that are safe in a file-system path component on Linux/macOS.
// We allow alphanumeric, dot, hyphen, and underscore.
const SAFE_SEGMENT_RE = /[^a-zA-Z0-9._-]/g;

/**
 * Derive a filesystem-safe directory name from a target string.
 *
 * Strategy:
 * 1. Extract the hostname from a URL if possible.
 * 2. Strip all characters that are not alphanumeric, '.', '-', or '_'.
 * 3. Truncate to 128 characters.
 * 4. If the result is empty after sanitization (e.g. purely special-char input)
 *    fall back to a SHA-256 hex digest of the original value.
 *
 * @example
 *   safeTargetPath('https://example.com')       // 'example.com'
 *   safeTargetPath('https://example.com:8443')  // 'example.com'
 *   safeTargetPath('../../etc/passwd')           // 'etcpasswd'  (traversal stripped)
 *   safeTargetPath('192.168.1.100')              // '192.168.1.100'
 *   safeTargetPath('!!@@##')                     // sha256 hex fallback
 */
export function safeTargetPath(target: string): string {
  if (!target || typeof target !== 'string') {
    throw new TypeError('safeTargetPath: target must be a non-empty string');
  }

  let candidate = target.trim();

  // 1. If it looks like a URL, extract the hostname only.
  if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
    try {
      candidate = new URL(candidate).hostname;
    } catch {
      // Not a valid URL — fall through and sanitize the raw string.
    }
  }

  // 2. Strip unsafe characters.
  const sanitized = candidate.replace(SAFE_SEGMENT_RE, '').slice(0, 128);

  // 3. If nothing remains after sanitization use a hash of the original.
  if (sanitized.length === 0) {
    return createHash('sha256').update(target).digest('hex').slice(0, 32);
  }

  return sanitized;
}

/**
 * Resolve a scan output path and assert it stays within the intended root.
 *
 * @param root   The absolute base directory (e.g. /opt/cstrike/reports).
 * @param target The user-supplied target string.
 * @param suffix Optional file name to append (also sanitized).
 * @returns      The resolved absolute path.
 * @throws       If the resolved path escapes `root`.
 *
 * @example
 *   resolveTargetPathSync('/opt/reports', 'https://example.com', 'nmap.txt')
 *   // '/opt/reports/example.com/nmap.txt'
 */
export function resolveTargetPathSync(root: string, target: string, suffix?: string): string {
  const safeDir = safeTargetPath(target);
  const parts: string[] = [root, safeDir];

  if (suffix) {
    // Strip path separators from the suffix component.
    const safeSuffix = suffix.replace(/[/\\]/g, '_').replace(SAFE_SEGMENT_RE, '');
    if (safeSuffix.length === 0) {
      throw new Error(
        `resolveTargetPathSync: suffix "${suffix}" contains no safe characters`,
      );
    }
    parts.push(safeSuffix);
  }

  const resolved = resolve(join(...parts));
  const normalizedRoot = resolve(root);

  // Guard against path traversal even after sanitization.
  if (!resolved.startsWith(normalizedRoot + '/') && resolved !== normalizedRoot) {
    throw new Error(
      `resolveTargetPathSync: resolved path "${resolved}" escapes root "${normalizedRoot}"`,
    );
  }

  return resolved;
}
