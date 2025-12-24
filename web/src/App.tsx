/**
 * App Component - Main application entry point
 */

import { useEffect } from 'react';
import { MainLayout } from '@components/layout/MainLayout';
import { ErrorBoundary } from '@components/ErrorBoundary';
import { DashboardView } from '@modules/dashboard/DashboardView';
import { ReconnaissanceView } from '@modules/reconnaissance/ReconnaissanceView';
import { AIStreamView } from '@modules/ai-stream/AIStreamView';
import { ExploitationView } from '@modules/exploitation/ExploitationView';
import { LootView } from '@modules/loot/LootView';
import { LogsView } from '@modules/logs/LogsView';
import { ServicesView } from '@modules/services/ServicesView';
import { useUIStore } from '@stores/uiStore';
import { wsService } from '@services/websocket';

function App() {
  const { activeView } = useUIStore();

  // Connect to WebSocket on mount
  useEffect(() => {
    wsService.connect();

    return () => {
      wsService.disconnect();
    };
  }, []);

  // Render active view
  const renderView = () => {
    switch (activeView) {
      case 'dashboard':
        return <DashboardView />;
      case 'reconnaissance':
        return <ReconnaissanceView />;
      case 'ai-stream':
        return <AIStreamView />;
      case 'exploitation':
        return <ExploitationView />;
      case 'loot':
        return <LootView />;
      case 'logs':
        return <LogsView />;
      case 'services':
        return <ServicesView />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <ErrorBoundary>
      <MainLayout>{renderView()}</MainLayout>
    </ErrorBoundary>
  );
}

export default App;
