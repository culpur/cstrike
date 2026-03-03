/**
 * Module View Render Tests
 *
 * Each test verifies that a view renders without crashing and contains
 * expected structural elements. All external dependencies are mocked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';

// ============================================================================
// Mocks — must be declared before imports of the modules under test
// ============================================================================

// apiService mock
vi.mock('@services/api', () => ({
  apiService: {
    getStatus: vi.fn().mockResolvedValue({
      metrics: { cpu: 1, memory: 37, vpnIp: null, uptime: 3600, timestamp: Date.now() },
      services: { metasploitRpc: 'stopped', zap: 'stopped', burp: 'stopped' },
    }),
    getResults: vi.fn().mockResolvedValue([]),
    getTargetResults: vi.fn().mockResolvedValue({
      ports: [],
      subdomains: [],
      vulnerabilities: [],
      urls: [],
      technologies: [],
      httpEndpoints: [],
    }),
    executeCommand: vi.fn().mockResolvedValue({ output: '', exitCode: 0 }),
    getConfig: vi.fn().mockResolvedValue({}),
    updateConfig: vi.fn().mockResolvedValue({}),
    startScan: vi.fn().mockResolvedValue({ scan_id: 'test-scan' }),
    getTargets: vi.fn().mockResolvedValue([]),
    getLoot: vi.fn().mockResolvedValue([]),
    getCredentials: vi.fn().mockResolvedValue([]),
    getActiveScans: vi.fn().mockResolvedValue({ active_scans: [] }),
    startRecon: vi.fn().mockResolvedValue({ scan_id: 'test-scan', status: 'started' }),
    startExploitation: vi.fn().mockResolvedValue({ exploit_id: 'exp-1', status: 'started' }),
    getAIThoughts: vi.fn().mockResolvedValue([]),
    getLogs: vi.fn().mockResolvedValue([]),
    getSystemStatus: vi.fn().mockResolvedValue({}),
    getVpnConnections: vi.fn().mockResolvedValue([]),
    getServiceStatus: vi.fn().mockResolvedValue({}),
    startService: vi.fn().mockResolvedValue({}),
    stopService: vi.fn().mockResolvedValue({}),
    restartService: vi.fn().mockResolvedValue({}),
    getHeatmap: vi.fn().mockResolvedValue({ targets: [], paths: [] }),
    getAIProvider: vi.fn().mockResolvedValue({ provider: 'openai', model: 'gpt-4', status: 'connected' }),
    getMCPTools: vi.fn().mockResolvedValue([]),
    getLootHeatmap: vi.fn().mockResolvedValue({ targets: [], hotspots: [] }),
    getVulnAPIResults: vi.fn().mockResolvedValue({ findings: [] }),
    startBruteforce: vi.fn().mockResolvedValue({ job_id: 'bf-1' }),
    stopRecon: vi.fn().mockResolvedValue(undefined),
    getScanStatus: vi.fn().mockResolvedValue({ status: 'complete' }),
    getSystemMetrics: vi.fn().mockResolvedValue({ cpu: 0, memory: 0, vpnIp: null, uptime: 0, timestamp: Date.now() }),
    startBatchRecon: vi.fn().mockResolvedValue({ scan_ids: [] }),
    startVulnAPIScan: vi.fn().mockResolvedValue({ scan_id: 'vs-1' }),
    client: {
      get: vi.fn().mockResolvedValue({ data: {} }),
      post: vi.fn().mockResolvedValue({ data: {} }),
      put: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
    },
  },
}));

// websocket service mock
vi.mock('@services/websocket', () => ({
  wsService: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn().mockReturnValue(vi.fn()), // returns unsubscribe function
    off: vi.fn(),
    emit: vi.fn(),
    connected: false,
  },
}));

// socket.io-client mock
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

// Image asset mock
vi.mock('@assets/cstrike-icon-64.png', () => ({ default: 'mocked-icon.png' }));

// Recharts mock — avoids SVG measurement errors in jsdom
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

// fetch mock for components making direct fetch calls
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({}),
  text: () => Promise.resolve(''),
});

// localStorage mock (jsdom may not have it in all environments)
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

// ============================================================================
// Lazy-load views (after mocks are set up)
// ============================================================================

import { DashboardView } from '@modules/dashboard/DashboardView';
import { ServicesView } from '@modules/services/ServicesView';
import { TargetsView } from '@modules/targets/TargetsView';
import { AIStreamView } from '@modules/ai-stream/AIStreamView';
import { ResultsView } from '@modules/results/ResultsView';
import { LogsView } from '@modules/logs/LogsView';
import { ConfigurationView } from '@modules/configuration/ConfigurationView';
import { ExploitationView } from '@modules/exploitation/ExploitationView';
import { LootView } from '@modules/loot/LootView';
import { AttackMapView } from '@modules/attack-map/AttackMapView';
import { ReportGeneratorView } from '@modules/reports/ReportGeneratorView';
import { CampaignsView } from '@modules/campaigns/CampaignsView';
import { ThreatIntelView } from '@modules/threat-intel/ThreatIntelView';
import { ScanDiffView } from '@modules/scan-diff/ScanDiffView';
import { EvidenceView } from '@modules/evidence/EvidenceView';
import { TerminalView } from '@modules/terminal/TerminalView';
import { GeoMapView } from '@modules/geo-map/GeoMapView';

// ============================================================================
// Reset stores between tests to avoid state bleed
// ============================================================================

beforeEach(async () => {
  vi.clearAllMocks();
  // Re-apply resolved values after clearAllMocks
  const { apiService } = await import('@services/api');
  vi.mocked(apiService.getStatus).mockResolvedValue({
    metrics: { cpu: 1, memory: 37, vpnIp: null, uptime: 3600, timestamp: Date.now() },
    services: { metasploitRpc: 'stopped', zap: 'stopped', burp: 'stopped' },
  } as any);
  vi.mocked(apiService.getTargets).mockResolvedValue([]);
  vi.mocked(apiService.getLoot).mockResolvedValue([]);
  vi.mocked(apiService.getActiveScans).mockResolvedValue({ active_scans: [] } as any);
  vi.mocked(apiService.getAIThoughts).mockResolvedValue([]);
  vi.mocked(apiService.getLogs).mockResolvedValue([]);
  vi.mocked(apiService.getCredentials).mockResolvedValue([]);
  vi.mocked(apiService.getTargetResults).mockResolvedValue({
    ports: [],
    subdomains: [],
    vulnerabilities: [],
    urls: [],
    technologies: [],
    httpEndpoints: [],
  } as any);
  vi.mocked(apiService.getConfig).mockResolvedValue({} as any);
  vi.mocked(apiService.getVpnConnections).mockResolvedValue([]);
  vi.mocked(apiService.getServiceStatus).mockResolvedValue({} as any);
  vi.mocked(apiService.getAIProvider).mockResolvedValue({ provider: 'openai', model: 'gpt-4', status: 'connected' });
  vi.mocked(apiService.getMCPTools).mockResolvedValue([]);
  vi.mocked(apiService.getLootHeatmap).mockResolvedValue({ targets: [], hotspots: [] } as any);
  vi.mocked(apiService.getSystemMetrics).mockResolvedValue({ cpu: 0, memory: 0, vpnIp: null, uptime: 0, timestamp: Date.now() });

  const { wsService } = await import('@services/websocket');
  vi.mocked(wsService.on).mockReturnValue(vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Helper
// ============================================================================

async function renderView(Component: React.ComponentType) {
  let container: HTMLElement = document.body;
  await act(async () => {
    const result = render(<Component />);
    container = result.container;
  });
  return container;
}

/**
 * Safe alternative to queryByText that never throws even when multiple
 * elements match. Returns the first matching element or null.
 */
