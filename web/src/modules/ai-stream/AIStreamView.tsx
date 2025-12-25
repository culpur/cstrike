/**
 * AI Stream View - Real-time AI decision and thought display
 */

import { useEffect, useRef, useState } from 'react';
import { Brain, Zap, Eye, Terminal, Play } from 'lucide-react';
import { Panel, Button } from '@components/ui';
import { useAIStore } from '@stores/aiStore';
import { useReconStore } from '@stores/reconStore';
import { useUIStore } from '@stores/uiStore';
import { wsService } from '@services/websocket';
import { apiService } from '@services/api';
import { formatTime, cn } from '@utils/index';
import type { AIThought, AIDecision } from '@/types';

export function AIStreamView() {
  const { thoughts, decisions, isThinking, addThought, addDecision, setThinking } =
    useAIStore();
  const { targets } = useReconStore();
  const { addToast } = useUIStore();

  const thoughtsEndRef = useRef<HTMLDivElement>(null);
  const [selectedTarget, setSelectedTarget] = useState<string>('');
  const [selectedPhase, setSelectedPhase] = useState<'recon' | 'exploitation'>('recon');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Auto-scroll to bottom
  useEffect(() => {
    thoughtsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thoughts]);

  // Load existing AI thoughts on mount
  useEffect(() => {
    const loadThoughts = async () => {
      try {
        const existingThoughts = await apiService.getAIThoughts();
        // Transform string array to AIThought objects
        existingThoughts.forEach((thought) => {
          addThought({
            thoughtType: 'observation',
            content: thought,
          });
        });
      } catch (error) {
        console.error('Failed to load AI thoughts:', error);
      }
    };
    loadThoughts();
  }, [addThought]);

  // Setup WebSocket listeners
  useEffect(() => {
    const unsubThought = wsService.on('ai_thought', (data: any) => {
      // Backend emits: {target, phase, response, timestamp}
      // Transform to AIThought format
      addThought({
        thoughtType: 'reasoning',
        content: data.response || data.message || JSON.stringify(data),
      });
      setThinking(false);
    });

    const unsubDecision = wsService.on('ai_thought', (data: any) => {
      if ('decision' in data) {
        addDecision(data as unknown as Omit<AIDecision, 'id' | 'timestamp'>);
      }
    });

    return () => {
      unsubThought();
      unsubDecision();
    };
  }, [addThought, addDecision, setThinking]);

  const handleAnalyze = async () => {
    if (!selectedTarget) {
      addToast({
        type: 'warning',
        message: 'Please select a target first',
      });
      return;
    }

    setIsAnalyzing(true);
    setThinking(true);
    try {
      await apiService.analyzeWithAI(selectedTarget, selectedPhase);
      addToast({
        type: 'success',
        message: `AI analysis started for ${selectedTarget}`,
      });
    } catch (error) {
      setThinking(false);
      addToast({
        type: 'error',
        message: 'Failed to start AI analysis',
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-grok-text-heading">AI Thought Stream</h1>
        {isThinking && (
          <div className="flex items-center gap-2 text-grok-ai-purple">
            <Brain className="w-5 h-5 animate-pulse" />
            <span className="text-sm font-medium">AI Thinking...</span>
          </div>
        )}
      </div>

      {/* AI Analysis Controls */}
      <Panel title="AI Analysis">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-grok-text-muted mb-1">Target</label>
              <select
                value={selectedTarget}
                onChange={(e) => setSelectedTarget(e.target.value)}
                className="w-full px-3 py-2 bg-grok-surface-2 border border-grok-border rounded text-sm text-grok-text-heading"
              >
                <option value="">Select target...</option>
                {targets.map((target) => (
                  <option key={target.id} value={target.url}>
                    {target.url}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-grok-text-muted mb-1">Phase</label>
              <select
                value={selectedPhase}
                onChange={(e) => setSelectedPhase(e.target.value as 'recon' | 'exploitation')}
                className="w-full px-3 py-2 bg-grok-surface-2 border border-grok-border rounded text-sm text-grok-text-heading"
              >
                <option value="recon">Reconnaissance</option>
                <option value="exploitation">Exploitation</option>
              </select>
            </div>
          </div>
          <Button
            onClick={handleAnalyze}
            isLoading={isAnalyzing}
            disabled={!selectedTarget || isThinking}
            className="w-full"
          >
            <Play className="w-4 h-4 mr-2" />
            Analyze with AI
          </Button>
        </div>
      </Panel>

      {/* Recent Decisions */}
      <Panel title="Recent Decisions">
        {decisions.length === 0 ? (
          <p className="text-sm text-grok-text-muted text-center py-8">
            No AI decisions yet
          </p>
        ) : (
          <div className="space-y-3">
            {decisions.slice(-5).reverse().map((decision) => (
              <DecisionCard key={decision.id} decision={decision} />
            ))}
          </div>
        )}
      </Panel>

      {/* Thought Stream */}
      <Panel title="Live Thought Stream" noPadding>
        <div className="h-[600px] overflow-y-auto p-4 bg-grok-void font-mono text-sm">
          {thoughts.length === 0 ? (
            <p className="text-grok-text-muted text-center py-8">
              Waiting for AI activity...
            </p>
          ) : (
            <div className="space-y-3">
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

function DecisionCard({ decision }: { decision: AIDecision }) {
  const confidenceColor =
    decision.confidence >= 0.8
      ? 'text-grok-success'
      : decision.confidence >= 0.5
      ? 'text-grok-warning'
      : 'text-grok-error';

  return (
    <div className="bg-grok-surface-2 border border-grok-border rounded-lg p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-grok-ai-purple" />
          <span className="text-xs text-grok-text-muted">
            {formatTime(decision.timestamp)}
          </span>
          <span className="text-xs px-2 py-0.5 bg-grok-ai-purple/20 text-grok-ai-purple rounded">
            {decision.phase}
          </span>
        </div>
        <span className={cn('text-xs font-medium', confidenceColor)}>
          {Math.round(decision.confidence * 100)}% confident
        </span>
      </div>
      <p className="text-sm text-grok-text-heading font-medium mb-2">
        {decision.decision}
      </p>
      <p className="text-sm text-grok-text-muted">{decision.reasoning}</p>
      {decision.executedCommand && (
        <div className="mt-3 p-2 bg-grok-void rounded font-mono text-xs text-grok-recon-blue">
          $ {decision.executedCommand}
        </div>
      )}
    </div>
  );
}

function ThoughtCard({ thought }: { thought: AIThought }) {
  const getIcon = () => {
    switch (thought.thoughtType) {
      case 'reasoning':
        return <Brain className="w-4 h-4" />;
      case 'command':
        return <Terminal className="w-4 h-4" />;
      case 'decision':
        return <Zap className="w-4 h-4" />;
      case 'observation':
        return <Eye className="w-4 h-4" />;
    }
  };

  const getColor = () => {
    switch (thought.thoughtType) {
      case 'reasoning':
        return 'text-grok-ai-purple border-grok-ai-purple/30';
      case 'command':
        return 'text-grok-recon-blue border-grok-recon-blue/30';
      case 'decision':
        return 'text-grok-warning border-grok-warning/30';
      case 'observation':
        return 'text-grok-text-body border-grok-border';
    }
  };

  return (
    <div className={cn('flex gap-3 p-3 border-l-2 rounded', getColor())}>
      <div className="flex-shrink-0 mt-0.5">{getIcon()}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-grok-text-muted">
            {formatTime(thought.timestamp)}
          </span>
          <span className="text-xs px-1.5 py-0.5 bg-grok-surface-2 rounded">
            {thought.thoughtType}
          </span>
        </div>
        <p className="text-sm text-grok-text-body">{thought.content}</p>
        {thought.command && (
          <div className="mt-2 p-2 bg-grok-surface-2 rounded text-xs text-grok-recon-blue">
            $ {thought.command}
          </div>
        )}
      </div>
    </div>
  );
}
