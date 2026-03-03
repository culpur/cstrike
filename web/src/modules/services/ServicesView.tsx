/**
 * Services View — Full service lifecycle management
 *
 * Start, stop, restart services. Monitor health, ports, errors.
 * Manage VPN connection. View feature availability matrix.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Server,
  Play,
  Square,
  RotateCw,
  Wifi,
  WifiOff,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Shield,
  Cpu,
  HardDrive,
  Zap,
  ExternalLink,
} from 'lucide-react';
import { useSystemStore } from '@stores/systemStore';
import { useUIStore } from '@stores/uiStore';
import { apiService } from '@services/api';
import { formatPercent } from '@utils/index';
import type { ServiceStatus, ServiceState } from '@/types';

interface ServiceCard {
  id: string;
  name: string;
  displayName: string;
  port: number;
  status: ServiceStatus;
  optional: boolean;
  description: string;
}

const STATUS_CONFIG: Record<ServiceStatus, { icon: typeof CheckCircle2; color: string; dotClass: string; label: string }> = {
  running: { icon: CheckCircle2, color: 'text-[var(--grok-success)]', dotClass: 'status-dot-running', label: 'Healthy' },
  stopped: { icon: XCircle, color: 'text-[var(--grok-text-muted)]', dotClass: 'status-dot-stopped', label: 'Stopped' },
  error: { icon: AlertTriangle, color: 'text-[var(--grok-warning)]', dotClass: 'status-dot-stopped', label: 'Not Installed' },
  starting: { icon: Loader2, color: 'text-[var(--grok-warning)]', dotClass: 'status-dot-starting', label: 'Starting' },
  stopping: { icon: Loader2, color: 'text-[var(--grok-warning)]', dotClass: 'status-dot-starting', label: 'Stopping' },
};

export function ServicesView() {
  const { metrics, services, connected, updateServiceStatus } = useSystemStore();
  const { addToast } = useUIStore();
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [aiProvider, setAIProvider] = useState({ provider: '', model: '', status: '' });
  const [aiConnectivity, setAIConnectivity] = useState<{
    tested: boolean;
    reachable: boolean;
    testing: boolean;
    error?: string;
  }>({ tested: false, reachable: false, testing: false });

  const serviceCards: ServiceCard[] = [
    {
      id: 'api_server',
      name: 'api_server',
      displayName: 'API Server',
      port: 8000,
      status: connected ? 'running' : 'stopped',
      optional: false,
      description: 'Flask REST API + WebSocket server',
    },
    {
      id: 'frontend',
      name: 'frontend',
      displayName: 'Web Frontend',
      port: 3000,
      status: 'running', // If we're rendering, frontend is running
      optional: false,
      description: 'React + Vite dev server',
    },
    {
      id: 'metasploit',
      name: 'metasploit',
      displayName: 'Metasploit RPC',
      port: 55552,
      status: services.metasploitRpc,
      optional: true,
      description: 'Exploitation framework daemon',
    },
    {
      id: 'zap',
      name: 'zap',
      displayName: 'OWASP ZAP',
      port: 8090,
      status: services.zap,
      optional: true,
      description: 'Web application security scanner',
    },
    {
      id: 'burp',
      name: 'burp',
      displayName: 'Burp Suite',
      port: 0,
      status: services.burp,
      optional: true,
      description: 'Web vulnerability scanner',
    },
  ];

  // Fetch AI provider info and test connectivity
  const testAIConnectivity = useCallback(async () => {
    setAIConnectivity((prev) => ({ ...prev, testing: true }));
    try {
      const result = await apiService.testAIProvider();
      setAIProvider({ provider: result.provider, model: result.model, status: result.reachable ? 'connected' : 'configured' });
      setAIConnectivity({ tested: true, reachable: result.reachable, testing: false, error: result.error });
    } catch {
      setAIConnectivity((prev) => ({ ...prev, testing: false, tested: true, reachable: false, error: 'API unreachable' }));
    }
  }, []);

  useEffect(() => {
    apiService.getAIProvider()
      .then((info) => {
        setAIProvider(info);
        // Auto-test connectivity after getting provider info
        testAIConnectivity();
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh service status
  const refreshStatus = useCallback(async () => {
    try {
      const status = await apiService.getStatus();
      updateServiceStatus('metasploitRpc', status.services.metasploitRpc);
      updateServiceStatus('zap', status.services.zap);
      updateServiceStatus('burp', status.services.burp);
    } catch {
      // API unreachable
    }
  }, [updateServiceStatus]);

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 5000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  // Auto-start failed optional services — they should always be on
  const [autoStartAttempted, setAutoStartAttempted] = useState<Set<string>>(new Set());
  useEffect(() => {
    const failedServices = serviceCards.filter(
      (svc) => svc.optional && svc.status === 'error' && !autoStartAttempted.has(svc.id)
    );
    if (failedServices.length > 0) {
      failedServices.forEach((svc) => {
        setAutoStartAttempted((prev) => new Set(prev).add(svc.id));
        handleServiceAction(svc.id, 'start').catch(() => {});
      });
    }
  }, [services, connected]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleServiceAction = async (
    service: string,
    action: 'start' | 'stop' | 'restart'
  ) => {
    setLoading((prev) => ({ ...prev, [service]: true }));
    try {
      const svcName = service as 'metasploit' | 'zap' | 'burp';
      if (action === 'start') await apiService.startService(svcName);
      else if (action === 'stop') await apiService.stopService(svcName);
      else await apiService.restartService(svcName);

      addToast({
        type: 'success',
        message: `${service}: ${action} successful`,
        duration: 3000,
      });
      // Refresh after brief delay
      setTimeout(refreshStatus, 2000);
    } catch (err: any) {
      addToast({
        type: 'error',
        message: `${service}: ${action} failed — ${err.message || 'unknown error'}`,
        duration: 5000,
      });
    } finally {
      setLoading((prev) => ({ ...prev, [service]: false }));
    }
  };

  const healthyCount = serviceCards.filter((s) => s.status === 'running').length;
  const totalCount = serviceCards.length;

  return (
    <div className="h-full overflow-auto p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[var(--grok-text-heading)] flex items-center gap-2">
            <Server className="w-5 h-5 text-[var(--grok-scan-cyan)]" />
            Service Management
          </h1>
          <p className="text-[10px] text-[var(--grok-text-muted)] mt-0.5 font-mono">
            {healthyCount}/{totalCount} services healthy
          </p>
        </div>
        <button
          onClick={refreshStatus}
          className="cs-btn flex items-center gap-1.5"
        >
          <RotateCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* System Metrics Bar */}
      <div className="grid grid-cols-4 gap-3">
        <div className="cs-panel p-3 flex items-center gap-3">
          <Cpu className="w-4 h-4 text-[var(--grok-scan-cyan)]" />
          <div>
            <div className="metric-label">CPU</div>
            <div className="text-sm font-mono font-semibold text-[var(--grok-text-heading)]">
              {formatPercent(metrics.cpu)}
            </div>
          </div>
        </div>
        <div className="cs-panel p-3 flex items-center gap-3">
          <HardDrive className="w-4 h-4 text-[var(--grok-ai-purple)]" />
          <div>
            <div className="metric-label">Memory</div>
            <div className="text-sm font-mono font-semibold text-[var(--grok-text-heading)]">
              {formatPercent(metrics.memory)}
            </div>
          </div>
        </div>
        <div className="cs-panel p-3 flex items-center gap-3">
          {metrics.vpnIp ? (
            <Wifi className="w-4 h-4 text-[var(--grok-success)]" />
          ) : (
            <WifiOff className="w-4 h-4 text-[var(--grok-text-muted)]" />
          )}
          <div>
            <div className="metric-label">VPN</div>
            <div className="text-sm font-mono font-semibold text-[var(--grok-text-heading)]">
              {metrics.vpnIp || 'Disconnected'}
            </div>
          </div>
        </div>
        <div className="cs-panel p-3 flex items-center gap-3">
          <Shield className={`w-4 h-4 ${aiConnectivity.reachable ? 'text-[var(--grok-success)]' : 'text-[var(--grok-ai-purple)]'}`} />
          <div className="flex-1 min-w-0">
            <div className="metric-label">AI Provider</div>
            {aiProvider.provider ? (
              <div
                className={`text-sm font-mono font-semibold truncate ${aiConnectivity.reachable ? 'text-[var(--grok-success)]' : 'text-[var(--grok-text-heading)]'}`}
                title={`${aiProvider.provider} / ${aiProvider.model}${aiConnectivity.reachable ? ' (connected)' : ' (not reachable)'}`}
              >
                {aiProvider.provider} / {aiProvider.model}
              </div>
            ) : (
              <button
                onClick={() => { const { setActiveView } = useUIStore.getState(); setActiveView('configuration'); }}
                className="text-sm font-mono font-semibold text-[var(--grok-warning)] hover:text-[var(--grok-ai-purple)] transition-colors flex items-center gap-1"
                title="Go to AI Provider configuration"
              >
                Configure
                <ExternalLink className="w-3 h-3" />
              </button>
            )}
          </div>
          <button
            onClick={testAIConnectivity}
            disabled={aiConnectivity.testing}
            className="cs-btn flex items-center gap-1 text-[10px] py-1 px-2 flex-shrink-0"
            title={aiConnectivity.error || 'Test AI provider connectivity'}
          >
            {aiConnectivity.testing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Zap className="w-3 h-3" />
            )}
            Test
          </button>
        </div>
      </div>

      {/* Service Cards */}
      <div className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--grok-text-muted)]">
          Managed Services
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {serviceCards.map((svc) => {
            const cfg = STATUS_CONFIG[svc.status] || STATUS_CONFIG.stopped;
            const StatusIcon = cfg.icon;
            const isLoading = loading[svc.id];
            const isControllable = svc.optional; // Only optional services have controls

            return (
              <div
                key={svc.id}
                className={`svc-card svc-card-${svc.status === 'running' ? 'healthy' : svc.status === 'error' ? 'error' : svc.status === 'starting' ? 'starting' : 'stopped'}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`status-dot ${cfg.dotClass}`} />
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--grok-text-heading)]">
                        {svc.displayName}
                      </h3>
                      <p className="text-[10px] text-[var(--grok-text-muted)] mt-0.5">
                        {svc.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <StatusIcon
                      className={`w-4 h-4 ${cfg.color} ${svc.status === 'starting' || svc.status === 'stopping' ? 'animate-spin' : ''}`}
                    />
                    <span className={`text-xs font-mono ${cfg.color}`}>
                      {cfg.label}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-4 text-[10px] text-[var(--grok-text-muted)] font-mono">
                    {svc.port > 0 && <span>:{svc.port}</span>}
                    {svc.optional && (
                      <span className="text-[var(--grok-text-muted)]">optional</span>
                    )}
                    {!svc.optional && (
                      <span className="text-[var(--grok-warning)]">required</span>
                    )}
                  </div>

                  {isControllable && (
                    <div className="flex items-center gap-1.5">
                      {svc.status === 'stopped' || svc.status === 'error' ? (
                        <button
                          onClick={() => handleServiceAction(svc.id, 'start')}
                          disabled={isLoading}
                          className="cs-btn cs-btn-success flex items-center gap-1 text-[10px] py-1 px-2"
                        >
                          {isLoading ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Play className="w-3 h-3" />
                          )}
                          Start
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => handleServiceAction(svc.id, 'restart')}
                            disabled={isLoading}
                            className="cs-btn flex items-center gap-1 text-[10px] py-1 px-2"
                          >
                            {isLoading ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <RotateCw className="w-3 h-3" />
                            )}
                            Restart
                          </button>
                          <button
                            onClick={() => handleServiceAction(svc.id, 'stop')}
                            disabled={isLoading}
                            className="cs-btn cs-btn-danger flex items-center gap-1 text-[10px] py-1 px-2"
                          >
                            <Square className="w-3 h-3" />
                            Stop
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Feature Status Matrix */}
      <div className="cs-panel">
        <div className="cs-panel-header">Feature Availability</div>
        <div className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {getFeatureMatrix(services, connected, aiProvider, aiConnectivity).map((feat) => (
              <div
                key={feat.name}
                className="flex items-center gap-2 p-2 rounded bg-[var(--grok-surface-2)]"
              >
                <div
                  className={`status-dot ${feat.available ? 'status-dot-running' : 'status-dot-stopped'}`}
                />
                <div>
                  <span className="text-xs text-[var(--grok-text-body)]">
                    {feat.name}
                  </span>
                  {feat.detail && (
                    <span className="text-[9px] text-[var(--grok-text-muted)] block">
                      {feat.detail}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function getFeatureMatrix(
  services: ServiceState,
  connected: boolean,
  aiProvider: { provider: string; model: string; status: string },
  aiConnectivity: { tested: boolean; reachable: boolean; testing: boolean; error?: string }
) {
  const aiAvailable = aiConnectivity.reachable;
  const aiDetail = aiProvider.provider
    ? `${aiProvider.provider} / ${aiProvider.model}`
    : 'not configured';

  return [
    { name: 'REST API', available: connected, detail: ':8000' },
    { name: 'WebSocket', available: connected, detail: 'Socket.IO' },
    { name: 'Metasploit RPC', available: services.metasploitRpc === 'running', detail: ':55552' },
    { name: 'OWASP ZAP', available: services.zap === 'running', detail: ':8090' },
    { name: 'Burp Suite', available: services.burp === 'running' },
    { name: 'AI Provider', available: aiAvailable, detail: aiDetail },
    { name: 'MCP Tools', available: connected, detail: 'agentic mode' },
    { name: 'VulnAPI', available: connected, detail: 'API scanning' },
    { name: 'Recon Pipeline', available: connected, detail: 'nmap + suite' },
    { name: 'Credential Validator', available: connected, detail: 'SSH/FTP/HTTP' },
    { name: 'Loot Tracker', available: connected, detail: 'heatmap + reuse' },
    { name: 'Report Export', available: connected, detail: 'JSON / Markdown' },
  ];
}