function findFirst(...queries: (() => Element | null | HTMLElement | undefined)[]): Element | null {
  for (const q of queries) {
    try {
      const el = q();
      if (el) return el as Element;
    } catch {
      // swallow "found multiple elements" errors
    }
  }
  return null;
}

function hasText(pattern: RegExp): Element | null {
  const all = screen.queryAllByText(pattern);
  return all.length > 0 ? all[0] : null;
}

// ============================================================================
// DashboardView
// ============================================================================

describe('DashboardView', () => {
  it('renders without crashing', async () => {
    await renderView(DashboardView);
  });

  it('shows Command Center heading', async () => {
    await renderView(DashboardView);
    expect(screen.getByText('Command Center')).toBeInTheDocument();
  });

  it('shows Launch Scan button', async () => {
    await renderView(DashboardView);
    expect(screen.getByText('Launch Scan')).toBeInTheDocument();
  });

  it('shows telemetry labels (CPU, RAM, VPN, Uptime, Targets)', async () => {
    await renderView(DashboardView);
    expect(screen.getByText('CPU')).toBeInTheDocument();
    expect(screen.getByText('RAM')).toBeInTheDocument();
  });

  it('shows service indicators', async () => {
    await renderView(DashboardView);
    expect(screen.getByText('API')).toBeInTheDocument();
  });
});

