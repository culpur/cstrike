/**
 * Interactive Terminal — multi-tab shell session manager.
 *
 * Tab bar shows:
 *   [Local] [SSH root@10.10.10.100 x] [Shell target:4444 x] ...
 *
 * "Local" tab: one-shot commands via POST /api/v1/terminal/execute
 * Session tabs: POST /api/v1/terminal/sessions/:id/execute (stdin → spawn)
 *
 * WebSocket streaming keeps every tab's output live without polling.
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import {
  Terminal,
  Play,
  Trash2,
  Download,
  ChevronUp,
  ChevronDown,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  X,
  MonitorDot,
  Network,
  Plus,
} from 'lucide-react';
import { cn } from '@utils/index';
import { apiService } from '@services/api';
import { wsService } from '@services/websocket';
import { useUIStore } from '@stores/uiStore';
import { useTerminalStore } from '@stores/terminalStore';
import type { ShellSession, ShellSessionType } from '@stores/terminalStore';

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

// Unique ID for the always-present "Local" tab — not a real session
const LOCAL_TAB_ID = '__local__';

/* ------------------------------------------------------------------ */
/*  Sub-component: Tab bar                                             */
/* ------------------------------------------------------------------ */

interface TabBarProps {
  sessions: ShellSession[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewSSH: () => void;
}

function TabBar({ sessions, activeTabId, onSelectTab, onCloseTab, onNewSSH }: TabBarProps) {
  return (
    <div className="flex items-center gap-0 overflow-x-auto scrollbar-none border-b border-[var(--grok-border)] flex-shrink-0 bg-[var(--grok-surface-1)]">
      {/* Local tab (always first) */}
      <button
        onClick={() => onSelectTab(LOCAL_TAB_ID)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono whitespace-nowrap border-r border-[var(--grok-border)] transition-colors flex-shrink-0',
          activeTabId === LOCAL_TAB_ID
            ? 'bg-[var(--grok-void)] text-[var(--grok-ok-green)] border-b-2 border-b-[var(--grok-ok-green)] -mb-px'
            : 'text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] hover:bg-[var(--grok-surface-2)]',
        )}
      >
        <Terminal className="w-3 h-3 flex-shrink-0" />
        <span>Local</span>
      </button>

      {/* Dynamic session tabs */}
      {sessions.map((session) => {
        const isActive = activeTabId === session.id;
        const label = sessionTabLabel(session);
        const Icon = session.type === 'ssh' ? Network : MonitorDot;

        return (
          <button
            key={session.id}
            onClick={() => onSelectTab(session.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono whitespace-nowrap border-r border-[var(--grok-border)] transition-colors flex-shrink-0 group',
              isActive
                ? 'bg-[var(--grok-void)] text-[var(--grok-exploit-red)] border-b-2 border-b-[var(--grok-exploit-red)] -mb-px'
                : 'text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] hover:bg-[var(--grok-surface-2)]',
              !session.active && 'opacity-50',
            )}
          >
            <Icon className="w-3 h-3 flex-shrink-0" />
            <span className="max-w-[120px] truncate">{label}</span>
            {!session.active && (
              <span className="text-[8px] text-[var(--grok-text-muted)]">[dead]</span>
            )}
            <span
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(session.id);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onCloseTab(session.id)}
              className="ml-0.5 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--grok-crit-red)]/20 hover:text-[var(--grok-crit-red)] transition-all"
              title={`Close ${label}`}
            >
              <X className="w-2.5 h-2.5" />
            </span>
          </button>
        );
      })}

      {/* New SSH session button */}
      <button
        onClick={onNewSSH}
        className="flex items-center gap-1 px-2 py-2 text-[10px] text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] hover:bg-[var(--grok-surface-2)] transition-colors flex-shrink-0"
        title="New SSH session"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
}

function sessionTabLabel(session: ShellSession): string {
  const prefix = session.type === 'ssh' ? 'SSH' : session.type === 'reverse_shell' ? 'Shell' : 'Bind';
  const userPart = session.user ? `${session.user}@` : '';
  const hostPart = session.host || session.target;
  const portPart = session.port ? `:${session.port}` : '';
  return `${prefix} ${userPart}${hostPart}${portPart}`;
}

