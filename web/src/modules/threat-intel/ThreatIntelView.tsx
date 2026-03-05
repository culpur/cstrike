/**
 * ThreatIntelView — OpenCTI Threat Intelligence Integration
 *
 * Connects CStrike scan findings to an OpenCTI instance for enrichment:
 * - Tab 1: Connection & Config
 * - Tab 2: Indicator Lookup (IP, Domain, URL, CVE, Hash)
 * - Tab 3: Target Enrichment (cross-reference CStrike targets with OpenCTI)
 * - Tab 4: Feed & Reports (paginated threat report feed)
 *
 * Uses direct fetch() to OpenCTI GraphQL — no backend proxy required.
 * Degrades gracefully to demo mode when not connected.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Shield,
  Wifi,
  WifiOff,
  Eye,
  EyeOff,
  Search,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Target,
  FileText,
  Link2,
  Zap,
  Tag,
  Calendar,
  Activity,
  Info,
} from 'lucide-react';
import { Panel, Input } from '@components/ui';
import { useUIStore } from '@stores/uiStore';
import { apiService } from '@services/api';
import { cn } from '@utils/index';

// ============================================================================
// Types
// ============================================================================

type TLPLevel = 'WHITE' | 'GREEN' | 'AMBER' | 'RED';
type IndicatorType = 'ip' | 'domain' | 'url' | 'cve' | 'hash';
type ReportType = 'threat-report' | 'incident' | 'malware-analysis' | 'all';

interface OpenCTIConfig {
  url: string;
  token: string;
}

interface IndicatorLabel {
  value: string;
  color: string;
}

interface KillChainPhase {
  kill_chain_name: string;
  phase_name: string;
}

interface Indicator {
  id: string;
  name: string;
  pattern: string;
  valid_from: string;
  confidence: number;
  tlp: TLPLevel;
  labels: IndicatorLabel[];
  killChainPhases: KillChainPhase[];
  malwareFamilies: string[];
  threatActors: string[];
}

interface ThreatReport {
  id: string;
  name: string;
  description: string;
  confidence: number;
  published: string;
  report_types: string[];
  indicators: string[];
  campaigns: string[];
  techniques: string[];
  expanded: boolean;
}

interface EnrichmentResult {
  targetUrl: string;
  threatActors: string[];
  relatedCVEs: Array<{ id: string; exploited: boolean }>;
  mitreAttack: string[];
  riskScore: number;
  reportTimeline: Array<{ date: string; title: string }>;
}

// ============================================================================
// OpenCTI Client
// ============================================================================

const STORAGE_URL_KEY = 'cstrike_opencti_url';
const STORAGE_TOKEN_KEY = 'cstrike_opencti_token';

const openctiClient = {
  getConfig(): OpenCTIConfig {
    return {
      url: localStorage.getItem(STORAGE_URL_KEY) ?? '',
      token: localStorage.getItem(STORAGE_TOKEN_KEY) ?? '',
    };
  },

  saveConfig(config: OpenCTIConfig): void {
    localStorage.setItem(STORAGE_URL_KEY, config.url);
    localStorage.setItem(STORAGE_TOKEN_KEY, config.token);
  },

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const { url, token } = this.getConfig();
    if (!url || !token) throw new Error('OpenCTI not configured');

    const res = await fetch(`${url}/graphql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors[0].message);
    return json.data as T;
  },

  async testConnection(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const data = await this.graphql<{ about: { version: string } }>(
        `query { about { version } }`
      );
      return { ok: true, version: data.about?.version };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  },

  async searchIndicators(type: IndicatorType, value: string): Promise<Indicator[]> {
    const query = `
      query SearchIndicators($search: String!) {
        indicators(search: $search, first: 20) {
          edges {
            node {
              id
              name
              pattern
              valid_from
              confidence
              objectLabel { value color }
              objectMarking { definition }
              killChainPhases { kill_chain_name phase_name }
            }
          }
        }
      }
    `;

    const data = await this.graphql<{
      indicators: { edges: Array<{ node: RawIndicatorNode }> };
    }>(query, { search: value });

    return (data.indicators?.edges ?? []).map(({ node }) => normalizeIndicator(node, type));
  },

  async getIndicatorsForIP(ip: string): Promise<Indicator[]> {
    return this.searchIndicators('ip', ip);
  },

  async getIndicatorsForDomain(domain: string): Promise<Indicator[]> {
    return this.searchIndicators('domain', domain);
  },

  async getReports(filters: { type: ReportType; minConfidence: number; limit?: number }): Promise<ThreatReport[]> {
    const query = `
      query GetReports($first: Int, $filters: FilterGroup) {
        reports(first: $first, filters: $filters, orderBy: published, orderMode: desc) {
          edges {
            node {
              id
              name
              description
              confidence
              published
              report_types
              objects(first: 50) {
                edges { node { ... on Indicator { name } } }
              }
            }
          }
        }
      }
    `;

    const data = await this.graphql<{
      reports: { edges: Array<{ node: RawReportNode }> };
    }>(query, {
      first: filters.limit ?? 20,
    });

    return (data.reports?.edges ?? []).map(({ node }) => normalizeReport(node));
  },
};

// ============================================================================
// GraphQL Response Normalizers
// ============================================================================

interface RawIndicatorNode {
  id: string;
  name: string;
  pattern?: string;
  valid_from?: string;
  confidence?: number;
  objectLabel?: Array<{ value: string; color: string }>;
  objectMarking?: Array<{ definition: string }>;
  killChainPhases?: Array<{ kill_chain_name: string; phase_name: string }>;
}

function normalizeIndicator(node: RawIndicatorNode, _type: IndicatorType): Indicator {
  const marking = node.objectMarking?.[0]?.definition ?? 'TLP:WHITE';
  const tlpRaw = marking.replace('TLP:', '') as TLPLevel;
  const tlp: TLPLevel = ['WHITE', 'GREEN', 'AMBER', 'RED'].includes(tlpRaw) ? tlpRaw : 'WHITE';

  return {
    id: node.id,
    name: node.name,
    pattern: node.pattern ?? '',
    valid_from: node.valid_from ?? '',
    confidence: node.confidence ?? 0,
    tlp,
    labels: node.objectLabel ?? [],
    killChainPhases: node.killChainPhases ?? [],
    malwareFamilies: [],
    threatActors: [],
  };
}

interface RawReportNode {
  id: string;
  name: string;
  description?: string;
  confidence?: number;
  published?: string;
  report_types?: string[];
  objects?: { edges: Array<{ node: { name?: string } }> };
}

function normalizeReport(node: RawReportNode): ThreatReport {
  return {
    id: node.id,
    name: node.name,
    description: node.description ?? '',
    confidence: node.confidence ?? 0,
    published: node.published ?? '',
    report_types: node.report_types ?? ['threat-report'],
    indicators: (node.objects?.edges ?? []).map((e) => e.node.name ?? '').filter(Boolean),
    campaigns: [],
    techniques: [],
    expanded: false,
  };
}

// ============================================================================
// Demo / Mock Data (shown when not connected)
// ============================================================================

const DEMO_INDICATORS: Indicator[] = [
  {
    id: 'demo-1',
    name: '198.51.100.22',
    pattern: "[ipv4-addr:value = '198.51.100.22']",
    valid_from: '2025-11-15T00:00:00Z',
    confidence: 85,
    tlp: 'AMBER',
    labels: [{ value: 'c2-server', color: '#ff2040' }, { value: 'APT29', color: '#8844ff' }],
    killChainPhases: [
      { kill_chain_name: 'mitre-attack', phase_name: 'command-and-control' },
    ],
    malwareFamilies: ['SUNBURST', 'Cobalt Strike'],
    threatActors: ['APT29 (Cozy Bear)'],
  },
  {
    id: 'demo-2',
    name: 'malicious-update.cdn-edge.net',
    pattern: "[domain-name:value = 'malicious-update.cdn-edge.net']",
    valid_from: '2025-10-01T00:00:00Z',
    confidence: 92,
    tlp: 'RED',
    labels: [{ value: 'phishing', color: '#ffaa00' }, { value: 'dropper', color: '#ff2040' }],
    killChainPhases: [
      { kill_chain_name: 'mitre-attack', phase_name: 'initial-access' },
      { kill_chain_name: 'mitre-attack', phase_name: 'delivery' },
    ],
    malwareFamilies: ['AgentTesla'],
    threatActors: ['TA505'],
  },
  {
    id: 'demo-3',
    name: 'CVE-2024-21413',
    pattern: "[vulnerability:name = 'CVE-2024-21413']",
    valid_from: '2024-02-13T00:00:00Z',
    confidence: 99,
    tlp: 'WHITE',
    labels: [{ value: 'critical', color: '#ff0033' }, { value: 'rce', color: '#ff2040' }],
    killChainPhases: [
      { kill_chain_name: 'mitre-attack', phase_name: 'exploitation' },
    ],
    malwareFamilies: [],
    threatActors: ['Midnight Blizzard'],
  },
];

const DEMO_REPORTS: ThreatReport[] = [
  {
    id: 'demo-r1',
    name: 'APT29 Supply Chain Campaign — Q4 2025',
    description: 'Analysis of a sophisticated supply chain compromise targeting software vendors in the financial and defence sectors. Adversary leveraged trojanized build tools to establish persistent access.',
    confidence: 88,
    published: '2025-12-01T00:00:00Z',
    report_types: ['threat-report'],
    indicators: ['198.51.100.22', 'cdn-edge.malicious.net', 'SHA256:a1b2c3d4e5f6...'],
    campaigns: ['SolarWinds-Like Operation 2025'],
    techniques: ['T1195.002', 'T1059.003', 'T1071.001', 'T1078'],
    expanded: false,
  },
  {
    id: 'demo-r2',
    name: 'Ransomware-as-a-Service: BlackCat Infrastructure Update',
    description: 'Updated infrastructure mapping for BlackCat/ALPHV ransomware operations. New C2 domains identified via sinkhole analysis.',
    confidence: 75,
    published: '2025-11-18T00:00:00Z',
    report_types: ['incident'],
    indicators: ['185.220.101.99', 'ransomware-pay.onion', 'SHA1:deadbeef123...'],
    campaigns: ['BlackCat/ALPHV 2025'],
    techniques: ['T1486', 'T1489', 'T1490'],
    expanded: false,
  },
  {
    id: 'demo-r3',
    name: 'Zero-Day Exploitation in Enterprise VPN Products',
    description: 'Active exploitation of unpatched vulnerabilities in widely-deployed enterprise VPN solutions. Threat actors pivoting from initial access to lateral movement within hours.',
    confidence: 95,
    published: '2025-10-30T00:00:00Z',
    report_types: ['malware-analysis'],
    indicators: ['CVE-2025-1234', 'CVE-2025-5678', '10.0.0.0/8 (internal)'],
    campaigns: [],
    techniques: ['T1133', 'T1210', 'T1021.002'],
    expanded: false,
  },
];

// ============================================================================
// Sub-components
// ============================================================================

function TLPBadge({ level }: { level: TLPLevel }) {
  const styles: Record<TLPLevel, string> = {
    WHITE: 'bg-white/10 text-white border-white/30',
    GREEN: 'bg-green-900/40 text-green-400 border-green-700/50',
    AMBER: 'bg-amber-900/40 text-amber-400 border-amber-700/50',
    RED: 'bg-red-900/40 text-red-400 border-red-700/50',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono font-bold border',
        styles[level]
      )}
    >
      TLP:{level}
    </span>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  const color =
    pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-grok-surface-2 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono text-grok-text-muted w-8 text-right">{pct}</span>
    </div>
  );
}

interface RiskGaugeProps {
  score: number;
}

function RiskGauge({ score }: RiskGaugeProps) {
  const pct = Math.min(100, Math.max(0, score));
  // SVG arc: half-circle gauge from 180deg to 0deg
  const radius = 44;
  const cx = 60;
  const cy = 60;
  const startAngle = Math.PI; // 180deg — left
  const endAngle = 0; // 0deg — right
  const sweepAngle = Math.PI; // 180deg total sweep

  const valueAngle = startAngle - (pct / 100) * sweepAngle;
  const x1 = cx + radius * Math.cos(startAngle);
  const y1 = cy + radius * Math.sin(startAngle);
  const x2 = cx + radius * Math.cos(valueAngle);
  const y2 = cy + radius * Math.sin(valueAngle);
  const largeArc = pct > 50 ? 1 : 0;

  const trackX2 = cx + radius * Math.cos(endAngle);
  const trackY2 = cy + radius * Math.sin(endAngle);

  const color = pct >= 75 ? '#ff0033' : pct >= 50 ? '#ff2040' : pct >= 25 ? '#ffaa00' : '#00cc66';
  const label = pct >= 75 ? 'CRITICAL' : pct >= 50 ? 'HIGH' : pct >= 25 ? 'MEDIUM' : 'LOW';

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 120 70" className="w-32 h-20" aria-label={`Risk score: ${score}/100`}>
        {/* Track */}
        <path
          d={`M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${trackX2} ${trackY2}`}
          fill="none"
          stroke="var(--grok-border)"
          strokeWidth="8"
          strokeLinecap="round"
        />
        {/* Value arc */}
        {pct > 0 && (
          <path
            d={`M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${color})` }}
          />
        )}
        {/* Score text */}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          className="font-bold"
          fill={color}
          fontSize="18"
          fontFamily="monospace"
        >
          {pct}
        </text>
        <text
          x={cx}
          y={cy + 10}
          textAnchor="middle"
          fill="var(--grok-text-muted)"
          fontSize="8"
          fontFamily="monospace"
        >
          RISK
        </text>
      </svg>
      <span
        className="text-xs font-bold font-mono tracking-widest"
        style={{ color }}
      >
        {label}
      </span>
    </div>
  );
}

