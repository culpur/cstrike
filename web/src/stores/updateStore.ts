import { create } from 'zustand';

interface UpdateInfo {
  commits: number;
  latestCommit: string;
  latestMessage: string;
  latestTag?: string;
}

interface UpdateStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  output: string;
  startedAt?: number;
  completedAt?: number;
}

interface UpdateStore {
  updateAvailable: boolean;
  updateInfo: UpdateInfo | null;
  updateStatus: 'idle' | 'checking' | 'available' | 'updating' | 'completed' | 'error';
  steps: UpdateStep[];
  currentStep: number;
  error: string | null;

  setUpdateAvailable: (available: boolean, info?: UpdateInfo) => void;
  setUpdateStatus: (status: UpdateStore['updateStatus']) => void;
  setSteps: (steps: UpdateStep[]) => void;
  setCurrentStep: (step: number) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useUpdateStore = create<UpdateStore>((set) => ({
  updateAvailable: false,
  updateInfo: null,
  updateStatus: 'idle',
  steps: [],
  currentStep: 0,
  error: null,

  setUpdateAvailable: (available, info) => set({
    updateAvailable: available,
    updateInfo: info || null,
    updateStatus: available ? 'available' : 'idle',
  }),
  setUpdateStatus: (status) => set({ updateStatus: status }),
  setSteps: (steps) => set({ steps }),
  setCurrentStep: (step) => set({ currentStep: step }),
  setError: (error) => set({ error }),
  reset: () => set({
    updateAvailable: false,
    updateInfo: null,
    updateStatus: 'idle',
    steps: [],
    currentStep: 0,
    error: null,
  }),
}));
