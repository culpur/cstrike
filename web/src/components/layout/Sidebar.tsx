/**
 * Sidebar Component — Collapsible rail navigation with dark-ops aesthetic
 */

import {
  LayoutDashboard,
  Target,
  Brain,
  FolderOpen,
  FileText,
  Settings,
  ChevronLeft,
  ChevronRight,
  Swords,
  Trophy,
  Server,
  Map,
  FileBarChart,
  CalendarClock,
  ShieldAlert,
  GitCompareArrows,
  FileCheck,
  Terminal,

  User,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { useUIStore } from '@stores/uiStore';
import { useSystemStore, type OperationMode } from '@stores/systemStore';
import { apiService } from '@services/api';
import { cn } from '@utils/index';
import cstrikeIcon from '@assets/cstrike-icon-64.png';

const navigationItems = [
  {
    id: 'dashboard',
    label: 'Command Center',
    icon: LayoutDashboard,
    section: 'ops',
  },
  {
    id: 'services',
    label: 'Services',
    icon: Server,
    section: 'system',
  },
  {
    id: 'targets',
    label: 'Targets',
    icon: Target,
    section: 'attack',
  },
  {
    id: 'ai-stream',
    label: 'AI Stream',
    icon: Brain,
    section: 'attack',
  },
  {
    id: 'exploitation',
    label: 'Exploitation',
    icon: Swords,
    section: 'attack',
  },
  {
    id: 'loot',
    label: 'Loot',
    icon: Trophy,
    section: 'intel',
  },
  {
    id: 'results',
    label: 'Results',
    icon: FolderOpen,
    section: 'intel',
  },
  {
    id: 'attack-map',
    label: 'Battle Map',
    icon: Map,
    section: 'intel',
  },
  {
    id: 'threat-intel',
    label: 'Threat Intel',
    icon: ShieldAlert,
    section: 'intel',
  },
  {
    id: 'scan-diff',
    label: 'Scan Diff',
    icon: GitCompareArrows,
    section: 'intel',
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: FileBarChart,
    section: 'ops',
  },
  {
    id: 'campaigns',
    label: 'Campaigns',
    icon: CalendarClock,
    section: 'ops',
  },
  {
    id: 'evidence',
    label: 'Evidence',
    icon: FileCheck,
    section: 'ops',
  },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: Terminal,
    section: 'ops',
  },
  {
    id: 'logs',
    label: 'Logs',
    icon: FileText,
    section: 'system',
  },
  {
    id: 'config',
    label: 'Configuration',
    icon: Settings,
    section: 'system',
  },
];

const sections = [
  { id: 'ops', label: 'Operations' },
  { id: 'attack', label: 'Attack' },
  { id: 'intel', label: 'Intel' },
  { id: 'system', label: 'System' },
];

const MODE_CONFIG: Record<OperationMode, {
  label: string;
  short: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  description: string;
}> = {
  manual: {
    label: 'OP',
    short: 'OP',
    icon: User,
    color: 'var(--grok-recon-blue)',
    description: 'Operator Controlled',
  },
  'semi-auto': {
    label: 'SEMI',
    short: 'SEMI',
    icon: ShieldCheck,
    color: 'var(--grok-warning)',
    description: 'Semi-Automated',
  },
  'full-auto': {
    label: 'AUTO',
    short: 'AUTO',
    icon: Zap,
    color: 'var(--grok-exploit-red)',
    description: 'Fully Automatic',
  },
};

