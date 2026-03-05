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

import { Component, type ReactNode, type ErrorInfo } from 'react';
import { Sidebar } from './Sidebar';
import { ToastContainer } from './ToastContainer';
import { NotificationCenter } from './NotificationCenter';
import { WorkflowDrawer } from './WorkflowDrawer';
import { TaskMapFooter } from './TaskMapFooter';

/** Error boundary that catches crashes in footer/panel components and recovers gracefully */
class FooterErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[TaskMapFooter] Crash caught by error boundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-8 flex items-center justify-center text-[10px] text-[var(--grok-text-muted)] border-t border-[var(--grok-border)] bg-[var(--grok-surface-1)]">
          Task pipeline recovered from error —
          <button
            className="ml-1 text-[var(--grok-recon-blue)] hover:underline"
            onClick={() => this.setState({ hasError: false })}
          >
            retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
          className="h-14 flex items-center justify-end pr-8 pl-4 flex-shrink-0 border-b border-[var(--grok-border)]"
          style={{ background: 'var(--grok-surface-1)' }}
        >
          <NotificationCenter />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-hidden">{children}</main>

        {/* Live task pipeline footer — wrapped in error boundary */}
        <FooterErrorBoundary>
          <TaskMapFooter />
        </FooterErrorBoundary>
      </div>

      <ToastContainer />
      <WorkflowDrawer />
    </div>
  );
}
