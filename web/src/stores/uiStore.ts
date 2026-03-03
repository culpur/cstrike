/**
 * UI Store - Manages UI state (navigation, toasts, modals)
 */

import { create } from 'zustand';
import type { ToastNotification } from '@/types';
import { generateId } from '@utils/index';

interface UIStore {
  // State
  sidebarCollapsed: boolean;
  activeView: string;
  toasts: ToastNotification[];
  workflowDrawerOpen: boolean;
  workflowDrawerTarget: string | null;

  // Actions
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setActiveView: (view: string) => void;
  addToast: (toast: Omit<ToastNotification, 'id' | 'timestamp'>) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
  openWorkflowDrawer: (target?: string) => void;
  closeWorkflowDrawer: () => void;
  navigateToResultsWithTarget: (target: string) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  // Initial state
  sidebarCollapsed: false,
  activeView: 'dashboard',
  toasts: [],
  workflowDrawerOpen: false,
  workflowDrawerTarget: null,

  // Actions
  toggleSidebar: () =>
    set((state) => ({
      sidebarCollapsed: !state.sidebarCollapsed,
    })),

  setSidebarCollapsed: (collapsed) =>
    set({ sidebarCollapsed: collapsed }),

  setActiveView: (view) =>
    set({ activeView: view }),

  addToast: (toast) =>
    set((state) => {
      const newToast: ToastNotification = {
        ...toast,
        id: generateId(),
        timestamp: Date.now(),
      };

      // Auto-remove after duration (default 5s)
      if (toast.duration !== 0) {
        setTimeout(() => {
          set((state) => ({
            toasts: state.toasts.filter((t) => t.id !== newToast.id),
          }));
        }, toast.duration || 5000);
      }

      return {
        toasts: [...state.toasts, newToast],
      };
    }),

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  clearToasts: () => set({ toasts: [] }),

  openWorkflowDrawer: (target) =>
    set({ workflowDrawerOpen: true, workflowDrawerTarget: target ?? null }),

  closeWorkflowDrawer: () =>
    set({ workflowDrawerOpen: false }),

  navigateToResultsWithTarget: (target) =>
    set({
      activeView: 'results',
      workflowDrawerOpen: false,
      workflowDrawerTarget: target,
    }),
}));