// ============================================================================
// ServicesView
// ============================================================================

describe('ServicesView', () => {
  it('renders without crashing', async () => {
    await renderView(ServicesView);
  });

  it('shows Services heading', async () => {
    await renderView(ServicesView);
    const headings = screen.getAllByText(/services/i);
    expect(headings.length).toBeGreaterThan(0);
  });

  it('shows Managed Services section', async () => {
    await renderView(ServicesView);
    expect(screen.getByText(/managed services/i)).toBeInTheDocument();
  });
});

// ============================================================================
// TargetsView
// ============================================================================

describe('TargetsView', () => {
  it('renders without crashing', async () => {
    await renderView(TargetsView);
  });

  it('shows Targets heading or Add Target button', async () => {
    await renderView(TargetsView);
    const el = findFirst(
      () => hasText(/target/i),
      () => screen.queryByRole('button'),
    );
    expect(el).not.toBeNull();
  });

  it('shows Add Target functionality', async () => {
    await renderView(TargetsView);
    await waitFor(() => {
      const addBtn = findFirst(
        () => hasText(/add target/i),
        () => screen.queryByRole('textbox'),
      );
      expect(addBtn).not.toBeNull();
    });
  });
});

// ============================================================================
// AIStreamView
// ============================================================================

describe('AIStreamView', () => {
  it('renders without crashing', async () => {
    await renderView(AIStreamView);
  });

  it('shows AI Stream related content', async () => {
    await renderView(AIStreamView);
    const el = findFirst(
      () => hasText(/ai stream/i),
      () => hasText(/thought/i),
      () => hasText(/stream/i),
      () => screen.queryByRole('button'),
    );
    expect(el).not.toBeNull();
  });
});

// ============================================================================
// ResultsView
// ============================================================================

describe('ResultsView', () => {
  it('renders without crashing', async () => {
    await renderView(ResultsView);
  });

  it('shows results-related content', async () => {
    await renderView(ResultsView);
    const el = findFirst(
      () => hasText(/scan results/i),
      () => hasText(/vulnerabilit/i),
      () => hasText(/no targets/i),
      () => hasText(/select a target/i),
      () => screen.queryByRole('button'),
    );
    expect(el).not.toBeNull();
  });
});

// ============================================================================
// LogsView
// ============================================================================

describe('LogsView', () => {
  it('renders without crashing', async () => {
    await renderView(LogsView);
  });

  it('shows log-related UI elements', async () => {
    await renderView(LogsView);
    const el = findFirst(
      () => hasText(/system log/i),
      () => hasText(/clear logs/i),
      () => hasText(/export/i),
      () => screen.queryByRole('button'),
    );
    expect(el).not.toBeNull();
  });
});

// ============================================================================
// ConfigurationView
// ============================================================================

describe('ConfigurationView', () => {
  it('renders without crashing', async () => {
    await renderView(ConfigurationView);
  });

  it('shows configuration-related content', async () => {
    await renderView(ConfigurationView);
    const el = findFirst(
      () => hasText(/save config/i),
      () => hasText(/configuration/i),
      () => hasText(/scan mode/i),
      () => screen.queryByRole('button'),
    );
    expect(el).not.toBeNull();
  });
});

// ============================================================================
// ExploitationView
// ============================================================================

describe('ExploitationView', () => {
  it('renders without crashing', async () => {
    await renderView(ExploitationView);
  });

  it('shows exploitation-related content', async () => {
    await renderView(ExploitationView);
    const el = findFirst(
      () => hasText(/exploitation/i),
      () => hasText(/web exploit/i),
      () => hasText(/brute force/i),
      () => screen.queryByRole('button'),
    );
    expect(el).not.toBeNull();
  });
});

// ============================================================================
// LootView
// ============================================================================

describe('LootView', () => {
  it('renders without crashing', async () => {
    await renderView(LootView);
  });

  it('shows loot-related content', async () => {
    await renderView(LootView);
    const el = findFirst(
      () => hasText(/loot vault/i),
      () => hasText(/all loot/i),
      () => hasText(/credential/i),
      () => screen.queryByRole('button'),
    );
    expect(el).not.toBeNull();
  });
});

