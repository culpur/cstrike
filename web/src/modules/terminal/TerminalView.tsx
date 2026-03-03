/**
 * Interactive Terminal — Web-based terminal for running security tools
 *
 * Provides a terminal-like interface for executing commands through
 * the CStrike API's tool execution endpoint. Includes command history,
 * tool suggestions, and output formatting.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Terminal,
  Play,
  Square,
  Trash2,
  Download,
  ChevronUp,
  ChevronDown,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  Zap,
} from 'lucide-react';
import { cn } from '@utils/index';
import { apiService } from '@services/api';
import { useUIStore } from '@stores/uiStore';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface TermLine {
  id: number;
  type: 'input' | 'output' | 'error' | 'system' | 'divider';
  text: string;
  timestamp: number;
  tool?: string;
}

interface ToolQuickAction {
  label: string;
  command: string;
  description: string;
  category: 'recon' | 'exploit' | 'enum' | 'web';
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const QUICK_ACTIONS: ToolQuickAction[] = [
  { label: 'nmap', command: 'nmap -sV -sC -T4', description: 'Service version scan', category: 'recon' },
  { label: 'nmap full', command: 'nmap -sV -sC -p- -T4', description: 'Full port scan', category: 'recon' },
  { label: 'nikto', command: 'nikto -h', description: 'Web server scanner', category: 'web' },
  { label: 'nuclei', command: 'nuclei -u', description: 'Vulnerability scanner', category: 'exploit' },
  { label: 'ffuf', command: 'ffuf -w /opt/cstrike/data/wordlists/common.txt -u', description: 'Web fuzzer', category: 'web' },
  { label: 'sqlmap', command: 'sqlmap -u', description: 'SQL injection scanner', category: 'exploit' },
  { label: 'subfinder', command: 'subfinder -d', description: 'Subdomain discovery', category: 'recon' },
  { label: 'httpx', command: 'httpx -l', description: 'HTTP probing', category: 'recon' },
  { label: 'hydra ssh', command: 'hydra -l admin -P /opt/cstrike/data/wordlists/passwords.txt ssh://', description: 'SSH brute force', category: 'exploit' },
  { label: 'sslscan', command: 'sslscan', description: 'SSL/TLS analysis', category: 'enum' },
  { label: 'gobuster', command: 'gobuster dir -w /opt/cstrike/data/wordlists/common.txt -u', description: 'Dir brute force', category: 'web' },
  { label: 'whois', command: 'whois', description: 'Domain info', category: 'recon' },
];

const CATEGORY_COLORS: Record<string, string> = {
  recon: 'var(--grok-recon-blue)',
  exploit: 'var(--grok-exploit-red)',
  enum: 'var(--grok-loot-gold)',
  web: 'var(--grok-ok-green)',
};

const BANNER = `
╔═══════════════════════════════════════════════╗
║  CStrike v2 — Interactive Terminal            ║
║  Type a command or select a tool below.       ║
║  Commands execute through the CStrike API.    ║
╚═══════════════════════════════════════════════╝
`.trim();

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function TerminalView() {
  const { addToast } = useUIStore();
  const [lines, setLines] = useState<TermLine[]>([
    { id: 0, type: 'system', text: BANNER, timestamp: Date.now() },
  ]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [running, setRunning] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [showQuickActions, setShowQuickActions] = useState(true);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lineIdRef = useRef(1);

  const addLine = useCallback((type: TermLine['type'], text: string, tool?: string) => {
    const id = lineIdRef.current++;
    setLines((prev) => [...prev, { id, type, text, timestamp: Date.now(), tool }]);
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [lines]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const executeCommand = useCallback(
    async (cmd: string) => {
      if (!cmd.trim()) return;

      // Add to history
      setHistory((prev) => [cmd, ...prev.filter((h) => h !== cmd)].slice(0, 50));
      setHistoryIdx(-1);

      // Display input line
      addLine('input', cmd);
      addLine('divider', '');

      // Handle built-in commands
      if (cmd.trim() === 'clear') {
        setLines([{ id: lineIdRef.current++, type: 'system', text: 'Terminal cleared.', timestamp: Date.now() }]);
        setInput('');
        return;
      }
      if (cmd.trim() === 'help') {
        addLine('system', 'Available tools: nmap, nikto, nuclei, ffuf, sqlmap, subfinder, httpx, hydra, sslscan, gobuster, katana, masscan');
        addLine('system', 'Built-in: clear, help, history');
        setInput('');
        return;
      }
      if (cmd.trim() === 'history') {
        history.forEach((h, i) => addLine('system', `  ${i + 1}  ${h}`));
        setInput('');
        return;
      }

      setRunning(true);
      setInput('');

      try {
        // Extract tool name from command
        const tool = cmd.trim().split(/\s+/)[0];

        // Execute through API
        const response = await apiService.executeCommand(cmd);
        const output = typeof response === 'string' ? response : response?.output || response?.data?.output || JSON.stringify(response, null, 2);

        // Display output
        if (output) {
          output.split('\n').forEach((line: string) => {
            addLine('output', line, tool);
          });
        } else {
          addLine('system', 'Command completed (no output).');
        }
      } catch (err: any) {
        const msg = err.response?.data?.error || err.message || 'Command execution failed';
        addLine('error', `Error: ${msg}`);
      } finally {
        setRunning(false);
        addLine('divider', '');
      }
    },
    [history, addLine]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !running) {
        executeCommand(input);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (history.length > 0) {
          const newIdx = Math.min(historyIdx + 1, history.length - 1);
          setHistoryIdx(newIdx);
          setInput(history[newIdx]);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIdx > 0) {
          const newIdx = historyIdx - 1;
          setHistoryIdx(newIdx);
          setInput(history[newIdx]);
        } else {
          setHistoryIdx(-1);
          setInput('');
        }
      } else if (e.key === 'c' && e.ctrlKey && running) {
        setRunning(false);
        addLine('system', '^C');
      } else if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault();
        setLines([]);
      }
    },
    [input, running, history, historyIdx, executeCommand, addLine]
  );

  const copyLine = useCallback(async (id: number, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const exportSession = useCallback(() => {
    const text = lines
      .filter((l) => l.type !== 'divider')
      .map((l) => {
        if (l.type === 'input') return `$ ${l.text}`;
        if (l.type === 'error') return `[ERROR] ${l.text}`;
        if (l.type === 'system') return `[SYSTEM] ${l.text}`;
        return l.text;
      })
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cstrike-terminal-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
    addToast({ type: 'success', message: 'Session exported', duration: 2000 });
  }, [lines, addToast]);

  const filteredActions = useMemo(
    () =>
      filterCategory
        ? QUICK_ACTIONS.filter((a) => a.category === filterCategory)
        : QUICK_ACTIONS,
    [filterCategory]
  );

  return (
    <div className={cn('h-full flex flex-col overflow-hidden', fullscreen && 'fixed inset-0 z-50 bg-[var(--grok-void)]')}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[var(--grok-surface-1)] border-b border-[var(--grok-border)] flex-shrink-0">
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5 text-[var(--grok-success)]" />
          <h1 className="text-lg font-bold text-[var(--grok-text-heading)]">Terminal</h1>
          {running && (
            <span className="flex items-center gap-1.5 text-[10px] text-[var(--grok-ok-green)] animate-pulse">
              <Zap className="w-3 h-3" /> Running...
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowQuickActions(!showQuickActions)}
            className="p-1.5 rounded text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] hover:bg-[var(--grok-surface-2)]"
            title="Toggle quick actions"
          >
            {showQuickActions ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setLines([])}
            className="p-1.5 rounded text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] hover:bg-[var(--grok-surface-2)]"
            title="Clear"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={exportSession}
            className="p-1.5 rounded text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] hover:bg-[var(--grok-surface-2)]"
            title="Export session"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={() => setFullscreen(!fullscreen)}
            className="p-1.5 rounded text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] hover:bg-[var(--grok-surface-2)]"
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Quick Actions */}
      {showQuickActions && (
        <div className="px-4 py-2 bg-[var(--grok-surface-1)] border-b border-[var(--grok-border)] flex-shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] uppercase tracking-wider text-[var(--grok-text-muted)]">Quick Tools</span>
            <div className="flex gap-1 ml-2">
              {['recon', 'exploit', 'enum', 'web'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
                  className={cn(
                    'px-2 py-0.5 rounded text-[9px] uppercase border transition-colors',
                    filterCategory === cat
                      ? 'border-current'
                      : 'border-transparent hover:border-[var(--grok-border)]'
                  )}
                  style={{ color: CATEGORY_COLORS[cat] }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {filteredActions.map((a) => (
              <button
                key={a.label}
                onClick={() => {
                  setInput(a.command + ' ');
                  inputRef.current?.focus();
                }}
                className="px-2 py-1 rounded text-[10px] font-mono bg-[var(--grok-surface-2)] border border-[var(--grok-border)] text-[var(--grok-text-body)] hover:border-[var(--grok-recon-blue)] transition-colors group"
                title={a.description}
              >
                <span style={{ color: CATEGORY_COLORS[a.category] }}>{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Terminal Output */}
      <div
        ref={termRef}
        className="flex-1 overflow-y-auto px-4 py-2 font-mono text-xs bg-[var(--grok-void)]"
        onClick={() => inputRef.current?.focus()}
      >
        {lines.map((line) => {
          if (line.type === 'divider') {
            return (
              <div
                key={line.id}
                className="border-b border-[var(--grok-border)]/20 my-1"
              />
            );
          }
          return (
            <div
              key={line.id}
              className={cn(
                'group flex items-start py-0.5 hover:bg-[var(--grok-surface-1)]/30 rounded px-1 -mx-1',
                line.type === 'error' && 'text-[var(--grok-crit-red)]',
                line.type === 'system' && 'text-[var(--grok-text-muted)]',
                line.type === 'input' && 'text-[var(--grok-ok-green)]',
                line.type === 'output' && 'text-[var(--grok-text-body)]'
              )}
            >
              {line.type === 'input' && (
                <span className="text-[var(--grok-ok-green)] mr-2 select-none">$</span>
              )}
              {line.type === 'error' && (
                <span className="text-[var(--grok-crit-red)] mr-2 select-none">!</span>
              )}
              <span className="flex-1 whitespace-pre-wrap break-all">{line.text}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  copyLine(line.id, line.text);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] transition-opacity"
              >
                {copiedId === line.id ? (
                  <Check className="w-3 h-3 text-[var(--grok-ok-green)]" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Input */}
      <div className="px-4 py-2 bg-[var(--grok-surface-1)] border-t border-[var(--grok-border)] flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[var(--grok-ok-green)] font-mono text-xs select-none">
            cstrike@v2 $
          </span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={running}
            placeholder={running ? 'Waiting for command to complete...' : 'Enter command...'}
            className="flex-1 bg-transparent text-xs font-mono text-[var(--grok-text-body)] placeholder:text-[var(--grok-text-muted)] outline-none"
            autoFocus
          />
          <button
            onClick={() => (running ? setRunning(false) : executeCommand(input))}
            className={cn(
              'p-1.5 rounded transition-colors',
              running
                ? 'text-[var(--grok-crit-red)] hover:bg-[var(--grok-crit-red)]/10'
                : 'text-[var(--grok-ok-green)] hover:bg-[var(--grok-ok-green)]/10'
            )}
          >
            {running ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
