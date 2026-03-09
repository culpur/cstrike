/**
 * App — Root component with global WebSocket wiring and view routing
 */

import { useEffect } from 'react';
import { MainLayout } from '@components/layout/MainLayout';
import { ErrorBoundary } from '@components/ErrorBoundary';
import { DashboardView } from '@modules/dashboard/DashboardView';
import { ServicesView } from '@modules/services/ServicesView';
import { TargetsView } from '@modules/targets/TargetsView';
import { AIStreamView } from '@modules/ai-stream/AIStreamView';
import { ResultsView } from '@modules/results/ResultsView';
import { LogsView } from '@modules/logs/LogsView';
import { ConfigurationView } from '@modules/configuration/ConfigurationView';
import { ExploitationView } from '@modules/exploitation/ExploitationView';
import { LootView } from '@modules/loot/LootView';
import { BattleMapView } from '@modules/attack-map/BattleMapView';
import { ReportGeneratorView } from '@modules/reports/ReportGeneratorView';
import { CampaignsView } from '@modules/campaigns/CampaignsView';
import { ThreatIntelView } from '@modules/threat-intel/ThreatIntelView';
import { ScanDiffView } from '@modules/scan-diff/ScanDiffView';
import { EvidenceView } from '@modules/evidence/EvidenceView';
import { TerminalView } from '@modules/terminal/TerminalView';
import { UpdateView } from '@modules/update/UpdateView';

import { useUIStore } from '@stores/uiStore';
import { useWebSocketHandlers } from '@/hooks/useWebSocketHandlers';
import { apiService } from '@services/api';
import { useSystemStore } from '@stores/systemStore';
import { CommandPalette } from '@components/CommandPalette';

function App() {
  const { activeView } = useUIStore();
  const { updateMetrics, updateServiceStatus, setConnected } = useSystemStore();

  // Global WebSocket → Store wiring (runs once)
  useWebSocketHandlers();

  // Fetch initial status on mount
  useEffect(() => {
    apiService
      .getStatus()
      .then((status) => {
        updateMetrics(status.metrics);
        updateServiceStatus('metasploitRpc', status.services.metasploitRpc);
        updateServiceStatus('zap', status.services.zap);
        updateServiceStatus('burp', status.services.burp);
        setConnected(true);
      })
      .catch(() => setConnected(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const renderView = () => {
    switch (activeView) {
      case 'dashboard':
        return <DashboardView />;
      case 'services':
        return <ServicesView />;
      case 'targets':
      case 'reconnaissance':
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
      case 'attack-map':
        return <BattleMapView />;
      case 'reports':
        return <ReportGeneratorView />;
      case 'campaigns':
        return <CampaignsView />;
      case 'threat-intel':
        return <ThreatIntelView />;
      case 'scan-diff':
        return <ScanDiffView />;
      case 'evidence':
        return <EvidenceView />;
      case 'terminal':
        return <TerminalView />;
      case 'update':
        return <UpdateView />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <ErrorBoundary>
      <MainLayout>{renderView()}</MainLayout>
      <CommandPalette />
    </ErrorBoundary>
  );
}

export default App;
