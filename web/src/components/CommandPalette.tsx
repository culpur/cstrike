/**
 * CommandPalette — Spotlight-style command palette for CStrike v2.
 *
 * Opens with Ctrl+K (or Cmd+K on Mac).
 * Supports arrow-key navigation, Enter to select, Escape to close.
 * Integrates global keyboard shortcuts via useKeyboardShortcuts.
 */

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  memo,
  type KeyboardEvent,
} from 'react';
import {
  LayoutDashboard,
  Target,
  Brain,
  FolderOpen,
  FileText,
  Settings,
  Swords,
  Trophy,
  Server,
  Scan,
  Download,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Command,
  Map,
  FileBarChart,
  CalendarClock,
  ShieldAlert,
  GitCompareArrows,
  FileCheck,
  Terminal,
  Globe,
} from 'lucide-react';
import { useUIStore } from '@stores/uiStore';
import { useLogStore } from '@stores/logStore';
import { useKeyboardShortcuts } from '@hooks/useKeyboardShortcuts';
import { cn } from '@utils/index';

// ── Types ─────────────────────────────────────────────────────────────────────

type PaletteItemKind = 'navigation' | 'action';

interface PaletteItem {
  id: string;
  kind: PaletteItemKind;
  label: string;
  description?: string;
  shortcut?: string[];
  icon: React.ComponentType<{ className?: string }>;
  /** Called when the item is selected. Receives close callback. */
  onSelect: (close: () => void) => void;
}

// ── Keyboard shortcut badge ───────────────────────────────────────────────────

const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPod|iPad/.test(navigator.platform);

interface KbdProps {
  keys: string[];
}

const Kbd = memo<KbdProps>(({ keys }) => (
  <span className="flex items-center gap-0.5" aria-hidden="true">
    {keys.map((key, i) => (
      <kbd
        key={i}
        className={cn(
          'inline-flex items-center justify-center',
          'min-w-[1.375rem] h-[1.375rem] px-1',
          'rounded text-[10px] font-mono font-medium',
          'bg-[var(--grok-surface-1)] border border-[var(--grok-border)]',
          'text-[var(--grok-text-muted)]',
          'leading-none'
        )}
      >
        {key === 'Cmd' && isMac ? '⌘' : key}
      </kbd>
    ))}
  </span>
));
Kbd.displayName = 'Kbd';

// ── Single palette row ────────────────────────────────────────────────────────

interface PaletteRowProps {
  item: PaletteItem;
  isSelected: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}

const PaletteRow = memo<PaletteRowProps>(
  ({ item, isSelected, onMouseEnter, onClick }) => {
    const Icon = item.icon;
    return (
      <button
        role="option"
        aria-selected={isSelected}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-3 transition-colors text-left',
          'focus:outline-none',
          isSelected
            ? 'bg-[var(--grok-surface-3)]'
            : 'hover:bg-[var(--grok-surface-2)]'
        )}
        onMouseEnter={onMouseEnter}
        onClick={onClick}
      >
        {/* Icon */}
        <span
          className={cn(
            'flex-shrink-0 w-8 h-8 rounded flex items-center justify-center',
            item.kind === 'navigation'
              ? 'bg-[var(--grok-recon-blue)]/10 text-[var(--grok-recon-blue)]'
              : 'bg-[var(--grok-exploit-red)]/10 text-[var(--grok-exploit-red)]'
          )}
        >
          <Icon className="w-4 h-4" />
        </span>

        {/* Label + description */}
        <span className="flex-1 min-w-0">
          <span
            className={cn(
              'block text-sm font-medium truncate',
              isSelected
                ? 'text-[var(--grok-text-heading)]'
                : 'text-[var(--grok-text-body)]'
            )}
          >
            {item.label}
          </span>
          {item.description && (
            <span className="block text-xs text-[var(--grok-text-muted)] truncate mt-0.5">
              {item.description}
            </span>
          )}
        </span>

        {/* Shortcut badge */}
        {item.shortcut && (
          <span className="flex-shrink-0 ml-2">
            <Kbd keys={item.shortcut} />
          </span>
        )}

        {/* Kind tag */}
        <span
          className={cn(
            'flex-shrink-0 text-[10px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded',
            item.kind === 'navigation'
              ? 'text-[var(--grok-recon-blue)] bg-[var(--grok-recon-blue)]/10'
              : 'text-[var(--grok-exploit-red)] bg-[var(--grok-exploit-red)]/10'
          )}
        >
          {item.kind === 'navigation' ? 'nav' : 'act'}
        </span>
      </button>
    );
  }
);
PaletteRow.displayName = 'PaletteRow';

