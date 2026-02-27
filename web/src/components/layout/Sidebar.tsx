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
} from 'lucide-react';
import { useUIStore } from '@stores/uiStore';
import { useSystemStore } from '@stores/systemStore';
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
    section: 'ops',
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

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, activeView, setActiveView } =
    useUIStore();
  const { connected } = useSystemStore();

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
            <img src={cstrikeIcon} alt="CStrike" className="w-8 h-8 rounded" />
            <span className="font-bold text-sm text-[var(--grok-text-heading)] tracking-wide">
              CSTRIKE<span className="text-[var(--grok-exploit-red)]">v2</span>
            </span>
          </div>
        )}
        {sidebarCollapsed && (
          <img src={cstrikeIcon} alt="CStrike" className="w-8 h-8 rounded mx-auto" />
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

      {/* Connection indicator */}
      <div className="px-3 py-3 border-t border-[var(--grok-border)]">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'status-dot',
              connected ? 'status-dot-running' : 'status-dot-error'
            )}
          />
          {!sidebarCollapsed && (
            <span className="text-[10px] text-[var(--grok-text-muted)] font-mono">
              {connected ? 'CONNECTED' : 'OFFLINE'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
