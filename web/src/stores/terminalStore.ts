/**
 * Terminal Store — manages persistent shell session tabs for the Terminal view.
 *
 * Sessions are created either:
 *  a) Manually by the user (SSH session wizard)
 *  b) Automatically when a `shell_obtained` WebSocket event fires
 *
 * The "Local" tab is always present and is not backed by a SessionInfo record —
 * it uses the one-shot `/api/v1/terminal/execute` endpoint directly.
 */

import { create } from 'zustand';
import { apiService } from '@services/api';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ShellSessionType = 'local' | 'ssh' | 'reverse_shell' | 'bind_shell';

export interface ShellSession {
  id: string;
  type: ShellSessionType;
  /** Human-friendly label shown in the tab (e.g. "10.10.10.100") */
  target: string;
  host: string;
  port: number;
  user?: string;
  createdAt: number;
  lastActivity: number;
  active: boolean;
  /** Accumulated output lines for this session */
  output: string[];
}

interface TerminalStoreState {
  sessions: ShellSession[];
  activeSessionId: string | null;
}

interface TerminalStoreActions {
  addSession: (session: Omit<ShellSession, 'output'>) => void;
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;
  appendOutput: (sessionId: string, line: string) => void;
  markSessionInactive: (id: string) => void;
  loadSessions: () => Promise<void>;
}

export type TerminalStore = TerminalStoreState & TerminalStoreActions;

// ── Store ─────────────────────────────────────────────────────────────────────

const MAX_OUTPUT_LINES = 2000;

export const useTerminalStore = create<TerminalStore>((set) => ({
  // ── State ─────────────────────────────────────────────────────────────────

  sessions: [],
  activeSessionId: null,

  // ── Actions ───────────────────────────────────────────────────────────────

  addSession: (session) =>
    set((state) => {
      // Deduplicate by id
      if (state.sessions.some((s) => s.id === session.id)) {
        return state;
      }
      return {
        sessions: [...state.sessions, { ...session, output: [] }],
        // Auto-switch to the new session
        activeSessionId: session.id,
      };
    }),

  removeSession: (id) =>
    set((state) => {
      const remaining = state.sessions.filter((s) => s.id !== id);
      // If we just removed the active session, fall back to the previous one or null
      const newActive =
        state.activeSessionId === id
          ? remaining.length > 0
            ? remaining[remaining.length - 1].id
            : null
          : state.activeSessionId;
      return { sessions: remaining, activeSessionId: newActive };
    }),

  setActiveSession: (id) => set({ activeSessionId: id }),

  appendOutput: (sessionId, line) =>
    set((state) => ({
      sessions: state.sessions.map((s) => {
        if (s.id !== sessionId) return s;
        const output = [...s.output, line];
        if (output.length > MAX_OUTPUT_LINES) {
          output.splice(0, output.length - MAX_OUTPUT_LINES);
        }
        return { ...s, output, lastActivity: Date.now() };
      }),
    })),

  markSessionInactive: (id) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, active: false } : s
      ),
    })),

  loadSessions: async () => {
    try {
      const data = await apiService.getTerminalSessions();
      const sessions: ShellSession[] = data.map((s: any) => ({
        id: s.id,
        type: s.type as ShellSessionType,
        target: s.target,
        host: s.host,
        port: s.port,
        user: s.user,
        createdAt: s.createdAt,
        lastActivity: s.lastActivity,
        active: s.active,
        output: [],
      }));

      // Merge — don't clobber sessions already tracked in store
      set((state) => {
        const existingIds = new Set(state.sessions.map((s) => s.id));
        const newSessions = sessions.filter((s) => !existingIds.has(s.id));
        return { sessions: [...state.sessions, ...newSessions] };
      });
    } catch {
      // Sessions are not critical — ignore errors on initial load
    }
  },
}));
