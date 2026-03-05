/**
 * TaskMapFooter — Collapsible overlay showing real-time task pipeline graph.
 *
 * Collapsed: thin bar (h-8) with expand button + task count summary.
 * Expanded:  overlay panel (h-48→h-80) with horizontal scrollable SVG.
 *
 * Nodes: 32×32 rounded rects with status-based styling.
 * Edges: SVG lines connecting nodes in execution order with branching.
 * Hover: absolute-positioned popup with raw output preview.
 */

import { useMemo, useRef, useEffect } from 'react';
import {
  ChevronUp,
  ChevronDown,
  Settings,
  Terminal,
  GitBranch,
  CheckCircle,
  XCircle,
  CircleDot,
  Play,
  Target,
  X,
} from 'lucide-react';
import { useTaskMapStore, type TaskNode, type TaskNodeStatus } from '@stores/taskMapStore';
import { cn } from '@utils/index';

// ── Node dimensions & layout constants ─────────────────────────────────────
const NODE_W = 32;
const NODE_H = 32;
const NODE_GAP_X = 60;
const NODE_GAP_Y = 50;
const PADDING_X = 24;
const PADDING_Y = 20;

// ── Status color mapping ───────────────────────────────────────────────────
function nodeColor(node: TaskNode): string {
  if (node.type === 'shell') return 'var(--grok-exploit-red)';
  if (node.status === 'running') return 'var(--grok-recon-blue)';
  if (node.status === 'completed') {
    return node.hasFindings ? 'var(--grok-success)' : 'var(--grok-surface-3)';
  }
  if (node.status === 'failed') return 'var(--grok-error)';
  return 'var(--grok-surface-3)';
}

function nodeBorderColor(node: TaskNode): string {
  if (node.status === 'running') return 'var(--grok-recon-blue)';
  if (node.type === 'shell') return 'var(--grok-exploit-red)';
  return 'var(--grok-border)';
}

// ── Node icon selection ────────────────────────────────────────────────────
function NodeIcon({ node }: { node: TaskNode }) {
  const cls = 'w-3.5 h-3.5';
  switch (node.type) {
    case 'begin':
      return <Play className={cls} />;
    case 'decision':
      return <GitBranch className={cls} />;
    case 'task':
      if (node.status === 'running')
        return <Settings className={cn(cls, 'animate-spin')} />;
      if (node.status === 'completed')
        return node.hasFindings ? <CheckCircle className={cls} /> : <CircleDot className={cls} />;
      if (node.status === 'failed')
        return <XCircle className={cls} />;
      return <Target className={cls} />;
    case 'shell':
      return <Terminal className={cls} />;
    case 'complete':
      return <CheckCircle className={cls} />;
    default:
      return <CircleDot className={cls} />;
  }
}

// ── Layout engine: assign (x,y) positions to nodes ────────────────────────
interface LayoutNode extends TaskNode {
  x: number;
  y: number;
}

function layoutNodes(
  nodes: TaskNode[],
  edges: { from: string; to: string }[],
): LayoutNode[] {
  if (nodes.length === 0) return [];

  // Build adjacency: parentId → children
  const childrenOf = new Map<string, string[]>();
  for (const edge of edges) {
    const list = childrenOf.get(edge.from) ?? [];
    list.push(edge.to);
    childrenOf.set(edge.from, list);
  }

  // BFS from roots (nodes with no incoming edge)
  const incomingCount = new Map<string, number>();
  for (const n of nodes) incomingCount.set(n.id, 0);
  for (const e of edges) {
    incomingCount.set(e.to, (incomingCount.get(e.to) ?? 0) + 1);
  }

  const roots = nodes.filter((n) => (incomingCount.get(n.id) ?? 0) === 0);
  const positions = new Map<string, { col: number; row: number }>();
  const visited = new Set<string>();
  const queue: Array<{ id: string; col: number; row: number }> = [];

  // Track occupied rows per column to handle branching
  const colRows = new Map<number, number>();

  for (const root of roots) {
    const startRow = colRows.get(0) ?? 0;
    queue.push({ id: root.id, col: 0, row: startRow });
  }

  while (queue.length > 0) {
    const { id, col, row } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    // Find a free row in this column
    const usedRow = colRows.get(col) ?? 0;
    const assignedRow = Math.max(row, usedRow > row ? usedRow : row);
    positions.set(id, { col, row: assignedRow });
    colRows.set(col, assignedRow + 1);

    const children = childrenOf.get(id) ?? [];
    for (let i = 0; i < children.length; i++) {
      if (!visited.has(children[i])) {
        const childRow = assignedRow + i;
        queue.push({ id: children[i], col: col + 1, row: childRow });
      }
    }
  }

  // Fallback: place any unvisited nodes at the end
  let fallbackCol = 0;
  for (const [, pos] of positions) {
    fallbackCol = Math.max(fallbackCol, pos.col);
  }
  for (const n of nodes) {
    if (!visited.has(n.id)) {
      fallbackCol++;
      positions.set(n.id, { col: fallbackCol, row: 0 });
    }
  }

  return nodes.map((n) => {
    const pos = positions.get(n.id) ?? { col: 0, row: 0 };
    return {
      ...n,
      x: PADDING_X + pos.col * (NODE_W + NODE_GAP_X),
      y: PADDING_Y + pos.row * (NODE_H + NODE_GAP_Y),
    };
  });
}