const MODE_ORDER: OperationMode[] = ['manual', 'semi-auto', 'full-auto'];

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, activeView, setActiveView } =
    useUIStore();
  const { connected, operationMode, setOperationMode } = useSystemStore();

  const handleSetMode = (mode: OperationMode) => {
    setOperationMode(mode);
    apiService.setOperationMode(mode).catch(() => {});
  };

  const cycleMode = () => {
    const idx = MODE_ORDER.indexOf(operationMode);
    handleSetMode(MODE_ORDER[(idx + 1) % MODE_ORDER.length]);
  };

  return (
    <div
      className={cn(
        'h-full flex flex-col transition-all duration-300',
        'bg-[var(--grok-rail-bg)] border-r border-[var(--grok-border)]',
        sidebarCollapsed ? 'w-16' : 'w-56'
      )}
    >
      {/* Logo */}
      <div className="h-14 flex items-center justify-between px-3 border-b border-[var(--grok-border)]">
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2">
            <img src={cstrikeIcon} alt="CStrike" className="w-10 h-10 rounded ml-1" />
            <span className="font-bold text-sm text-[var(--grok-text-heading)] tracking-wide">
              CSTRIKE<span className="text-[var(--grok-exploit-red)]">v2</span>
            </span>
          </div>
        )}
        {sidebarCollapsed && (
          <img src={cstrikeIcon} alt="CStrike" className="w-10 h-10 rounded mx-auto" />
        )}
        {!sidebarCollapsed && (
          <button
            onClick={toggleSidebar}
            className="p-1 hover:bg-[var(--grok-surface-2)] rounded transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-[var(--grok-text-muted)]" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 overflow-y-auto">
        {sidebarCollapsed ? (
          /* Collapsed — just icons */
          <div className="space-y-1 px-2">
            {navigationItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveView(item.id)}
                  className={cn(
                    'w-full flex items-center justify-center p-2.5 rounded transition-all',
                    isActive
                      ? 'bg-[var(--grok-recon-blue)] text-white glow-blue'
                      : 'text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] hover:bg-[var(--grok-surface-2)]'
                  )}
                  title={item.label}
                >
                  <Icon className="w-4 h-4" />
                </button>
              );
            })}
            <button
              onClick={toggleSidebar}
              className="w-full flex items-center justify-center p-2.5 rounded text-[var(--grok-text-muted)] hover:bg-[var(--grok-surface-2)] mt-2"
              title="Expand"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          /* Expanded — grouped sections */
          <div className="space-y-3 px-2">
            {sections.map((section) => {
              const items = navigationItems.filter((i) => i.section === section.id);
              return (
                <div key={section.id}>
                  <div className="px-2 py-1">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--grok-text-muted)]">
                      {section.label}
                    </span>
                  </div>
                  {items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeView === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setActiveView(item.id)}
                        className={cn(
                          'w-full flex items-center gap-2.5 px-2.5 py-2 rounded transition-all text-left',
                          isActive
                            ? 'bg-[var(--grok-recon-blue)]/15 text-[var(--grok-recon-blue)] border-l-2 border-[var(--grok-recon-blue)]'
                            : 'text-[var(--grok-text-body)] hover:bg-[var(--grok-surface-2)] border-l-2 border-transparent'
                        )}
                      >
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        <span className="text-xs font-medium">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </nav>

      {/* Operation Mode Toggle */}
      <div className="px-3 py-3 border-t border-[var(--grok-border)]">
        {sidebarCollapsed ? (
          /* Collapsed — single icon, click to cycle */
          <button
            onClick={cycleMode}
            className="w-full flex items-center justify-center p-2 rounded transition-all hover:bg-[var(--grok-surface-2)]"
            title={MODE_CONFIG[operationMode].description}
            style={{ color: MODE_CONFIG[operationMode].color }}
          >
            {(() => {
              const Icon = MODE_CONFIG[operationMode].icon;
              return <Icon className="w-4 h-4" />;
            })()}
          </button>
        ) : (
          /* Expanded — 3-segment toggle */
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--grok-text-muted)] px-0.5">
              Operation Mode
            </span>
            <div className="flex mt-1.5 rounded-md overflow-hidden border border-[var(--grok-border)]">
              {MODE_ORDER.map((mode) => {
                const config = MODE_CONFIG[mode];
                const isActive = operationMode === mode;
                return (
                  <button
                    key={mode}
                    onClick={() => handleSetMode(mode)}
                    className={cn(
                      'flex-1 py-1.5 text-[10px] font-mono font-bold transition-all',
                      isActive
                        ? 'text-white'
                        : 'text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)] hover:bg-[var(--grok-surface-2)]'
                    )}
                    style={isActive ? { backgroundColor: config.color } : undefined}
                    title={config.description}
                  >
                    {config.label}
                  </button>
                );
              })}
            </div>
            <p
              className="text-[10px] font-mono mt-1.5 px-0.5"
              style={{ color: MODE_CONFIG[operationMode].color }}
            >
              {MODE_CONFIG[operationMode].description}
            </p>
          </div>
        )}
      </div>

      {/* Connection indicator */}
      <div className="px-3 py-4 border-t border-[var(--grok-border)]">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              'w-2.5 h-2.5 rounded-full flex-shrink-0',
              connected
                ? 'bg-[var(--grok-success)] shadow-[0_0_8px_var(--grok-success)]'
                : 'bg-[var(--grok-error)] shadow-[0_0_8px_var(--grok-error)] animate-pulse'
            )}
          />
          {!sidebarCollapsed && (
            <span className={cn(
              'text-xs font-mono font-semibold tracking-wide',
              connected ? 'text-[var(--grok-success)]' : 'text-[var(--grok-error)]'
            )}>
              {connected ? 'CONNECTED' : 'OFFLINE'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
