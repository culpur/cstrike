/**
 * Sidebar Component - Collapsible rail navigation
 */

import {
  LayoutDashboard,
  Search,
  Crosshair,
  Package,
  FileText,
  Brain,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useUIStore } from '@stores/uiStore';
import { cn } from '@utils/index';

const navigationItems = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    path: '/dashboard',
  },
  {
    id: 'reconnaissance',
    label: 'Reconnaissance',
    icon: Search,
    path: '/reconnaissance',
  },
  {
    id: 'ai-stream',
    label: 'AI Stream',
    icon: Brain,
    path: '/ai-stream',
  },
  {
    id: 'exploitation',
    label: 'Exploitation',
    icon: Crosshair,
    path: '/exploitation',
  },
  {
    id: 'loot',
    label: 'Loot',
    icon: Package,
    path: '/loot',
  },
  {
    id: 'logs',
    label: 'Logs',
    icon: FileText,
    path: '/logs',
  },
  {
    id: 'services',
    label: 'Services',
    icon: Settings,
    path: '/services',
  },
];

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, activeView, setActiveView } =
    useUIStore();

  return (
    <div
      className={cn(
        'h-full bg-grok-rail-bg border-r border-grok-border flex flex-col transition-all duration-300',
        sidebarCollapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-grok-border">
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-grok-exploit-red rounded flex items-center justify-center">
              <span className="text-white font-bold text-sm">CS</span>
            </div>
            <span className="font-bold text-grok-text-heading">CStrike</span>
          </div>
        )}
        <button
          onClick={toggleSidebar}
          className="p-1.5 hover:bg-grok-surface-2 rounded transition-colors"
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="w-5 h-5 text-grok-text-muted" />
          ) : (
            <ChevronLeft className="w-5 h-5 text-grok-text-muted" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;

          return (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
                'hover:bg-grok-surface-2',
                isActive
                  ? 'bg-grok-recon-blue text-white'
                  : 'text-grok-text-body'
              )}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {!sidebarCollapsed && (
                <span className="text-sm font-medium">{item.label}</span>
              )}
              {isActive && !sidebarCollapsed && (
                <div className="ml-auto w-1.5 h-1.5 bg-white rounded-full" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-grok-border">
        {!sidebarCollapsed && (
          <div className="text-xs text-grok-text-muted">
            <p>CStrike v1.0.0</p>
            <p className="mt-1">Offensive Security Framework</p>
          </div>
        )}
      </div>
    </div>
  );
}