/* ------------------------------------------------------------------ */
/*  Sub-component: SSH session dialog                                  */
/* ------------------------------------------------------------------ */

interface NewSSHDialogProps {
  onClose: () => void;
  onCreate: (params: { type: ShellSessionType; host: string; port: number; user?: string; password?: string }) => void;
}

function NewSSHDialog({ onClose, onCreate }: NewSSHDialogProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [sessionType, setSessionType] = useState<ShellSessionType>('ssh');
  const [creating, setCreating] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!host.trim()) return;
    setCreating(true);
    try {
      await onCreate({
        type: sessionType,
        host: host.trim(),
        port: parseInt(port, 10) || 22,
        user: user.trim() || undefined,
        password: password || undefined,
      });
      onClose();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[var(--grok-surface-1)] border border-[var(--grok-border)] rounded-lg p-5 w-80 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[var(--grok-text-heading)]">New Shell Session</h3>
          <button onClick={onClose} className="text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Type */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[var(--grok-text-muted)] mb-1">Type</label>
            <select
              value={sessionType}
              onChange={(e) => setSessionType(e.target.value as ShellSessionType)}
              className="w-full bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded px-2 py-1.5 text-xs text-[var(--grok-text-body)] outline-none focus:border-[var(--grok-recon-blue)]"
            >
              <option value="ssh">SSH</option>
              <option value="reverse_shell">Reverse Shell (catch)</option>
              <option value="bind_shell">Bind Shell (connect)</option>
              <option value="local">Local</option>
            </select>
          </div>

          {/* Host */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[var(--grok-text-muted)] mb-1">Host / IP</label>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="10.10.10.100"
              className="w-full bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded px-2 py-1.5 text-xs font-mono text-[var(--grok-text-body)] placeholder:text-[var(--grok-text-muted)] outline-none focus:border-[var(--grok-recon-blue)]"
              autoFocus
              required
            />
          </div>

          {/* Port */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[var(--grok-text-muted)] mb-1">Port</label>
            <input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="22"
              type="number"
              min="1"
              max="65535"
              className="w-full bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded px-2 py-1.5 text-xs font-mono text-[var(--grok-text-body)] placeholder:text-[var(--grok-text-muted)] outline-none focus:border-[var(--grok-recon-blue)]"
            />
          </div>

          {/* User */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[var(--grok-text-muted)] mb-1">Username (optional)</label>
            <input
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="root"
              className="w-full bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded px-2 py-1.5 text-xs font-mono text-[var(--grok-text-body)] placeholder:text-[var(--grok-text-muted)] outline-none focus:border-[var(--grok-recon-blue)]"
            />
          </div>

          {/* Password (for SSH with sshpass) */}
          {sessionType === 'ssh' && (
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[var(--grok-text-muted)] mb-1">Password (optional)</label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="leave blank for key-based auth"
                type="password"
                className="w-full bg-[var(--grok-surface-2)] border border-[var(--grok-border)] rounded px-2 py-1.5 text-xs font-mono text-[var(--grok-text-body)] placeholder:text-[var(--grok-text-muted)] outline-none focus:border-[var(--grok-recon-blue)]"
              />
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-1.5 rounded border border-[var(--grok-border)] text-xs text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !host.trim()}
              className="flex-1 py-1.5 rounded bg-[var(--grok-recon-blue)]/20 border border-[var(--grok-recon-blue)] text-xs text-[var(--grok-recon-blue)] hover:bg-[var(--grok-recon-blue)]/30 disabled:opacity-50 transition-colors"
            >
              {creating ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function TerminalView() {
  const { addToast } = useUIStore();

  // Terminal store (session tabs)
  const { sessions, activeSessionId, addSession, removeSession, setActiveSession } =
    useTerminalStore();

  // Determine the active tab: use store's activeSessionId if it's a session tab, else LOCAL_TAB_ID
  const [localTabId] = useState(LOCAL_TAB_ID);
  const activeTabId = activeSessionId ?? localTabId;

  // Per-tab terminal line history — keyed by tab id
  // Session output comes from the store; local output is kept here
  const [localLines, setLocalLines] = useState<TermLine[]>([
    { id: 0, type: 'system', text: BANNER, timestamp: Date.now() },
  ]);
  const lineIdRef = useRef(1);

  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [fullscreen, setFullscreen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showQuickActions, setShowQuickActions] = useState(true);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [showSSHDialog, setShowSSHDialog] = useState(false);

  const termRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Derived: lines for the currently visible tab ─────────────────

  const activeSession = sessions.find((s) => s.id === activeTabId);

  // Convert session output (string[]) to TermLine[] for display
  const sessionLines = useMemo<TermLine[]>(() => {
    if (!activeSession) return [];
    return activeSession.output.map((text, i) => ({
      id: i,
      type: 'output' as const,
      text,
      timestamp: activeSession.createdAt,
    }));
  }, [activeSession, activeSession?.output]);

  const visibleLines: TermLine[] = activeTabId === LOCAL_TAB_ID ? localLines : sessionLines;

  const addLocalLine = useCallback((type: TermLine['type'], text: string, tool?: string) => {
    const id = lineIdRef.current++;
    setLocalLines((prev) => [...prev, { id, type, text, timestamp: Date.now(), tool }]);
  }, []);

  // ── WebSocket listener for local tab streaming output ────────────
  useEffect(() => {
    const unsub = wsService.on<any>('terminal_output', (data) => {
      if (data.sessionId && data.output && String(data.sessionId).startsWith('local-')) {
        const lines: string[] = data.output.split('\n');
        for (const line of lines) {
          const id = lineIdRef.current++;
          setLocalLines((prev) => [...prev, { id, type: 'output', text: line, timestamp: Date.now() }]);
        }
      }
    });
    return unsub;
  }, []);

  // ── Auto-scroll ──────────────────────────────────────────────────
  useEffect(() => {
    if (termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [visibleLines]);

  // ── Focus input on mount and tab switch ─────────────────────────
  useEffect(() => {
    inputRef.current?.focus();
  }, [activeTabId]);

  // ── Load existing sessions on mount ─────────────────────────────
  useEffect(() => {
    useTerminalStore.getState().loadSessions();
  }, []);

  // ── Tab switching ────────────────────────────────────────────────
  const handleSelectTab = useCallback(
    (id: string) => {
      if (id === LOCAL_TAB_ID) {
        setActiveSession(null);
      } else {
        setActiveSession(id);
      }
      setInput('');
      setHistoryIdx(-1);
    },
    [setActiveSession],
  );

  const handleCloseTab = useCallback(
    async (id: string) => {
      try {
        await apiService.closeTerminalSession(id);
      } catch {
        // best-effort close
      }
      removeSession(id);
    },
    [removeSession],
  );

  const handleNewSSH = useCallback(
    async (params: { type: ShellSessionType; host: string; port: number; user?: string; password?: string }) => {
      try {
        const sessionData = await apiService.createTerminalSession({
          type: params.type,
          host: params.host,
          port: params.port,
          user: params.user,
          password: params.password,
          target: params.host,
        });
        if (sessionData?.id) {
          addSession({
            id: sessionData.id,
            type: sessionData.type ?? params.type,
            target: sessionData.target ?? params.host,
            host: sessionData.host ?? params.host,
            port: sessionData.port ?? params.port,
            user: sessionData.user ?? params.user,
            createdAt: sessionData.createdAt ?? Date.now(),
            lastActivity: sessionData.lastActivity ?? Date.now(),
            active: true,
          });
          addToast({ type: 'success', message: `Session opened: ${params.host}`, duration: 3000 });
        }
      } catch (err: any) {
        addToast({ type: 'error', message: `Failed to open session: ${err.message}`, duration: 5000 });
      }
    },
    [addSession, addToast],
  );

  // ── Command execution ────────────────────────────────────────────

  const promptLabel = useMemo(() => {
    if (activeTabId === LOCAL_TAB_ID) return 'cstrike@v2 $';
    const s = sessions.find((x) => x.id === activeTabId);
    if (!s) return 'cstrike@v2 $';
    const userPart = s.user ? `${s.user}@` : '';
    return `${userPart}${s.host} $`;
  }, [activeTabId, sessions]);

  const executeCommand = useCallback(
    async (cmd: string) => {
      if (!cmd.trim()) return;

      setHistory((prev) => [cmd, ...prev.filter((h) => h !== cmd)].slice(0, 50));
      setHistoryIdx(-1);

      // ── Local tab built-ins ──────────────────────────────────────
      if (activeTabId === LOCAL_TAB_ID) {
        addLocalLine('input', cmd);
        addLocalLine('divider', '');

        if (cmd.trim() === 'clear') {
          setLocalLines([{ id: lineIdRef.current++, type: 'system', text: 'Terminal cleared.', timestamp: Date.now() }]);
          setInput('');
          return;
        }
        if (cmd.trim() === 'help') {
          addLocalLine('system', 'Available tools: nmap, nikto, nuclei, ffuf, sqlmap, subfinder, httpx, hydra, sslscan, gobuster, katana, masscan');
          addLocalLine('system', 'Built-in: clear, help, history');
          addLocalLine('system', 'Session tabs: use + button or SSH quick-action to open a shell session.');
          setInput('');
          return;
        }
        if (cmd.trim() === 'history') {
          history.forEach((h, i) => addLocalLine('system', `  ${i + 1}  ${h}`));
          setInput('');
          return;
        }

        setInput('');
        // Fire-and-forget: output streams via WebSocket terminal_output events
        apiService.executeCommand(cmd).catch((err: any) => {
          const msg = err.response?.data?.error || err.message || 'Command execution failed';
          addLocalLine('error', `Error: ${msg}`);
        });
        return;
      }

      // ── Session tab ─────────────────────────────────────────────
      const session = sessions.find((s) => s.id === activeTabId);
      if (!session) return;

      if (!session.active) {
        addToast({ type: 'error', message: 'Session is no longer active', duration: 3000 });
        return;
      }

      // Reflect the command in the session output locally (the actual output
      // will stream back via WebSocket terminal_output events)
      useTerminalStore.getState().appendOutput(session.id, `$ ${cmd}`);

      setInput('');
      apiService.executeInSession(session.id, cmd).catch((err: any) => {
        const msg = err.response?.data?.error || err.message || 'Command failed';
        useTerminalStore.getState().appendOutput(session.id, `[ERROR] ${msg}`);
      });
    },
    [activeTabId, sessions, history, addLocalLine, addToast],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
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
      } else if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault();
        if (activeTabId === LOCAL_TAB_ID) setLocalLines([]);
      }
    },
    [input, history, historyIdx, activeTabId, executeCommand, addLocalLine],
  );

  // ── Copy + export ────────────────────────────────────────────────
  const copyLine = useCallback(async (id: string | number, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(String(id));
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const exportSession = useCallback(() => {
    const text = visibleLines
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
    a.download = `cstrike-terminal-${activeTabId === LOCAL_TAB_ID ? 'local' : activeTabId.substring(0, 8)}-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
    addToast({ type: 'success', message: 'Session exported', duration: 2000 });
  }, [visibleLines, activeTabId, addToast]);

  const filteredActions = useMemo(
    () => (filterCategory ? QUICK_ACTIONS.filter((a) => a.category === filterCategory) : QUICK_ACTIONS),
    [filterCategory],
  );

  const clearOutput = useCallback(() => {
    if (activeTabId === LOCAL_TAB_ID) {
      setLocalLines([]);
    }
    // For session tabs, clearing local mirror doesn't affect backend buffer;
    // a full clear would need a store action — omitted for simplicity.
  }, [activeTabId]);

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div
      className={cn(
        'h-full flex flex-col overflow-hidden',
        fullscreen && 'fixed inset-0 z-50 bg-[var(--grok-void)]',
      )}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-2 bg-[var(--grok-surface-1)] border-b border-[var(--grok-border)] flex-shrink-0">
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5 text-[var(--grok-success)]" />
          <h1 className="text-lg font-bold text-[var(--grok-text-heading)]">Terminal</h1>
          {activeSession && (
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded border font-mono',
                activeSession.active
                  ? 'border-[var(--grok-exploit-red)] text-[var(--grok-exploit-red)]'
                  : 'border-[var(--grok-text-muted)] text-[var(--grok-text-muted)]',
              )}
            >
              {activeSession.active ? 'LIVE' : 'DEAD'}
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
            onClick={clearOutput}
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

      {/* ── Tab bar ── */}
      <TabBar
        sessions={sessions}
        activeTabId={activeTabId}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onNewSSH={() => setShowSSHDialog(true)}
      />

      {/* ── Quick Actions (only visible on Local tab) ── */}
      {showQuickActions && activeTabId === LOCAL_TAB_ID && (
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
                      : 'border-transparent hover:border-[var(--grok-border)]',
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
                className="px-2 py-1 rounded text-[10px] font-mono bg-[var(--grok-surface-2)] border border-[var(--grok-border)] text-[var(--grok-text-body)] hover:border-[var(--grok-recon-blue)] transition-colors"
                title={a.description}
              >
                <span style={{ color: CATEGORY_COLORS[a.category] }}>{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Terminal Output ── */}
      <div
        ref={termRef}
        className="flex-1 overflow-y-auto px-4 py-2 font-mono text-xs bg-[var(--grok-void)]"
        onClick={() => inputRef.current?.focus()}
      >
        {visibleLines.map((line, idx) => {
          const lineKey = activeTabId === LOCAL_TAB_ID ? line.id : idx;

          if (line.type === 'divider') {
            return (
              <div
                key={lineKey}
                className="border-b border-[var(--grok-border)]/20 my-1"
              />
            );
          }

          return (
            <div
              key={lineKey}
              className={cn(
                'group flex items-start py-0.5 hover:bg-[var(--grok-surface-1)]/30 rounded px-1 -mx-1',
                line.type === 'error' && 'text-[var(--grok-crit-red)]',
                line.type === 'system' && 'text-[var(--grok-text-muted)]',
                line.type === 'input' && 'text-[var(--grok-ok-green)]',
                line.type === 'output' && 'text-[var(--grok-text-body)]',
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
                  copyLine(lineKey, line.text);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] transition-opacity"
              >
                {copiedId === String(lineKey) ? (
                  <Check className="w-3 h-3 text-[var(--grok-ok-green)]" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          );
        })}

        {/* Empty state for session tabs */}
        {activeTabId !== LOCAL_TAB_ID && visibleLines.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--grok-text-muted)]">
            <MonitorDot className="w-8 h-8 opacity-30" />
            <p className="text-xs">
              {activeSession?.active
                ? 'Session is live — type a command below'
                : 'Session has ended'}
            </p>
          </div>
        )}
      </div>

      {/* ── Input ── */}
      <div className="px-4 py-2 bg-[var(--grok-surface-1)] border-t border-[var(--grok-border)] flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[var(--grok-ok-green)] font-mono text-xs select-none">
            {promptLabel}
          </span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={activeTabId !== LOCAL_TAB_ID && !activeSession?.active}
            placeholder={
              activeTabId !== LOCAL_TAB_ID && !activeSession?.active
                ? 'Session ended'
                : 'Enter command...'
            }
            className="flex-1 bg-transparent text-xs font-mono text-[var(--grok-text-body)] placeholder:text-[var(--grok-text-muted)] outline-none"
            autoFocus
          />
          <button
            onClick={() => executeCommand(input)}
            disabled={activeTabId !== LOCAL_TAB_ID && !activeSession?.active}
            className="p-1.5 rounded transition-colors disabled:opacity-30 text-[var(--grok-ok-green)] hover:bg-[var(--grok-ok-green)]/10"
          >
            <Play className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── SSH Dialog ── */}
      {showSSHDialog && (
        <NewSSHDialog
          onClose={() => setShowSSHDialog(false)}
          onCreate={handleNewSSH}
        />
      )}
    </div>
  );
}
