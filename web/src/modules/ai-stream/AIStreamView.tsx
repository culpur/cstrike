/**
 * AI Stream View — Real-time AI decision and thought display
 *
 * Shows every AI interaction: the prompt fed to the provider, the response
 * received, the reasoning behind decisions, and commands extracted.
 *
 * WebSocket events are handled by useWebSocketHandlers (mounted in App.tsx).
 * This view reads from the aiStore and loads historical thoughts from the API.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Brain,
  Zap,
  Eye,
  Terminal,
  Send,
  MessageSquare,
  Target,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Panel } from '@components/ui';
import { useAIStore } from '@stores/aiStore';
import { apiService } from '@services/api';
import { formatTime, cn } from '@utils/index';
import type { AIThought } from '@/types';

// ── Type labels and styling ────────────────────────────────────────────────

const THOUGHT_META: Record<
  AIThought['thoughtType'],
  {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    color: string;
    borderColor: string;
    bgColor: string;
  }
> = {
  ai_prompt: {
    icon: Send,
    label: 'PROMPT SENT',
    color: 'text-[var(--grok-recon-blue)]',
    borderColor: 'border-[var(--grok-recon-blue)]',
    bgColor: 'bg-[var(--grok-recon-blue)]/5',
  },
  ai_response: {
    icon: MessageSquare,
    label: 'AI RESPONSE',
    color: 'text-[var(--grok-success)]',
    borderColor: 'border-[var(--grok-success)]',
    bgColor: 'bg-[var(--grok-success)]/5',
  },
  ai_decision: {
    icon: Target,
    label: 'AI DECISION',
    color: 'text-[var(--grok-ai-purple)]',
    borderColor: 'border-[var(--grok-ai-purple)]',
    bgColor: 'bg-[var(--grok-ai-purple)]/5',
  },
  ai_execution: {
    icon: Terminal,
    label: 'EXECUTION',
    color: 'text-[var(--grok-warning)]',
    borderColor: 'border-[var(--grok-warning)]',
    bgColor: 'bg-[var(--grok-warning)]/5',
  },
  reasoning: {
    icon: Brain,
    label: 'REASONING',
    color: 'text-[var(--grok-ai-purple)]',
    borderColor: 'border-[var(--grok-ai-purple)]/30',
    bgColor: 'bg-[var(--grok-ai-purple)]/5',
  },
  command: {
    icon: Terminal,
    label: 'COMMAND',
    color: 'text-[var(--grok-recon-blue)]',
    borderColor: 'border-[var(--grok-recon-blue)]/30',
    bgColor: 'bg-[var(--grok-recon-blue)]/5',
  },
  decision: {
    icon: Zap,
    label: 'DECISION',
    color: 'text-[var(--grok-warning)]',
    borderColor: 'border-[var(--grok-warning)]/30',
    bgColor: 'bg-[var(--grok-warning)]/5',
  },
  observation: {
    icon: Eye,
    label: 'OBSERVATION',
    color: 'text-[var(--grok-text-body)]',
    borderColor: 'border-[var(--grok-border)]',
    bgColor: 'bg-[var(--grok-surface-2)]/50',
  },
};

// ============================================================================
// AIStreamView — the main exported component
// ============================================================================

export function AIStreamView() {
  const { thoughts, decisions, isThinking, addThought, addDecision } = useAIStore();
  const thoughtsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new thoughts
  useEffect(() => {
    thoughtsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thoughts]);

  // Load historical AI thoughts from API on mount
  useEffect(() => {
    const loadThoughts = async () => {
      try {
        const existingThoughts = await apiService.getAIThoughts();
        existingThoughts.forEach((thought) => {
          const typeMap: Record<string, AIThought['thoughtType']> = {
            ai_prompt: 'ai_prompt',
            ai_response: 'ai_response',
            ai_decision: 'ai_decision',
            ai_execution: 'ai_execution',
            reasoning: 'reasoning',
            command: 'command',
            decision: 'decision',
            observation: 'observation',
          };

          const mappedType = typeMap[thought.thoughtType] || 'observation';
          const content =
            typeof thought.content === 'string'
              ? thought.content
              : JSON.stringify(thought.content);

          addThought({
            thoughtType: mappedType,
            content,
            command: thought.command || undefined,
            metadata: thought.metadata || undefined,
          });

          // Populate Recent Decisions from ai_decision thoughts
          if (mappedType === 'ai_decision') {
            const meta = thought.metadata as Record<string, unknown> | null;
            addDecision({
              phase: 'recon' as any,
              decision: content,
              reasoning: meta?.rationale ? String(meta.rationale) : '',
              confidence: 0.85,
              executedCommand: thought.command || undefined,
            });
          }
        });
      } catch (error) {
        console.error('Failed to load AI thoughts:', error);
      }
    };
    loadThoughts();
  }, [addThought, addDecision]);

  // No duplicate WebSocket listener here — useWebSocketHandlers handles it

  return (
    <div className="h-full overflow-auto p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[var(--grok-text-heading)] flex items-center gap-2">
            <Brain className="w-5 h-5 text-[var(--grok-ai-purple)]" />
            AI Thought Stream
          </h1>
          <p className="text-[10px] text-[var(--grok-text-muted)] mt-0.5 font-mono">
            Full AI interaction log — prompts, responses, decisions, and reasoning
          </p>
        </div>
        {isThinking && (
          <div className="flex items-center gap-2 text-[var(--grok-ai-purple)]">
            <Brain className="w-4 h-4 animate-pulse" />
            <span className="text-xs font-medium">AI Thinking...</span>
          </div>
        )}
      </div>

      {/* Recent Decisions */}
      {decisions.length > 0 && (
        <Panel title="Recent Decisions">
          <div className="space-y-2">
            {decisions.slice(-5).reverse().map((decision) => (
              <div
                key={decision.id}
                className="flex gap-3 p-3 rounded-lg border-l-3"
                style={{
                  borderLeftWidth: '3px',
                  borderLeftColor: 'var(--grok-ai-purple)',
                  background: 'var(--grok-surface-2)',
                }}
              >
                <Zap className="w-4 h-4 text-[var(--grok-ai-purple)] flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-mono text-[var(--grok-text-muted)]">
                      {formatTime(decision.timestamp)}
                    </span>
                    {decision.executedCommand && (
                      <span className="text-[10px] font-mono px-1.5 py-px rounded bg-[var(--grok-recon-blue)]/15 text-[var(--grok-recon-blue)]">
                        {decision.executedCommand}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-semibold text-[var(--grok-text-heading)]">
                    {decision.decision}
                  </p>
                  {decision.reasoning && (
                    <p className="text-xs text-[var(--grok-text-muted)] mt-0.5">
                      {decision.reasoning}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Thought Stream */}
      <Panel title="Live Thought Stream" noPadding>
        <div
          className="overflow-y-auto p-4 font-mono text-sm"
          style={{ height: 'calc(100vh - 200px)', background: 'var(--grok-void)' }}
        >
          {thoughts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Brain className="w-10 h-10 text-[var(--grok-text-muted)] mb-3 opacity-30" />
              <p className="text-sm text-[var(--grok-text-muted)]">
                Waiting for AI activity...
              </p>
              <p className="text-[10px] text-[var(--grok-text-muted)] mt-1 opacity-60">
                Set mode to SEMI or AUTO and start a scan to see AI reasoning
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {thoughts.map((thought) => (
                <ThoughtCard key={thought.id} thought={thought} />
              ))}
              <div ref={thoughtsEndRef} />
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

// ============================================================================
// ThoughtCard — renders a single AI thought with expandable details
// ============================================================================

function ThoughtCard({ thought }: { thought: AIThought }) {
  const meta = THOUGHT_META[thought.thoughtType] || THOUGHT_META.observation;
  const Icon = meta.icon;

  // AI prompts and responses default to expanded so the user can see them
  const isAIInteraction = ['ai_prompt', 'ai_response'].includes(thought.thoughtType);
  const [expanded, setExpanded] = useState(isAIInteraction);

  const hasExpandableContent =
    (thought.metadata && Object.keys(thought.metadata).length > 0) ||
    thought.content.length > 200;

  return (
    <div
      className={cn(
        'rounded-lg border-l-3 overflow-hidden transition-colors',
        meta.borderColor,
        meta.bgColor,
      )}
      style={{ borderLeftWidth: '3px' }}
    >
      {/* Header row — always visible */}
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 cursor-pointer select-none',
          'hover:bg-[var(--grok-surface-2)]/30 transition-colors',
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <Icon className={cn('w-3.5 h-3.5 flex-shrink-0', meta.color)} />

        <span
          className={cn(
            'text-[10px] font-mono font-bold uppercase tracking-wider flex-shrink-0',
            meta.color,
          )}
        >
          {meta.label}
        </span>

        {/* Provider/model badge for AI interactions */}
        {thought.metadata?.provider && (
          <span className="text-[10px] font-mono px-1.5 py-px rounded bg-[var(--grok-surface-3)] text-[var(--grok-text-muted)]">
            {String(thought.metadata.provider)}/{String(thought.metadata.model || '?')}
          </span>
        )}

        {/* Rationale preview for decisions */}
        {thought.thoughtType === 'ai_decision' && thought.metadata?.rationale && (
          <span className="text-[10px] text-[var(--grok-text-muted)] truncate">
            — {String(thought.metadata.rationale)}
          </span>
        )}

        {/* Tool name for commands/decisions */}
        {thought.command && (
          <span className="text-[10px] font-mono px-1.5 py-px rounded bg-[var(--grok-recon-blue)]/15 text-[var(--grok-recon-blue)]">
            {thought.command}
          </span>
        )}

        <span className="text-[10px] text-[var(--grok-text-muted)] ml-auto flex-shrink-0">
          {formatTime(thought.timestamp)}
        </span>

        {hasExpandableContent && (
          expanded
            ? <ChevronDown className="w-3 h-3 text-[var(--grok-text-muted)] flex-shrink-0" />
            : <ChevronRight className="w-3 h-3 text-[var(--grok-text-muted)] flex-shrink-0" />
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* ── AI Prompt ────────────────────────────────────────── */}
          {thought.thoughtType === 'ai_prompt' && (
            <>
              {/* System prompt */}
              {thought.metadata?.system_prompt && (
                <div>
                  <div className="text-[10px] font-mono font-bold text-[var(--grok-text-muted)] uppercase tracking-wider mb-1">
                    System Prompt
                  </div>
                  <div className="p-2.5 rounded text-xs text-[var(--grok-text-body)] font-mono whitespace-pre-wrap max-h-32 overflow-y-auto" style={{ background: 'var(--grok-surface-1)' }}>
                    {String(thought.metadata.system_prompt)}
                  </div>
                </div>
              )}

              {/* User prompt (the content field) */}
              <div>
                <div className="text-[10px] font-mono font-bold text-[var(--grok-recon-blue)] uppercase tracking-wider mb-1">
                  Prompt to AI Provider
                </div>
                <div className="p-2.5 rounded text-xs text-[var(--grok-text-heading)] font-mono whitespace-pre-wrap max-h-80 overflow-y-auto" style={{ background: 'var(--grok-surface-1)', borderLeft: '2px solid var(--grok-recon-blue)' }}>
                  {thought.content}
                </div>
              </div>

              {/* Config */}
              <div className="flex items-center gap-3 text-[10px] font-mono text-[var(--grok-text-muted)]">
                {thought.metadata?.model && <span>Model: {String(thought.metadata.model)}</span>}
                {thought.metadata?.temperature != null && <span>Temp: {String(thought.metadata.temperature)}</span>}
                {thought.metadata?.max_tokens != null && <span>Max tokens: {String(thought.metadata.max_tokens)}</span>}
              </div>
            </>
          )}

          {/* ── AI Response ──────────────────────────────────────── */}
          {thought.thoughtType === 'ai_response' && (
            <>
              <div>
                <div className="text-[10px] font-mono font-bold text-[var(--grok-success)] uppercase tracking-wider mb-1">
                  AI Response
                </div>
                <div className="p-2.5 rounded text-xs text-[var(--grok-text-heading)] font-mono whitespace-pre-wrap max-h-96 overflow-y-auto" style={{ background: 'var(--grok-surface-1)', borderLeft: '2px solid var(--grok-success)' }}>
                  {thought.content}
                </div>
              </div>

              {/* Extracted commands */}
              {thought.metadata?.commands && Array.isArray(thought.metadata.commands) && (thought.metadata.commands as string[]).length > 0 && (
                <div>
                  <div className="text-[10px] font-mono font-bold text-[var(--grok-warning)] uppercase tracking-wider mb-1">
                    Extracted Commands ({(thought.metadata.commands as string[]).length})
                  </div>
                  <div className="space-y-1">
                    {(thought.metadata.commands as string[]).map((cmd, idx) => (
                      <div key={idx} className="p-2 rounded text-xs text-[var(--grok-recon-blue)] font-mono" style={{ background: 'var(--grok-surface-1)' }}>
                        $ {cmd}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Model info */}
              <div className="flex items-center gap-3 text-[10px] font-mono text-[var(--grok-text-muted)]">
                {thought.metadata?.provider && <span>{String(thought.metadata.provider)}/{String(thought.metadata.model || '?')}</span>}
                {thought.metadata?.commandCount != null && <span>{String(thought.metadata.commandCount)} commands extracted</span>}
              </div>
            </>
          )}

          {/* ── AI Decision ──────────────────────────────────────── */}
          {thought.thoughtType === 'ai_decision' && (
            <>
              <div>
                <div className="text-[10px] font-mono font-bold text-[var(--grok-ai-purple)] uppercase tracking-wider mb-1">
                  Decision
                </div>
                <div className="p-2.5 rounded text-xs text-[var(--grok-text-heading)] font-mono" style={{ background: 'var(--grok-surface-1)', borderLeft: '2px solid var(--grok-ai-purple)' }}>
                  {thought.content}
                </div>
              </div>

              {thought.metadata?.rationale && (
                <div>
                  <div className="text-[10px] font-mono font-bold text-[var(--grok-text-muted)] uppercase tracking-wider mb-1">
                    Rationale
                  </div>
                  <div className="p-2 rounded text-xs text-[var(--grok-text-body)] font-mono whitespace-pre-wrap" style={{ background: 'var(--grok-surface-1)' }}>
                    {String(thought.metadata.rationale)}
                  </div>
                </div>
              )}

              {thought.command && (
                <div className="p-2 rounded text-xs text-[var(--grok-recon-blue)] font-mono" style={{ background: 'var(--grok-surface-1)' }}>
                  Selected tool: {thought.command}
                </div>
              )}
            </>
          )}

          {/* ── AI Execution ─────────────────────────────────────── */}
          {thought.thoughtType === 'ai_execution' && (
            <>
              {thought.command && (
                <div className="p-2 rounded text-xs text-[var(--grok-warning)] font-mono" style={{ background: 'var(--grok-surface-1)' }}>
                  $ {thought.command}
                </div>
              )}
              <div className="text-xs text-[var(--grok-text-body)]">
                {thought.content}
              </div>
            </>
          )}

          {/* ── Observation ──────────────────────────────────────── */}
          {thought.thoughtType === 'observation' && (
            <div className="p-2.5 rounded text-xs text-[var(--grok-text-body)] font-mono whitespace-pre-wrap" style={{ background: 'var(--grok-surface-1)' }}>
              {thought.content}
            </div>
          )}

          {/* ── Command ──────────────────────────────────────────── */}
          {thought.thoughtType === 'command' && (
            <>
              {thought.command && (
                <div className="p-2 rounded text-xs text-[var(--grok-recon-blue)] font-mono" style={{ background: 'var(--grok-surface-1)' }}>
                  $ {thought.command}
                </div>
              )}
              {thought.metadata?.status && (
                <div className="text-[10px] font-mono text-[var(--grok-text-muted)]">
                  Status: {String(thought.metadata.status)}
                </div>
              )}
            </>
          )}

          {/* ── Reasoning ────────────────────────────────────────── */}
          {thought.thoughtType === 'reasoning' && (
            <div className="p-2.5 rounded text-xs text-[var(--grok-text-body)] font-mono whitespace-pre-wrap" style={{ background: 'var(--grok-surface-1)' }}>
              {thought.content}
            </div>
          )}

          {/* ── Decision (legacy) ────────────────────────────────── */}
          {thought.thoughtType === 'decision' && (
            <>
              <div className="p-2.5 rounded text-xs text-[var(--grok-text-heading)] font-mono" style={{ background: 'var(--grok-surface-1)' }}>
                {thought.content}
              </div>
              {thought.metadata && (
                <pre className="p-2 rounded text-[10px] text-[var(--grok-text-muted)] overflow-x-auto" style={{ background: 'var(--grok-surface-1)' }}>
                  {JSON.stringify(thought.metadata, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
