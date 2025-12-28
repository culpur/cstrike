/**
 * Results View - Browse completed scan results for all targets
 */

import { useState, useEffect } from 'react';
import { Download, RefreshCw, ChevronRight, AlertCircle } from 'lucide-react';
import { Button, Panel } from '@components/ui';
import { useUIStore } from '@stores/uiStore';
import { apiService } from '@services/api';
import { formatTime, cn } from '@utils/index';
import type { Target, CompleteScanResults } from '@/types';

export function ResultsView() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [results, setResults] = useState<CompleteScanResults | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const { addToast } = useUIStore();

  useEffect(() => {
    loadTargets();
  }, []);

  const loadTargets = async () => {
    setIsLoading(true);
    try {
      const data = await apiService.getResults();
      setTargets(data);
    } catch (error) {
      console.error('Failed to load results:', error);
      addToast({
        type: 'error',
        message: 'Failed to load results',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadTargetResults = async (target: string) => {
    setSelectedTarget(target);
    setIsLoadingResults(true);
    try {
      const data = await apiService.getTargetResults(target);
      setResults(data);
    } catch (error) {
      console.error('Failed to load target results:', error);
      addToast({
        type: 'error',
        message: 'Failed to load target results',
      });
      setResults(null);
    } finally {
      setIsLoadingResults(false);
    }
  };

  const handleDownload = async (format: 'json' | 'markdown') => {
    if (!selectedTarget) return;

    try {
      const blob = await apiService.downloadResults(selectedTarget, format);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedTarget}-results.${format === 'json' ? 'json' : 'md'}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      addToast({
        type: 'success',
        message: `Results downloaded as ${format.toUpperCase()}`,
      });
    } catch (error) {
      console.error('Failed to download results:', error);
      addToast({
        type: 'error',
        message: 'Failed to download results',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="h-full overflow-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <RefreshCw className="w-8 h-8 text-grok-recon-blue animate-spin mx-auto mb-2" />
            <p className="text-grok-text-muted">Loading results...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-grok-text-heading">Results Browser</h1>
        <Button variant="secondary" onClick={loadTargets}>
          <RefreshCw className="w-4 h-4 mr-1" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Target List */}
        <div className="lg:col-span-1">
          <Panel title={`Targets (${targets.length})`} noPadding>
            <div className="divide-y divide-grok-border max-h-[700px] overflow-y-auto">
              {targets.length === 0 ? (
                <div className="p-6 text-center text-grok-text-muted">
                  No scan results available
                </div>
              ) : (
                targets.map((target) => (
                  <button
                    key={target.id}
                    onClick={() => loadTargetResults(target.url)}
                    className={cn(
                      'w-full text-left p-4 hover:bg-grok-surface-2 transition-colors',
                      selectedTarget === target.url && 'bg-grok-surface-2'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-grok-text-heading truncate">
                          {target.url}
                        </p>
                        <p className="text-xs text-grok-text-muted mt-1">
                          {formatTime(target.addedAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 ml-2">
                        <StatusBadge status={target.status} />
                        <ChevronRight className="w-4 h-4 text-grok-text-muted" />
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </Panel>
        </div>

        {/* Detailed Results Panel */}
        <div className="lg:col-span-2">
          {!selectedTarget ? (
            <Panel title="Select a Target">
              <div className="text-center py-12">
                <AlertCircle className="w-12 h-12 text-grok-text-muted mx-auto mb-3" />
                <p className="text-grok-text-muted">
                  Select a target from the list to view detailed results
                </p>
              </div>
            </Panel>
          ) : isLoadingResults ? (
            <Panel title={selectedTarget}>
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-8 h-8 text-grok-recon-blue animate-spin" />
              </div>
            </Panel>
          ) : results ? (
            <div className="space-y-4">
              {/* Header with Download Buttons */}
              <Panel
                title={selectedTarget}
                action={
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleDownload('json')}
                    >
                      <Download className="w-3 h-3 mr-1" />
                      JSON
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleDownload('markdown')}
                    >
                      <Download className="w-3 h-3 mr-1" />
                      Markdown
                    </Button>
                  </div>
                }
              >
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <MetricCard
                    label="Total Ports"
                    value={results.stats?.totalPorts || 0}
                  />
                  <MetricCard
                    label="Open Ports"
                    value={results.stats?.openPorts || 0}
                    color="text-grok-success"
                  />
                  <MetricCard
                    label="Subdomains"
                    value={results.stats?.totalSubdomains || 0}
                  />
                  <MetricCard
                    label="Vulnerabilities"
                    value={results.stats?.totalVulnerabilities || 0}
                    color="text-grok-exploit-red"
                  />
                </div>
              </Panel>

              {/* Ports Discovered */}
              {results.ports && results.ports.length > 0 && (
                <Panel title={`Ports Discovered (${results.ports.length})`} noPadding>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-grok-surface-2 border-b border-grok-border">
                        <tr>
                          <th className="px-4 py-2 text-left text-grok-text-muted font-medium">
                            Port
                          </th>
                          <th className="px-4 py-2 text-left text-grok-text-muted font-medium">
                            Protocol
                          </th>
                          <th className="px-4 py-2 text-left text-grok-text-muted font-medium">
                            State
                          </th>
                          <th className="px-4 py-2 text-left text-grok-text-muted font-medium">
                            Service
                          </th>
                          <th className="px-4 py-2 text-left text-grok-text-muted font-medium">
                            Version
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-grok-border">
                        {results.ports.map((port, idx) => (
                          <tr key={idx} className="hover:bg-grok-surface-1">
                            <td className="px-4 py-2 font-mono text-grok-text-heading">
                              {port.port}
                            </td>
                            <td className="px-4 py-2 text-grok-text-body">
                              {port.protocol}
                            </td>
                            <td className="px-4 py-2">
                              <span
                                className={cn(
                                  'px-2 py-0.5 rounded text-xs font-medium',
                                  port.state === 'open'
                                    ? 'bg-green-500/20 text-green-400'
                                    : 'bg-gray-500/20 text-gray-400'
                                )}
                              >
                                {port.state}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-grok-text-body">
                              {port.service || '-'}
                            </td>
                            <td className="px-4 py-2 text-grok-text-muted text-xs">
                              {port.version || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              )}

              {/* Subdomains Discovered */}
              {results.subdomains && results.subdomains.length > 0 && (
                <Panel
                  title={`Subdomains Discovered (${results.subdomains.length})`}
                  noPadding
                >
                  <div className="max-h-64 overflow-y-auto">
                    <div className="divide-y divide-grok-border">
                      {results.subdomains.map((subdomain, idx) => (
                        <div key={idx} className="px-4 py-2 hover:bg-grok-surface-1">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-grok-text-body font-mono">
                              {subdomain.subdomain}
                            </span>
                            {subdomain.alive && (
                              <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400">
                                ALIVE
                              </span>
                            )}
                          </div>
                          {subdomain.ipAddresses && subdomain.ipAddresses.length > 0 && (
                            <p className="text-xs text-grok-text-muted mt-1">
                              {subdomain.ipAddresses.join(', ')}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </Panel>
              )}

              {/* HTTP Endpoints */}
              {results.httpEndpoints && results.httpEndpoints.length > 0 && (
                <Panel
                  title={`HTTP Endpoints (${results.httpEndpoints.length})`}
                  noPadding
                >
                  <div className="max-h-64 overflow-y-auto divide-y divide-grok-border">
                    {results.httpEndpoints.map((endpoint, idx) => (
                      <div key={idx} className="px-4 py-3 hover:bg-grok-surface-1">
                        <div className="flex items-center justify-between mb-1">
                          <a
                            href={endpoint.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-grok-recon-blue hover:underline font-mono"
                          >
                            {endpoint.url}
                          </a>
                          <span className="text-xs text-grok-text-muted">
                            {endpoint.statusCode}
                          </span>
                        </div>
                        {endpoint.title && (
                          <p className="text-xs text-grok-text-body truncate">
                            {endpoint.title}
                          </p>
                        )}
                        {endpoint.technologies && endpoint.technologies.length > 0 && (
                          <div className="flex gap-1 mt-2 flex-wrap">
                            {endpoint.technologies.map((tech, i) => (
                              <span
                                key={i}
                                className="px-2 py-0.5 rounded text-xs bg-grok-surface-3 text-grok-text-muted"
                              >
                                {tech}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              {/* Technologies Detected */}
              {results.technologies && results.technologies.length > 0 && (
                <Panel title="Technologies Detected">
                  <div className="flex flex-wrap gap-2">
                    {results.technologies.map((tech, idx) => (
                      <div
                        key={idx}
                        className="px-3 py-2 bg-grok-surface-2 border border-grok-border rounded"
                      >
                        <p className="text-sm font-medium text-grok-text-heading">
                          {tech.name}
                          {tech.version && (
                            <span className="text-grok-text-muted ml-1">
                              v{tech.version}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-grok-text-muted mt-0.5">
                          {tech.category}
                        </p>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              {/* Vulnerabilities */}
              {results.vulnerabilities && results.vulnerabilities.length > 0 && (
                <Panel
                  title={`Vulnerabilities (${results.vulnerabilities.length})`}
                  noPadding
                >
                  <div className="divide-y divide-grok-border">
                    {results.vulnerabilities.map((vuln) => (
                      <div key={vuln.id} className="p-4 hover:bg-grok-surface-1">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="text-sm font-medium text-grok-text-heading">
                              {vuln.title}
                            </h4>
                            <p className="text-xs text-grok-text-body mt-1">
                              {vuln.description}
                            </p>
                            {vuln.cve && (
                              <p className="text-xs text-grok-text-muted mt-1 font-mono">
                                {vuln.cve}
                              </p>
                            )}
                          </div>
                          <SeverityBadge severity={vuln.severity} />
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}
            </div>
          ) : (
            <Panel title={selectedTarget}>
              <div className="text-center py-12">
                <AlertCircle className="w-12 h-12 text-grok-text-muted mx-auto mb-3" />
                <p className="text-grok-text-muted">No results available for this target</p>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors = {
    pending: 'bg-gray-500/20 text-gray-400',
    scanning: 'bg-blue-500/20 text-blue-400',
    complete: 'bg-green-500/20 text-green-400',
    failed: 'bg-red-500/20 text-red-400',
  };

  return (
    <span
      className={cn(
        'px-2 py-0.5 rounded text-xs font-medium',
        colors[status as keyof typeof colors] || colors.pending
      )}
    >
      {status.toUpperCase()}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors = {
    critical: 'bg-red-900/30 text-red-400 border-red-700',
    high: 'bg-orange-900/30 text-orange-400 border-orange-700',
    medium: 'bg-yellow-900/30 text-yellow-400 border-yellow-700',
    low: 'bg-blue-900/30 text-blue-400 border-blue-700',
    info: 'bg-gray-900/30 text-gray-400 border-gray-700',
  };

  return (
    <span
      className={cn(
        'px-2 py-1 rounded text-xs font-medium border',
        colors[severity as keyof typeof colors] || colors.info
      )}
    >
      {severity.toUpperCase()}
    </span>
  );
}

function MetricCard({
  label,
  value,
  color = 'text-grok-text-heading',
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="bg-grok-surface-2 border border-grok-border rounded p-3">
      <p className="text-xs text-grok-text-muted uppercase tracking-wide mb-1">
        {label}
      </p>
      <p className={cn('text-2xl font-bold', color)}>{value}</p>
    </div>
  );
}
