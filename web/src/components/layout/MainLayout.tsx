/**
 * MainLayout Component - Root layout with sidebar and content area
 */

import { type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { ToastContainer } from './ToastContainer';

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="h-full flex bg-grok-void">
      <Sidebar />
      <main className="flex-1 overflow-hidden">{children}</main>
      <ToastContainer />
    </div>
  );
}
