/**
 * Navigation / Routing Tests
 *
 * Verifies that:
 * - App renders without crashing
 * - Each activeView value renders the correct component
 * - Sidebar navigation changes activeView
 * - Default view is 'dashboard'
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@assets/cstrike-icon-64.png', () => ({ default: 'mocked-icon.png' }));

vi.mock('@services/api', () => ({
  apiService: {
    getStatus: vi.fn().mockResolvedValue({
      metrics: { cpu: 0, memory: 0, vpnIp: null, uptime: 0, timestamp: Date.now() },
      services: { metasploitRpc: 'stopped', zap: 'stopped', burp: 'stopped' },
    }),
    getTargets: vi.fn().mockResolvedValue([]),
    getLoot: vi.fn().mockResolvedValue([]),
    getCredentials: vi.fn().mockResolvedValue([]),
    getActiveScans: vi.fn().mockResolvedValue({ active_scans: [] }),
    getAIThoughts: vi.fn().mockResolvedValue([]),
    getLogs: vi.fn().mockResolvedValue([]),
    getConfig: vi.fn().mockResolvedValue({}),
    getResults: vi.fn().mockResolvedValue([]),
    getVpnConnections: vi.fn().mockResolvedValue([]),
    getServiceStatus: vi.fn().mockResolvedValue({}),
    getAIProvider: vi.fn().mockResolvedValue({ provider: 'openai', model: 'gpt-4', status: 'connected' }),
    getMCPTools: vi.fn().mockResolvedValue([]),
    getSystemMetrics: vi.fn().mockResolvedValue({ cpu: 0, memory: 0, vpnIp: null, uptime: 0, timestamp: Date.now() }),
    getTargetResults: vi.fn().mockResolvedValue({
      ports: [], subdomains: [], vulnerabilities: [], urls: [], technologies: [], httpEndpoints: [],
    }),
    getLootHeatmap: vi.fn().mockResolvedValue({ targets: [], hotspots: [] }),
    startRecon: vi.fn().mockResolvedValue({ scan_id: 'test-scan', status: 'started' }),
    startExploitation: vi.fn().mockResolvedValue({ exploit_id: 'exp-1', status: 'started' }),
    client: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn().mockResolvedValue({ data: {} }) },
  },
}));

// localStorage mock
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

vi.mock('@services/websocket', () => ({
  wsService: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn().mockReturnValue(vi.fn()),
    off: vi.fn(),
    emit: vi.fn(),
    connected: false,
  },
}));

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
  })),
}));

vi.mock('recharts', () => {
  const MockChart = ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="recharts-mock">{children}</div>
  );
  return {
    ResponsiveContainer: MockChart,
    PieChart: MockChart,
    Pie: () => null,
    Cell: () => null,
    BarChart: MockChart,
    Bar: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    AreaChart: MockChart,
    Area: () => null,
  };
});

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({}),
  text: () => Promise.resolve(''),
});

// ============================================================================
// Imports (after mocks)
// ============================================================================

import App from '../App';
import { useUIStore } from '@stores/uiStore';
import { useSystemStore } from '@stores/systemStore';

/**
 * Safe text finder — uses queryAllByText so it never throws on multiple matches.
 * Returns the first matching element or null.
 */
function hasText(pattern: RegExp | string): Element | null {
  const all = screen.queryAllByText(pattern);
  return all.length > 0 ? all[0] : null;
}

function findFirst(...fns: (() => Element | null | HTMLElement | undefined)[]): Element | null {
  for (const fn of fns) {
    try {
      const el = fn();
      if (el) return el as Element;
    } catch {
      // swallow "multiple elements" errors from getBy* queries
    }
  }
  return null;
}

// ============================================================================
// Reset stores before each test
// ============================================================================

function resetStores() {
  act(() => {
    useUIStore.setState({ sidebarCollapsed: false, activeView: 'dashboard', toasts: [] });
    useSystemStore.getState().reset();
  });
}

