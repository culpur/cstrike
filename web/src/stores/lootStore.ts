/**
 * Loot Store - Manages collected credentials, ports, URLs, etc.
 */

import { create } from 'zustand';
import type { LootItem, CredentialPair, LootStats, LootCategory } from '@/types';
import { generateId } from '@utils/index';

interface LootStore {
  // State
  items: LootItem[];
  credentials: CredentialPair[];
  stats: LootStats;

  // Actions
  addLootItem: (item: Omit<LootItem, 'id' | 'timestamp'>) => void;
  addCredential: (credential: Omit<CredentialPair, 'id' | 'timestamp'>) => void;
  validateCredential: (id: string, validated: boolean) => void;
  removeLootItem: (id: string) => void;
  clearLoot: () => void;
  reset: () => void;

  // Computed
  getLootByCategory: (category: LootCategory) => LootItem[];
  getLootByTarget: (target: string) => LootItem[];
}

const calculateStats = (
  items: LootItem[],
  credentials: CredentialPair[]
): LootStats => {
  const byCategory: Record<LootCategory, number> = {
    username: 0,
    password: 0,
    hash: 0,
    url: 0,
    port: 0,
    credential: 0,
    file: 0,
  };

  items.forEach((item) => {
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
  });

  const uniqueTargets = new Set(items.map((item) => item.target)).size;
  const validatedCredentials = credentials.filter((c) => c.validated).length;

  return {
    totalItems: items.length,
    byCategory,
    uniqueTargets,
    validatedCredentials,
  };
};

export const useLootStore = create<LootStore>((set, get) => ({
  // Initial state
  items: [],
  credentials: [],
  stats: {
    totalItems: 0,
    byCategory: {
      username: 0,
      password: 0,
      hash: 0,
      url: 0,
      port: 0,
      credential: 0,
      file: 0,
    },
    uniqueTargets: 0,
    validatedCredentials: 0,
  },

  // Actions
  addLootItem: (item) =>
    set((state) => {
      const newItem: LootItem = {
        ...item,
        id: generateId(),
        timestamp: Date.now(),
      };

      const items = [...state.items, newItem];
      const stats = calculateStats(items, state.credentials);

      return { items, stats };
    }),

  addCredential: (credential) =>
    set((state) => {
      const newCredential: CredentialPair = {
        ...credential,
        id: generateId(),
        timestamp: Date.now(),
      };

      const credentials = [...state.credentials, newCredential];
      const stats = calculateStats(state.items, credentials);

      return { credentials, stats };
    }),

  validateCredential: (id, validated) =>
    set((state) => {
      const credentials = state.credentials.map((c) =>
        c.id === id ? { ...c, validated } : c
      );
      const stats = calculateStats(state.items, credentials);

      return { credentials, stats };
    }),

  removeLootItem: (id) =>
    set((state) => {
      const items = state.items.filter((item) => item.id !== id);
      const stats = calculateStats(items, state.credentials);

      return { items, stats };
    }),

  clearLoot: () =>
    set({
      items: [],
      credentials: [],
      stats: calculateStats([], []),
    }),

  reset: () =>
    set({
      items: [],
      credentials: [],
      stats: calculateStats([], []),
    }),

  // Computed
  getLootByCategory: (category) => {
    return get().items.filter((item) => item.category === category);
  },

  getLootByTarget: (target) => {
    return get().items.filter((item) => item.target === target);
  },
}));
