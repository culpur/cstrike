/**
 * Zustand Store Tests — All 8 stores
 *
 * Tests are isolated: each resets the store to its initial state
 * via the store's own setState before running.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// ============================================================================
// uiStore
// ============================================================================

describe('uiStore', () => {
  let useUIStore: typeof import('@stores/uiStore').useUIStore;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@stores/uiStore');
    useUIStore = mod.useUIStore;
    // Reset to initial state
    act(() => {
      useUIStore.setState({
        sidebarCollapsed: false,
        activeView: 'dashboard',
        toasts: [],
      });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initialises with default values', () => {
    const { result } = renderHook(() => useUIStore());
    expect(result.current.sidebarCollapsed).toBe(false);
    expect(result.current.activeView).toBe('dashboard');
    expect(result.current.toasts).toHaveLength(0);
  });

  it('toggleSidebar flips sidebarCollapsed', () => {
    const { result } = renderHook(() => useUIStore());
    act(() => result.current.toggleSidebar());
    expect(result.current.sidebarCollapsed).toBe(true);
    act(() => result.current.toggleSidebar());
    expect(result.current.sidebarCollapsed).toBe(false);
  });

  it('setSidebarCollapsed sets explicit value', () => {
    const { result } = renderHook(() => useUIStore());
    act(() => result.current.setSidebarCollapsed(true));
    expect(result.current.sidebarCollapsed).toBe(true);
    act(() => result.current.setSidebarCollapsed(false));
    expect(result.current.sidebarCollapsed).toBe(false);
  });

  it('setActiveView changes the active view', () => {
    const { result } = renderHook(() => useUIStore());
    act(() => result.current.setActiveView('results'));
    expect(result.current.activeView).toBe('results');
    act(() => result.current.setActiveView('logs'));
    expect(result.current.activeView).toBe('logs');
  });

  it('addToast appends a toast with id and timestamp', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useUIStore());
    act(() => {
      result.current.addToast({ type: 'success', message: 'Hello', duration: 0 });
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe('Hello');
    expect(result.current.toasts[0].type).toBe('success');
    expect(typeof result.current.toasts[0].id).toBe('string');
    expect(typeof result.current.toasts[0].timestamp).toBe('number');
  });

  it('removeToast removes by id', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useUIStore());
    act(() => {
      result.current.addToast({ type: 'info', message: 'Test', duration: 0 });
    });
    const id = result.current.toasts[0].id;
    act(() => result.current.removeToast(id));
    expect(result.current.toasts).toHaveLength(0);
  });

  it('clearToasts empties all toasts', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useUIStore());
    act(() => {
      result.current.addToast({ type: 'info', message: 'A', duration: 0 });
      result.current.addToast({ type: 'error', message: 'B', duration: 0 });
    });
    expect(result.current.toasts).toHaveLength(2);
    act(() => result.current.clearToasts());
    expect(result.current.toasts).toHaveLength(0);
  });

  it('toast auto-removes after default 5 second duration', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useUIStore());
    act(() => {
      result.current.addToast({ type: 'success', message: 'Timed' });
    });
    expect(result.current.toasts).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(5100);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('toast with duration:0 does not auto-remove', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useUIStore());
    act(() => {
      result.current.addToast({ type: 'info', message: 'Persistent', duration: 0 });
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.toasts).toHaveLength(1);
  });
});

// ============================================================================
// notificationStore
// ============================================================================

describe('notificationStore', () => {
  let useNotificationStore: typeof import('@stores/notificationStore').useNotificationStore;
  let useUnreadCount: typeof import('@stores/notificationStore').useUnreadCount;
  let useRecentNotifications: typeof import('@stores/notificationStore').useRecentNotifications;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@stores/notificationStore');
    useNotificationStore = mod.useNotificationStore;
    useUnreadCount = mod.useUnreadCount;
    useRecentNotifications = mod.useRecentNotifications;
    act(() => {
      useNotificationStore.setState({ notifications: [] });
    });
  });

  it('initialises with empty notifications', () => {
    const { result } = renderHook(() => useNotificationStore());
    expect(result.current.notifications).toHaveLength(0);
  });

  it('addNotification adds a notification with id, timestamp, read:false', () => {
    const { result } = renderHook(() => useNotificationStore());
    act(() => {
      result.current.addNotification({
        type: 'vuln_found',
        title: 'SQL Injection',
        message: 'Found in /login',
        severity: 'high',
      });
    });
    expect(result.current.notifications).toHaveLength(1);
    const n = result.current.notifications[0];
    expect(n.read).toBe(false);
    expect(n.title).toBe('SQL Injection');
    expect(typeof n.id).toBe('string');
    expect(typeof n.timestamp).toBe('number');
  });

  it('newest notifications appear first (prepended)', () => {
    const { result } = renderHook(() => useNotificationStore());
    act(() => {
      result.current.addNotification({ type: 'scan_started', title: 'First', message: 'A' });
      result.current.addNotification({ type: 'scan_complete', title: 'Second', message: 'B' });
    });
    expect(result.current.notifications[0].title).toBe('Second');
    expect(result.current.notifications[1].title).toBe('First');
  });

  it('markRead marks a single notification as read', () => {
    const { result } = renderHook(() => useNotificationStore());
    act(() => {
      result.current.addNotification({ type: 'error', title: 'Err', message: 'fail' });
    });
    const id = result.current.notifications[0].id;
    act(() => result.current.markRead(id));
    expect(result.current.notifications[0].read).toBe(true);
  });

  it('markAllRead marks all notifications as read', () => {
    const { result } = renderHook(() => useNotificationStore());
    act(() => {
      result.current.addNotification({ type: 'vuln_found', title: 'V1', message: 'm' });
      result.current.addNotification({ type: 'cred_found', title: 'V2', message: 'm' });
    });
    act(() => result.current.markAllRead());
    expect(result.current.notifications.every((n) => n.read)).toBe(true);
  });

  it('clearAll empties the notification list', () => {
    const { result } = renderHook(() => useNotificationStore());
    act(() => {
      result.current.addNotification({ type: 'shell_obtained', title: 'Shell', message: 'm' });
    });
    act(() => result.current.clearAll());
    expect(result.current.notifications).toHaveLength(0);
  });

  it('useUnreadCount selector returns correct count', () => {
    const store = renderHook(() => useNotificationStore());
    const counter = renderHook(() => useUnreadCount());
    act(() => {
      store.result.current.addNotification({ type: 'error', title: 'E', message: 'm' });
      store.result.current.addNotification({ type: 'error', title: 'E2', message: 'm' });
    });
    expect(counter.result.current).toBe(2);
    const id = store.result.current.notifications[0].id;
    act(() => store.result.current.markRead(id));
    expect(counter.result.current).toBe(1);
  });

  it('useRecentNotifications returns at most the specified limit', () => {
    const store = renderHook(() => useNotificationStore());
    const recent = renderHook(() => useRecentNotifications(2));
    act(() => {
      for (let i = 0; i < 5; i++) {
        store.result.current.addNotification({
          type: 'scan_started',
          title: `N${i}`,
          message: 'm',
        });
      }
    });
    expect(recent.result.current).toHaveLength(2);
  });

  it('caps notifications at MAX_NOTIFICATIONS (100)', () => {
    const { result } = renderHook(() => useNotificationStore());
    act(() => {
      for (let i = 0; i < 105; i++) {
        result.current.addNotification({ type: 'error', title: `N${i}`, message: 'm' });
      }
    });
    expect(result.current.notifications).toHaveLength(100);
  });
});

// ============================================================================
// systemStore
// ============================================================================

describe('systemStore', () => {
  let useSystemStore: typeof import('@stores/systemStore').useSystemStore;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@stores/systemStore');
    useSystemStore = mod.useSystemStore;
    act(() => {
      useSystemStore.getState().reset();
    });
  });

  it('initialises with zero metrics and stopped services', () => {
    const { result } = renderHook(() => useSystemStore());
    expect(result.current.metrics.cpu).toBe(0);
    expect(result.current.metrics.memory).toBe(0);
    expect(result.current.services.metasploitRpc).toBe('stopped');
    expect(result.current.connected).toBe(false);
  });

  it('updateMetrics merges partial metrics', () => {
    const { result } = renderHook(() => useSystemStore());
    act(() => result.current.updateMetrics({ cpu: 42, memory: 55 }));
    expect(result.current.metrics.cpu).toBe(42);
    expect(result.current.metrics.memory).toBe(55);
    expect(result.current.metrics.uptime).toBe(0); // unchanged
  });

  it('updateServiceStatus updates a specific service', () => {
    const { result } = renderHook(() => useSystemStore());
    act(() => result.current.updateServiceStatus('metasploitRpc', 'running'));
    expect(result.current.services.metasploitRpc).toBe('running');
    // Other services unaffected
    expect(result.current.services.zap).toBe('stopped');
  });

  it('setConnected toggles connection state', () => {
    const { result } = renderHook(() => useSystemStore());
    act(() => result.current.setConnected(true));
    expect(result.current.connected).toBe(true);
    act(() => result.current.setConnected(false));
    expect(result.current.connected).toBe(false);
  });

  it('updatePhase sets current phase', () => {
    const { result } = renderHook(() => useSystemStore());
    act(() => result.current.updatePhase('recon'));
    expect(result.current.phaseProgress.currentPhase).toBe('recon');
  });

  it('setPhaseComplete marks a phase complete', () => {
    const { result } = renderHook(() => useSystemStore());
    act(() => result.current.setPhaseComplete('reconComplete', true));
    expect(result.current.phaseProgress.reconComplete).toBe(true);
  });

  it('setVpnConnections stores the connections array', () => {
    const { result } = renderHook(() => useSystemStore());
    const conns = [
      {
        id: 'vpn-1',
        name: 'ProtonVPN',
        provider: 'protonvpn' as const,
        status: 'connected' as const,
        ip: '10.10.10.1',
        connectedAt: Date.now(),
      },
    ];
    act(() => result.current.setVpnConnections(conns));
    expect(result.current.vpnConnections).toHaveLength(1);
    expect(result.current.vpnConnections[0].name).toBe('ProtonVPN');
  });

  it('reset returns store to initial state', () => {
    const { result } = renderHook(() => useSystemStore());
    act(() => {
      result.current.updateMetrics({ cpu: 99 });
      result.current.setConnected(true);
      result.current.reset();
    });
    expect(result.current.metrics.cpu).toBe(0);
    expect(result.current.connected).toBe(false);
  });
});

// ============================================================================
// reconStore
// ============================================================================

describe('reconStore', () => {
  let useReconStore: typeof import('@stores/reconStore').useReconStore;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@stores/reconStore');
    useReconStore = mod.useReconStore;
    act(() => {
      useReconStore.getState().reset();
    });
  });

  it('initialises with empty targets and default tools', () => {
    const { result } = renderHook(() => useReconStore());
    expect(result.current.targets).toHaveLength(0);
    expect(result.current.tools.length).toBeGreaterThan(0);
  });

  it('addTarget creates a target with pending status', () => {
    const { result } = renderHook(() => useReconStore());
    act(() => result.current.addTarget('http://example.com'));
    expect(result.current.targets).toHaveLength(1);
    expect(result.current.targets[0].url).toBe('http://example.com');
    expect(result.current.targets[0].status).toBe('pending');
    expect(typeof result.current.targets[0].id).toBe('string');
  });

  it('removeTarget removes by id', () => {
    const { result } = renderHook(() => useReconStore());
    act(() => result.current.addTarget('http://remove.me'));
    const id = result.current.targets[0].id;
    act(() => result.current.removeTarget(id));
    expect(result.current.targets).toHaveLength(0);
  });

  it('updateTargetStatus changes target status', () => {
    const { result } = renderHook(() => useReconStore());
    act(() => result.current.addTarget('http://test.com'));
    const id = result.current.targets[0].id;
    act(() => result.current.updateTargetStatus(id, 'scanning'));
    expect(result.current.targets[0].status).toBe('scanning');
  });

  it('toggleTool flips a tool enabled state', () => {
    const { result } = renderHook(() => useReconStore());
    const nmapBefore = result.current.tools.find((t) => t.name === 'nmap');
    expect(nmapBefore?.enabled).toBe(true);
    act(() => result.current.toggleTool('nmap'));
    const nmapAfter = result.current.tools.find((t) => t.name === 'nmap');
    expect(nmapAfter?.enabled).toBe(false);
  });

  it('startScan adds target to activeScans and sets scanning status', () => {
    const { result } = renderHook(() => useReconStore());
    act(() => result.current.addTarget('http://scan.me'));
    const id = result.current.targets[0].id;
    act(() => result.current.startScan(id));
    expect(result.current.activeScans.has(id)).toBe(true);
    expect(result.current.targets[0].status).toBe('scanning');
  });

  it('completeScan removes from activeScans and sets complete status', () => {
    const { result } = renderHook(() => useReconStore());
    act(() => result.current.addTarget('http://scan.me'));
    const id = result.current.targets[0].id;
    act(() => {
      result.current.startScan(id);
      result.current.completeScan(id);
    });
    expect(result.current.activeScans.has(id)).toBe(false);
    expect(result.current.targets[0].status).toBe('complete');
  });

  it('storeScanResults and getScanResults round-trip', () => {
    const { result } = renderHook(() => useReconStore());
    const scanResults = {
      ports: [],
      subdomains: [],
      vulnerabilities: [],
      urls: [],
      technologies: [],
    };
    act(() => result.current.storeScanResults('scan-abc', scanResults));
    const retrieved = result.current.getScanResults('scan-abc');
    expect(retrieved).toEqual(scanResults);
  });

  it('clearResults empties results but leaves targets', () => {
    const { result } = renderHook(() => useReconStore());
    act(() => {
      result.current.addTarget('http://x.com');
      result.current.addPortScanResult({
        port: 80,
        protocol: 'tcp',
        state: 'open',
        target: 'http://x.com',
      });
      result.current.clearResults();
    });
    expect(result.current.portScanResults).toHaveLength(0);
    expect(result.current.targets).toHaveLength(1);
  });
});

// ============================================================================
// lootStore
// ============================================================================

describe('lootStore', () => {
  let useLootStore: typeof import('@stores/lootStore').useLootStore;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@stores/lootStore');
    useLootStore = mod.useLootStore;
    act(() => {
      useLootStore.getState().reset();
    });
  });

  it('initialises with empty items, credentials and zero stats', () => {
    const { result } = renderHook(() => useLootStore());
    expect(result.current.items).toHaveLength(0);
    expect(result.current.credentials).toHaveLength(0);
    expect(result.current.stats.totalItems).toBe(0);
  });

  it('addLootItem adds item and updates stats', () => {
    const { result } = renderHook(() => useLootStore());
    act(() => {
      result.current.addLootItem({
        category: 'credential',
        value: 'admin:password',
        target: 'http://x.com',
        source: 'hydra',
      });
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.stats.totalItems).toBe(1);
    expect(result.current.stats.byCategory.credential).toBe(1);
  });

  it('addCredential adds a credential pair', () => {
    const { result } = renderHook(() => useLootStore());
    act(() => {
      result.current.addCredential({
        username: 'admin',
        password: 'secret',
        service: 'ssh',
        host: '10.0.0.1',
        port: 22,
        validated: false,
      });
    });
    expect(result.current.credentials).toHaveLength(1);
    expect(result.current.credentials[0].username).toBe('admin');
  });

  it('validateCredential marks credential as validated', () => {
    const { result } = renderHook(() => useLootStore());
    act(() => {
      result.current.addCredential({
        username: 'root',
        password: 'toor',
        service: 'ssh',
        host: '10.0.0.1',
        port: 22,
        validated: false,
      });
    });
    const id = result.current.credentials[0].id;
    act(() => result.current.validateCredential(id, true));
    expect(result.current.credentials[0].validated).toBe(true);
    expect(result.current.stats.validatedCredentials).toBe(1);
  });

  it('removeLootItem removes item and updates stats', () => {
    const { result } = renderHook(() => useLootStore());
    act(() => {
      result.current.addLootItem({
        category: 'url',
        value: 'http://example.com/admin',
        target: 'http://example.com',
        source: 'ffuf',
      });
    });
    const id = result.current.items[0].id;
    act(() => result.current.removeLootItem(id));
    expect(result.current.items).toHaveLength(0);
    expect(result.current.stats.totalItems).toBe(0);
  });

  it('getLootByCategory returns matching items', () => {
    const { result } = renderHook(() => useLootStore());
    act(() => {
      result.current.addLootItem({ category: 'hash', value: 'abc123', target: 't', source: 's' });
      result.current.addLootItem({ category: 'url', value: 'http://x', target: 't', source: 's' });
    });
    const hashes = result.current.getLootByCategory('hash');
    expect(hashes).toHaveLength(1);
    expect(hashes[0].category).toBe('hash');
  });

  it('getLootByTarget returns matching items', () => {
    const { result } = renderHook(() => useLootStore());
    act(() => {
      result.current.addLootItem({ category: 'url', value: 'x', target: 'target-a', source: 's' });
      result.current.addLootItem({ category: 'url', value: 'y', target: 'target-b', source: 's' });
    });
    const forA = result.current.getLootByTarget('target-a');
    expect(forA).toHaveLength(1);
  });

  it('clearLoot resets everything', () => {
    const { result } = renderHook(() => useLootStore());
    act(() => {
      result.current.addLootItem({ category: 'file', value: '/etc/passwd', target: 't', source: 's' });
      result.current.clearLoot();
    });
    expect(result.current.items).toHaveLength(0);
    expect(result.current.stats.totalItems).toBe(0);
  });
});

// ============================================================================
// aiStore
// ============================================================================

describe('aiStore', () => {
  let useAIStore: typeof import('@stores/aiStore').useAIStore;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@stores/aiStore');
    useAIStore = mod.useAIStore;
    act(() => {
      useAIStore.getState().reset();
    });
  });

  it('initialises with empty thoughts, decisions and isThinking false', () => {
    const { result } = renderHook(() => useAIStore());
    expect(result.current.thoughts).toHaveLength(0);
    expect(result.current.decisions).toHaveLength(0);
    expect(result.current.isThinking).toBe(false);
  });

  it('addThought appends a thought with id and timestamp', () => {
    const { result } = renderHook(() => useAIStore());
    act(() => {
      result.current.addThought({ thoughtType: 'reasoning', content: 'Port 22 is open' });
    });
    expect(result.current.thoughts).toHaveLength(1);
    expect(result.current.thoughts[0].content).toBe('Port 22 is open');
    expect(typeof result.current.thoughts[0].id).toBe('string');
  });

  it('addDecision appends a decision', () => {
    const { result } = renderHook(() => useAIStore());
    act(() => {
      result.current.addDecision({
        action: 'run_exploit',
        reasoning: 'CVE-2021-44228 detected',
        priority: 'high',
      });
    });
    expect(result.current.decisions).toHaveLength(1);
    expect(result.current.decisions[0].action).toBe('run_exploit');
  });

  it('setThinking updates isThinking', () => {
    const { result } = renderHook(() => useAIStore());
    act(() => result.current.setThinking(true));
    expect(result.current.isThinking).toBe(true);
    act(() => result.current.setThinking(false));
    expect(result.current.isThinking).toBe(false);
  });

  it('clearThoughts empties thoughts and decisions', () => {
    const { result } = renderHook(() => useAIStore());
    act(() => {
      result.current.addThought({ thoughtType: 'observation', content: 'found' });
      result.current.addDecision({ action: 'scan', reasoning: 'r', priority: 'medium' });
      result.current.clearThoughts();
    });
    expect(result.current.thoughts).toHaveLength(0);
    expect(result.current.decisions).toHaveLength(0);
  });

  it('trims thoughts when maxThoughts is exceeded', () => {
    const { result } = renderHook(() => useAIStore());
    // Lower the limit for testing
    act(() => {
      useAIStore.setState({ maxThoughts: 3 });
    });
    act(() => {
      for (let i = 0; i < 5; i++) {
        result.current.addThought({ thoughtType: 'observation', content: `T${i}` });
      }
    });
    expect(result.current.thoughts).toHaveLength(3);
  });
});

// ============================================================================
// logStore
// ============================================================================

describe('logStore', () => {
  let useLogStore: typeof import('@stores/logStore').useLogStore;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@stores/logStore');
    useLogStore = mod.useLogStore;
    act(() => {
      useLogStore.getState().reset();
    });
  });

  it('initialises with empty logs and default filter', () => {
    const { result } = renderHook(() => useLogStore());
    expect(result.current.logs).toHaveLength(0);
    expect(result.current.filter.levels).toContain('INFO');
    expect(result.current.filter.levels).toContain('ERROR');
  });

  it('addLog appends a log entry with id and timestamp', () => {
    const { result } = renderHook(() => useLogStore());
    act(() => {
      result.current.addLog({ level: 'INFO', message: 'Test message', source: 'api' });
    });
    expect(result.current.logs).toHaveLength(1);
    expect(result.current.logs[0].message).toBe('Test message');
    expect(typeof result.current.logs[0].id).toBe('string');
  });

  it('addLog caps at maxLogs (5000 by default) by dropping oldest', () => {
    const { result } = renderHook(() => useLogStore());
    act(() => {
      useLogStore.setState({ maxLogs: 3 });
    });
    act(() => {
      result.current.addLog({ level: 'INFO', message: 'first', source: 's' });
      result.current.addLog({ level: 'INFO', message: 'second', source: 's' });
      result.current.addLog({ level: 'INFO', message: 'third', source: 's' });
      result.current.addLog({ level: 'INFO', message: 'fourth', source: 's' });
    });
    expect(result.current.logs).toHaveLength(3);
    expect(result.current.logs[0].message).toBe('second');
  });

  it('setFilter updates filter fields', () => {
    const { result } = renderHook(() => useLogStore());
    act(() => result.current.setFilter({ searchQuery: 'error', levels: ['ERROR'] }));
    expect(result.current.filter.searchQuery).toBe('error');
    expect(result.current.filter.levels).toEqual(['ERROR']);
  });

  it('getFilteredLogs filters by level', () => {
    const { result } = renderHook(() => useLogStore());
    act(() => {
      result.current.addLog({ level: 'INFO', message: 'info msg', source: 's' });
      result.current.addLog({ level: 'ERROR', message: 'error msg', source: 's' });
      result.current.setFilter({ levels: ['ERROR'] });
    });
    const filtered = result.current.getFilteredLogs();
    expect(filtered).toHaveLength(1);
    expect(filtered[0].level).toBe('ERROR');
  });

  it('getFilteredLogs filters by searchQuery', () => {
    const { result } = renderHook(() => useLogStore());
    act(() => {
      result.current.addLog({ level: 'INFO', message: 'target found', source: 's' });
      result.current.addLog({ level: 'INFO', message: 'scan complete', source: 's' });
      result.current.setFilter({ searchQuery: 'target' });
    });
    const filtered = result.current.getFilteredLogs();
    expect(filtered).toHaveLength(1);
    expect(filtered[0].message).toBe('target found');
  });

  it('clearLogs empties the log array', () => {
    const { result } = renderHook(() => useLogStore());
    act(() => {
      result.current.addLog({ level: 'WARN', message: 'w', source: 's' });
      result.current.clearLogs();
    });
    expect(result.current.logs).toHaveLength(0);
  });
});

// ============================================================================
// exploitationStore
// ============================================================================

describe('exploitationStore', () => {
  let useExploitationStore: typeof import('@stores/exploitationStore').useExploitationStore;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@stores/exploitationStore');
    useExploitationStore = mod.useExploitationStore;
    act(() => {
      useExploitationStore.getState().clearResults();
    });
  });

  it('initialises with empty results', () => {
    const { result } = renderHook(() => useExploitationStore());
    expect(result.current.results).toHaveLength(0);
    expect(result.current.activeExploitations.size).toBe(0);
    expect(result.current.selectedResultId).toBeNull();
  });

  it('addResult creates a new exploitation result', () => {
    const { result } = renderHook(() => useExploitationStore());
    act(() => result.current.addResult('exploit-1', '10.0.0.1'));
    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0].target).toBe('10.0.0.1');
    expect(result.current.results[0].status).toBe('running');
    expect(result.current.activeExploitations.has('exploit-1')).toBe(true);
  });

  it('addResult is idempotent — duplicate exploitId is ignored', () => {
    const { result } = renderHook(() => useExploitationStore());
    act(() => {
      result.current.addResult('exploit-1', '10.0.0.1');
      result.current.addResult('exploit-1', '10.0.0.1');
    });
    expect(result.current.results).toHaveLength(1);
  });

  it('updateResultStatus updates status', () => {
    const { result } = renderHook(() => useExploitationStore());
    act(() => {
      result.current.addResult('e1', '1.2.3.4');
      result.current.updateResultStatus('e1', 'completed');
    });
    expect(result.current.results[0].status).toBe('completed');
  });

  it('addVulnerability appends vuln and creates timeline event', () => {
    const { result } = renderHook(() => useExploitationStore());
    act(() => {
      result.current.addResult('e1', '1.2.3.4');
      result.current.addVulnerability('e1', {
        id: 'v1',
        name: 'Log4Shell',
        severity: 'critical',
        cve: 'CVE-2021-44228',
        description: 'JNDI injection',
      });
    });
    expect(result.current.results[0].vulnerabilities).toHaveLength(1);
    const timeline = result.current.results[0].timeline;
    expect(timeline.some((e) => e.message.includes('Log4Shell'))).toBe(true);
  });

  it('addShell appends shell and creates timeline event', () => {
    const { result } = renderHook(() => useExploitationStore());
    act(() => {
      result.current.addResult('e1', '1.2.3.4');
      result.current.addShell('e1', {
        id: 's1',
        type: 'reverse',
        host: '1.2.3.4',
        port: 4444,
        os: 'linux',
        user: 'root',
        active: true,
        obtainedAt: Date.now(),
      });
    });
    expect(result.current.results[0].shells).toHaveLength(1);
  });

  it('completeExploitation moves to completed and removes from active', () => {
    const { result } = renderHook(() => useExploitationStore());
    act(() => {
      result.current.addResult('e1', '1.2.3.4');
      result.current.completeExploitation('e1');
    });
    expect(result.current.results[0].status).toBe('completed');
    expect(result.current.activeExploitations.has('e1')).toBe(false);
  });

  it('failExploitation marks as failed and removes from active', () => {
    const { result } = renderHook(() => useExploitationStore());
    act(() => {
      result.current.addResult('e1', '1.2.3.4');
      result.current.failExploitation('e1', 'Connection refused');
    });
    expect(result.current.results[0].status).toBe('failed');
    expect(result.current.activeExploitations.has('e1')).toBe(false);
  });

  it('setSelectedResult and getResult work correctly', () => {
    const { result } = renderHook(() => useExploitationStore());
    act(() => {
      result.current.addResult('e1', '1.2.3.4');
      result.current.setSelectedResult('something');
    });
    expect(result.current.selectedResultId).toBe('something');
    const found = result.current.getResult('e1');
    expect(found).toBeDefined();
    expect(found?.target).toBe('1.2.3.4');
  });

  it('clearResults empties everything', () => {
    const { result } = renderHook(() => useExploitationStore());
    act(() => {
      result.current.addResult('e1', '1.2.3.4');
      result.current.clearResults();
    });
    expect(result.current.results).toHaveLength(0);
    expect(result.current.activeExploitations.size).toBe(0);
    expect(result.current.selectedResultId).toBeNull();
  });
});
