/**
 * Battle Map — Combined Geo Map + Attack Map with per-target sections
 *
 * Tabs:
 * - Battle Map: World geo map + per-target attack summary cards
 * - MITRE ATT&CK: Full MITRE technique matrix (from AttackMapView)
 * - Kill Chain: Cyber kill chain progress (from AttackMapView)
 */

import { useState, useEffect, useMemo } from 'react';
import {
  Map,
  Globe,
  Shield,
  Crosshair,
  Target,
  Server,
  Zap,
  Radio,
  Search,
  Layers,
  ZoomIn,
  ZoomOut,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@utils/index';
import { apiService } from '@services/api';

// ── Types ──────────────────────────────────────────────────────────────

interface GeoTarget {
  id: string;
  label: string;
  ip?: string;
  lat: number;
  lng: number;
  status: 'scanning' | 'complete' | 'idle';
  ports: Array<{ port: number; state: string; service?: string }>;
  vulns: Array<{ severity: string; title?: string; id?: string }>;
  subdomains: number;
  httpEndpoints: number;
  country?: string;
  city?: string;
}

interface AttackPath {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  type: 'recon' | 'exploit' | 'exfil';
  active: boolean;
}

interface TechniqueMapping {
  id: string;
  name: string;
  tactic: string;
  status: 'detected' | 'attempted' | 'succeeded' | 'not_tested';
  source?: string;
  count?: number;
}

type ViewTab = 'battlemap' | 'mitre' | 'killchain';

// ── Constants ──────────────────────────────────────────────────────────

const TACTICS = [
  { id: 'TA0043', name: 'Reconnaissance', short: 'Recon' },
  { id: 'TA0042', name: 'Resource Development', short: 'Resources' },
  { id: 'TA0001', name: 'Initial Access', short: 'Init Access' },
  { id: 'TA0002', name: 'Execution', short: 'Execution' },
  { id: 'TA0003', name: 'Persistence', short: 'Persist' },
  { id: 'TA0004', name: 'Privilege Escalation', short: 'Priv Esc' },
  { id: 'TA0005', name: 'Defense Evasion', short: 'Def Evasion' },
  { id: 'TA0006', name: 'Credential Access', short: 'Cred Access' },
  { id: 'TA0007', name: 'Discovery', short: 'Discovery' },
  { id: 'TA0008', name: 'Lateral Movement', short: 'Lat Move' },
  { id: 'TA0009', name: 'Collection', short: 'Collection' },
  { id: 'TA0011', name: 'Command and Control', short: 'C2' },
  { id: 'TA0010', name: 'Exfiltration', short: 'Exfil' },
  { id: 'TA0040', name: 'Impact', short: 'Impact' },
];

const KILL_CHAIN_PHASES = [
  { id: 'recon', name: 'Reconnaissance', icon: Search, tactics: ['TA0043'] },
  { id: 'weaponize', name: 'Weaponization', icon: Layers, tactics: ['TA0042'] },
  { id: 'deliver', name: 'Delivery', icon: Target, tactics: ['TA0001'] },
  { id: 'exploit', name: 'Exploitation', icon: Zap, tactics: ['TA0002'] },
  { id: 'install', name: 'Installation', icon: Server, tactics: ['TA0003'] },
  { id: 'c2', name: 'Command & Control', icon: Radio, tactics: ['TA0011'] },
  { id: 'actions', name: 'Actions on Objectives', icon: Crosshair, tactics: ['TA0009', 'TA0010', 'TA0040'] },
];

// Improved continent coordinates with more detail
const CONTINENT_COORDS: [number, number][][] = [
  // North America
  [
    [72, -168], [74, -157], [71, -156], [72, -150], [71, -139], [70, -130],
    [69, -120], [70, -110], [73, -100], [73, -95], [73, -85], [70, -75],
    [68, -68], [62, -60], [55, -58], [50, -55], [47, -53], [44, -60],
    [44, -63], [42, -67], [42, -70], [40, -74], [38, -75], [35, -75],
    [30, -81], [28, -82], [25, -80], [25, -83], [30, -88], [29, -89],
    [29, -94], [27, -97], [26, -97], [22, -98], [20, -100], [18, -96],
    [15, -92], [15, -87], [18, -88], [20, -90], [21, -97], [20, -105],
    [23, -110], [28, -112], [32, -117], [34, -120], [38, -122], [42, -124],
    [48, -125], [50, -128], [55, -133], [58, -138], [60, -148], [62, -155],
    [65, -163], [68, -168], [72, -168],
  ],
  // South America
  [
    [12, -72], [11, -68], [10, -66], [8, -60], [7, -56], [5, -52],
    [3, -51], [1, -48], [-2, -44], [-5, -37], [-8, -35], [-12, -37],
    [-15, -39], [-18, -40], [-23, -43], [-28, -49], [-33, -53],
    [-36, -57], [-40, -62], [-45, -65], [-50, -68], [-53, -70],
    [-55, -67], [-55, -65], [-53, -73], [-50, -75], [-46, -75],
    [-42, -73], [-35, -72], [-28, -71], [-22, -70], [-17, -72],
    [-14, -76], [-8, -80], [-2, -80], [0, -78], [4, -77],
    [8, -76], [10, -75], [12, -72],
  ],
  // Africa
  [
    [37, 10], [36, 0], [35, -6], [34, -2], [33, 0], [33, 10], [33, 13],
    [32, 20], [31, 32], [28, 34], [22, 37], [18, 40], [12, 44], [12, 50],
    [5, 48], [0, 42], [-5, 40], [-10, 40], [-15, 38], [-18, 36],
    [-22, 35], [-26, 33], [-30, 31], [-34, 26], [-34, 20], [-34, 18],
    [-30, 16], [-28, 15], [-20, 13], [-12, 12], [-5, 9], [0, 7],
    [3, 2], [5, 1], [6, -2], [6, -5], [5, -8], [5, -10],
    [7, -14], [10, -16], [13, -17], [15, -17], [18, -16],
    [22, -17], [25, -15], [28, -13], [31, -10], [33, -8], [35, -6],
    [37, -5], [37, 0], [37, 10],
  ],
  // Europe
  [
    [36, -10], [37, -9], [40, -9], [43, -9], [44, -1], [46, -2],
    [48, -5], [49, 0], [51, 2], [53, 5], [55, 8], [56, 10],
    [58, 12], [60, 15], [62, 18], [65, 22], [68, 25], [70, 28],
    [71, 32], [70, 42], [65, 40], [60, 30], [58, 25], [55, 20],
    [52, 18], [50, 20], [48, 18], [47, 20], [45, 25], [43, 28],
    [42, 29], [40, 26], [37, 22], [38, 18], [37, 15], [36, 12],
    [38, 10], [40, 5], [43, 3], [43, 0], [42, -2], [40, -4],
    [38, -7], [36, -10],
  ],
  // Asia
  [
    [70, 42], [71, 55], [73, 65], [73, 80], [73, 95], [73, 110],
    [72, 125], [71, 135], [70, 145], [66, 170], [64, 175],
    [62, 170], [58, 162], [55, 155], [50, 142], [45, 137],
    [42, 132], [38, 130], [35, 129], [33, 126], [30, 121],
    [25, 117], [22, 114], [20, 110], [15, 108], [10, 106],
    [5, 104], [1, 104], [3, 100], [8, 98], [15, 100],
    [20, 96], [22, 92], [22, 88], [22, 84], [18, 82],
    [14, 80], [8, 77], [12, 72], [24, 68], [25, 62],
    [26, 56], [24, 52], [16, 52], [13, 48], [12, 44],
    [18, 40], [22, 37], [28, 34], [31, 32], [34, 35],
    [37, 36], [39, 40], [42, 44], [42, 52], [45, 50],
    [47, 42], [50, 45], [55, 55], [58, 50], [60, 42], [70, 42],
  ],
  // Australia
  [
    [-12, 131], [-13, 127], [-15, 125], [-20, 118], [-24, 114],
    [-28, 114], [-31, 115], [-33, 117], [-35, 118], [-36, 120],
    [-37, 128], [-38, 140], [-38, 145], [-37, 150], [-33, 152],
    [-28, 153], [-24, 151], [-20, 148], [-17, 146], [-15, 145],
    [-13, 141], [-11, 136], [-12, 131],
  ],
  // Greenland
  [
    [77, -70], [80, -60], [83, -40], [83, -30], [82, -22],
    [80, -18], [76, -18], [73, -20], [70, -22], [65, -35],
    [60, -44], [62, -50], [64, -53], [67, -53], [70, -56], [77, -70],
  ],
  // Japan
  [
    [33, 131], [34, 132], [35, 133], [36, 136], [37, 137],
    [38, 139], [39, 140], [41, 141], [42, 141], [45, 142],
    [44, 143], [43, 140], [40, 140], [38, 137], [36, 136],
    [35, 135], [34, 132], [33, 131],
  ],
  // UK & Ireland
  [
    [50, -5], [51, -3], [51, 1], [53, 0], [54, -1],
    [55, -2], [57, -3], [58, -4], [58, -5],
    [57, -7], [56, -6], [55, -6], [54, -5],
    [53, -5], [52, -5], [50, -5],
  ],
  // New Zealand
  [
    [-35, 174], [-37, 175], [-38, 176], [-40, 174],
    [-42, 172], [-44, 169], [-46, 168], [-45, 167],
    [-44, 167], [-42, 168], [-40, 170],
    [-38, 173], [-36, 174], [-35, 174],
  ],
  // Indonesia
  [
    [5, 95], [4, 97], [2, 99], [0, 102], [-1, 104],
    [-4, 106], [-6, 106], [-7, 110], [-8, 114],
    [-8, 116], [-7, 114], [-6, 112], [-4, 109],
    [-3, 107], [-1, 104], [0, 101], [2, 98], [3, 97], [5, 95],
  ],
];

// ── Projection ──────────────────────────────────────────────────────

function project(lat: number, lng: number): { x: number; y: number } {
  const x = ((lng + 180) / 360) * 700 + 50;
  const y = ((90 - lat) / 180) * 350 + 25;
  return { x, y };
}

function coordsToPath(coords: [number, number][]): string {
  return coords.map(([lat, lng], i) => {
    const { x, y } = project(lat, lng);
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ') + ' Z';
}

// ── MITRE mapping ──────────────────────────────────────────────────

function mapFindingsToMitre(
  ports: Array<{ port: number; state: string; service?: string }>,
  vulns: Array<{ severity: string; title?: string; id?: string }>,
  subdomains: number,
  httpEndpoints: number,
  lootCreds: number,
): TechniqueMapping[] {
  const techniques: TechniqueMapping[] = [];
  if (ports.length > 0) {
    techniques.push({ id: 'T1046', name: 'Network Service Discovery', tactic: 'TA0007', status: 'succeeded', source: 'nmap', count: ports.length });
  }
  if (subdomains > 0) {
    techniques.push({ id: 'T1596', name: 'Search Open Technical Databases', tactic: 'TA0043', status: 'succeeded', source: 'subfinder', count: subdomains });
    techniques.push({ id: 'T1590', name: 'Gather Victim Network Information', tactic: 'TA0043', status: 'succeeded', source: 'subfinder', count: subdomains });
  }
  if (httpEndpoints > 0) {
    techniques.push({ id: 'T1595.002', name: 'Active Scanning: Vulnerability Scanning', tactic: 'TA0043', status: 'succeeded', source: 'gobuster', count: httpEndpoints });
    techniques.push({ id: 'T1083', name: 'File and Directory Discovery', tactic: 'TA0007', status: 'succeeded', source: 'gobuster', count: httpEndpoints });
  }
  const hasSSH = ports.some((p) => p.service === 'ssh' && p.state === 'open');
  const hasHTTP = ports.some((p) => (p.service === 'http' || p.service === 'ssl/http') && p.state === 'open');
  if (hasHTTP) {
    techniques.push({ id: 'T1190', name: 'Exploit Public-Facing Application', tactic: 'TA0001', status: vulns.length > 0 ? 'detected' : 'not_tested' });
  }
  if (hasSSH) {
    techniques.push({ id: 'T1078', name: 'Valid Accounts', tactic: 'TA0001', status: lootCreds > 0 ? 'succeeded' : 'not_tested' });
    techniques.push({ id: 'T1110', name: 'Brute Force', tactic: 'TA0006', status: lootCreds > 0 ? 'attempted' : 'not_tested' });
  }
  if (vulns.some((v) => v.id?.includes('sql'))) {
    techniques.push({ id: 'T1059.004', name: 'Command and Scripting: SQL', tactic: 'TA0002', status: 'detected', source: 'nuclei' });
  }
  if (ports.filter((p) => p.state === 'open').length > 0) {
    techniques.push({ id: 'T1049', name: 'System Network Connections Discovery', tactic: 'TA0007', status: 'succeeded', source: 'nmap' });
  }
  if (lootCreds > 0) {
    techniques.push({ id: 'T1003', name: 'OS Credential Dumping', tactic: 'TA0006', status: 'succeeded', count: lootCreds });
  }
  techniques.push({ id: 'T1595.001', name: 'Active Scanning: Port Scanning', tactic: 'TA0043', status: ports.length > 0 ? 'succeeded' : 'not_tested', source: 'nmap' });
  return techniques;
}

// ── Helpers ──────────────────────────────────────────────────────────

function statusDotColor(s: GeoTarget['status']) {
  switch (s) {
    case 'scanning': return 'var(--grok-recon-blue)';
    case 'complete': return 'var(--grok-ok-green)';
    default: return 'var(--grok-text-muted)';
  }
}

function pathColor(t: AttackPath['type']) {
  switch (t) {
    case 'recon': return 'var(--grok-recon-blue)';
    case 'exploit': return 'var(--grok-exploit-red)';
    case 'exfil': return 'var(--grok-loot-gold)';
  }
}

function getTechniqueStyle(status: string): string {
  switch (status) {
    case 'succeeded': return 'bg-[var(--grok-success)]/10 border-[var(--grok-success)]/30 text-[var(--grok-success)]';
    case 'detected': return 'bg-[var(--grok-warning)]/10 border-[var(--grok-warning)]/30 text-[var(--grok-warning)]';
    case 'attempted': return 'bg-[var(--grok-scan-cyan)]/10 border-[var(--grok-scan-cyan)]/30 text-[var(--grok-scan-cyan)]';
    default: return 'bg-[var(--grok-surface-2)] border-[var(--grok-border)]/50 text-[var(--grok-text-muted)]';
  }
}

const GRID_LINES = Array.from({ length: 7 }, (_, i) => ({ y: 50 + i * 50 }));
const MERIDIANS = Array.from({ length: 9 }, (_, i) => ({ x: 100 + i * 75 }));

const GEO_LOCATIONS = [
  { lat: 37.77, lng: -122.42, country: 'US', city: 'San Francisco' },
  { lat: 40.71, lng: -74.01, country: 'US', city: 'New York' },
  { lat: 51.51, lng: -0.13, country: 'UK', city: 'London' },
  { lat: 48.86, lng: 2.35, country: 'FR', city: 'Paris' },
  { lat: 35.68, lng: 139.65, country: 'JP', city: 'Tokyo' },
  { lat: 52.52, lng: 13.41, country: 'DE', city: 'Berlin' },
];

// ── Main Component ──────────────────────────────────────────────────

export function BattleMapView() {
  const [activeTab, setActiveTab] = useState<ViewTab>('battlemap');
  const [targets, setTargets] = useState<GeoTarget[]>([]);
  const [lootCreds, setLootCreds] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [expandedTargets, setExpandedTargets] = useState<Set<string>>(new Set());
  const [showGrid, setShowGrid] = useState(true);
  const [showPaths, setShowPaths] = useState(true);

  // Fetch targets with their results
  useEffect(() => {
    const fetchData = async () => {
      try {
        const targetUrls = await apiService.getTargets();
        const mapped: GeoTarget[] = [];
        for (let i = 0; i < targetUrls.length; i++) {
          const url = targetUrls[i];
          const loc = GEO_LOCATIONS[i % GEO_LOCATIONS.length];
          try {
            const results = await apiService.getTargetResults(url);
            mapped.push({
              id: `t-${i}`,
              label: url,
              ip: url.replace(/https?:\/\//, '').split('/')[0],
              lat: loc.lat,
              lng: loc.lng,
              status: 'complete',
              ports: results.ports || [],
              vulns: results.vulnerabilities || [],
              subdomains: results.subdomains?.length || 0,
              httpEndpoints: results.httpEndpoints?.length || 0,
              country: loc.country,
              city: loc.city,
            });
          } catch {
            mapped.push({
              id: `t-${i}`,
              label: url,
              lat: loc.lat,
              lng: loc.lng,
              status: 'idle',
              ports: [],
              vulns: [],
              subdomains: 0,
              httpEndpoints: 0,
              country: loc.country,
              city: loc.city,
            });
          }
        }
        setTargets(mapped);
        // Auto-expand first target
        if (mapped.length > 0) setExpandedTargets(new Set([mapped[0].id]));
      } catch { /* API not available */ }
    };
    fetchData();
  }, []);

  // Loot cred count
  useEffect(() => {
    apiService.getLoot().then((loot) => {
      const items = Array.isArray(loot) ? loot : [];
      setLootCreds(items.filter((i: any) => i.category === 'credential').length);
    }).catch(() => {});
  }, []);

  // Attack paths from origin to each target
  const paths = useMemo<AttackPath[]>(() => {
    return targets.map((t) => ({
      from: { lat: 38.9, lng: -77.0 },
      to: { lat: t.lat, lng: t.lng },
      type: t.vulns.length > 0 ? 'exploit' as const : 'recon' as const,
      active: t.status === 'scanning',
    }));
  }, [targets]);

  // Global techniques (all targets combined)
  const allTechniques = useMemo(() => {
    const allPorts = targets.flatMap((t) => t.ports);
    const allVulns = targets.flatMap((t) => t.vulns);
    const allSubs = targets.reduce((s, t) => s + t.subdomains, 0);
    const allHttp = targets.reduce((s, t) => s + t.httpEndpoints, 0);
    return mapFindingsToMitre(allPorts, allVulns, allSubs, allHttp, lootCreds);
  }, [targets, lootCreds]);

  const viewBox = useMemo(() => {
    const cx = 400, cy = 200;
    const w = 800 / zoom, h = 400 / zoom;
    return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`;
  }, [zoom]);

  const toggleExpanded = (id: string) => {
    setExpandedTargets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const tabs: Array<{ key: ViewTab; label: string; icon: React.ReactNode }> = [
    { key: 'battlemap', label: 'Battle Map', icon: <Globe className="w-4 h-4" /> },
    { key: 'mitre', label: 'MITRE ATT&CK', icon: <Shield className="w-4 h-4" /> },
    { key: 'killchain', label: 'Kill Chain', icon: <Crosshair className="w-4 h-4" /> },
  ];

  return (
    <div className="h-full overflow-auto p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[var(--grok-text-heading)] flex items-center gap-2">
            <Map className="w-5 h-5 text-[var(--grok-exploit-red)]" />
            Battle Map
          </h1>
          <p className="text-[10px] text-[var(--grok-text-muted)] mt-0.5 font-mono">
            {targets.length} targets — geo visualization + attack surface analysis
          </p>
        </div>
        <div className="flex items-center gap-1 bg-[var(--grok-surface-2)] rounded p-0.5 border border-[var(--grok-border)]">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors rounded ${
                activeTab === tab.key
                  ? 'bg-[var(--grok-recon-blue)] text-white'
                  : 'text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)]'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Battle Map Tab ──────────────────────────────────────── */}
      {activeTab === 'battlemap' && (
        <>
          {/* Geo Map */}
          <div className="cs-panel overflow-hidden relative" style={{ height: 380 }}>
            {/* Map controls */}
            <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
              <button
                onClick={() => setShowGrid(!showGrid)}
                className={cn(
                  'px-2 py-1 text-[10px] rounded border transition-colors',
                  showGrid ? 'border-[var(--grok-recon-blue)]/40 text-[var(--grok-recon-blue)]' : 'border-[var(--grok-border)] text-[var(--grok-text-muted)]'
                )}
              >
                Grid
              </button>
              <button
                onClick={() => setShowPaths(!showPaths)}
                className={cn(
                  'px-2 py-1 text-[10px] rounded border transition-colors',
                  showPaths ? 'border-[var(--grok-exploit-red)]/40 text-[var(--grok-exploit-red)]' : 'border-[var(--grok-border)] text-[var(--grok-text-muted)]'
                )}
              >
                Paths
              </button>
              <button onClick={() => setZoom((z) => Math.min(z + 0.5, 4))} className="p-1 rounded text-[var(--grok-text-muted)] hover:bg-[var(--grok-surface-2)]">
                <ZoomIn className="w-4 h-4" />
              </button>
              <span className="text-[10px] text-[var(--grok-text-muted)] font-mono w-6 text-center">{zoom}x</span>
              <button onClick={() => setZoom((z) => Math.max(z - 0.5, 0.5))} className="p-1 rounded text-[var(--grok-text-muted)] hover:bg-[var(--grok-surface-2)]">
                <ZoomOut className="w-4 h-4" />
              </button>
            </div>

            <svg viewBox={viewBox} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
              {/* Ocean background */}
              <rect x="0" y="0" width="800" height="400" fill="var(--grok-void)" />

              {/* Grid */}
              {showGrid && (
                <g opacity={0.1}>
                  {GRID_LINES.map((l) => (
                    <line key={`h${l.y}`} x1={50} y1={l.y} x2={750} y2={l.y} stroke="var(--grok-border)" strokeWidth={0.3} />
                  ))}
                  {MERIDIANS.map((l) => (
                    <line key={`v${l.x}`} x1={l.x} y1={25} x2={l.x} y2={375} stroke="var(--grok-border)" strokeWidth={0.3} />
                  ))}
                </g>
              )}

              {/* Continent basemap */}
              {CONTINENT_COORDS.map((coords, i) => (
                <path
                  key={`c-${i}`}
                  d={coordsToPath(coords)}
                  fill="var(--grok-surface-2)"
                  stroke="var(--grok-border)"
                  strokeWidth={0.4}
                  opacity={0.7}
                />
              ))}

              {/* Attack paths */}
              {showPaths && paths.map((p, i) => {
                const from = project(p.from.lat, p.from.lng);
                const to = project(p.to.lat, p.to.lng);
                const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 30 };
                return (
                  <g key={`path-${i}`}>
                    <path
                      d={`M ${from.x} ${from.y} Q ${mid.x} ${mid.y} ${to.x} ${to.y}`}
                      fill="none"
                      stroke={pathColor(p.type)}
                      strokeWidth={0.8}
                      strokeDasharray={p.active ? '4 2' : '2 4'}
                      opacity={p.active ? 0.8 : 0.4}
                    >
                      {p.active && (
                        <animate attributeName="stroke-dashoffset" from="6" to="0" dur="1s" repeatCount="indefinite" />
                      )}
                    </path>
                    <circle cx={to.x} cy={to.y} r={1.5} fill={pathColor(p.type)} opacity={0.5} />
                  </g>
                );
              })}

              {/* Targets */}
              {targets.map((t) => {
                const { x, y } = project(t.lat, t.lng);
                const isSelected = selectedTargetId === t.id;
                const openPorts = t.ports.filter((p) => p.state === 'open').length;
                return (
                  <g key={t.id} onClick={() => setSelectedTargetId(isSelected ? null : t.id)} className="cursor-pointer">
                    {t.status === 'scanning' && (
                      <circle cx={x} cy={y} r={8} fill="none" stroke="var(--grok-recon-blue)" strokeWidth={0.5} opacity={0.5}>
                        <animate attributeName="r" from="6" to="16" dur="1.5s" repeatCount="indefinite" />
                        <animate attributeName="opacity" from="0.5" to="0" dur="1.5s" repeatCount="indefinite" />
                      </circle>
                    )}
                    {isSelected && (
                      <circle cx={x} cy={y} r={10} fill="none" stroke="var(--grok-recon-blue)" strokeWidth={1} strokeDasharray="3 2" />
                    )}
                    <circle cx={x} cy={y} r={4} fill={statusDotColor(t.status)} stroke="var(--grok-void)" strokeWidth={1.5} />
                    {/* Mini stats */}
                    <text x={x + 7} y={y - 2} fontSize={5} fill="var(--grok-text-body)" fontFamily="monospace">
                      {t.label.replace(/https?:\/\//, '').substring(0, 20)}
                    </text>
                    <text x={x + 7} y={y + 5} fontSize={4} fill="var(--grok-text-muted)" fontFamily="monospace">
                      {openPorts}P / {t.vulns.length}V
                    </text>
                  </g>
                );
              })}

              {/* Origin */}
              <g>
                <circle cx={project(38.9, -77.0).x} cy={project(38.9, -77.0).y} r={5} fill="var(--grok-exploit-red)" opacity={0.3}>
                  <animate attributeName="r" from="4" to="10" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" from="0.3" to="0" dur="2s" repeatCount="indefinite" />
                </circle>
                <polygon
                  points={`${project(38.9, -77.0).x},${project(38.9, -77.0).y - 5} ${project(38.9, -77.0).x - 3},${project(38.9, -77.0).y + 2} ${project(38.9, -77.0).x + 3},${project(38.9, -77.0).y + 2}`}
                  fill="var(--grok-exploit-red)"
                />
                <text x={project(38.9, -77.0).x + 7} y={project(38.9, -77.0).y} fontSize={5} fill="var(--grok-exploit-red)" fontFamily="monospace">
                  CSTRIKE
                </text>
              </g>
            </svg>

            {/* Legend */}
            <div className="absolute bottom-3 left-3 flex gap-3 text-[9px] font-mono text-[var(--grok-text-muted)]">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--grok-ok-green)]" /> Complete</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--grok-recon-blue)]" /> Scanning</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-[var(--grok-exploit-red)]" style={{ clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' }} /> Origin</span>
            </div>
          </div>

          {/* Per-target sections */}
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)]">
              Target Sections ({targets.length})
            </div>
            {targets.length === 0 && (
              <div className="cs-panel p-8 text-center text-xs text-[var(--grok-text-muted)]">
                No targets — run a scan to populate
              </div>
            )}
            {targets.map((t) => {
              const isExpanded = expandedTargets.has(t.id);
              const openPorts = t.ports.filter((p) => p.state === 'open');
              const techniques = mapFindingsToMitre(t.ports, t.vulns, t.subdomains, t.httpEndpoints, lootCreds);
              const succeeded = techniques.filter((x) => x.status === 'succeeded').length;
              const detected = techniques.filter((x) => x.status === 'detected').length;

              return (
                <div key={t.id} className="cs-panel overflow-hidden">
                  {/* Target header */}
                  <button
                    onClick={() => toggleExpanded(t.id)}
                    className="w-full flex items-center justify-between p-3 hover:bg-[var(--grok-surface-2)] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: statusDotColor(t.status) }} />
                      <div className="text-left">
                        <div className="text-sm font-mono font-semibold text-[var(--grok-text-heading)]">
                          {t.label}
                        </div>
                        <div className="text-[10px] text-[var(--grok-text-muted)]">
                          {t.ip} — {t.country}, {t.city}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 text-[10px] font-mono">
                        <span className="text-[var(--grok-recon-blue)]">{openPorts.length}P</span>
                        <span className="text-[var(--grok-warning)]">{t.vulns.length}V</span>
                        <span className="text-[var(--grok-success)]">{succeeded}T</span>
                      </div>
                      {isExpanded ? <ChevronDown className="w-4 h-4 text-[var(--grok-text-muted)]" /> : <ChevronRight className="w-4 h-4 text-[var(--grok-text-muted)]" />}
                    </div>
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="border-t border-[var(--grok-border)] p-4 space-y-4">
                      {/* Stats row */}
                      <div className="grid grid-cols-4 gap-2">
                        <div className="p-2 bg-[var(--grok-surface-2)] rounded text-center">
                          <div className="text-lg font-mono font-bold text-[var(--grok-recon-blue)]">{openPorts.length}</div>
                          <div className="text-[9px] text-[var(--grok-text-muted)] uppercase">Open Ports</div>
                        </div>
                        <div className="p-2 bg-[var(--grok-surface-2)] rounded text-center">
                          <div className="text-lg font-mono font-bold text-[var(--grok-warning)]">{t.vulns.length}</div>
                          <div className="text-[9px] text-[var(--grok-text-muted)] uppercase">Vulns</div>
                        </div>
                        <div className="p-2 bg-[var(--grok-surface-2)] rounded text-center">
                          <div className="text-lg font-mono font-bold text-[var(--grok-success)]">{succeeded}</div>
                          <div className="text-[9px] text-[var(--grok-text-muted)] uppercase">Succeeded</div>
                        </div>
                        <div className="p-2 bg-[var(--grok-surface-2)] rounded text-center">
                          <div className="text-lg font-mono font-bold text-[var(--grok-scan-cyan)]">{detected}</div>
                          <div className="text-[9px] text-[var(--grok-text-muted)] uppercase">Detected</div>
                        </div>
                      </div>

                      {/* Attack surface mini graph */}
                      {openPorts.length > 0 && (
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)] mb-2">
                            Attack Surface
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {openPorts.map((p, i) => {
                              const svcColors: Record<string, string> = {
                                http: '#2266ff', 'ssl/http': '#2266ff', ssh: '#00cc66',
                                ftp: '#ffaa00', mysql: '#8844ff', 'ssl/https': '#00ccdd',
                              };
                              const color = (p.service ? svcColors[p.service] : undefined) || '#6a6a80';
                              return (
                                <div key={i} className="flex items-center gap-1.5 px-2 py-1 bg-[var(--grok-surface-2)] rounded border border-[var(--grok-border)]">
                                  <div className="w-2 h-2 rounded-full" style={{ background: color }} />
                                  <span className="text-[10px] font-mono font-bold" style={{ color }}>{p.port}</span>
                                  <span className="text-[10px] font-mono text-[var(--grok-text-muted)]">{p.service || '?'}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Technique summary */}
                      {techniques.length > 0 && (
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)] mb-2">
                            MITRE Techniques
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {techniques.map((tech) => (
                              <span
                                key={tech.id}
                                className={`px-2 py-1 text-[9px] font-mono rounded border ${getTechniqueStyle(tech.status)}`}
                              >
                                {tech.id} {tech.name.length > 25 ? tech.name.slice(0, 25) + '...' : tech.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── MITRE ATT&CK Tab ──────────────────────────────────── */}
      {activeTab === 'mitre' && (
        <MitreMatrixView techniques={allTechniques} />
      )}

      {/* ── Kill Chain Tab ────────────────────────────────────── */}
      {activeTab === 'killchain' && (
        <div className="cs-panel p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)] mb-4">
            Cyber Kill Chain Progress
          </div>
          <KillChainView techniques={allTechniques} />
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function MitreMatrixView({ techniques }: { techniques: TechniqueMapping[] }) {
  const [selectedTechnique, setSelectedTechnique] = useState<TechniqueMapping | null>(null);

  const tacticGroups = useMemo(() => {
    const groups: Record<string, TechniqueMapping[]> = {};
    TACTICS.forEach((t) => { groups[t.id] = []; });
    techniques.forEach((tech) => {
      if (groups[tech.tactic]) groups[tech.tactic].push(tech);
    });
    return groups;
  }, [techniques]);

  const stats = useMemo(() => ({
    total: techniques.length,
    succeeded: techniques.filter((t) => t.status === 'succeeded').length,
    detected: techniques.filter((t) => t.status === 'detected').length,
    attempted: techniques.filter((t) => t.status === 'attempted').length,
    notTested: techniques.filter((t) => t.status === 'not_tested').length,
  }), [techniques]);

  return (
    <>
      <div className="grid grid-cols-5 gap-3">
        <StatCard label="Techniques" value={stats.total} color="var(--grok-text-heading)" />
        <StatCard label="Succeeded" value={stats.succeeded} color="var(--grok-success)" />
        <StatCard label="Detected" value={stats.detected} color="var(--grok-warning)" />
        <StatCard label="Attempted" value={stats.attempted} color="var(--grok-scan-cyan)" />
        <StatCard label="Not Tested" value={stats.notTested} color="var(--grok-text-muted)" />
      </div>
      <div className="cs-panel p-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)] mb-4">
          MITRE ATT&CK Enterprise Matrix
        </div>
        <div className="overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {TACTICS.map((tactic) => {
              const techs = tacticGroups[tactic.id] || [];
              return (
                <div key={tactic.id} className="w-32 flex-shrink-0">
                  <div className="bg-[var(--grok-surface-3)] px-2 py-2 rounded-t text-center border border-[var(--grok-border)]">
                    <div className="text-[9px] font-bold uppercase text-[var(--grok-text-heading)] leading-tight">{tactic.short}</div>
                    <div className="text-[8px] text-[var(--grok-text-muted)] mt-0.5">{tactic.id}</div>
                  </div>
                  <div className="space-y-0.5 mt-0.5">
                    {techs.length === 0 ? (
                      <div className="h-8 bg-[var(--grok-surface-2)] rounded border border-[var(--grok-border)]/50 flex items-center justify-center">
                        <span className="text-[8px] text-[var(--grok-text-muted)]">-</span>
                      </div>
                    ) : (
                      techs.map((tech) => (
                        <button
                          key={tech.id}
                          onClick={() => setSelectedTechnique(selectedTechnique?.id === tech.id ? null : tech)}
                          className={`w-full text-left px-2 py-1.5 rounded border transition-all text-[9px] leading-tight ${
                            getTechniqueStyle(tech.status)
                          } ${selectedTechnique?.id === tech.id ? 'ring-1 ring-[var(--grok-recon-blue)]' : ''}`}
                        >
                          <div className="font-mono text-[8px] opacity-60">{tech.id}</div>
                          <div className="truncate">{tech.name}</div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {selectedTechnique && (
          <div className="mt-4 p-4 bg-[var(--grok-surface-2)] rounded border border-[var(--grok-border)] animate-fade-in">
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-xs font-mono text-[var(--grok-text-muted)]">{selectedTechnique.id}</span>
                <h3 className="text-sm font-semibold text-[var(--grok-text-heading)]">{selectedTechnique.name}</h3>
              </div>
              <span className={`px-2 py-1 text-[10px] font-mono font-bold uppercase rounded border ${getTechniqueStyle(selectedTechnique.status)}`}>
                {selectedTechnique.status.replace('_', ' ')}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-4 text-xs">
              <div>
                <span className="text-[var(--grok-text-muted)]">Tactic:</span>
                <span className="ml-2 text-[var(--grok-text-body)]">
                  {TACTICS.find((t) => t.id === selectedTechnique.tactic)?.name}
                </span>
              </div>
              {selectedTechnique.source && (
                <div>
                  <span className="text-[var(--grok-text-muted)]">Source:</span>
                  <span className="ml-2 text-[var(--grok-text-body)] font-mono">{selectedTechnique.source}</span>
                </div>
              )}
              {selectedTechnique.count !== undefined && (
                <div>
                  <span className="text-[var(--grok-text-muted)]">Findings:</span>
                  <span className="ml-2 text-[var(--grok-text-heading)] font-mono font-bold">{selectedTechnique.count}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="cs-panel p-3 text-center">
      <div className="text-xl font-mono font-bold" style={{ color }}>{value}</div>
      <div className="text-[9px] text-[var(--grok-text-muted)] uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}

function KillChainView({ techniques }: { techniques: TechniqueMapping[] }) {
  return (
    <div className="space-y-2">
      {KILL_CHAIN_PHASES.map((phase, idx) => {
        const phaseTechniques = techniques.filter((t) => phase.tactics.includes(t.tactic));
        const succeeded = phaseTechniques.filter((t) => t.status === 'succeeded').length;
        const detected = phaseTechniques.filter((t) => t.status === 'detected').length;
        const total = phaseTechniques.length;
        const progress = total > 0 ? Math.round(((succeeded + detected * 0.5) / total) * 100) : 0;
        const Icon = phase.icon;

        return (
          <div key={phase.id} className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border ${
              succeeded > 0
                ? 'bg-[var(--grok-success)]/10 border-[var(--grok-success)]/50 text-[var(--grok-success)]'
                : detected > 0
                ? 'bg-[var(--grok-warning)]/10 border-[var(--grok-warning)]/50 text-[var(--grok-warning)]'
                : 'bg-[var(--grok-surface-3)] border-[var(--grok-border)] text-[var(--grok-text-muted)]'
            }`}>
              {idx + 1}
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5 text-[var(--grok-text-muted)]" />
                  <span className="text-xs font-semibold text-[var(--grok-text-heading)]">{phase.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {succeeded > 0 && <span className="text-[9px] font-mono text-[var(--grok-success)]">{succeeded} succeeded</span>}
                  {detected > 0 && <span className="text-[9px] font-mono text-[var(--grok-warning)]">{detected} detected</span>}
                  <span className="text-[9px] font-mono text-[var(--grok-text-muted)]">{total} total</span>
                </div>
              </div>
              <div className="w-full h-1.5 bg-[var(--grok-surface-3)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${progress}%`,
                    background: succeeded > 0 ? 'var(--grok-success)' : detected > 0 ? 'var(--grok-warning)' : 'var(--grok-border)',
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
