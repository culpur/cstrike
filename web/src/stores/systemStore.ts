/**
 * System Store — system metrics, services, phase state
 */

import { create } from 'zustand';
import type {
  SystemMetrics,
  ServiceState,
  PhaseProgress,
  PhaseType,
  ServiceStatus,
  VpnConnection,
} from '@/types';

interface SystemStore {
  // State
  metrics: SystemMetrics;
  services: ServiceState;
  phaseProgress: PhaseProgress;
  connected: boolean;
  vpnConnections: VpnConnection[];

  // Actions
  updateMetrics: (metrics: Partial<SystemMetrics>) => void;
  updateServiceStatus: (service: string, status: ServiceStatus) => void;
  updatePhase: (phase: PhaseType) => void;
  setPhaseComplete: (phase: string, complete: boolean) => void;
  setConnected: (connected: boolean) => void;
  setVpnConnections: (connections: VpnConnection[]) => void;
  reset: () => void;
}

const initialMetrics: SystemMetrics = {
  cpu: 0,
  memory: 0,
  vpnIp: null,
  uptime: 0,
  timestamp: Date.now(),
};

const initialServices: ServiceState = {
  metasploitRpc: 'stopped',
  zap: 'stopped',
  burp: 'stopped',
};

const initialPhaseProgress: PhaseProgress = {
  currentPhase: 'idle',
  reconComplete: false,
  aiAnalysisComplete: false,
  zapScanComplete: false,
  metasploitScanComplete: false,
  exploitationComplete: false,
};

export const useSystemStore = create<SystemStore>((set) => ({
  metrics: initialMetrics,
  services: initialServices,
  phaseProgress: initialPhaseProgress,
  connected: false,
  vpnConnections: [],

  updateMetrics: (metrics) =>
    set((state) => ({
      metrics: {
        ...state.metrics,
        ...metrics,
        timestamp: Date.now(),
      },
    })),

  updateServiceStatus: (service, status) =>
    set((state) => ({
      services: {
        ...state.services,
        [service]: status,
      },
    })),

  updatePhase: (phase) =>
    set((state) => ({
      phaseProgress: {
        ...state.phaseProgress,
        currentPhase: phase,
      },
    })),

  setPhaseComplete: (phase, complete) =>
    set((state) => ({
      phaseProgress: {
        ...state.phaseProgress,
        [phase]: complete,
      },
    })),

  setConnected: (connected) => set({ connected }),

  setVpnConnections: (connections) => set({ vpnConnections: connections }),

  reset: () =>
    set({
      metrics: initialMetrics,
      services: initialServices,
      phaseProgress: initialPhaseProgress,
      connected: false,
      vpnConnections: [],
    }),
}));
