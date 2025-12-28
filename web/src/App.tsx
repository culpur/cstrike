/**
 * App Component - Main application entry point
 */

import { useEffect } from 'react';
import { MainLayout } from '@components/layout/MainLayout';
import { ErrorBoundary } from '@components/ErrorBoundary';
import { DashboardView } from '@modules/dashboard/DashboardView';
import { TargetsView } from '@modules/targets/TargetsView';
import { AIStreamView } from '@modules/ai-stream/AIStreamView';
import { ResultsView } from '@modules/results/ResultsView';
import { LogsView } from '@modules/logs/LogsView';
import { ConfigurationView } from '@modules/configuration/ConfigurationView';
import { ExploitationView } from '@modules/exploitation/ExploitationView';
import { LootView } from '@modules/loot/LootView';
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
      case 'targets':
      case 'reconnaissance': // Keep old route for backward compatibility
        return <TargetsView />;
      case 'ai-stream':
        return <AIStreamView />;
      case 'results':
        return <ResultsView />;
      case 'logs':
        return <LogsView />;
      case 'config':
        return <ConfigurationView />;
      case 'exploitation':
        return <ExploitationView />;
      case 'loot':
        return <LootView />;
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
