/**
 * System Store - Manages system metrics, services, and phase state
 */

import { create } from 'zustand';
import type {
  SystemMetrics,
  ServiceState,
  PhaseProgress,
  PhaseType,
  ServiceStatus,
} from '@/types';

interface SystemStore {
  // State
  metrics: SystemMetrics;
  services: ServiceState;
  phaseProgress: PhaseProgress;
  connected: boolean;

  // Actions
  updateMetrics: (metrics: Partial<SystemMetrics>) => void;
  updateServiceStatus: (service: keyof ServiceState, status: ServiceStatus) => void;
  updatePhase: (phase: PhaseType) => void;
  setPhaseComplete: (phase: keyof Omit<PhaseProgress, 'currentPhase'>, complete: boolean) => void;
  setConnected: (connected: boolean) => void;
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
  // Initial state
  metrics: initialMetrics,
  services: initialServices,
  phaseProgress: initialPhaseProgress,
  connected: false,

  // Actions
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

  reset: () =>
    set({
      metrics: initialMetrics,
      services: initialServices,
      phaseProgress: initialPhaseProgress,
      connected: false,
    }),
}));
