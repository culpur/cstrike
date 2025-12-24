/**
 * Log Store - Manages application logs with filtering
 */

import { create } from 'zustand';
import type { LogEntry, LogFilter } from '@/types';
import { generateId } from '@utils/index';

interface LogStore {
  // State
  logs: LogEntry[];
  filter: LogFilter;
  maxLogs: number;

  // Actions
  addLog: (log: Omit<LogEntry, 'id' | 'timestamp'>) => void;
  setFilter: (filter: Partial<LogFilter>) => void;
  clearLogs: () => void;
  reset: () => void;

  // Computed
  getFilteredLogs: () => LogEntry[];
}

const defaultFilter: LogFilter = {
  levels: ['DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'],
  sources: [],
  searchQuery: '',
};

export const useLogStore = create<LogStore>((set, get) => ({
  // Initial state
  logs: [],
  filter: defaultFilter,
  maxLogs: 5000, // Keep last 5000 logs

  // Actions
  addLog: (log) =>
    set((state) => {
      const newLog: LogEntry = {
        ...log,
        id: generateId(),
        timestamp: Date.now(),
      };

      const logs = [...state.logs, newLog];

      // Trim to max logs
      if (logs.length > state.maxLogs) {
        logs.shift();
      }

      return { logs };
    }),

  setFilter: (filter) =>
    set((state) => ({
      filter: {
        ...state.filter,
        ...filter,
      },
    })),

  clearLogs: () => set({ logs: [] }),

  reset: () =>
    set({
      logs: [],
      filter: defaultFilter,
    }),

  // Computed
  getFilteredLogs: () => {
    const { logs, filter } = get();

    return logs.filter((log) => {
      // Filter by level
      if (!filter.levels.includes(log.level)) {
        return false;
      }

      // Filter by source
      if (filter.sources.length > 0 && !filter.sources.includes(log.source)) {
        return false;
      }

      // Filter by search query
      if (filter.searchQuery) {
        const query = filter.searchQuery.toLowerCase();
        const matches =
          log.message.toLowerCase().includes(query) ||
          log.source.toLowerCase().includes(query);
        if (!matches) {
          return false;
        }
      }

      // Filter by time range
      if (filter.startTime && log.timestamp < filter.startTime) {
        return false;
      }
      if (filter.endTime && log.timestamp > filter.endTime) {
        return false;
      }

      return true;
    });
  },
}));
