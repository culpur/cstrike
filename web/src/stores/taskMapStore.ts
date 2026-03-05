/**
 * Task Map Store — real-time task pipeline graph for the footer visualization.
 *
 * Nodes represent scan lifecycle events (begin, decision, task, shell, complete).
 * Edges connect them in execution order, with branching for ETM parallel tracks.
 */

import { create } from 'zustand';

export type TaskNodeType = 'begin' | 'decision' | 'task' | 'shell' | 'complete';
export type TaskNodeStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface TaskNode {
  id: string;
  type: TaskNodeType;
  label: string;
  status: TaskNodeStatus;
  tool?: string;
  target?: string;
  hasFindings: boolean;
  rawOutput?: string;
  parentId?: string;
  startedAt?: number;
  completedAt?: number;
  findingsCount?: number;
  credentialsCount?: number;
}

export interface TaskEdge {
  from: string;
  to: string;
}

interface TaskMapStore {
  nodes: TaskNode[];
  edges: TaskEdge[];
  expanded: boolean;
  hoveredNodeId: string | null;
  activeScanId: string | null;

  addNode: (node: TaskNode) => void;
  updateNode: (id: string, patch: Partial<TaskNode>) => void;
  addEdge: (edge: TaskEdge) => void;
  setExpanded: (expanded: boolean) => void;
  setHoveredNode: (id: string | null) => void;
  setActiveScan: (scanId: string | null) => void;
  clearMap: () => void;

  // Convenience: get the last node of a given type or the last overall
  getLastNode: () => TaskNode | undefined;
  getLastNodeOfType: (type: TaskNodeType) => TaskNode | undefined;
}

export const useTaskMapStore = create<TaskMapStore>((set, get) => ({
  nodes: [],
  edges: [],
  expanded: false,
  hoveredNodeId: null,
  activeScanId: null,

  addNode: (node) =>
    set((state) => ({
      nodes: [...state.nodes, node],
    })),

  updateNode: (id, patch) =>
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    })),

  addEdge: (edge) =>
    set((state) => {
      // Prevent duplicate edges
      const exists = state.edges.some((e) => e.from === edge.from && e.to === edge.to);
      if (exists) return state;
      return { edges: [...state.edges, edge] };
    }),

  setExpanded: (expanded) => set({ expanded }),
  setHoveredNode: (hoveredNodeId) => set({ hoveredNodeId }),
  setActiveScan: (activeScanId) => set({ activeScanId }),

  clearMap: () => set({ nodes: [], edges: [], hoveredNodeId: null, activeScanId: null }),

  getLastNode: () => {
    const { nodes } = get();
    return nodes[nodes.length - 1];
  },

  getLastNodeOfType: (type) => {
    const { nodes } = get();
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i].type === type) return nodes[i];
    }
    return undefined;
  },
}));
