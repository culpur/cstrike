/**
 * MainLayout Component - Root layout with sidebar, header bar, and content area
 *
 * Structure:
 *   ┌──────────┬────────────────────────────────┐
 *   │          │  Header (h-14)  [Notification] │
 *   │ Sidebar  ├────────────────────────────────┤
 *   │          │  Main content (flex-1)          │
 *   └──────────┴────────────────────────────────┘
 *
 * The header bar aligns with the sidebar logo row (also h-14) so the top
 * edge of the interface looks cohesive across the full width.
 */

import { type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { ToastContainer } from './ToastContainer';
import { NotificationCenter } from './NotificationCenter';

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="h-full flex bg-grok-void">
      <Sidebar />

      {/* Right-hand column: header + content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header bar */}
        <header
          className="h-14 flex items-center justify-end px-4 flex-shrink-0 border-b border-[var(--grok-border)]"
          style={{ background: 'var(--grok-surface-1)' }}
        >
          <NotificationCenter />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>

      <ToastContainer />
    </div>
  );
}