// ============================================================================
// Helper — render App and wait for async effects to settle
// ============================================================================

async function renderApp() {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(<App />);
  });
  return result!;
}

// ============================================================================
// App bootstrap
// ============================================================================

describe('App', () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
  });

  it('renders without crashing', async () => {
    await renderApp();
    expect(document.body).toBeDefined();
  });

  it('default activeView is dashboard', async () => {
    await renderApp();
    expect(useUIStore.getState().activeView).toBe('dashboard');
  });

  it('renders the DashboardView by default (Command Center heading)', async () => {
    await renderApp();
    await waitFor(() => {
      // "Command Center" appears in sidebar + dashboard heading — check at least one exists
      expect(screen.queryAllByText('Command Center').length).toBeGreaterThan(0);
    });
  });

  it('renders the Sidebar', async () => {
    await renderApp();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('renders the CommandPalette trigger (palette is hidden by default)', async () => {
    await renderApp();
    // Palette is not shown initially
    expect(screen.queryByRole('dialog', { name: /command palette/i })).toBeNull();
  });
});

// ============================================================================
// View routing — each activeView value
// ============================================================================

describe('View routing', () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
  });

  it('renders DashboardView for activeView=dashboard', async () => {
    await renderApp();
    act(() => useUIStore.getState().setActiveView('dashboard'));
    await waitFor(() => {
      expect(screen.queryAllByText('Command Center').length).toBeGreaterThan(0);
    });
  });

  it('renders ServicesView for activeView=services', async () => {
    await renderApp();
    act(() => useUIStore.getState().setActiveView('services'));
    await waitFor(() => {
      const el = findFirst(
        () => hasText(/managed services/i),
        () => hasText(/api server/i),
        () => screen.queryByRole('button'),
      );
      expect(el).not.toBeNull();
    });
  });

  it('renders TargetsView for activeView=targets', async () => {
    await renderApp();
    act(() => useUIStore.getState().setActiveView('targets'));
    await waitFor(() => {
      const el = findFirst(
        () => hasText(/add target/i),
        () => hasText(/reconnaissance target/i),
        () => screen.queryByRole('textbox'),
      );
      expect(el).not.toBeNull();
    });
  });

  it('renders TargetsView for activeView=reconnaissance (alias)', async () => {
    await renderApp();
    act(() => useUIStore.getState().setActiveView('reconnaissance'));
    await waitFor(() => {
      const el = findFirst(
        () => hasText(/add target/i),
        () => screen.queryByRole('textbox'),
      );
      expect(el).not.toBeNull();
    });
  });

  it('renders AIStreamView for activeView=ai-stream', async () => {
    await renderApp();
    act(() => useUIStore.getState().setActiveView('ai-stream'));
    await waitFor(() => {
      const el = findFirst(
        () => hasText(/ai analysis/i),
        () => hasText(/no ai activity/i),
        () => hasText(/thought/i),
        () => screen.queryByRole('button'),
      );
      expect(el).not.toBeNull();
    });
  });

  it('renders ResultsView for activeView=results', async () => {
    await renderApp();
    act(() => useUIStore.getState().setActiveView('results'));
    await waitFor(() => {
      const el = findFirst(
        () => hasText(/select a target/i),
        () => hasText(/scan results/i),
        () => hasText(/no results/i),
        () => screen.queryByRole('button'),
      );
      expect(el).not.toBeNull();
    });
  });

  it('renders LogsView for activeView=logs', async () => {
    await renderApp();
    act(() => useUIStore.getState().setActiveView('logs'));
    await waitFor(() => {
      const el = findFirst(
        () => hasText(/clear logs/i),
        () => hasText(/export/i),
        () => screen.queryByRole('button'),
      );
      expect(el).not.toBeNull();
    });
  });

  it('renders ConfigurationView for activeView=config', async () => {
    await renderApp();
    act(() => useUIStore.getState().setActiveView('config'));
    await waitFor(() => {
      const el = findFirst(
        () => hasText(/save config/i),
        () => hasText(/scan mode/i),
        () => screen.queryByRole('button'),
      );
      expect(el).not.toBeNull();
    });
  });

  it('renders ExploitationView for activeView=exploitation', async () => {
    await renderApp();
    act(() => useUIStore.getState().setActiveView('exploitation'));
    await waitFor(() => {
      const el = findFirst(
        () => hasText(/web exploitation/i),
        () => hasText(/brute force/i),
        () => screen.queryByRole('button'),
      );
      expect(el).not.toBeNull();
    });
  });

  it('renders LootView for activeView=loot', async () => {
    await renderApp();
    act(() => useUIStore.getState().setActiveView('loot'));
    await waitFor(() => {
      const el = findFirst(
        () => hasText(/loot vault/i),
        () => hasText(/no loot/i),
        () => screen.queryByRole('button'),
      );
      expect(el).not.toBeNull();
    });
  });

  it('renders AttackMapView for activeView=attack-map', async () => {
    await renderApp();
    act(() => useUIStore.getState().setActiveView('attack-map'));
    await waitFor(() => {
      const el = findFirst(
        () => hasText(/mitre/i),
        () => hasText(/attack map/i),
        () => hasText(/tactic/i),
        () => screen.queryByRole('button'),
      );
      expect(el).not.toBeNull();
    });
  });

  it('renders ReportGeneratorView for activeView=reports', async () => {
    await renderApp();
    act(() => useUIStore.getState().setActiveView('reports'));
    await waitFor(() => {
      const el = findFirst(
        () => hasText(/pentest report/i),
        () => hasText(/report generator/i),
        () => hasText(/template/i),
        () => screen.queryByRole('button'),
      );
      expect(el).not.toBeNull();
    });
  });

  it('renders CampaignsView for activeView=campaigns', async () => {
    await renderApp();
    act(() => useUIStore.getState().setActiveView('campaigns'));
    await waitFor(() => {
      const el = findFirst(
        () => hasText(/campaigns/i),
        () => hasText(/target group/i),
        () => screen.queryByRole('button'),
      );
      expect(el).not.toBeNull();
    });
  });

  it('renders ThreatIntelView for activeView=threat-intel', async () => {
    await renderApp();
    act(() => useUIStore.getState().setActiveView('threat-intel'));
    await waitFor(() => {
      const el = findFirst(
        () => hasText(/threat intel/i),
        () => hasText(/opencti/i),
        () => hasText(/indicator/i),
        () => screen.queryByRole('button'),
      );
      expect(el).not.toBeNull();
    });
  });

  it('renders ScanDiffView for activeView=scan-diff', async () => {
    await renderApp();
    act(() => useUIStore.getState().setActiveView('scan-diff'));
    await waitFor(() => {
      const el = findFirst(
        () => hasText(/scan diff/i),
        () => hasText(/snapshot/i),
        () => hasText(/compare/i),
        () => screen.queryByRole('button'),
      );
      expect(el).not.toBeNull();
    });
  });

  it('renders EvidenceView for activeView=evidence', async () => {
    await renderApp();
    act(() => useUIStore.getState().setActiveView('evidence'));
    await waitFor(() => {
      const el = findFirst(
        () => hasText(/evidence collector/i),
        () => hasText(/no evidence/i),
        () => hasText(/timeline/i),
        () => screen.queryByRole('button'),
      );
      expect(el).not.toBeNull();
    });
  });

  it('renders TerminalView for activeView=terminal', async () => {
    await renderApp();
    act(() => useUIStore.getState().setActiveView('terminal'));
    await waitFor(() => {
      const el = findFirst(
        () => screen.queryByRole('textbox'),
        () => hasText(/nmap/i),
        () => screen.queryByPlaceholderText(/command/i),
      );
      expect(el).not.toBeNull();
    });
  });

  it('renders GeoMapView for activeView=geo-map', async () => {
    await renderApp();
    act(() => useUIStore.getState().setActiveView('geo-map'));
    await waitFor(() => {
      const el = findFirst(
        () => hasText(/geo map/i),
        () => hasText(/zoom/i),
        () => document.querySelector('svg'),
        () => screen.queryByRole('button'),
      );
      expect(el).not.toBeNull();
    });
  });

  it('falls back to DashboardView for an unknown activeView', async () => {
    await renderApp();
    act(() => useUIStore.getState().setActiveView('nonexistent-view'));
    await waitFor(() => {
      expect(screen.queryAllByText('Command Center').length).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// Sidebar navigation changes activeView
// ============================================================================

describe('Sidebar navigation', () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
  });

  /**
   * Find a sidebar nav button by its text label.
   * Uses queryAllByText to avoid "multiple elements" errors, then takes the
   * first element with a button ancestor in the sidebar navigation.
   */
  function getSidebarButton(label: string): HTMLElement | null {
    const matches = screen.queryAllByText(label);
    for (const el of matches) {
      const btn = el.closest('button');
      if (btn) return btn;
    }
    return null;
  }

  it('navigates to Logs when clicking the Logs sidebar item', async () => {
    await renderApp();
    const logsBtn = getSidebarButton('Logs');
    expect(logsBtn).not.toBeNull();
    fireEvent.click(logsBtn!);
    await waitFor(() => {
      expect(useUIStore.getState().activeView).toBe('logs');
    });
  });

  it('navigates to Targets when clicking the Targets sidebar item', async () => {
    await renderApp();
    const targetsBtn = getSidebarButton('Targets');
    expect(targetsBtn).not.toBeNull();
    fireEvent.click(targetsBtn!);
    await waitFor(() => {
      expect(useUIStore.getState().activeView).toBe('targets');
    });
  });

  it('navigates to Configuration when clicking the Configuration sidebar item', async () => {
    await renderApp();
    const configBtn = getSidebarButton('Configuration');
    expect(configBtn).not.toBeNull();
    fireEvent.click(configBtn!);
    await waitFor(() => {
      expect(useUIStore.getState().activeView).toBe('config');
    });
  });

  it('navigates to Exploitation when clicking the Exploitation sidebar item', async () => {
    await renderApp();
    const exploitBtn = getSidebarButton('Exploitation');
    expect(exploitBtn).not.toBeNull();
    fireEvent.click(exploitBtn!);
    await waitFor(() => {
      expect(useUIStore.getState().activeView).toBe('exploitation');
    });
  });

  it('navigates to Loot when clicking the Loot sidebar item', async () => {
    await renderApp();
    const lootBtn = getSidebarButton('Loot');
    expect(lootBtn).not.toBeNull();
    fireEvent.click(lootBtn!);
    await waitFor(() => {
      expect(useUIStore.getState().activeView).toBe('loot');
    });
  });

  it('navigates to Results when clicking the Results sidebar item', async () => {
    await renderApp();
    const resultsBtn = getSidebarButton('Results');
    expect(resultsBtn).not.toBeNull();
    fireEvent.click(resultsBtn!);
    await waitFor(() => {
      expect(useUIStore.getState().activeView).toBe('results');
    });
  });

  it('navigates to Services when clicking the Services sidebar item', async () => {
    await renderApp();
    const servicesBtn = getSidebarButton('Services');
    expect(servicesBtn).not.toBeNull();
    fireEvent.click(servicesBtn!);
    await waitFor(() => {
      expect(useUIStore.getState().activeView).toBe('services');
    });
  });

  it('navigates to AI Stream when clicking the AI Stream sidebar item', async () => {
    await renderApp();
    const aiBtn = getSidebarButton('AI Stream');
    expect(aiBtn).not.toBeNull();
    fireEvent.click(aiBtn!);
    await waitFor(() => {
      expect(useUIStore.getState().activeView).toBe('ai-stream');
    });
  });
});
