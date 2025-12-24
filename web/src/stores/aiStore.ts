/**
 * AI Store - Manages AI thought stream and decisions
 */

import { create } from 'zustand';
import type { AIThought, AIDecision } from '@/types';

interface AIStore {
  // State
  thoughts: AIThought[];
  decisions: AIDecision[];
  isThinking: boolean;
  maxThoughts: number;

  // Actions
  addThought: (thought: Omit<AIThought, 'id' | 'timestamp'>) => void;
  addDecision: (decision: Omit<AIDecision, 'id' | 'timestamp'>) => void;
  setThinking: (thinking: boolean) => void;
  clearThoughts: () => void;
  reset: () => void;
}

export const useAIStore = create<AIStore>((set) => ({
  // Initial state
  thoughts: [],
  decisions: [],
  isThinking: false,
  maxThoughts: 1000, // Keep last 1000 thoughts

  // Actions
  addThought: (thought) =>
    set((state) => {
      const newThought: AIThought = {
        ...thought,
        id: `thought-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
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
