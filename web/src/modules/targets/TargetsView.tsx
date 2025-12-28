/**
 * Targets View - Target management for AI-driven autonomous scans
 *
 * This view allows users to add targets and initiate AI-driven scans.
 * Once "Start Scan" is clicked, the AI autonomously runs ALL phases:
 * - Reconnaissance (all tools)
 * - AI Analysis
 * - Exploitation
 * - Follow-up actions
 *
 * Users simply watch the progress on the Dashboard and AI Stream.
 */

import { useState, useEffect } from 'react';
import { Plus, Trash2, Play, Square, XCircle } from 'lucide-react';
import { Button, Panel, Input, StatusBadge } from '@components/ui';
import { useReconStore } from '@stores/reconStore';
import { useUIStore } from '@stores/uiStore';
import { apiService } from '@services/api';
import { wsService } from '@services/websocket';
import { formatTime, isValidUrl } from '@utils/index';
import type { ReconOutput, PortScanResult, SubdomainResult } from '@/types';

interface ActiveScan {
  scan_id: string;
  target: string;
  tools: string[];
  running_tools?: string[];
  started_at: string;
  status: string;
}

export function TargetsView() {
  const [targetUrl, setTargetUrl] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [activeScans, setActiveScans] = useState<ActiveScan[]>([]);

  const {
    targets,
    portScanResults,
    subdomainResults,
    reconOutputs,
    addTarget,
    removeTarget,
    addPortScanResult,
    addSubdomainResult,
    addReconOutput,
    startScan,
  } = useReconStore();

  const { addToast } = useUIStore();

  // Load existing targets on mount
  useEffect(() => {
    const loadTargets = async () => {
      try {
        const existingTargets = await apiService.getTargets();
        existingTargets.forEach((url) => {
          if (!targets.some((t) => t.url === url)) {
            addTarget(url);
          }
        });
      } catch (error) {
        console.error('Failed to load targets:', error);
      }
    };
    loadTargets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll active scans periodically
  useEffect(() => {
    const pollActiveScans = async () => {
      try {
        const response = await apiService.getActiveScans();
        setActiveScans(response.active_scans);
      } catch (error) {
        console.error('Failed to fetch active scans:', error);
      }
    };

    pollActiveScans();
    const interval = setInterval(pollActiveScans, 3000);

    return () => clearInterval(interval);
  }, []);

  // Setup WebSocket listeners
  useEffect(() => {
    const unsubOutput = wsService.on<ReconOutput>('recon_output', (data) => {
      addReconOutput(data);
    });

    const unsubPort = wsService.on<PortScanResult>('tool_update', (data) => {
      if ('port' in data) {
        addPortScanResult(data as PortScanResult);
      }
    });

    const unsubSubdomain = wsService.on<SubdomainResult>('tool_update', (data) => {
      if ('subdomain' in data) {
        addSubdomainResult(data as SubdomainResult);
      }
    });

    return () => {
      unsubOutput();
      unsubPort();
      unsubSubdomain();
    };
  }, [addReconOutput, addPortScanResult, addSubdomainResult]);

  const handleAddTarget = async () => {
    if (!targetUrl.trim()) return;

    if (!isValidUrl(targetUrl)) {
      addToast({
        type: 'error',
        message: 'Invalid URL format',
      });
      return;
    }

    setIsAdding(true);
    try {
      await apiService.addTarget(targetUrl);
      addTarget(targetUrl);
      setTargetUrl('');
      addToast({
        type: 'success',
        message: 'Target added successfully',
      });
    } catch (error) {
      addToast({
        type: 'error',
        message: 'Failed to add target',
      });
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveTarget = async (targetUrl: string) => {
    try {
      const target = targets.find((t) => t.url === targetUrl);
      if (!target) return;

      await apiService.removeTarget(targetUrl);
      removeTarget(target.id);
      addToast({
        type: 'success',
        message: 'Target removed',
      });
    } catch (error) {
      addToast({
        type: 'error',
        message: 'Failed to remove target',
      });
    }
  };

  const handleStartScan = async (targetId: string) => {
    try {
      // Start AI-driven scan (AI will decide which tools to run)
      const response = await apiService.startRecon(targetId, []);
      const scanId = response?.scan_id || null;

      startScan(targetId);
      addToast({
        type: 'success',
        message: `AI-driven scan started (scan_id: ${scanId})`,
      });
    } catch (error) {
      addToast({
        type: 'error',
        message: 'Failed to start scan',
      });
    }
  };

  const handleStopScan = async (scanId: string) => {
    try {
      await apiService.stopRecon(scanId);
      addToast({
        type: 'info',
        message: 'Scan cancellation requested',
      });
      const response = await apiService.getActiveScans();
      setActiveScans(response.active_scans);
    } catch (error) {
      addToast({
        type: 'error',
        message: 'Failed to stop scan',
      });
    }
  };

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-grok-text-heading">Targets</h1>
        <p className="text-sm text-grok-text-muted mt-1">
          Add targets and start AI-driven autonomous scans. The AI will automatically run all phases.
        </p>
      </div>

      {/* Add Target */}
      <Panel title="Add Target">
        <div className="flex gap-2">
          <Input
            placeholder="https://example.com or 192.168.1.1"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddTarget()}
          />
          <Button onClick={handleAddTarget} isLoading={isAdding} className="flex-shrink-0">
            <Plus className="w-4 h-4 mr-1" />
            Add
          </Button>
        </div>
      </Panel>

      {/* Active Scans */}
      {activeScans.length > 0 && (
        <Panel title={`Active Scans (${activeScans.length})`}>
          <div className="space-y-3">
            {activeScans.map((scan) => (
              <div
                key={scan.scan_id}
                className="flex items-center justify-between p-3 bg-grok-surface-2 rounded-lg border border-grok-border"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-grok-recon-blue rounded-full animate-pulse" />
                    <p className="text-sm font-medium text-grok-text-heading truncate">
                      {scan.target}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <p className="text-xs text-grok-text-muted font-mono">
                      {scan.scan_id}
                    </p>
                    <p className="text-xs text-grok-text-muted">
                      Started {new Date(scan.started_at).toLocaleTimeString()}
                    </p>
                  </div>
                  {scan.running_tools && scan.running_tools.length > 0 && (
                    <div className="flex gap-1 mt-2">
                      {scan.running_tools.map((tool) => (
                        <span
                          key={tool}
                          className="text-xs px-2 py-0.5 bg-grok-recon-blue/10 text-grok-recon-blue rounded"
                        >
                          {tool}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => handleStopScan(scan.scan_id)}
                >
                  <XCircle className="w-3 h-3 mr-1" />
                  Cancel
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Targets List */}
      <Panel title={`Targets (${targets.length})`}>
        {targets.length === 0 ? (
          <p className="text-sm text-grok-text-muted text-center py-8">
            No targets added yet. Add a target above to begin.
          </p>
        ) : (
          <div className="space-y-3">
            {targets.map((target) => {
              const activeScan = activeScans.find((s) => s.target === target.url);
              const isScanning = !!activeScan;

              return (
                <div
                  key={target.id}
                  className="flex items-center justify-between p-3 bg-grok-surface-2 rounded-lg border border-grok-border"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-grok-text-heading truncate">
                      {target.url}
                    </p>
                    {target.ip && (
                      <p className="text-xs text-grok-text-muted mt-1">{target.ip}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <StatusBadge status={target.status} />
                    {isScanning ? (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => handleStopScan(activeScan.scan_id)}
                      >
                        <Square className="w-3 h-3 mr-1" />
                        Stop
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => handleStartScan(target.url)}
                      >
                        <Play className="w-3 h-3 mr-1" />
                        Start Scan
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveTarget(target.url)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Results */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Port Scan Results */}
        <Panel title={`Open Ports (${portScanResults.length})`}>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {portScanResults.length === 0 ? (
              <p className="text-sm text-grok-text-muted text-center py-4">
                No ports discovered yet
              </p>
            ) : (
              portScanResults.slice(-20).reverse().map((result, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2 bg-grok-surface-2 rounded text-sm"
                >
                  <div>
                    <span className="text-grok-text-heading font-mono">
                      {result.target}:{result.port}
                    </span>
                    {result.service && (
                      <span className="text-grok-text-muted ml-2">
                        ({result.service})
                      </span>
                    )}
                  </div>
                  <StatusBadge status={'success'} label={result.state} showDot={false} />
                </div>
              ))
            )}
          </div>
        </Panel>

        {/* Subdomain Results */}
        <Panel title={`Subdomains (${subdomainResults.length})`}>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {subdomainResults.length === 0 ? (
              <p className="text-sm text-grok-text-muted text-center py-4">
                No subdomains discovered yet
              </p>
            ) : (
              subdomainResults.slice(-20).reverse().map((result, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2 bg-grok-surface-2 rounded text-sm"
                >
                  <span className="text-grok-text-heading font-mono">
                    {result.subdomain}
                  </span>
                  <span className="text-grok-text-muted text-xs">
                    {result.source}
                  </span>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>

      {/* Live Output */}
      <Panel title="Live Output">
        <div className="bg-grok-void rounded p-4 font-mono text-xs max-h-96 overflow-y-auto">
          {reconOutputs.length === 0 ? (
            <p className="text-grok-text-muted">Waiting for scan output...</p>
          ) : (
            <div className="space-y-1">
              {reconOutputs.slice(-50).map((output) => {
                const getEventColor = (event?: string) => {
                  if (!event) return 'text-grok-text-body';
                  if (event.includes('start')) return 'text-grok-recon-blue';
                  if (event.includes('complete')) return 'text-grok-success';
                  if (event.includes('error') || event.includes('failed')) return 'text-grok-error';
                  if (event.includes('timeout')) return 'text-grok-warning';
                  if (event.includes('retry')) return 'text-grok-warning';
                  return 'text-grok-text-body';
                };

                const getEventIcon = (event?: string) => {
                  if (!event) return '•';
                  if (event.includes('start')) return '▶';
                  if (event.includes('complete')) return '✓';
                  if (event.includes('error') || event.includes('failed')) return '✗';
                  if (event.includes('timeout')) return '⏱';
                  if (event.includes('retry')) return '↻';
                  return '•';
                };

                return (
                  <div key={output.timestamp} className="flex gap-2">
                    <span className="text-grok-text-muted flex-shrink-0">
                      [{formatTime(output.timestamp)}]
                    </span>
                    <span className={cn('flex-shrink-0', getEventColor(output.event))}>
                      {getEventIcon(output.event)}
                    </span>
                    <span className="text-grok-recon-blue flex-shrink-0">
                      [{output.tool || 'recon'}]
                    </span>
                    {output.progress && (
                      <span className="text-grok-text-muted flex-shrink-0">
                        [{output.progress}]
                      </span>
                    )}
                    <span className={getEventColor(output.event)}>{output.output}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