// ── Section heading ───────────────────────────────────────────────────────────

const SectionHeading = memo<{ label: string }>(({ label }) => (
  <div className="px-4 py-1.5 border-b border-[var(--grok-border)]">
    <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--grok-text-muted)]">
      {label}
    </span>
  </div>
));
SectionHeading.displayName = 'SectionHeading';

// ── CommandPalette ────────────────────────────────────────────────────────────

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { setActiveView, toggleSidebar, sidebarCollapsed, addToast } =
    useUIStore();
  const { clearLogs } = useLogStore();

  const open = useCallback(() => {
    setIsOpen(true);
    setQuery('');
    setSelectedIndex(0);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setSelectedIndex(0);
  }, []);

  // Register global keyboard shortcuts
  useKeyboardShortcuts({
    onOpenPalette: open,
    onClosePalette: close,
    isPaletteOpen: isOpen,
  });

  // Focus the search input whenever the palette opens
  useEffect(() => {
    if (isOpen) {
      // rAF ensures the modal has rendered before we attempt focus
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // ── Item definitions ──────────────────────────────────────────

  const items: PaletteItem[] = [
    // Navigation
    {
      id: 'nav-dashboard',
      kind: 'navigation',
      label: 'Command Center',
      description: 'Main dashboard with metrics and overview',
      shortcut: ['g', 'd'],
      icon: LayoutDashboard,
      onSelect: (close) => {
        setActiveView('dashboard');
        close();
      },
    },
    {
      id: 'nav-services',
      kind: 'navigation',
      label: 'Services',
      description: 'Manage Metasploit, ZAP, Burp Suite',
      shortcut: ['g', 's'],
      icon: Server,
      onSelect: (close) => {
        setActiveView('services');
        close();
      },
    },
    {
      id: 'nav-targets',
      kind: 'navigation',
      label: 'Targets',
      description: 'Add and manage reconnaissance targets',
      shortcut: ['g', 't'],
      icon: Target,
      onSelect: (close) => {
        setActiveView('targets');
        close();
      },
    },
    {
      id: 'nav-ai-stream',
      kind: 'navigation',
      label: 'AI Stream',
      description: 'Live AI-powered analysis feed',
      shortcut: ['g', 'a'],
      icon: Brain,
      onSelect: (close) => {
        setActiveView('ai-stream');
        close();
      },
    },
    {
      id: 'nav-exploitation',
      kind: 'navigation',
      label: 'Exploitation',
      description: 'Exploit modules and payload builder',
      shortcut: ['g', 'e'],
      icon: Swords,
      onSelect: (close) => {
        setActiveView('exploitation');
        close();
      },
    },
    {
      id: 'nav-loot',
      kind: 'navigation',
      label: 'Loot',
      description: 'Captured credentials and post-exploitation data',
      shortcut: ['g', 'o'],
      icon: Trophy,
      onSelect: (close) => {
        setActiveView('loot');
        close();
      },
    },
    {
      id: 'nav-results',
      kind: 'navigation',
      label: 'Results',
      description: 'Browse and export scan results',
      shortcut: ['g', 'r'],
      icon: FolderOpen,
      onSelect: (close) => {
        setActiveView('results');
        close();
      },
    },
    {
      id: 'nav-logs',
      kind: 'navigation',
      label: 'Logs',
      description: 'System and service log stream',
      shortcut: ['g', 'l'],
      icon: FileText,
      onSelect: (close) => {
        setActiveView('logs');
        close();
      },
    },
    {
      id: 'nav-config',
      kind: 'navigation',
      label: 'Configuration',
      description: 'API endpoints, proxies, and preferences',
      shortcut: ['g', 'c'],
      icon: Settings,
      onSelect: (close) => {
        setActiveView('config');
        close();
      },
    },
    {
      id: 'nav-attack-map',
      kind: 'navigation',
      label: 'Attack Map',
      description: 'MITRE ATT&CK matrix and kill chain',
      icon: Map,
      onSelect: (close) => {
        setActiveView('attack-map');
        close();
      },
    },
    {
      id: 'nav-threat-intel',
      kind: 'navigation',
      label: 'Threat Intel',
      description: 'OpenCTI threat intelligence integration',
      icon: ShieldAlert,
      onSelect: (close) => {
        setActiveView('threat-intel');
        close();
      },
    },
    {
      id: 'nav-reports',
      kind: 'navigation',
      label: 'Reports',
      description: 'Generate pentest reports (PDF/HTML/Markdown)',
      icon: FileBarChart,
      onSelect: (close) => {
        setActiveView('reports');
        close();
      },
    },
    {
      id: 'nav-campaigns',
      kind: 'navigation',
      label: 'Campaigns',
      description: 'Scan scheduling and target groups',
      icon: CalendarClock,
      onSelect: (close) => {
        setActiveView('campaigns');
        close();
      },
    },
    {
      id: 'nav-scan-diff',
      kind: 'navigation',
      label: 'Scan Diff',
      description: 'Compare scan runs side by side',
      icon: GitCompareArrows,
      onSelect: (close) => {
        setActiveView('scan-diff');
        close();
      },
    },
    {
      id: 'nav-evidence',
      kind: 'navigation',
      label: 'Evidence',
      description: 'Engagement timeline and evidence collector',
      icon: FileCheck,
      onSelect: (close) => {
        setActiveView('evidence');
        close();
      },
    },
    {
      id: 'nav-terminal',
      kind: 'navigation',
      label: 'Terminal',
      description: 'Interactive terminal for security tools',
      icon: Terminal,
      onSelect: (close) => {
        setActiveView('terminal');
        close();
      },
    },
    {
      id: 'nav-geo-map',
      kind: 'navigation',
      label: 'Geo Map',
      description: 'World map visualization of targets',
      icon: Globe,
      onSelect: (close) => {
        setActiveView('geo-map');
        close();
      },
    },
    // Actions
    {
      id: 'act-launch-scan',
      kind: 'action',
      label: 'Launch Scan',
      description: 'Navigate to Targets to initiate a new scan',
      icon: Scan,
      onSelect: (close) => {
        setActiveView('targets');
        addToast({
          type: 'info',
          message: 'Select a target and click Run Scan.',
        });
        close();
      },
    },
    {
      id: 'act-export-results',
      kind: 'action',
      label: 'Export Results',
      description: 'Navigate to Results view to export data',
      icon: Download,
      onSelect: (close) => {
        setActiveView('results');
        addToast({
          type: 'info',
          message: 'Use the export controls in the Results view.',
        });
        close();
      },
    },
    {
      id: 'act-clear-logs',
      kind: 'action',
      label: 'Clear Logs',
      description: 'Wipe all entries from the log store',
      icon: Trash2,
      onSelect: (close) => {
        clearLogs();
        addToast({
          type: 'success',
          message: 'All log entries have been removed.',
        });
        close();
      },
    },
    {
      id: 'act-toggle-sidebar',
      kind: 'action',
      label: sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar',
      description: 'Toggle the navigation rail',
      icon: sidebarCollapsed ? PanelLeftOpen : PanelLeftClose,
      onSelect: (close) => {
        toggleSidebar();
        close();
      },
    },
  ];

  // ── Filtering ─────────────────────────────────────────────────

  const filteredItems = query.trim()
    ? items.filter(
        (item) =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          (item.description?.toLowerCase().includes(query.toLowerCase()) ?? false)
      )
    : items;

  // Clamp selection after filter changes
  useEffect(() => {
    setSelectedIndex((prev) =>
      filteredItems.length === 0 ? 0 : Math.min(prev, filteredItems.length - 1)
    );
  }, [filteredItems.length]);

  // ── Keyboard navigation inside the palette ─────────────────────

  const handleInputKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            filteredItems.length === 0 ? 0 : (prev + 1) % filteredItems.length
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) =>
            filteredItems.length === 0
              ? 0
              : (prev - 1 + filteredItems.length) % filteredItems.length
          );
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredItems[selectedIndex]) {
            filteredItems[selectedIndex].onSelect(close);
          }
          break;
        case 'Escape':
          e.preventDefault();
          close();
          break;
        default:
          break;
      }
    },
    [filteredItems, selectedIndex, close]
  );

  // Scroll the selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector<HTMLButtonElement>(
      '[aria-selected="true"]'
    );
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // ── Render ────────────────────────────────────────────────────

  if (!isOpen) return null;

  const navItems = filteredItems.filter((i) => i.kind === 'navigation');
  const actionItems = filteredItems.filter((i) => i.kind === 'action');
  const hasNavItems = navItems.length > 0;
  const hasActionItems = actionItems.length > 0;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      {/* Scrim */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={cn(
          'relative w-full max-w-[600px] rounded-xl overflow-hidden animate-fade-in',
          'bg-[var(--grok-surface-2)]',
          'border border-[var(--grok-border)]',
          'shadow-[0_24px_64px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.04)]'
        )}
      >
        {/* Search bar */}
        <div className="flex items-center gap-3 px-4 border-b border-[var(--grok-border)]">
          <Search
            className="w-4 h-4 flex-shrink-0 text-[var(--grok-text-muted)]"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search commands..."
            className={cn(
              'flex-1 py-4 bg-transparent',
              'text-sm text-[var(--grok-text-heading)]',
              'placeholder:text-[var(--grok-text-muted)]',
              'focus:outline-none'
            )}
            role="combobox"
            aria-expanded={true}
            aria-autocomplete="list"
            aria-controls="command-palette-list"
            aria-activedescendant={
              filteredItems[selectedIndex]
                ? `cpal-${filteredItems[selectedIndex].id}`
                : undefined
            }
            autoComplete="off"
            spellCheck={false}
          />
          <kbd
            className={cn(
              'flex-shrink-0 inline-flex items-center justify-center',
              'h-[1.375rem] px-1.5 rounded text-[10px] font-mono',
              'bg-[var(--grok-surface-1)] border border-[var(--grok-border)]',
              'text-[var(--grok-text-muted)]'
            )}
            aria-label="Press Escape to close"
          >
            esc
          </kbd>
        </div>

        {/* Results list */}
        <div
          id="command-palette-list"
          ref={listRef}
          role="listbox"
          aria-label="Commands"
          className="max-h-[420px] overflow-y-auto overscroll-contain"
        >
          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-[var(--grok-text-muted)]">
              <Search className="w-8 h-8 opacity-30" aria-hidden="true" />
              <p className="text-sm">No commands match &ldquo;{query}&rdquo;</p>
            </div>
          ) : (
            <>
              {hasNavItems && (
                <>
                  <SectionHeading label="Navigation" />
                  {navItems.map((item) => {
                    const flatIndex = filteredItems.indexOf(item);
                    return (
                      <PaletteRow
                        key={item.id}
                        item={item}
                        isSelected={flatIndex === selectedIndex}
                        onMouseEnter={() => setSelectedIndex(flatIndex)}
                        onClick={() => item.onSelect(close)}
                      />
                    );
                  })}
                </>
              )}
              {hasActionItems && (
                <>
                  <SectionHeading label="Actions" />
                  {actionItems.map((item) => {
                    const flatIndex = filteredItems.indexOf(item);
                    return (
                      <PaletteRow
                        key={item.id}
                        item={item}
                        isSelected={flatIndex === selectedIndex}
                        onMouseEnter={() => setSelectedIndex(flatIndex)}
                        onClick={() => item.onSelect(close)}
                      />
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer hint */}
        <div
          className={cn(
            'flex items-center justify-between gap-4 px-4 py-2.5',
            'border-t border-[var(--grok-border)]',
            'bg-[var(--grok-surface-1)]'
          )}
        >
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-[11px] text-[var(--grok-text-muted)]">
              <Kbd keys={['↑', '↓']} />
              <span>navigate</span>
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-[var(--grok-text-muted)]">
              <Kbd keys={['↵']} />
              <span>select</span>
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-[var(--grok-text-muted)]">
              <Kbd keys={['esc']} />
              <span>close</span>
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--grok-text-muted)]">
            <Command className="w-3 h-3" aria-hidden="true" />
            <span>CStrike v2</span>
          </div>
        </div>
      </div>
    </div>
  );
}
