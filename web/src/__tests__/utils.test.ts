/**
 * Utility Function Tests
 *
 * Covers every exported utility from src/utils/index.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cn,
  formatTime,
  formatDateTime,
  getRelativeTime,
  formatUptime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatBytes,
  truncate,
  generateId,
  sanitizeHtml,
  getLogLevelColor,
  getPhaseColor,
  getPhaseDisplayName,
  exportAsJson,
  exportAsCsv,
  isValidIp,
  isValidUrl,
  isValidPort,
  groupBy,
  unique,
  sortBy,
} from '@utils/index';

// ============================================================================
// cn — class-name joiner
// ============================================================================

describe('cn', () => {
  it('joins multiple truthy strings', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('filters out falsy values', () => {
    expect(cn('a', false, undefined, null, 'b')).toBe('a b');
  });

  it('returns empty string for all falsy', () => {
    expect(cn(false, null, undefined)).toBe('');
  });

  it('handles a single class', () => {
    expect(cn('foo')).toBe('foo');
  });
});

// ============================================================================
// formatTime
// ============================================================================

describe('formatTime', () => {
  it('returns a non-empty time string for any timestamp', () => {
    const result = formatTime(Date.now());
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('formats midnight-UTC epoch as a valid time', () => {
    // 1970-01-01T00:00:00Z — the exact result depends on timezone but should not throw
    const result = formatTime(0);
    expect(typeof result).toBe('string');
  });
});

// ============================================================================
// formatDateTime
// ============================================================================

describe('formatDateTime', () => {
  it('returns a non-empty datetime string', () => {
    const result = formatDateTime(Date.now());
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// getRelativeTime
// ============================================================================

describe('getRelativeTime', () => {
  it('shows seconds for a timestamp 30 seconds ago', () => {
    const ts = Date.now() - 30_000;
    expect(getRelativeTime(ts)).toBe('30s ago');
  });

  it('shows minutes for a timestamp 5 minutes ago', () => {
    const ts = Date.now() - 5 * 60 * 1000;
    expect(getRelativeTime(ts)).toBe('5m ago');
  });

  it('shows hours for a timestamp 3 hours ago', () => {
    const ts = Date.now() - 3 * 60 * 60 * 1000;
    expect(getRelativeTime(ts)).toBe('3h ago');
  });

  it('shows days for a timestamp 2 days ago', () => {
    const ts = Date.now() - 2 * 24 * 60 * 60 * 1000;
    expect(getRelativeTime(ts)).toBe('2d ago');
  });
});

// ============================================================================
// formatUptime
// ============================================================================

describe('formatUptime', () => {
  it('formats under an hour as minutes', () => {
    expect(formatUptime(45 * 60)).toBe('45m');
  });

  it('formats hours and minutes', () => {
    expect(formatUptime(2 * 3600 + 30 * 60)).toBe('2h 30m');
  });

  it('formats days and hours', () => {
    expect(formatUptime(3 * 86400 + 5 * 3600)).toBe('3d 5h');
  });

  it('formats exactly zero seconds', () => {
    expect(formatUptime(0)).toBe('0m');
  });
});

// ============================================================================
// formatDuration
// ============================================================================

describe('formatDuration', () => {
  it('formats milliseconds under a minute as seconds', () => {
    expect(formatDuration(45_000)).toBe('45s');
  });

  it('formats milliseconds as minutes and seconds', () => {
    expect(formatDuration(2 * 60 * 1000 + 15_000)).toBe('2m 15s');
  });

  it('formats hours', () => {
    expect(formatDuration(3 * 3600 * 1000 + 30 * 60 * 1000 + 15_000)).toBe('3h 30m 15s');
  });

  it('formats days', () => {
    expect(formatDuration(2 * 24 * 3600 * 1000 + 5 * 3600 * 1000 + 30 * 60 * 1000)).toBe(
      '2d 5h 30m'
    );
  });
});

// ============================================================================
// formatNumber
// ============================================================================

describe('formatNumber', () => {
  it('returns plain number for < 1000', () => {
    expect(formatNumber(999)).toBe('999');
  });

  it('formats thousands with K suffix', () => {
    expect(formatNumber(1500)).toBe('1.5K');
  });

  it('formats millions with M suffix', () => {
    expect(formatNumber(2_500_000)).toBe('2.5M');
  });

  it('formats billions with B suffix', () => {
    expect(formatNumber(1_200_000_000)).toBe('1.2B');
  });
});

// ============================================================================
// formatPercent
// ============================================================================

describe('formatPercent', () => {
  it('formats with one decimal place by default', () => {
    expect(formatPercent(75)).toBe('75.0%');
  });

  it('respects custom decimal places', () => {
    expect(formatPercent(33.333, 2)).toBe('33.33%');
  });

  it('formats 0%', () => {
    expect(formatPercent(0)).toBe('0.0%');
  });

  it('formats 100%', () => {
    expect(formatPercent(100)).toBe('100.0%');
  });
});

// ============================================================================
// formatBytes
// ============================================================================

describe('formatBytes', () => {
  it('handles 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512.0 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
  });
});

// ============================================================================
// truncate
// ============================================================================

describe('truncate', () => {
  it('does not truncate strings at or below length', () => {
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('truncates and appends ellipsis for long strings', () => {
    expect(truncate('hello world', 5)).toBe('hello...');
  });

  it('handles empty string', () => {
    expect(truncate('', 5)).toBe('');
  });
});

// ============================================================================
// generateId
// ============================================================================

describe('generateId', () => {
  it('returns a non-empty string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('generates unique ids on successive calls', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateId()));
    expect(ids.size).toBe(20);
  });
});

// ============================================================================
// sanitizeHtml
// ============================================================================

describe('sanitizeHtml', () => {
  it('escapes HTML entities', () => {
    const result = sanitizeHtml('<script>alert("xss")</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;');
  });

  it('passes plain text through unchanged', () => {
    expect(sanitizeHtml('hello world')).toBe('hello world');
  });

  it('escapes angle brackets', () => {
    const result = sanitizeHtml('<b>bold</b>');
    expect(result).toContain('&lt;b&gt;');
  });
});

// ============================================================================
// getLogLevelColor
// ============================================================================

describe('getLogLevelColor', () => {
  it('returns a string for each level', () => {
    const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'] as const;
    levels.forEach((level) => {
      const color = getLogLevelColor(level);
      expect(typeof color).toBe('string');
      expect(color.length).toBeGreaterThan(0);
    });
  });

  it('DEBUG returns muted color class', () => {
    expect(getLogLevelColor('DEBUG')).toContain('muted');
  });

  it('ERROR returns error color class', () => {
    expect(getLogLevelColor('ERROR')).toContain('error');
  });

  it('CRITICAL returns exploit-red color class', () => {
    expect(getLogLevelColor('CRITICAL')).toContain('exploit-red');
  });
});

// ============================================================================
// getPhaseColor
// ============================================================================

describe('getPhaseColor', () => {
  it('returns a string for each known phase', () => {
    const phases = ['recon', 'ai', 'zap', 'metasploit', 'exploit', 'idle'] as const;
    phases.forEach((phase) => {
      const color = getPhaseColor(phase);
      expect(typeof color).toBe('string');
      expect(color.length).toBeGreaterThan(0);
    });
  });

  it('recon returns recon-blue class', () => {
    expect(getPhaseColor('recon')).toContain('recon-blue');
  });

  it('ai returns ai-purple class', () => {
    expect(getPhaseColor('ai')).toContain('ai-purple');
  });

  it('exploit returns exploit-red class', () => {
    expect(getPhaseColor('exploit')).toContain('exploit-red');
  });
});

// ============================================================================
// getPhaseDisplayName
// ============================================================================

describe('getPhaseDisplayName', () => {
  it('returns Reconnaissance for recon', () => {
    expect(getPhaseDisplayName('recon')).toBe('Reconnaissance');
  });

  it('returns AI Analysis for ai', () => {
    expect(getPhaseDisplayName('ai')).toBe('AI Analysis');
  });

  it('returns ZAP Scan for zap', () => {
    expect(getPhaseDisplayName('zap')).toBe('ZAP Scan');
  });

  it('returns Metasploit for metasploit', () => {
    expect(getPhaseDisplayName('metasploit')).toBe('Metasploit');
  });

  it('returns Exploitation for exploit', () => {
    expect(getPhaseDisplayName('exploit')).toBe('Exploitation');
  });

  it('returns Idle for idle', () => {
    expect(getPhaseDisplayName('idle')).toBe('Idle');
  });

  it('returns the phase string itself for unknown phases', () => {
    expect(getPhaseDisplayName('unknown' as any)).toBe('unknown');
  });
});

// ============================================================================
// exportAsJson — blob/URL creation
// ============================================================================

describe('exportAsJson', () => {
  beforeEach(() => {
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls URL.createObjectURL', () => {
    exportAsJson({ foo: 'bar' }, 'test-export');
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('calls URL.revokeObjectURL', () => {
    exportAsJson([1, 2, 3], 'test-export');
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});

// ============================================================================
// exportAsCsv — blob/URL creation
// ============================================================================

describe('exportAsCsv', () => {
  beforeEach(() => {
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls URL.createObjectURL with CSV data', () => {
    exportAsCsv([{ name: 'Alice', score: 10 }], 'test');
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('does nothing for empty data array', () => {
    (URL.createObjectURL as ReturnType<typeof vi.fn>).mockClear();
    exportAsCsv([], 'empty');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('uses provided headers instead of object keys', () => {
    const blobSpy = vi.spyOn(global, 'Blob');
    exportAsCsv(
      [{ a: '1', b: '2' }],
      'headers-test',
      ['a', 'b']
    );
    expect(blobSpy).toHaveBeenCalled();
  });
});

// ============================================================================
// isValidIp
// ============================================================================

describe('isValidIp', () => {
  it('accepts valid IPv4 addresses', () => {
    expect(isValidIp('192.168.1.1')).toBe(true);
    expect(isValidIp('0.0.0.0')).toBe(true);
    expect(isValidIp('255.255.255.255')).toBe(true);
  });

  it('rejects invalid IPv4 addresses', () => {
    expect(isValidIp('256.0.0.1')).toBe(false);
    expect(isValidIp('192.168.1')).toBe(false);
    expect(isValidIp('not-an-ip')).toBe(false);
    expect(isValidIp('')).toBe(false);
  });
});

// ============================================================================
// isValidUrl
// ============================================================================

describe('isValidUrl', () => {
  it('accepts valid http/https URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('http://localhost:3000')).toBe(true);
  });

  it('accepts valid hostnames without protocol', () => {
    expect(isValidUrl('example.com')).toBe(true);
    expect(isValidUrl('sub.example.com')).toBe(true);
  });

  it('accepts valid IPv4 addresses', () => {
    expect(isValidUrl('192.168.1.100')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidUrl('')).toBe(false);
  });

  it('rejects whitespace-only string', () => {
    expect(isValidUrl('   ')).toBe(false);
  });
});

// ============================================================================
// isValidPort
// ============================================================================

describe('isValidPort', () => {
  it('accepts ports in range 1-65535', () => {
    expect(isValidPort(1)).toBe(true);
    expect(isValidPort(80)).toBe(true);
    expect(isValidPort(443)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
  });

  it('rejects port 0', () => {
    expect(isValidPort(0)).toBe(false);
  });

  it('rejects port above 65535', () => {
    expect(isValidPort(65536)).toBe(false);
  });

  it('rejects negative ports', () => {
    expect(isValidPort(-1)).toBe(false);
  });

  it('rejects non-integer ports', () => {
    expect(isValidPort(80.5)).toBe(false);
  });
});

// ============================================================================
// groupBy
// ============================================================================

describe('groupBy', () => {
  it('groups array items by a string key', () => {
    const data = [
      { type: 'vuln', name: 'A' },
      { type: 'port', name: 'B' },
      { type: 'vuln', name: 'C' },
    ];
    const result = groupBy(data, 'type');
    expect(result['vuln']).toHaveLength(2);
    expect(result['port']).toHaveLength(1);
  });

  it('returns empty object for empty array', () => {
    expect(groupBy([], 'type')).toEqual({});
  });

  it('handles single-element arrays', () => {
    const result = groupBy([{ category: 'a', val: 1 }], 'category');
    expect(result['a']).toHaveLength(1);
  });
});

// ============================================================================
// unique
// ============================================================================

describe('unique', () => {
  it('removes duplicate primitives', () => {
    expect(unique([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
  });

  it('removes duplicate strings', () => {
    expect(unique(['a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('returns empty array for empty input', () => {
    expect(unique([])).toEqual([]);
  });

  it('returns same array when all elements are already unique', () => {
    expect(unique([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

// ============================================================================
// sortBy
// ============================================================================

describe('sortBy', () => {
  const data = [
    { name: 'Charlie', score: 3 },
    { name: 'Alice', score: 1 },
    { name: 'Bob', score: 2 },
  ];

  it('sorts ascending by default', () => {
    const result = sortBy(data, 'score');
    expect(result.map((d) => d.name)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('sorts descending when specified', () => {
    const result = sortBy(data, 'score', 'desc');
    expect(result.map((d) => d.name)).toEqual(['Charlie', 'Bob', 'Alice']);
  });

  it('sorts strings alphabetically ascending', () => {
    const result = sortBy(data, 'name');
    expect(result.map((d) => d.name)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('does not mutate the original array', () => {
    const original = [...data];
    sortBy(data, 'score');
    expect(data).toEqual(original);
  });

  it('handles empty array', () => {
    expect(sortBy([], 'score')).toEqual([]);
  });
});
