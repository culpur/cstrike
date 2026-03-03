/**
 * AI Store - Manages AI thought stream and decisions
 */

import { create } from 'zustand';
import type { AIThought, AIDecision } from '@/types';
import { apiService } from '@services/api';

interface AIStore {
  // State
  thoughts: AIThought[];
  decisions: AIDecision[];
  isThinking: boolean;
  maxThoughts: number;

  // Actions
  loadThoughts: () => Promise<void>;
  addThought: (thought: Omit<AIThought, 'id' | 'timestamp'> & { timestamp?: number }) => void;
  addDecision: (decision: Omit<AIDecision, 'id' | 'timestamp'>) => void;
  setThinking: (thinking: boolean) => void;
  clearThoughts: () => void;
  reset: () => void;
}

export const useAIStore = create<AIStore>((set, get) => ({
  // Initial state
  thoughts: [],
  decisions: [],
  isThinking: false,
  maxThoughts: 1000, // Keep last 1000 thoughts

  // Actions
  loadThoughts: async () => {
    try {
      const raw = await apiService.getAIThoughts();
      const { addThought } = get();
      for (const t of raw) {
        addThought({
          thoughtType: t.thoughtType as AIThought['thoughtType'],
          content: t.content,
          command: t.command,
          metadata: t.metadata,
          // Preserve the original DB timestamp so historical thoughts sort correctly.
          timestamp: t.timestamp,
        });
      }
    } catch {
      // API unreachable — store stays with whatever is already in memory.
    }
  },

  addThought: (thought) =>
    set((state) => {
      // Deduplicate — skip if we already have a thought with the same type + content
      // (prevents double-add from historical API load + live WebSocket)
      const isDupe = state.thoughts.some(
        (t) => t.thoughtType === thought.thoughtType && t.content === thought.content,
      );
      if (isDupe) return state;

      const newThought: AIThought = {
        ...thought,
        id: `thought-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        // Preserve timestamp from persisted data when provided; use Date.now() for live events.
        timestamp: thought.timestamp ?? Date.now(),
      };

      const thoughts = [...state.thoughts, newThought];

      // Trim to max thoughts
      if (thoughts.length > state.maxThoughts) {
        thoughts.shift();
      }

      return { thoughts };
    }),

  addDecision: (decision) =>
    set((state) => {
      const newDecision: AIDecision = {
        ...decision,
        id: `decision-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
      };

      return {
        decisions: [...state.decisions, newDecision],
      };
    }),

  setThinking: (thinking) => set({ isThinking: thinking }),

  clearThoughts: () =>
    set({
      thoughts: [],
      decisions: [],
    }),

  reset: () =>
    set({
      thoughts: [],
      decisions: [],
      isThinking: false,
    }),
}));
