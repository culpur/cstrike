/**
 * Reconnaissance View - Target management and scanning controls
 */

import { useState, useEffect } from 'react';
import { Plus, Trash2, Play, Square, PlayCircle, XCircle } from 'lucide-react';
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

export function ReconnaissanceView() {
  const [targetUrl, setTargetUrl] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [activeScans, setActiveScans] = useState<ActiveScan[]>([]);
  const [isBatchScanning, setIsBatchScanning] = useState(false);

  const {
    targets,
    tools,
    portScanResults,
    subdomainResults,
    reconOutputs,
    addTarget,
    removeTarget,
    toggleTool,
    setToolRunning,
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
        // Add each target individually (store doesn't have setTargets)
        existingTargets.forEach((url) => {
          // Only add if not already in targets
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
  }, []); // Only run on mount

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

    // Poll immediately and then every 3 seconds
    pollActiveScans();
    const interval = setInterval(pollActiveScans, 3000);

    return () => clearInterval(interval);
  }, []);

  // Poll scan status when active scan
  useEffect(() => {
    if (!activeScanId) return;

    const pollInterval = setInterval(async () => {
      try {
        const status = await apiService.getScanStatus(activeScanId);
        if (status.status === 'completed' || status.status === 'failed') {
          setIsScanning(false);
          setActiveScanId(null);
          clearInterval(pollInterval);

          addToast({
            type: status.status === 'completed' ? 'success' : 'error',
            message: status.status === 'completed' ? 'Scan completed!' : `Scan failed: ${status.error}`,
          });
        }
      } catch (error) {
        console.error('Failed to poll scan status:', error);
      }
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(pollInterval);
  }, [activeScanId, addToast]);

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
      // Find the target by URL to get its ID for local store removal
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
    const enabledTools = tools.filter((t) => t.enabled).map((t) => t.name);

    if (enabledTools.length === 0) {
      addToast({
        type: 'warning',
        message: 'Please enable at least one tool',
      });
      return;
    }

    setIsScanning(true);
    try {
      // Start recon and capture scan_id for polling
      const response = await apiService.startRecon(targetId, enabledTools);
      const scanId = response?.scan_id || null;

      if (scanId) {
        setActiveScanId(scanId);
      }

      startScan(targetId);
      enabledTools.forEach((tool) => setToolRunning(tool, true));
      addToast({
        type: 'success',
        message: `Reconnaissance started (scan_id: ${scanId})`,
      });
    } catch (error) {
      setIsScanning(false);
      addToast({
        type: 'error',
        message: 'Failed to start reconnaissance',
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
      // Refresh active scans list
      const response = await apiService.getActiveScans();
      setActiveScans(response.active_scans);
    } catch (error) {
      addToast({
        type: 'error',
        message: 'Failed to stop scan',
      });
    }
  };

  const handleBatchScan = async () => {
    const targetUrls = targets.map((t) => t.url);
    const enabledTools = tools.filter((t) => t.enabled).map((t) => t.name);

    if (targetUrls.length === 0) {
      addToast({
        type: 'warning',
        message: 'No targets available for batch scanning',
      });
      return;
    }

    if (enabledTools.length === 0) {
      addToast({
        type: 'warning',
        message: 'Please enable at least one tool',
      });
      return;
    }

    setIsBatchScanning(true);
    try {
      const response = await apiService.startBatchRecon(targetUrls, enabledTools);
      addToast({
        type: 'success',
        message: `Batch scan started: ${response.successful}/${response.total} targets`,
      });

      if (response.failed && response.failed.length > 0) {
        addToast({
          type: 'warning',
          message: `${response.failed.length} targets failed to start`,
        });
      }

      // Refresh active scans list
      const activeResponse = await apiService.getActiveScans();
      setActiveScans(activeResponse.active_scans);
    } catch (error) {
      addToast({
        type: 'error',
        message: 'Failed to start batch scan',
      });
    } finally {
      setIsBatchScanning(false);
    }
  };

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold text-grok-text-heading">Reconnaissance</h1>

      {/* Add Target */}
      <Panel title="Add Target">
        <div className="flex gap-2">
          <Input
            placeholder="https://example.com"
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

      {/* Tool Selection */}
      <Panel title="Reconnaissance Tools">
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {tools.map((tool) => (
              <button
                key={tool.name}
                onClick={() => toggleTool(tool.name)}
                className={cn(
                  'p-3 rounded-lg border transition-all text-left',
                  tool.enabled
                    ? 'bg-grok-recon-blue/10 border-grok-recon-blue text-grok-recon-blue'
                    : 'bg-grok-surface-2 border-grok-border text-grok-text-muted hover:border-grok-text-muted'
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{tool.name}</span>
                  {tool.running && (
                    <span className="w-2 h-2 bg-current rounded-full animate-pulse" />
                  )}
                </div>
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <Button
              onClick={handleBatchScan}
              isLoading={isBatchScanning}
              disabled={targets.length === 0 || tools.filter(t => t.enabled).length === 0}
              variant="primary"
            >
              <PlayCircle className="w-4 h-4 mr-2" />
              Scan All Targets ({targets.length})
            </Button>
          </div>
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
            No targets added yet
          </p>
        ) : (
          <div className="space-y-3">
            {targets.map((target) => (
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
                  {/* Check if this target has an active scan */}
                  {(() => {
                    const activeScan = activeScans.find((s) => s.target === target.url);
                    return activeScan ? (
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
                        disabled={isScanning}
                      >
                        <Play className="w-3 h-3 mr-1" />
                        Scan
                      </Button>
                    );
                  })()}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemoveTarget(target.url)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
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
              {reconOutputs.slice(-50).map((output) => (
                <div key={output.timestamp} className="flex gap-2">
                  <span className="text-grok-text-muted flex-shrink-0">
                    [{formatTime(output.timestamp)}]
                  </span>
                  <span className="text-grok-recon-blue flex-shrink-0">
                    [{output.tool}]
                  </span>
                  <span className="text-grok-text-body">{output.output}</span>
                </div>
              ))}
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
