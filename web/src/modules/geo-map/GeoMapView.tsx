/**
 * Geolocation Dark Map — World map visualization of targets and attack activity
 *
 * SVG-based world map with target locations, attack paths, and
 * real-time activity indicators. No external map library required.
 */

import { useState, useEffect, useMemo } from 'react';
import {
  Globe,
  Shield,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { cn } from '@utils/index';
import { apiService } from '@services/api';
import { useLootStore } from '@stores/lootStore';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface GeoTarget {
  id: string;
  label: string;
  ip?: string;
  lat: number;
  lng: number;
  status: 'scanning' | 'complete' | 'idle';
  ports?: number;
  vulns?: number;
  country?: string;
  city?: string;
}

interface AttackPath {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  type: 'recon' | 'exploit' | 'exfil';
  active: boolean;
}

interface MapEvent {
  id: number;
  lat: number;
  lng: number;
  type: 'scan' | 'vuln' | 'credential' | 'exploit';
  label: string;
  timestamp: number;
}

/* ------------------------------------------------------------------ */
/*  World Basemap — Continent outlines as [lat, lng] coordinates       */
/* ------------------------------------------------------------------ */
const CONTINENT_COORDS: [number, number][][] = [
  // North America
  [
    [68, -168], [72, -150], [71, -130], [70, -110], [73, -95],
    [68, -68], [55, -58], [47, -53], [44, -63], [42, -70],
    [35, -75], [30, -81], [25, -80], [30, -88], [29, -94],
    [26, -97], [20, -100], [15, -92], [20, -105], [23, -110],
    [32, -117], [38, -122], [48, -125], [55, -133], [60, -148],
    [68, -168],
  ],
  // South America
  [
    [12, -72], [10, -66], [7, -56], [3, -51], [-2, -44],
    [-8, -35], [-15, -39], [-23, -43], [-33, -53],
    [-40, -62], [-50, -68], [-55, -67], [-53, -73],
    [-46, -75], [-35, -72], [-22, -70], [-14, -76],
    [-2, -80], [4, -77], [10, -75], [12, -72],
  ],
  // Africa
  [
    [35, -6], [37, 10], [33, 13], [31, 32],
    [22, 37], [12, 50], [0, 42], [-10, 40],
    [-18, 36], [-26, 33], [-34, 26], [-34, 18],
    [-28, 15], [-12, 12], [0, 7], [5, 1],
    [6, -5], [5, -10], [10, -16], [15, -17],
    [22, -17], [28, -13], [35, -6],
  ],
  // Europe
  [
    [36, -10], [38, -9], [43, -9], [48, -5],
    [51, 2], [55, 8], [58, 12], [62, 18],
    [70, 28], [70, 42], [60, 30], [55, 20],
    [50, 18], [45, 25], [42, 29], [37, 22],
    [36, 12], [40, 5], [43, 0], [40, -4], [36, -10],
  ],
  // Asia
  [
    [70, 42], [73, 65], [73, 95], [72, 125], [70, 145],
    [64, 143], [58, 135], [50, 142], [42, 132],
    [35, 129], [30, 121], [22, 114], [15, 108],
    [1, 104], [8, 98], [20, 96], [22, 88],
    [18, 82], [8, 77], [24, 68], [26, 56],
    [16, 52], [12, 44], [22, 37], [31, 32],
    [37, 36], [42, 44], [42, 52], [47, 42],
    [55, 55], [62, 42], [70, 42],
  ],
  // Australia
  [
    [-12, 131], [-15, 125], [-24, 114], [-31, 115],
    [-35, 118], [-38, 145], [-37, 150], [-28, 153],
    [-20, 148], [-15, 145], [-11, 136], [-12, 131],
  ],
  // Greenland
  [
    [77, -70], [83, -40], [82, -22], [76, -18],
    [70, -22], [60, -44], [64, -53], [70, -56], [77, -70],
  ],
  // Japan
  [
    [33, 131], [35, 133], [37, 137], [39, 140],
    [42, 141], [45, 142], [43, 140], [38, 137],
    [35, 135], [33, 131],
  ],
  // UK
  [
    [50, -5], [51, 1], [53, 0], [55, -2],
    [58, -4], [57, -7], [55, -6], [52, -5], [50, -5],
  ],
  // New Zealand
  [
    [-35, 174], [-38, 176], [-42, 172], [-46, 168],
    [-44, 167], [-40, 170], [-36, 174], [-35, 174],
  ],
  // Indonesia (Sumatra + Java simplified)
  [
    [5, 95], [2, 99], [-1, 104], [-6, 106],
    [-8, 114], [-8, 116], [-6, 112], [-3, 107],
    [0, 101], [3, 97], [5, 95],
  ],
  // Borneo
  [
    [7, 117], [5, 119], [1, 110], [-3, 110],
    [-2, 113], [0, 118], [4, 118], [7, 117],
  ],
];

/* Simple grid for reference */
const GRID_LINES = Array.from({ length: 7 }, (_, i) => ({
  y: 50 + i * 50,
  label: `${90 - i * 30}°`,
}));

const MERIDIANS = Array.from({ length: 9 }, (_, i) => ({
  x: 100 + i * 75,
  label: `${-180 + i * 45}°`,
}));

/* ------------------------------------------------------------------ */
/*  Coordinate projection — Mercator-ish onto our viewBox              */
/* ------------------------------------------------------------------ */
function project(lat: number, lng: number): { x: number; y: number } {
  const x = ((lng + 180) / 360) * 700 + 50;
  const y = ((90 - lat) / 180) * 350 + 25;
  return { x, y };
}

/** Convert [lat, lng] coordinate array to SVG path string */
function coordsToPath(coords: [number, number][]): string {
  return coords.map(([lat, lng], i) => {
    const { x, y } = project(lat, lng);
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ') + ' Z';
}

/* ------------------------------------------------------------------ */
/*  Demo data — used when no real targets exist                        */
/* ------------------------------------------------------------------ */
const DEMO_TARGETS: GeoTarget[] = [
  { id: 'd1', label: 'web-target-01', ip: '192.168.1.100', lat: 37.7749, lng: -122.4194, status: 'complete', ports: 12, vulns: 3, country: 'US', city: 'San Francisco' },
  { id: 'd2', label: 'api-server-eu', ip: '10.0.70.80', lat: 51.5074, lng: -0.1278, status: 'scanning', ports: 8, vulns: 1, country: 'UK', city: 'London' },
  { id: 'd3', label: 'db-cluster-asia', ip: '172.16.0.50', lat: 35.6762, lng: 139.6503, status: 'idle', ports: 3, vulns: 0, country: 'JP', city: 'Tokyo' },
  { id: 'd4', label: 'cdn-edge', ip: '203.0.113.10', lat: -33.8688, lng: 151.2093, status: 'complete', ports: 5, vulns: 2, country: 'AU', city: 'Sydney' },
];

const DEMO_PATHS: AttackPath[] = [
  { from: { lat: 38.9, lng: -77.0 }, to: { lat: 37.77, lng: -122.42 }, type: 'recon', active: true },
  { from: { lat: 38.9, lng: -77.0 }, to: { lat: 51.51, lng: -0.13 }, type: 'exploit', active: true },
  { from: { lat: 51.51, lng: -0.13 }, to: { lat: 35.68, lng: 139.65 }, type: 'recon', active: false },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function statusDotColor(s: GeoTarget['status']) {
  switch (s) {
    case 'scanning':
      return 'var(--grok-recon-blue)';
    case 'complete':
      return 'var(--grok-ok-green)';
    default:
      return 'var(--grok-text-muted)';
  }
}

function pathColor(t: AttackPath['type']) {
  switch (t) {
    case 'recon':
      return 'var(--grok-recon-blue)';
    case 'exploit':
      return 'var(--grok-exploit-red)';
    case 'exfil':
      return 'var(--grok-loot-gold)';
  }
}

const eventColors: Record<MapEvent['type'], string> = {
  scan: 'var(--grok-recon-blue)',
  vuln: 'var(--grok-loot-gold)',
  credential: 'var(--grok-ok-green)',
  exploit: 'var(--grok-exploit-red)',
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function GeoMapView() {
  const lootItems = useLootStore((s) => s.items);
  const [targets, setTargets] = useState<GeoTarget[]>(DEMO_TARGETS);
  const [paths] = useState<AttackPath[]>(DEMO_PATHS);
  const [events, setEvents] = useState<MapEvent[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<GeoTarget | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [showPaths, setShowPaths] = useState(true);
  const [showEvents, setShowEvents] = useState(true);

  // Fetch real targets
  useEffect(() => {
    (async () => {
      try {
        const realTargets = await apiService.getResults();
        if (realTargets.length > 0) {
          const locations = [
            { lat: 37.77, lng: -122.42, country: 'US', city: 'San Francisco' },
            { lat: 40.71, lng: -74.01, country: 'US', city: 'New York' },
            { lat: 51.51, lng: -0.13, country: 'UK', city: 'London' },
            { lat: 48.86, lng: 2.35, country: 'FR', city: 'Paris' },
            { lat: 35.68, lng: 139.65, country: 'JP', city: 'Tokyo' },
            { lat: 52.52, lng: 13.41, country: 'DE', city: 'Berlin' },
          ];
          const mapped: GeoTarget[] = realTargets.map((t, i) => {
            const loc = locations[i % locations.length];
            return {
              id: t.id,
              label: t.url,
              ip: t.ip,
              lat: loc.lat,
              lng: loc.lng,
              status: t.status === 'scanning' ? 'scanning' : t.status === 'complete' ? 'complete' : 'idle',
              country: loc.country,
              city: loc.city,
            };
          });
          setTargets(mapped);
        }
      } catch { /* use demo data */ }
    })();
  }, []);

  // Generate events from loot
  useEffect(() => {
    const evts: MapEvent[] = lootItems.slice(0, 20).map((l, i) => {
      const t = targets[i % targets.length];
      return {
        id: i,
        lat: t.lat + (Math.random() - 0.5) * 5,
        lng: t.lng + (Math.random() - 0.5) * 5,
        type: l.category === 'credential' || l.category === 'password' ? 'credential' : 'scan',
        label: `${l.category}: ${l.value.slice(0, 20)}`,
        timestamp: l.timestamp,
      };
    });
    setEvents(evts);
  }, [lootItems, targets]);

  const viewBox = useMemo(() => {
    const cx = 400, cy = 200;
    const w = 800 / zoom, h = 400 / zoom;
    return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`;
  }, [zoom]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[var(--grok-surface-1)] border-b border-[var(--grok-border)] flex-shrink-0">
        <div className="flex items-center gap-3">
          <Globe className="w-5 h-5 text-[var(--grok-recon-blue)]" />
          <h1 className="text-lg font-bold text-[var(--grok-text-heading)]">Geo Map</h1>
          <span className="text-[10px] text-[var(--grok-text-muted)] font-mono">
            {targets.length} targets tracked
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Layer toggles */}
          <div className="flex items-center gap-1 mr-2">
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
            <button
              onClick={() => setShowEvents(!showEvents)}
              className={cn(
                'px-2 py-1 text-[10px] rounded border transition-colors',
                showEvents ? 'border-[var(--grok-loot-gold)]/40 text-[var(--grok-loot-gold)]' : 'border-[var(--grok-border)] text-[var(--grok-text-muted)]'
              )}
            >
              Events
            </button>
          </div>
          {/* Zoom */}
          <button
            onClick={() => setZoom((z) => Math.min(z + 0.5, 4))}
            className="p-1.5 rounded text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] hover:bg-[var(--grok-surface-2)]"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <span className="text-[10px] text-[var(--grok-text-muted)] font-mono w-8 text-center">
            {zoom}x
          </span>
          <button
            onClick={() => setZoom((z) => Math.max(z - 0.5, 0.5))}
            className="p-1.5 rounded text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] hover:bg-[var(--grok-surface-2)]"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Map + Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Map */}
        <div className="flex-1 relative bg-[var(--grok-void)]">
          <svg viewBox={viewBox} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
            {/* Grid */}
            {showGrid && (
              <g opacity={0.15}>
                {GRID_LINES.map((l) => (
                  <line key={`h${l.y}`} x1={50} y1={l.y} x2={750} y2={l.y} stroke="var(--grok-border)" strokeWidth={0.5} />
                ))}
                {MERIDIANS.map((l) => (
                  <line key={`v${l.x}`} x1={l.x} y1={25} x2={l.x} y2={375} stroke="var(--grok-border)" strokeWidth={0.5} />
                ))}
              </g>
            )}

            {/* Continent basemap */}
            {CONTINENT_COORDS.map((coords, i) => (
              <path
                key={`continent-${i}`}
                d={coordsToPath(coords)}
                fill="var(--grok-surface-2)"
                stroke="var(--grok-border)"
                strokeWidth={0.5}
                opacity={0.6}
              />
            ))}

            {/* Attack paths */}
            {showPaths &&
              paths.map((p, i) => {
                const from = project(p.from.lat, p.from.lng);
                const to = project(p.to.lat, p.to.lng);
                const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 30 };
                return (
                  <g key={`path-${i}`}>
                    <path
                      d={`M ${from.x} ${from.y} Q ${mid.x} ${mid.y} ${to.x} ${to.y}`}
                      fill="none"
                      stroke={pathColor(p.type)}
                      strokeWidth={1}
                      strokeDasharray={p.active ? '4 2' : '2 4'}
                      opacity={p.active ? 0.8 : 0.3}
                    >
                      {p.active && (
                        <animate attributeName="stroke-dashoffset" from="6" to="0" dur="1s" repeatCount="indefinite" />
                      )}
                    </path>
                    {/* Arrow head */}
                    <circle cx={to.x} cy={to.y} r={2} fill={pathColor(p.type)} opacity={0.6} />
                  </g>
                );
              })}

            {/* Events */}
            {showEvents &&
              events.map((e) => {
                const { x, y } = project(e.lat, e.lng);
                return (
                  <g key={`evt-${e.id}`}>
                    <circle cx={x} cy={y} r={3} fill={eventColors[e.type]} opacity={0.4}>
                      <animate attributeName="r" from="2" to="6" dur="2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" from="0.4" to="0" dur="2s" repeatCount="indefinite" />
                    </circle>
                    <circle cx={x} cy={y} r={1.5} fill={eventColors[e.type]} />
                  </g>
                );
              })}

            {/* Targets */}
            {targets.map((t) => {
              const { x, y } = project(t.lat, t.lng);
              const isSelected = selectedTarget?.id === t.id;
              return (
                <g
                  key={t.id}
                  onClick={() => setSelectedTarget(isSelected ? null : t)}
                  className="cursor-pointer"
                >
                  {/* Pulse ring for scanning targets */}
                  {t.status === 'scanning' && (
                    <circle cx={x} cy={y} r={8} fill="none" stroke="var(--grok-recon-blue)" strokeWidth={0.5} opacity={0.5}>
                      <animate attributeName="r" from="6" to="16" dur="1.5s" repeatCount="indefinite" />
                      <animate attributeName="opacity" from="0.5" to="0" dur="1.5s" repeatCount="indefinite" />
                    </circle>
                  )}

                  {/* Selection ring */}
                  {isSelected && (
                    <circle cx={x} cy={y} r={10} fill="none" stroke="var(--grok-recon-blue)" strokeWidth={1} strokeDasharray="3 2" />
                  )}

                  {/* Target dot */}
                  <circle cx={x} cy={y} r={4} fill={statusDotColor(t.status)} stroke="var(--grok-void)" strokeWidth={1.5} />

                  {/* Label */}
                  <text x={x + 7} y={y + 3} fontSize={6} fill="var(--grok-text-body)" fontFamily="monospace">
                    {t.label.length > 20 ? t.label.slice(0, 20) + '...' : t.label}
                  </text>
                </g>
              );
            })}

            {/* Origin marker (attacker position) */}
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
                ORIGIN
              </text>
            </g>
          </svg>

          {/* Legend overlay */}
          <div className="absolute bottom-4 left-4 flex gap-3 text-[9px] font-mono text-[var(--grok-text-muted)]">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[var(--grok-ok-green)]" /> Complete
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[var(--grok-recon-blue)]" /> Scanning
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[var(--grok-text-muted)]" /> Idle
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-[var(--grok-exploit-red)]" style={{ clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' }} /> Origin
            </span>
          </div>
        </div>

        {/* Sidebar — target detail / list */}
        <div className="w-72 flex-shrink-0 bg-[var(--grok-surface-1)] border-l border-[var(--grok-border)] overflow-y-auto">
          {selectedTarget ? (
            <div className="p-4 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-bold text-[var(--grok-text-heading)]">{selectedTarget.label}</h3>
                  <span className="text-[10px] text-[var(--grok-text-muted)] font-mono">{selectedTarget.ip || '—'}</span>
                </div>
                <span
                  className="px-2 py-0.5 rounded text-[10px] uppercase font-bold"
                  style={{
                    background: `${statusDotColor(selectedTarget.status)}15`,
                    color: statusDotColor(selectedTarget.status),
                  }}
                >
                  {selectedTarget.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 rounded bg-[var(--grok-surface-2)]">
                  <span className="text-[var(--grok-text-muted)]">Country</span>
                  <p className="text-[var(--grok-text-body)] font-mono">{selectedTarget.country || '—'}</p>
                </div>
                <div className="p-2 rounded bg-[var(--grok-surface-2)]">
                  <span className="text-[var(--grok-text-muted)]">City</span>
                  <p className="text-[var(--grok-text-body)] font-mono">{selectedTarget.city || '—'}</p>
                </div>
                <div className="p-2 rounded bg-[var(--grok-surface-2)]">
                  <span className="text-[var(--grok-text-muted)]">Coordinates</span>
                  <p className="text-[var(--grok-text-body)] font-mono text-[10px]">
                    {selectedTarget.lat.toFixed(2)}, {selectedTarget.lng.toFixed(2)}
                  </p>
                </div>
                <div className="p-2 rounded bg-[var(--grok-surface-2)]">
                  <span className="text-[var(--grok-text-muted)]">Ports</span>
                  <p className="text-[var(--grok-text-body)] font-mono">{selectedTarget.ports ?? '—'}</p>
                </div>
              </div>

              {selectedTarget.vulns !== undefined && selectedTarget.vulns > 0 && (
                <div className="p-3 rounded bg-[var(--grok-exploit-red)]/5 border border-[var(--grok-exploit-red)]/20">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-[var(--grok-exploit-red)]" />
                    <span className="text-xs font-bold text-[var(--grok-exploit-red)]">
                      {selectedTarget.vulns} Vulnerabilities
                    </span>
                  </div>
                </div>
              )}

              <button
                onClick={() => setSelectedTarget(null)}
                className="w-full py-2 text-xs rounded border border-[var(--grok-border)] text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] hover:bg-[var(--grok-surface-2)]"
              >
                Close
              </button>
            </div>
          ) : (
            <div className="p-3 space-y-1">
              <div className="px-1 py-2">
                <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--grok-text-muted)]">
                  Tracked Targets
                </span>
              </div>
              {targets.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTarget(t)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-[var(--grok-surface-2)] transition-colors text-left"
                >
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: statusDotColor(t.status) }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[var(--grok-text-body)] truncate">{t.label}</p>
                    <p className="text-[10px] text-[var(--grok-text-muted)] font-mono">{t.ip || '—'}</p>
                  </div>
                  <span className="text-[10px] text-[var(--grok-text-muted)]">
                    {t.country}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Activity feed */}
          <div className="border-t border-[var(--grok-border)] p-3 space-y-1">
            <div className="px-1 py-2">
              <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--grok-text-muted)]">
                Recent Activity
              </span>
            </div>
            {events.slice(0, 8).map((e) => (
              <div key={e.id} className="flex items-center gap-2 px-2 py-1 text-[10px]">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: eventColors[e.type] }} />
                <span className="text-[var(--grok-text-body)] truncate flex-1">{e.label}</span>
              </div>
            ))}
            {events.length === 0 && (
              <p className="text-[10px] text-[var(--grok-text-muted)] px-2">No activity yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