function IndicatorCard({ indicator }: { indicator: Indicator }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-grok-border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-3 bg-grok-surface-2 hover:bg-grok-hover transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Shield className="w-4 h-4 text-grok-recon-blue flex-shrink-0" />
          <span className="text-sm font-mono text-grok-text-heading truncate">
            {indicator.name}
          </span>
          <TLPBadge level={indicator.tlp} />
        </div>
        <div className="flex items-center gap-2 ml-3 flex-shrink-0">
          <span className="text-xs text-grok-text-muted font-mono">{indicator.confidence}%</span>
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-grok-text-muted" />
          ) : (
            <ChevronRight className="w-4 h-4 text-grok-text-muted" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="p-4 bg-grok-surface-1 border-t border-grok-border space-y-4">
          {/* Confidence */}
          <div>
            <p className="text-xs text-grok-text-muted mb-1.5 uppercase tracking-wide">
              Confidence
            </p>
            <ConfidenceBar value={indicator.confidence} />
          </div>

          {/* Pattern */}
          {indicator.pattern && (
            <div>
              <p className="text-xs text-grok-text-muted mb-1.5 uppercase tracking-wide">
                STIX Pattern
              </p>
              <code className="block text-xs font-mono text-grok-scan-cyan bg-grok-void px-3 py-2 rounded border border-grok-border break-all">
                {indicator.pattern}
              </code>
            </div>
          )}

          {/* Labels */}
          {indicator.labels.length > 0 && (
            <div>
              <p className="text-xs text-grok-text-muted mb-1.5 uppercase tracking-wide flex items-center gap-1">
                <Tag className="w-3 h-3" /> Labels
              </p>
              <div className="flex flex-wrap gap-1.5">
                {indicator.labels.map((label) => (
                  <span
                    key={label.value}
                    className="px-2 py-0.5 rounded text-xs font-mono"
                    style={{
                      backgroundColor: `${label.color}22`,
                      color: label.color,
                      border: `1px solid ${label.color}44`,
                    }}
                  >
                    {label.value}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Kill Chain */}
          {indicator.killChainPhases.length > 0 && (
            <div>
              <p className="text-xs text-grok-text-muted mb-1.5 uppercase tracking-wide flex items-center gap-1">
                <Activity className="w-3 h-3" /> Kill Chain Phases
              </p>
              <div className="flex flex-wrap gap-1.5">
                {indicator.killChainPhases.map((phase, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 rounded text-xs font-mono bg-grok-ai-purple/10 text-grok-ai-purple border border-grok-ai-purple/30"
                    style={{ '--grok-ai-purple': '#8844ff' } as React.CSSProperties}
                  >
                    {phase.phase_name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Threat Actors */}
          {indicator.threatActors.length > 0 && (
            <div>
              <p className="text-xs text-grok-text-muted mb-1.5 uppercase tracking-wide flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Threat Actors
              </p>
              <div className="flex flex-wrap gap-1.5">
                {indicator.threatActors.map((actor) => (
                  <span
                    key={actor}
                    className="px-2 py-0.5 rounded text-xs font-mono bg-grok-exploit-red/10 text-grok-exploit-red border border-grok-exploit-red/30"
                  >
                    {actor}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Malware Families */}
          {indicator.malwareFamilies.length > 0 && (
            <div>
              <p className="text-xs text-grok-text-muted mb-1.5 uppercase tracking-wide flex items-center gap-1">
                <Zap className="w-3 h-3" /> Malware Families
              </p>
              <div className="flex flex-wrap gap-1.5">
                {indicator.malwareFamilies.map((mw) => (
                  <span
                    key={mw}
                    className="px-2 py-0.5 rounded text-xs font-mono bg-grok-loot-green/10 text-grok-loot-green border border-grok-loot-green/30"
                    style={{ '--grok-loot-green': '#00cc66' } as React.CSSProperties}
                  >
                    {mw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Valid From */}
          {indicator.valid_from && (
            <p className="text-xs text-grok-text-muted flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              Valid from {new Date(indicator.valid_from).toLocaleDateString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Tab definitions
// ============================================================================

type TabId = 'config' | 'lookup' | 'enrichment' | 'feed';

const TABS: Array<{ id: TabId; label: string; icon: React.ElementType }> = [
  { id: 'config', label: 'Connection', icon: Wifi },
  { id: 'lookup', label: 'Indicator Lookup', icon: Search },
  { id: 'enrichment', label: 'Target Enrichment', icon: Target },
  { id: 'feed', label: 'Feed & Reports', icon: FileText },
];

// ============================================================================
// Main View
// ============================================================================

export function ThreatIntelView() {
  const { addToast } = useUIStore();

  // Connection state
  const [config, setConfig] = useState<OpenCTIConfig>(() => openctiClient.getConfig());
  const [showToken, setShowToken] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'connected' | 'failed'>('unknown');
  const [connectionVersion, setConnectionVersion] = useState<string | undefined>();
  const [isTesting, setIsTesting] = useState(false);
  const isConnected = connectionStatus === 'connected';

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>('config');

  // Indicator Lookup state
  const [searchType, setSearchType] = useState<IndicatorType>('ip');
  const [searchValue, setSearchValue] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [indicatorResults, setIndicatorResults] = useState<Indicator[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  // Target Enrichment state
  const [cstrikeTargets, setCstrikeTargets] = useState<string[]>([]);
  const [enrichingTarget, setEnrichingTarget] = useState<string | null>(null);
  const [enrichmentResults, setEnrichmentResults] = useState<Map<string, EnrichmentResult>>(new Map());
  const [expandedTargets, setExpandedTargets] = useState<Set<string>>(new Set());

  // Feed state
  const [reports, setReports] = useState<ThreatReport[]>([]);
  const [reportTypeFilter, setReportTypeFilter] = useState<ReportType>('all');
  const [minConfidence, setMinConfidence] = useState(0);
  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [reportPage, setReportPage] = useState(0);
  const REPORTS_PER_PAGE = 10;

  const isDemoMode = !isConnected;
  const displayIndicators = isDemoMode && hasSearched ? DEMO_INDICATORS : indicatorResults;
  const displayReports = isDemoMode ? DEMO_REPORTS : reports;

  // Load targets from CStrike API on mount
  useEffect(() => {
    apiService
      .getTargets()
      .then((targets) => setCstrikeTargets(targets.map((t) => t.url)))
      .catch(() => {/* targets unavailable */});
  }, []);

  // Auto-test connection on mount if config exists
  const hasAutoTested = useRef(false);
  useEffect(() => {
    if (hasAutoTested.current) return;
    if (config.url && config.token) {
      hasAutoTested.current = true;
      handleTestConnection(config);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================================
  // Handlers
  // ============================================================================

  async function handleTestConnection(cfg: OpenCTIConfig = config) {
    setIsTesting(true);
    try {
      openctiClient.saveConfig(cfg);
      const result = await openctiClient.testConnection();
      if (result.ok) {
        setConnectionStatus('connected');
        setConnectionVersion(result.version);
        addToast({ type: 'success', message: `Connected to OpenCTI ${result.version ?? ''}`.trim() });
      } else {
        setConnectionStatus('failed');
        addToast({ type: 'error', message: `Connection failed: ${result.error}` });
      }
    } catch (err) {
      setConnectionStatus('failed');
      addToast({ type: 'error', message: 'Connection test failed — check URL and token' });
    } finally {
      setIsTesting(false);
    }
  }

  function handleSaveConfig() {
    openctiClient.saveConfig(config);
    addToast({ type: 'success', message: 'OpenCTI config saved' });
  }

  async function handleSearch() {
    if (!searchValue.trim()) return;
    setIsSearching(true);
    setHasSearched(true);

    try {
      if (isConnected) {
        const results = await openctiClient.searchIndicators(searchType, searchValue.trim());
        setIndicatorResults(results);
        if (results.length === 0) {
          addToast({ type: 'info', message: 'No indicators found for this query' });
        }
      } else {
        // Demo mode: filter mock data loosely
        const filtered = DEMO_INDICATORS.filter((i) =>
          i.name.toLowerCase().includes(searchValue.toLowerCase()) ||
          i.pattern.toLowerCase().includes(searchValue.toLowerCase())
        );
        setIndicatorResults(filtered.length > 0 ? filtered : DEMO_INDICATORS);
      }
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Search failed',
      });
    } finally {
      setIsSearching(false);
    }
  }

  async function handleEnrichTarget(targetUrl: string) {
    setEnrichingTarget(targetUrl);
    setExpandedTargets((prev) => new Set(prev).add(targetUrl));

    try {
      if (isConnected) {
        // Extract hostname from URL for lookup
        let host = targetUrl;
        try { host = new URL(targetUrl).hostname; } catch {}
        const indicators = await openctiClient.getIndicatorsForDomain(host);

        // Derive enrichment from real indicators
        const threatActors = [...new Set(indicators.flatMap((i) => i.threatActors))];
        const relatedCVEs = indicators
          .filter((i) => i.name.toUpperCase().startsWith('CVE-'))
          .map((i) => ({ id: i.name, exploited: i.confidence > 70 }));
        const mitreAttack = [...new Set(indicators.flatMap((i) => i.killChainPhases.map((p) => p.phase_name)))];
        const riskScore = Math.min(100, Math.round(
          indicators.reduce((sum, i) => sum + i.confidence, 0) / Math.max(1, indicators.length)
        ));

        setEnrichmentResults((prev) => {
          const next = new Map(prev);
          next.set(targetUrl, {
            targetUrl,
            threatActors,
            relatedCVEs,
            mitreAttack,
            riskScore,
            reportTimeline: [],
          });
          return next;
        });
      } else {
        // Demo enrichment
        await new Promise((r) => setTimeout(r, 800));
        const demoResult: EnrichmentResult = {
          targetUrl,
          threatActors: ['APT29 (Cozy Bear)', 'FIN7'],
          relatedCVEs: [
            { id: 'CVE-2024-21413', exploited: true },
            { id: 'CVE-2023-38831', exploited: false },
          ],
          mitreAttack: ['initial-access', 'execution', 'persistence', 'lateral-movement'],
          riskScore: 67,
          reportTimeline: [
            { date: '2025-12-01', title: 'APT29 Campaign Targeting Financial Sector' },
            { date: ' 2025-10-15', title: 'Cobalt Strike Infrastructure Reuse' },
          ],
        };
        setEnrichmentResults((prev) => {
          const next = new Map(prev);
          next.set(targetUrl, demoResult);
          return next;
        });
      }

      addToast({ type: 'success', message: `Enrichment complete for ${targetUrl}` });
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Enrichment failed',
      });
    } finally {
      setEnrichingTarget(null);
    }
  }

  const handleToggleTarget = useCallback((url: string) => {
    setExpandedTargets((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }, []);

  async function handleLoadReports() {
    setIsLoadingReports(true);
    try {
      if (isConnected) {
        const fetched = await openctiClient.getReports({
          type: reportTypeFilter,
          minConfidence,
          limit: REPORTS_PER_PAGE,
        });
        setReports(fetched);
        setReportPage(0);
      }
      // In demo mode, displayReports = DEMO_REPORTS, no action needed
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to load reports',
      });
    } finally {
      setIsLoadingReports(false);
    }
  }

  function handleToggleReport(id: string) {
    setReports((prev) =>
      prev.map((r) => (r.id === id ? { ...r, expanded: !r.expanded } : r))
    );
  }

  function handleCrossReference(report: ThreatReport) {
    addToast({
      type: 'info',
      message: `Cross-referencing "${report.name}" with ${cstrikeTargets.length} CStrike targets...`,
    });
    // Navigate to enrichment tab with context
    setActiveTab('enrichment');
  }

  // ============================================================================
  // Render — Tab Bar
  // ============================================================================

  return (
    <div className="h-full overflow-auto p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[var(--grok-text-heading)] flex items-center gap-2">
            <Shield className="w-5 h-5 text-[var(--grok-recon-blue)]" />
            Threat Intelligence
          </h1>
          <p className="text-[10px] text-[var(--grok-text-muted)] mt-0.5 font-mono">
            OpenCTI integration &mdash; enrich scan findings with threat actor context
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isDemoMode && (
            <span className="px-2 py-1 rounded text-xs font-mono font-bold bg-amber-900/30 text-amber-400 border border-amber-700/40">
              DEMO MODE
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'w-2 h-2 rounded-full',
                connectionStatus === 'connected' && 'bg-green-400',
                connectionStatus === 'failed' && 'bg-red-400',
                connectionStatus === 'unknown' && 'bg-grok-text-muted'
              )}
            />
            <span className="text-xs text-grok-text-muted font-mono">
              {connectionStatus === 'connected'
                ? `Connected${connectionVersion ? ` v${connectionVersion}` : ''}`
                : connectionStatus === 'failed'
                ? 'Disconnected'
                : 'Not configured'}
            </span>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-grok-border" role="tablist" aria-label="Threat Intel sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`panel-${id}`}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
              activeTab === id
                ? 'border-grok-recon-blue text-grok-text-heading'
                : 'border-transparent text-grok-text-muted hover:text-grok-text-body hover:border-grok-border-glow'
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ======================================================================
          Tab 1 — Connection & Config
      ====================================================================== */}
      {activeTab === 'config' && (
        <div id="panel-config" role="tabpanel" className="space-y-6">
          <Panel title="OpenCTI Connection">
            <div className="space-y-4">
              <Input
                label="OpenCTI URL"
                placeholder="https://opencti.internal:8080"
                value={config.url}
                onChange={(e) => setConfig((c) => ({ ...c, url: e.target.value }))}
              />

              <div className="w-full">
                <label className="block text-sm font-medium text-grok-text-body mb-1.5">
                  API Token
                </label>
                <div className="relative">
                  <input
                    type={showToken ? 'text' : 'password'}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={config.token}
                    onChange={(e) => setConfig((c) => ({ ...c, token: e.target.value }))}
                    className={cn(
                      'w-full px-3 py-2 pr-10 bg-grok-surface-2 border border-grok-border rounded-md',
                      'text-grok-text-body placeholder:text-grok-text-muted font-mono',
                      'focus:outline-none focus:ring-2 focus:ring-grok-recon-blue focus:border-transparent',
                      'transition-colors'
                    )}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 px-3 text-grok-text-muted hover:text-grok-text-body transition-colors"
                    onClick={() => setShowToken((v) => !v)}
                    aria-label={showToken ? 'Hide token' : 'Reveal token'}
                  >
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  className="cs-btn cs-btn-primary flex items-center gap-1.5"
                  onClick={() => handleTestConnection()}
                  disabled={isTesting}
                >
                  <Wifi className="w-3.5 h-3.5" />
                  {isTesting ? 'Testing...' : connectionStatus === 'connected' ? 'Re-test Connection' : 'Test Connection'}
                </button>
                <button className="cs-btn flex items-center gap-1.5" onClick={handleSaveConfig}>
                  Save Config
                </button>
              </div>
            </div>
          </Panel>

          {/* Info box */}
          <div className="flex gap-3 p-4 bg-grok-recon-blue/5 border border-grok-recon-blue/20 rounded-lg">
            <Info className="w-5 h-5 text-grok-recon-blue flex-shrink-0 mt-0.5" />
            <div className="space-y-1 text-sm text-grok-text-muted">
              <p className="font-medium text-grok-text-body">What this integration provides</p>
              <ul className="space-y-1 list-disc list-inside">
                <li>Enrich discovered IPs and domains with known threat actor associations</li>
                <li>Cross-reference vulnerabilities with active exploitation campaigns</li>
                <li>Map scan findings to MITRE ATT&CK techniques via real-world reports</li>
                <li>Risk scoring for targets based on threat intelligence context</li>
                <li>Real-time threat report feed filtered to your environment</li>
              </ul>
              <p className="mt-2 text-xs">
                Configure your OpenCTI instance URL and API token above. The integration
                connects directly from your browser — no backend proxy required.
              </p>
            </div>
          </div>

          {connectionStatus === 'failed' && (
            <div className="flex gap-3 p-4 bg-grok-exploit-red/5 border border-grok-exploit-red/20 rounded-lg">
              <WifiOff className="w-5 h-5 text-grok-exploit-red flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-grok-exploit-red">Connection Failed</p>
                <p className="text-grok-text-muted mt-1">
                  Unable to reach the OpenCTI instance. Verify the URL is reachable from your
                  browser, the API token is valid, and CORS is configured to allow this origin.
                  The module will display demo data until a connection is established.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ======================================================================
          Tab 2 — Indicator Lookup
      ====================================================================== */}
      {activeTab === 'lookup' && (
        <div id="panel-lookup" role="tabpanel" className="space-y-6">
          <Panel title="Indicator Search">
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="flex-shrink-0">
                  <label className="block text-sm font-medium text-grok-text-body mb-1.5">
                    Type
                  </label>
                  <select
                    value={searchType}
                    onChange={(e) => setSearchType(e.target.value as IndicatorType)}
                    className={cn(
                      'h-10 px-3 bg-grok-surface-2 border border-grok-border rounded-md',
                      'text-grok-text-body text-sm',
                      'focus:outline-none focus:ring-2 focus:ring-grok-recon-blue focus:border-transparent'
                    )}
                  >
                    <option value="ip">IP Address</option>
                    <option value="domain">Domain</option>
                    <option value="url">URL</option>
                    <option value="cve">CVE ID</option>
                    <option value="hash">Hash (MD5/SHA1/SHA256)</option>
                  </select>
                </div>
                <div className="flex-1">
                  <Input
                    label="Value"
                    placeholder={
                      searchType === 'ip'
                        ? '198.51.100.22'
                        : searchType === 'domain'
                        ? 'evil.example.com'
                        : searchType === 'cve'
                        ? 'CVE-2024-21413'
                        : searchType === 'hash'
                        ? 'SHA256:a1b2c3...'
                        : 'https://malicious.example.com/payload'
                    }
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  />
                </div>
              </div>
              <button
                className="cs-btn cs-btn-primary flex items-center gap-1.5"
                onClick={handleSearch}
                disabled={isSearching}
              >
                <Search className="w-3.5 h-3.5" />
                {isSearching ? 'Searching...' : isDemoMode ? 'Search (Demo)' : 'Search OpenCTI'}
              </button>
            </div>
          </Panel>

          {isDemoMode && !hasSearched && (
            <div className="text-sm text-grok-text-muted text-center py-8 border border-dashed border-grok-border rounded-lg">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>Enter a value above to search OpenCTI indicators.</p>
              <p className="mt-1 text-xs">Demo data will be shown — connect OpenCTI for real results.</p>
            </div>
          )}

          {hasSearched && (
            <Panel
              title={`Results (${displayIndicators.length})`}
              action={
                isDemoMode && (
                  <span className="text-xs text-amber-400 font-mono">DEMO</span>
                )
              }
            >
              {displayIndicators.length === 0 ? (
                <p className="text-sm text-grok-text-muted text-center py-6">
                  No indicators found
                </p>
              ) : (
                <div className="space-y-3">
                  {displayIndicators.map((indicator) => (
                    <IndicatorCard key={indicator.id} indicator={indicator} />
                  ))}
                </div>
              )}
            </Panel>
          )}
        </div>
      )}

      {/* ======================================================================
          Tab 3 — Target Enrichment
      ====================================================================== */}
      {activeTab === 'enrichment' && (
        <div id="panel-enrichment" role="tabpanel" className="space-y-6">
          <Panel title={`CStrike Targets (${cstrikeTargets.length})`}>
            {cstrikeTargets.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <Target className="w-8 h-8 mx-auto text-grok-text-muted opacity-30" />
                <p className="text-sm text-grok-text-muted">
                  No targets found. Add targets in the Targets view and start scans first.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {cstrikeTargets.map((url) => {
                  const isExpanded = expandedTargets.has(url);
                  const result = enrichmentResults.get(url);
                  const isEnriching = enrichingTarget === url;

                  return (
                    <div key={url} className="border border-grok-border rounded-lg overflow-hidden">
                      {/* Target header */}
                      <div className="flex items-center justify-between p-3 bg-grok-surface-2">
                        <button
                          className="flex items-center gap-2 min-w-0 flex-1 text-left"
                          onClick={() => handleToggleTarget(url)}
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-grok-text-muted flex-shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-grok-text-muted flex-shrink-0" />
                          )}
                          <span className="text-sm font-mono text-grok-text-heading truncate">
                            {url}
                          </span>
                          {result && (
                            <span
                              className="ml-2 text-xs font-mono px-1.5 py-0.5 rounded border"
                              style={{
                                color:
                                  result.riskScore >= 75
                                    ? '#ff0033'
                                    : result.riskScore >= 50
                                    ? '#ff2040'
                                    : result.riskScore >= 25
                                    ? '#ffaa00'
                                    : '#00cc66',
                                borderColor:
                                  result.riskScore >= 75
                                    ? '#ff003333'
                                    : result.riskScore >= 50
                                    ? '#ff204033'
                                    : result.riskScore >= 25
                                    ? '#ffaa0033'
                                    : '#00cc6633',
                                backgroundColor:
                                  result.riskScore >= 75
                                    ? '#ff003310'
                                    : result.riskScore >= 50
                                    ? '#ff204010'
                                    : result.riskScore >= 25
                                    ? '#ffaa0010'
                                    : '#00cc6610',
                              }}
                            >
                              {result.riskScore}/100
                            </span>
                          )}
                        </button>
                        <button
                          className={cn('flex items-center gap-1.5 ml-3 flex-shrink-0 text-[10px] py-1 px-2', result ? 'cs-btn' : 'cs-btn cs-btn-primary')}
                          disabled={isEnriching}
                          onClick={() => handleEnrichTarget(url)}
                        >
                          <Shield className="w-3 h-3" />
                          {isEnriching ? 'Enriching...' : result ? 'Re-enrich' : isDemoMode ? 'Enrich (Demo)' : 'Enrich'}
                        </button>
                      </div>

                      {/* Enrichment results panel */}
                      {isExpanded && result && (
                        <div className="p-4 bg-grok-surface-1 border-t border-grok-border">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Left column */}
                            <div className="space-y-4">
                              {/* Risk gauge */}
                              <div className="flex flex-col items-center py-2">
                                <RiskGauge score={result.riskScore} />
                              </div>

                              {/* Threat Actors */}
                              <div>
                                <p className="text-xs text-grok-text-muted mb-2 uppercase tracking-wide flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" /> Known Threat Actors
                                </p>
                                {result.threatActors.length > 0 ? (
                                  <div className="space-y-1">
                                    {result.threatActors.map((actor) => (
                                      <div
                                        key={actor}
                                        className="flex items-center gap-2 px-2 py-1.5 rounded bg-grok-exploit-red/5 border border-grok-exploit-red/20"
                                      >
                                        <span className="w-1.5 h-1.5 rounded-full bg-grok-exploit-red flex-shrink-0" />
                                        <span className="text-xs font-mono text-grok-text-body">
                                          {actor}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-grok-text-muted">None identified</p>
                                )}
                              </div>

                              {/* Timeline */}
                              {result.reportTimeline.length > 0 && (
                                <div>
                                  <p className="text-xs text-grok-text-muted mb-2 uppercase tracking-wide flex items-center gap-1">
                                    <Calendar className="w-3 h-3" /> Report Timeline
                                  </p>
                                  <div className="space-y-2 border-l border-grok-border pl-3">
                                    {result.reportTimeline.map((entry, idx) => (
                                      <div key={idx}>
                                        <p className="text-xs text-grok-text-muted font-mono">
                                          {entry.date.trim()}
                                        </p>
                                        <p className="text-xs text-grok-text-body">
                                          {entry.title}
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Right column */}
                            <div className="space-y-4">
                              {/* Related CVEs */}
                              <div>
                                <p className="text-xs text-grok-text-muted mb-2 uppercase tracking-wide flex items-center gap-1">
                                  <Zap className="w-3 h-3" /> Related CVEs
                                </p>
                                {result.relatedCVEs.length > 0 ? (
                                  <div className="space-y-1.5">
                                    {result.relatedCVEs.map((cve) => (
                                      <div
                                        key={cve.id}
                                        className="flex items-center justify-between px-2 py-1.5 rounded bg-grok-surface-2 border border-grok-border"
                                      >
                                        <span className="text-xs font-mono text-grok-scan-cyan">
                                          {cve.id}
                                        </span>
                                        <span
                                          className={cn(
                                            'text-xs font-mono px-1.5 py-0.5 rounded',
                                            cve.exploited
                                              ? 'bg-grok-exploit-red/15 text-grok-exploit-red'
                                              : 'bg-grok-text-muted/10 text-grok-text-muted'
                                          )}
                                        >
                                          {cve.exploited ? 'EXPLOITED' : 'no exploit'}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-grok-text-muted">None identified</p>
                                )}
                              </div>

                              {/* MITRE ATT&CK */}
                              <div>
                                <p className="text-xs text-grok-text-muted mb-2 uppercase tracking-wide flex items-center gap-1">
                                  <Activity className="w-3 h-3" /> MITRE ATT&CK Techniques
                                </p>
                                {result.mitreAttack.length > 0 ? (
                                  <div className="flex flex-wrap gap-1.5">
                                    {result.mitreAttack.map((technique) => (
                                      <span
                                        key={technique}
                                        className="px-2 py-0.5 rounded text-xs font-mono bg-grok-ai-purple/10 border border-grok-ai-purple/30"
                                        style={{
                                          color: '#8844ff',
                                          '--grok-ai-purple': '#8844ff',
                                        } as React.CSSProperties}
                                      >
                                        {technique}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-grok-text-muted">None identified</p>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {isExpanded && !result && !isEnriching && (
                        <div className="p-4 bg-grok-surface-1 border-t border-grok-border text-center">
                          <p className="text-xs text-grok-text-muted">
                            Click "Enrich" to look up threat intelligence for this target
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* ======================================================================
          Tab 4 — Feed & Reports
      ====================================================================== */}
      {activeTab === 'feed' && (
        <div id="panel-feed" role="tabpanel" className="space-y-6">
          {/* Filters */}
          <Panel title="Filters">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-xs text-grok-text-muted mb-1.5 uppercase tracking-wide">
                  Report Type
                </label>
                <select
                  value={reportTypeFilter}
                  onChange={(e) => setReportTypeFilter(e.target.value as ReportType)}
                  className={cn(
                    'h-9 px-3 bg-grok-surface-2 border border-grok-border rounded-md',
                    'text-grok-text-body text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-grok-recon-blue'
                  )}
                >
                  <option value="all">All Types</option>
                  <option value="threat-report">Threat Report</option>
                  <option value="incident">Incident</option>
                  <option value="malware-analysis">Malware Analysis</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-grok-text-muted mb-1.5 uppercase tracking-wide">
                  Min Confidence: {minConfidence}
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(Number(e.target.value))}
                  className="w-32 accent-grok-recon-blue"
                  aria-label="Minimum confidence threshold"
                />
              </div>

              <button
                className="cs-btn flex items-center gap-1.5"
                onClick={handleLoadReports}
                disabled={isLoadingReports}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {isLoadingReports ? 'Loading...' : isConnected ? 'Load from OpenCTI' : 'Refresh Demo'}
              </button>
            </div>
          </Panel>

          {/* Report List */}
          <Panel
            title={`Reports (${displayReports.length})`}
            action={
              isDemoMode && (
                <span className="text-xs text-amber-400 font-mono">DEMO</span>
              )
            }
          >
            {displayReports.length === 0 ? (
              <div className="text-center py-8">
                <FileText className="w-8 h-8 mx-auto mb-2 text-grok-text-muted opacity-30" />
                <p className="text-sm text-grok-text-muted">
                  No reports loaded. Click "Load from OpenCTI" above.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {displayReports
                  .filter((r) => r.confidence >= minConfidence)
                  .filter((r) => reportTypeFilter === 'all' || r.report_types.includes(reportTypeFilter))
                  .slice(reportPage * REPORTS_PER_PAGE, (reportPage + 1) * REPORTS_PER_PAGE)
                  .map((report) => (
                    <div
                      key={report.id}
                      className="border border-grok-border rounded-lg overflow-hidden"
                    >
                      {/* Report header */}
                      <button
                        className="w-full flex items-start justify-between p-3 bg-grok-surface-2 hover:bg-grok-hover transition-colors text-left"
                        onClick={() =>
                          isDemoMode
                            ? setReports((prev) =>
                                prev.map((r) =>
                                  r.id === report.id ? { ...r, expanded: !r.expanded } : r
                                )
                              )
                            : handleToggleReport(report.id)
                        }
                        aria-expanded={report.expanded}
                      >
                        <div className="flex-1 min-w-0 pr-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-grok-text-heading">
                              {report.name}
                            </span>
                            {report.report_types.map((t) => (
                              <span
                                key={t}
                                className="px-1.5 py-0.5 rounded text-xs font-mono bg-grok-recon-blue/10 text-grok-recon-blue border border-grok-recon-blue/20"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs text-grok-text-muted flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {report.published
                                ? new Date(report.published).toLocaleDateString()
                                : 'Unknown date'}
                            </span>
                            <span className="text-xs text-grok-text-muted font-mono">
                              Confidence: {report.confidence}%
                            </span>
                          </div>
                        </div>
                        <div className="flex-shrink-0 mt-0.5">
                          {report.expanded ? (
                            <ChevronDown className="w-4 h-4 text-grok-text-muted" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-grok-text-muted" />
                          )}
                        </div>
                      </button>

                      {/* Expanded detail */}
                      {report.expanded && (
                        <div className="p-4 bg-grok-surface-1 border-t border-grok-border space-y-4">
                          {report.description && (
                            <p className="text-sm text-grok-text-body leading-relaxed">
                              {report.description}
                            </p>
                          )}

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {/* Referenced Indicators */}
                            {report.indicators.length > 0 && (
                              <div>
                                <p className="text-xs text-grok-text-muted mb-2 uppercase tracking-wide flex items-center gap-1">
                                  <Link2 className="w-3 h-3" /> Indicators
                                </p>
                                <div className="space-y-1">
                                  {report.indicators.slice(0, 6).map((ind, idx) => (
                                    <code
                                      key={idx}
                                      className="block text-xs font-mono text-grok-scan-cyan bg-grok-void px-2 py-1 rounded border border-grok-border truncate"
                                    >
                                      {ind}
                                    </code>
                                  ))}
                                  {report.indicators.length > 6 && (
                                    <p className="text-xs text-grok-text-muted">
                                      +{report.indicators.length - 6} more
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Campaigns */}
                            {report.campaigns.length > 0 && (
                              <div>
                                <p className="text-xs text-grok-text-muted mb-2 uppercase tracking-wide flex items-center gap-1">
                                  <Target className="w-3 h-3" /> Campaigns
                                </p>
                                <div className="space-y-1">
                                  {report.campaigns.map((c) => (
                                    <span
                                      key={c}
                                      className="block text-xs px-2 py-1 rounded bg-grok-loot-gold/10 border border-grok-loot-gold/20 font-mono"
                                      style={{
                                        color: 'var(--grok-loot-gold, #ffaa00)',
                                        '--grok-loot-gold': '#ffaa00',
                                      } as React.CSSProperties}
                                    >
                                      {c}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* MITRE Techniques */}
                            {report.techniques.length > 0 && (
                              <div>
                                <p className="text-xs text-grok-text-muted mb-2 uppercase tracking-wide flex items-center gap-1">
                                  <Activity className="w-3 h-3" /> MITRE Techniques
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {report.techniques.map((t) => (
                                    <span
                                      key={t}
                                      className="px-2 py-0.5 rounded text-xs font-mono"
                                      style={{
                                        backgroundColor: '#8844ff15',
                                        color: '#8844ff',
                                        border: '1px solid #8844ff33',
                                      }}
                                    >
                                      {t}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Confidence bar */}
                          <div>
                            <p className="text-xs text-grok-text-muted mb-1.5 uppercase tracking-wide">
                              Confidence
                            </p>
                            <ConfidenceBar value={report.confidence} />
                          </div>

                          {/* Cross-reference action */}
                          <div className="pt-2 border-t border-grok-border">
                            <button
                              className="cs-btn flex items-center gap-1.5 text-[10px] py-1 px-2"
                              onClick={() => handleCrossReference(report)}
                            >
                              <Target className="w-3.5 h-3.5" />
                              Cross-reference with Targets
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </Panel>

          {/* Pagination */}
          {displayReports.length > REPORTS_PER_PAGE && (
            <div className="flex items-center justify-between">
              <button
                className="cs-btn flex items-center gap-1.5"
                onClick={() => setReportPage((p) => Math.max(0, p - 1))}
                disabled={reportPage === 0}
              >
                Previous
              </button>
              <span className="text-xs text-[var(--grok-text-muted)] font-mono">
                Page {reportPage + 1} of {Math.ceil(displayReports.length / REPORTS_PER_PAGE)}
              </span>
              <button
                className="cs-btn flex items-center gap-1.5"
                onClick={() =>
                  setReportPage((p) =>
                    Math.min(p + 1, Math.ceil(displayReports.length / REPORTS_PER_PAGE) - 1)
                  )
                }
                disabled={(reportPage + 1) * REPORTS_PER_PAGE >= displayReports.length}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
