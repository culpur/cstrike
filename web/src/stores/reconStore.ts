/**
 * Reconnaissance Store - Manages targets, tools, and scan results
 */

import { create } from 'zustand';
import type {
  Target,
  ReconTool,
  PortScanResult,
  SubdomainResult,
  ReconOutput,
  ReconToolType,
  CompleteScanResults,
} from '@/types';
import { generateId } from '@utils/index';
import { apiService } from '@services/api';

interface ReconStore {
  // State
  targets: Target[];
  tools: ReconTool[];
  portScanResults: PortScanResult[];
  subdomainResults: SubdomainResult[];
  reconOutputs: ReconOutput[];
  activeScans: Set<string>;
  completedScans: Map<string, CompleteScanResults>; // scanId -> results

  // Actions
  loadTargets: () => Promise<void>;
  addTarget: (url: string) => void;
  removeTarget: (id: string) => void;
  updateTargetStatus: (id: string, status: Target['status']) => void;

  toggleTool: (tool: ReconToolType) => void;
  setToolRunning: (tool: ReconToolType, running: boolean) => void;

  addPortScanResult: (result: PortScanResult) => void;
  addSubdomainResult: (result: SubdomainResult) => void;
  addReconOutput: (output: ReconOutput) => void;

  startScan: (targetId: string) => void;
  completeScan: (targetId: string) => void;
  storeScanResults: (scanId: string, results: CompleteScanResults) => void;
  getScanResults: (scanId: string) => CompleteScanResults | undefined;

  clearResults: () => void;
  reset: () => void;
}

const defaultTools: ReconTool[] = [
  { name: 'nmap', enabled: true, running: false },
  { name: 'subfinder', enabled: true, running: false },
  { name: 'amass', enabled: false, running: false },
  { name: 'nikto', enabled: true, running: false },
  { name: 'httpx', enabled: true, running: false },
  { name: 'waybackurls', enabled: false, running: false },
  { name: 'gau', enabled: false, running: false },
  { name: 'dnsenum', enabled: false, running: false },
];

export const useReconStore = create<ReconStore>((set, get) => ({
  // Initial state
  targets: [],
  tools: defaultTools,
  portScanResults: [],
  subdomainResults: [],
  reconOutputs: [],
  activeScans: new Set(),
  completedScans: new Map(),

  // Actions
  loadTargets: async () => {
    try {
      const urls = await apiService.getTargets();
      set((state) => {
        // Collect URLs already in the store to avoid duplicates.
        const existingUrls = new Set(state.targets.map((t) => t.url));
        const newTargets: Target[] = urls
          .filter((url) => !existingUrls.has(url))
          .map((url) => ({
            id: generateId(),
            url,
            addedAt: Date.now(),
            status: 'pending' as const,
          }));
        if (newTargets.length === 0) return state;
        return { targets: [...state.targets, ...newTargets] };
      });
    } catch {
      // API unreachable — store stays with whatever is already in memory.
    }
  },

  addTarget: (url) =>
    set((state) => ({
      targets: [
        ...state.targets,
        {
          id: generateId(),
          url,
          addedAt: Date.now(),
          status: 'pending',
        },
      ],
    })),

  removeTarget: (id) =>
    set((state) => ({
      targets: state.targets.filter((t) => t.id !== id),
    })),

  updateTargetStatus: (id, status) =>
    set((state) => ({
      targets: state.targets.map((t) =>
        t.id === id ? { ...t, status } : t
      ),
    })),

  toggleTool: (tool) =>
    set((state) => ({
      tools: state.tools.map((t) =>
        t.name === tool ? { ...t, enabled: !t.enabled } : t
      ),
    })),

  setToolRunning: (tool, running) =>
    set((state) => ({
      tools: state.tools.map((t) =>
        t.name === tool
          ? { ...t, running, lastRun: running ? undefined : Date.now() }
          : t
      ),
    })),

  addPortScanResult: (result) =>
    set((state) => ({
      portScanResults: [...state.portScanResults, result],
    })),

  addSubdomainResult: (result) =>
    set((state) => ({
      subdomainResults: [...state.subdomainResults, result],
    })),

  addReconOutput: (output) =>
    set((state) => ({
      reconOutputs: [...state.reconOutputs, output],
    })),

  startScan: (targetId) =>
    set((state) => {
      const activeScans = new Set(state.activeScans);
      activeScans.add(targetId);
      return {
        activeScans,
        targets: state.targets.map((t) =>
          t.id === targetId ? { ...t, status: 'scanning' as const } : t
        ),
      };
    }),

  completeScan: (targetId) =>
    set((state) => {
      const activeScans = new Set(state.activeScans);
      activeScans.delete(targetId);
      return {
        activeScans,
        targets: state.targets.map((t) =>
          t.id === targetId ? { ...t, status: 'complete' as const } : t
        ),
      };
    }),

  storeScanResults: (scanId, results) =>
    set((state) => {
      const completedScans = new Map(state.completedScans);
      completedScans.set(scanId, results);
      return { completedScans };
    }),

  getScanResults: (scanId) => {
    return get().completedScans.get(scanId);
  },

  clearResults: () =>
    set({
      portScanResults: [],
      subdomainResults: [],
      reconOutputs: [],
    }),

  reset: () =>
    set({
      targets: [],
      tools: defaultTools,
      portScanResults: [],
      subdomainResults: [],
      reconOutputs: [],
      activeScans: new Set(),
      completedScans: new Map(),
    }),
}));