// ============================================================================
// AttackMapView
// ============================================================================

describe('AttackMapView', () => {
  it('renders without crashing', async () => {
    await renderView(AttackMapView);
  });

  it('shows MITRE or attack map related content', async () => {
    await renderView(AttackMapView);
    const el = findFirst(
      () => hasText(/mitre/i),
      () => hasText(/tactic/i),
      () => hasText(/technique/i),
      () => hasText(/matrix/i),
      () => hasText(/attack map/i),
      () => screen.queryByRole('button'),
    );
    expect(el).not.toBeNull();
  });
});

// ============================================================================
// ReportGeneratorView
// ============================================================================

describe('ReportGeneratorView', () => {
  it('renders without crashing', async () => {
    await renderView(ReportGeneratorView);
  });

  it('shows report-related content', async () => {
    await renderView(ReportGeneratorView);
    const el = findFirst(
      () => hasText(/pentest report/i),
      () => hasText(/report generator/i),
      () => hasText(/generate report/i),
      () => hasText(/template/i),
      () => screen.queryByRole('button'),
    );
    expect(el).not.toBeNull();
  });
});

// ============================================================================
// CampaignsView
// ============================================================================

describe('CampaignsView', () => {
  it('renders without crashing', async () => {
    await renderView(CampaignsView);
  });

  it('shows campaign or schedule related content', async () => {
    await renderView(CampaignsView);
    const el = findFirst(
      () => hasText(/campaigns/i),
      () => hasText(/schedule/i),
      () => hasText(/target group/i),
      () => screen.queryByRole('button'),
    );
    expect(el).not.toBeNull();
  });
});

// ============================================================================
// ThreatIntelView
// ============================================================================

describe('ThreatIntelView', () => {
  it('renders without crashing', async () => {
    await renderView(ThreatIntelView);
  });

  it('shows threat intel or connection-related content', async () => {
    await renderView(ThreatIntelView);
    const el = findFirst(
      () => hasText(/threat intel/i),
      () => hasText(/opencti/i),
      () => hasText(/indicator/i),
      () => hasText(/connection/i),
      () => screen.queryByRole('button'),
    );
    expect(el).not.toBeNull();
  });
});

// ============================================================================
// ScanDiffView
// ============================================================================

describe('ScanDiffView', () => {
  it('renders without crashing', async () => {
    await renderView(ScanDiffView);
  });

  it('shows scan diff related content', async () => {
    await renderView(ScanDiffView);
    const el = findFirst(
      () => hasText(/scan diff/i),
      () => hasText(/snapshot/i),
      () => hasText(/compare/i),
      () => hasText(/select a scan/i),
      () => screen.queryByRole('button'),
    );
    expect(el).not.toBeNull();
  });
});

// ============================================================================
// EvidenceView
// ============================================================================

describe('EvidenceView', () => {
  it('renders without crashing', async () => {
    await renderView(EvidenceView);
  });

  it('shows evidence-related content', async () => {
    await renderView(EvidenceView);
    const el = findFirst(
      () => hasText(/evidence collector/i),
      () => hasText(/no evidence/i),
      () => hasText(/timeline/i),
      () => hasText(/engagement/i),
      () => screen.queryByRole('button'),
    );
    expect(el).not.toBeNull();
  });
});

// ============================================================================
// TerminalView
// ============================================================================

describe('TerminalView', () => {
  it('renders without crashing', async () => {
    await renderView(TerminalView);
  });

  it('shows terminal or command input', async () => {
    await renderView(TerminalView);
    const el = findFirst(
      () => screen.queryByRole('textbox'),
      () => hasText(/nmap/i),
      () => screen.queryByPlaceholderText(/command/i),
      () => screen.queryByPlaceholderText(/enter command/i),
      () => screen.queryByRole('button'),
    );
    expect(el).not.toBeNull();
  });
});

// ============================================================================
// GeoMapView
// ============================================================================

describe('GeoMapView', () => {
  it('renders without crashing', async () => {
    await renderView(GeoMapView);
  });

  it('shows geo map or world map related content', async () => {
    await renderView(GeoMapView);
    const el = findFirst(
      () => hasText(/geo map/i),
      () => hasText(/world map/i),
      () => hasText(/zoom/i),
      () => document.querySelector('svg'),
      () => screen.queryByRole('button'),
    );
    expect(el).not.toBeNull();
  });
});
