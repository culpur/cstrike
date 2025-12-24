/**
 * Reconnaissance View - Target management and scanning controls
 */

import { useState, useEffect } from 'react';
import { Plus, Trash2, Play, Square } from 'lucide-react';
import { Button, Panel, Input, StatusBadge } from '@components/ui';
import { useReconStore } from '@stores/reconStore';
import { useUIStore } from '@stores/uiStore';
import { apiService } from '@services/api';
import { wsService } from '@services/websocket';
import { formatTime, isValidUrl } from '@utils/index';
import type { ReconOutput, PortScanResult, SubdomainResult } from '@/types';

export function ReconnaissanceView() {
  const [targetUrl, setTargetUrl] = useState('');
  const [isAdding, setIsAdding] = useState(false);

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
    completeScan,
  } = useReconStore();

  const { addToast } = useUIStore();

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

  const handleRemoveTarget = async (id: string) => {
    try {
      await apiService.removeTarget(id);
      removeTarget(id);
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

    try {
      await apiService.startRecon(targetId, enabledTools);
      startScan(targetId);
      enabledTools.forEach((tool) => setToolRunning(tool, true));
      addToast({
        type: 'success',
        message: 'Reconnaissance started',
      });
    } catch (error) {
      addToast({
        type: 'error',
        message: 'Failed to start reconnaissance',
      });
    }
  };

  const handleStopScan = async (targetId: string) => {
    try {
      await apiService.stopRecon(targetId);
      completeScan(targetId);
      tools.forEach((tool) => setToolRunning(tool.name, false));
      addToast({
        type: 'info',
        message: 'Reconnaissance stopped',
      });
    } catch (error) {
      addToast({
        type: 'error',
        message: 'Failed to stop reconnaissance',
      });
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
      </Panel>

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
                  {target.status === 'scanning' ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleStopScan(target.id)}
                    >
                      <Square className="w-3 h-3 mr-1" />
                      Stop
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => handleStartScan(target.id)}
                    >
                      <Play className="w-3 h-3 mr-1" />
                      Scan
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemoveTarget(target.id)}
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