// ── Hover popup ────────────────────────────────────────────────────────────
function HoverPopup({ node, x, y }: { node: TaskNode; x: number; y: number }) {
  return (
    <div
      className="absolute z-50 bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded-md shadow-lg p-3 max-w-sm pointer-events-none"
      style={{ left: x + NODE_W + 8, top: Math.max(4, y - 40) }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="text-xs font-bold uppercase tracking-wider"
          style={{ color: nodeColor(node) }}
        >
          {node.type}
        </span>
        <span className="text-xs text-[var(--grok-text-muted)]">{node.status}</span>
      </div>
      <p className="text-xs font-semibold text-[var(--grok-text-heading)] mb-1">
        {node.label}
      </p>
      {node.tool && (
        <p className="text-[10px] text-[var(--grok-text-muted)] font-mono">
          Tool: {node.tool}
        </p>
      )}
      {node.findingsCount != null && node.findingsCount > 0 && (
        <p className="text-[10px] text-[var(--grok-success)] font-mono">
          {node.findingsCount} findings
          {node.credentialsCount ? `, ${node.credentialsCount} creds` : ''}
        </p>
      )}
      {node.rawOutput && (
        <pre className="mt-1.5 text-[10px] font-mono text-[var(--grok-text-body)] bg-[var(--grok-surface-1)] rounded p-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap break-all">
          {node.rawOutput.slice(0, 800)}
          {node.rawOutput.length > 800 ? '\n...' : ''}
        </pre>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export function TaskMapFooter() {
  const { nodes, edges, expanded, hoveredNodeId, setExpanded, setHoveredNode, clearMap } =
    useTaskMapStore();

  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll right when new nodes are added
  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [nodes.length, expanded]);

  // Compute layout
  const layoutResult = useMemo(() => layoutNodes(nodes, edges), [nodes, edges]);

  // Don't render if no active tasks
  if (nodes.length === 0) return null;

  // Summary counts
  const running = nodes.filter((n) => n.status === 'running').length;
  const completed = nodes.filter((n) => n.status === 'completed').length;
  const failed = nodes.filter((n) => n.status === 'failed').length;
  const pending = nodes.filter((n) => n.status === 'pending').length;
  const shells = nodes.filter((n) => n.type === 'shell').length;
  const withFindings = nodes.filter((n) => n.hasFindings).length;

  // SVG dimensions
  const maxX = layoutResult.reduce((m, n) => Math.max(m, n.x), 0) + NODE_W + PADDING_X * 2;
  const maxY = layoutResult.reduce((m, n) => Math.max(m, n.y), 0) + NODE_H + PADDING_Y * 2;

  const hoveredNode = hoveredNodeId
    ? layoutResult.find((n) => n.id === hoveredNodeId)
    : null;

  return (
    <div
      className={cn(
        'flex-shrink-0 border-t border-[var(--grok-border)] transition-all duration-300 relative',
        'bg-[var(--grok-surface-1)]',
      )}
    >
      {/* Collapsed bar */}
      <div
        className="h-8 flex items-center px-3 gap-3 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <button className="p-0.5 hover:bg-[var(--grok-surface-2)] rounded transition-colors">
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-[var(--grok-text-muted)]" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5 text-[var(--grok-text-muted)]" />
          )}
        </button>

        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--grok-text-muted)]">
          Task Map
        </span>

        <div className="flex items-center gap-2 text-[10px] font-mono">
          {running > 0 && (
            <span className="text-[var(--grok-recon-blue)]">
              <Settings className="w-3 h-3 inline animate-spin mr-0.5" />
              {running}
            </span>
          )}
          {completed > 0 && (
            <span className="text-[var(--grok-success)]">
              <CheckCircle className="w-3 h-3 inline mr-0.5" />
              {completed}
            </span>
          )}
          {failed > 0 && (
            <span className="text-[var(--grok-error)]">
              <XCircle className="w-3 h-3 inline mr-0.5" />
              {failed}
            </span>
          )}
          {pending > 0 && (
            <span className="text-[var(--grok-text-muted)]">{pending} pending</span>
          )}
          {shells > 0 && (
            <span className="text-[var(--grok-exploit-red)]">
              <Terminal className="w-3 h-3 inline mr-0.5" />
              {shells}
            </span>
          )}
          {withFindings > 0 && (
            <span className="text-[var(--grok-warning)]">{withFindings} w/ findings</span>
          )}
        </div>

        <div className="flex-1" />

        <button
          onClick={(e) => {
            e.stopPropagation();
            clearMap();
          }}
          className="p-0.5 hover:bg-[var(--grok-surface-2)] rounded transition-colors"
          title="Clear task map"
        >
          <X className="w-3 h-3 text-[var(--grok-text-muted)]" />
        </button>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div
          ref={scrollRef}
          className="overflow-auto relative"
          style={{ height: Math.min(Math.max(maxY + 16, 160), 320) }}
        >
          <svg
            width={Math.max(maxX, 400)}
            height={Math.max(maxY, 120)}
            className="block"
          >
            {/* Edges */}
            {edges.map((edge, i) => {
              const fromNode = layoutResult.find((n) => n.id === edge.from);
              const toNode = layoutResult.find((n) => n.id === edge.to);
              if (!fromNode || !toNode) return null;

              const x1 = fromNode.x + NODE_W;
              const y1 = fromNode.y + NODE_H / 2;
              const x2 = toNode.x;
              const y2 = toNode.y + NODE_H / 2;

              // Bezier control points for smooth curves
              const cx1 = x1 + (x2 - x1) * 0.4;
              const cx2 = x2 - (x2 - x1) * 0.4;

              return (
                <path
                  key={`edge-${i}`}
                  d={`M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`}
                  stroke="var(--grok-border)"
                  strokeWidth={1.5}
                  fill="none"
                  opacity={0.6}
                />
              );
            })}

            {/* Nodes */}
            {layoutResult.map((node) => {
              const isHovered = hoveredNodeId === node.id;
              const color = nodeColor(node);
              const borderColor = nodeBorderColor(node);
              const isRunning = node.status === 'running';
              const isShell = node.type === 'shell';

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  className="cursor-pointer"
                >
                  {/* Glow effect for running/shell nodes */}
                  {(isRunning || isShell) && (
                    <rect
                      x={-3}
                      y={-3}
                      width={NODE_W + 6}
                      height={NODE_H + 6}
                      rx={8}
                      fill="none"
                      stroke={color}
                      strokeWidth={1}
                      opacity={0.4}
                    >
                      <animate
                        attributeName="opacity"
                        values="0.2;0.6;0.2"
                        dur="2s"
                        repeatCount="indefinite"
                      />
                    </rect>
                  )}

                  {/* Node rect */}
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={6}
                    fill={isHovered ? color : 'var(--grok-surface-2)'}
                    stroke={borderColor}
                    strokeWidth={isHovered ? 2 : 1.5}
                    opacity={isHovered ? 1 : 0.9}
                  />

                  {/* Icon */}
                  <foreignObject x={NODE_W / 2 - 7} y={NODE_H / 2 - 7} width={14} height={14}>
                    <div
                      className="flex items-center justify-center w-full h-full"
                      style={{ color: isHovered ? 'white' : color }}
                    >
                      <NodeIcon node={node} />
                    </div>
                  </foreignObject>

                  {/* Label below */}
                  <text
                    x={NODE_W / 2}
                    y={NODE_H + 12}
                    textAnchor="middle"
                    fontSize={9}
                    fontFamily="monospace"
                    fontWeight={600}
                    fill="var(--grok-text-muted)"
                  >
                    {node.label.length > 10
                      ? node.label.slice(0, 9) + '…'
                      : node.label}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Hover popup */}
          {hoveredNode && (
            <HoverPopup node={hoveredNode} x={hoveredNode.x} y={hoveredNode.y} />
          )}
        </div>
      )}
    </div>
  );
}
