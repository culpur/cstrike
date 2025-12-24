/**
 * CStrike Web UI - Utility Functions
 */

import type { LogLevel, PhaseType } from '@/types';

// ============================================================================
// Classname Utilities
// ============================================================================

/**
 * Conditionally join classnames together
 */
export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ============================================================================
// Time & Date Utilities
// ============================================================================

/**
 * Format timestamp to readable time string
 */
export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Format timestamp to readable date and time
 */
export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Get relative time string (e.g., "2 minutes ago")
 */
export function getRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Format uptime in seconds to readable string
 */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// ============================================================================
// Number Formatting
// ============================================================================

/**
 * Format number with appropriate suffix (K, M, B)
 */
export function formatNumber(num: number): string {
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

/**
 * Format percentage with specified decimal places
 */
export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format bytes to readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

// ============================================================================
// String Utilities
// ============================================================================

/**
 * Truncate string to specified length with ellipsis
 */
export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return `${str.slice(0, length)}...`;
}

/**
 * Generate unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Sanitize HTML to prevent XSS
 */
export function sanitizeHtml(html: string): string {
  const div = document.createElement('div');
  div.textContent = html;
  return div.innerHTML;
}

// ============================================================================
// Status & Phase Utilities
// ============================================================================

/**
 * Get color class for log level
 */
export function getLogLevelColor(level: LogLevel): string {
  switch (level) {
    case 'DEBUG':
      return 'text-grok-text-muted';
    case 'INFO':
      return 'text-grok-info';
    case 'WARN':
      return 'text-grok-warning';
    case 'ERROR':
      return 'text-grok-error';
    case 'CRITICAL':
      return 'text-grok-exploit-red';
    default:
      return 'text-grok-text-body';
  }
}

/**
 * Get color class for phase
 */
export function getPhaseColor(phase: PhaseType): string {
  switch (phase) {
    case 'recon':
      return 'text-grok-recon-blue';
    case 'ai':
      return 'text-grok-ai-purple';
    case 'zap':
    case 'metasploit':
      return 'text-grok-warning';
    case 'exploit':
      return 'text-grok-exploit-red';
    case 'idle':
      return 'text-grok-text-muted';
    default:
      return 'text-grok-text-body';
  }
}

/**
 * Get display name for phase
 */
export function getPhaseDisplayName(phase: PhaseType): string {
  switch (phase) {
    case 'recon':
      return 'Reconnaissance';
    case 'ai':
      return 'AI Analysis';
    case 'zap':
      return 'ZAP Scan';
    case 'metasploit':
      return 'Metasploit';
    case 'exploit':
      return 'Exploitation';
    case 'idle':
      return 'Idle';
    default:
      return phase;
  }
}

// ============================================================================
// Data Export Utilities
// ============================================================================

/**
 * Export data as JSON file
 */
export function exportAsJson(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, `${filename}.json`);
}

/**
 * Export data as CSV file
 */
export function exportAsCsv(
  data: Record<string, unknown>[],
  filename: string,
  headers?: string[]
): void {
  if (data.length === 0) return;

  const keys = headers || Object.keys(data[0]);
  const csv = [
    keys.join(','),
    ...data.map(row => keys.map(key => {
      const value = row[key];
      const str = value === null || value === undefined ? '' : String(value);
      return str.includes(',') ? `"${str}"` : str;
    }).join(','))
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  downloadBlob(blob, `${filename}.csv`);
}

/**
 * Download blob as file
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validate IP address format
 */
export function isValidIp(ip: string): boolean {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Regex.test(ip)) return false;
  return ip.split('.').every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
}

/**
 * Validate URL format
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate port number
 */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

// ============================================================================
// Array Utilities
// ============================================================================

/**
 * Group array items by key
 */
export function groupBy<T>(
  array: T[],
  key: keyof T
): Record<string, T[]> {
  return array.reduce((groups, item) => {
    const groupKey = String(item[key]);
    return {
      ...groups,
      [groupKey]: [...(groups[groupKey] || []), item],
    };
  }, {} as Record<string, T[]>);
}

/**
 * Remove duplicates from array
 */
export function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}

/**
 * Sort array by key
 */
export function sortBy<T>(
  array: T[],
  key: keyof T,
  direction: 'asc' | 'desc' = 'asc'
): T[] {
  return [...array].sort((a, b) => {
    const aVal = a[key];
    const bVal = b[key];
    if (aVal < bVal) return direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return direction === 'asc' ? 1 : -1;
    return 0;
  });
}
