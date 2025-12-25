/**
 * Scan Results View - Comprehensive visualization of completed reconnaissance scans
 */

import React, { useState } from 'react';
import {
  X,
  Download,
  Shield,
  Globe,
  Server,
  Code,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@components/ui';
import type { CompleteScanResults, VulnerabilityFinding, DetailedPortScanResult, DetailedSubdomainResult } from '@/types';
import { formatTime, formatDuration } from '@utils/index';

interface ScanResultsViewProps {
  results: CompleteScanResults;
  onClose: () => void;
}

export function ScanResultsView({ results, onClose }: ScanResultsViewProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'ports' | 'subdomains' | 'endpoints' | 'vulns' | 'tech'>('overview');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['stats']));

  const toggleSection = (section: string): void => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const handleExportJSON = (): void => {
    const dataStr = JSON.stringify(results, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `scan-results-${results.scanId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCSV = (): void => {
    // Create CSV for vulnerabilities (most important data)
    const headers = ['Severity', 'Title', 'CVE', 'CVSS', 'Component', 'Description'];
    const rows = results.vulnerabilities.map((v) => [
      v.severity,
      v.title,
      v.cve || 'N/A',
      v.cvss?.toString() || 'N/A',
      v.affectedComponent || 'N/A',
      v.description.replace(/,/g, ';'),
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.join(',')),
    ].join('\n');

    const dataBlob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `scan-vulnerabilities-${results.scanId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const getSeverityColor = (severity: VulnerabilityFinding['severity']): string => {
    switch (severity) {
      case 'critical':
        return 'text-red-500 bg-red-500/10 border-red-500';
      case 'high':
        return 'text-orange-500 bg-orange-500/10 border-orange-500';
      case 'medium':
        return 'text-yellow-500 bg-yellow-500/10 border-yellow-500';
      case 'low':
        return 'text-blue-500 bg-blue-500/10 border-blue-500';
      case 'info':
        return 'text-gray-500 bg-gray-500/10 border-gray-500';
    }
  };

  const getSeverityIcon = (severity: VulnerabilityFinding['severity']): React.ReactElement => {
    switch (severity) {
      case 'critical':
      case 'high':
        return <AlertTriangle className="w-4 h-4" />;
      case 'medium':
      case 'low':
        return <Shield className="w-4 h-4" />;
      case 'info':
        return <CheckCircle className="w-4 h-4" />;
    }
  };

  const duration = results.endTime - results.startTime;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-grok-surface-1 rounded-lg border border-grok-border w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="border-b border-grok-border p-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-grok-text-heading">Scan Results</h2>
            <p className="text-sm text-grok-text-muted mt-1">
              {results.target} - Completed {formatTime(results.endTime)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={handleExportJSON}>
              <Download className="w-4 h-4 mr-1" />
              JSON
            </Button>
            <Button size="sm" variant="ghost" onClick={handleExportCSV}>
              <Download className="w-4 h-4 mr-1" />
              CSV
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-grok-border flex gap-1 p-2 bg-grok-surface-2">
          {[
            { id: 'overview', label: 'Overview', icon: Shield },
            { id: 'ports', label: `Ports (${results.stats.openPorts})`, icon: Server },
            { id: 'subdomains', label: `Subdomains (${results.stats.totalSubdomains})`, icon: Globe },
            { id: 'endpoints', label: `Endpoints (${results.stats.totalEndpoints})`, icon: ExternalLink },
            { id: 'vulns', label: `Vulnerabilities (${results.stats.totalVulnerabilities})`, icon: AlertTriangle },
            { id: 'tech', label: `Technologies (${results.technologies.length})`, icon: Code },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as typeof activeTab)}
              className={cn(
                'px-4 py-2 rounded text-sm font-medium transition-all flex items-center gap-2',
                activeTab === id
                  ? 'bg-grok-recon-blue/20 text-grok-recon-blue border border-grok-recon-blue'
                  : 'text-grok-text-muted hover:text-grok-text-heading hover:bg-grok-surface-1'
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  label="Scan Duration"
                  value={formatDuration(duration)}
                  icon={<CheckCircle className="w-5 h-5 text-green-500" />}
                />
                <StatCard
                  label="Tools Used"
                  value={results.toolsUsed.length.toString()}
                  icon={<Server className="w-5 h-5 text-blue-500" />}
                />
                <StatCard
                  label="Total Findings"
                  value={(
                    results.stats.openPorts +
                    results.stats.totalSubdomains +
                    results.stats.totalVulnerabilities
                  ).toString()}
                  icon={<AlertTriangle className="w-5 h-5 text-yellow-500" />}
                />
                <StatCard
                  label="Critical Vulns"
                  value={results.stats.criticalVulns.toString()}
                  icon={<XCircle className="w-5 h-5 text-red-500" />}
                />
              </div>

              {/* Vulnerability Summary */}
              <CollapsibleSection
                title="Vulnerability Summary"
                isExpanded={expandedSections.has('vulns')}
                onToggle={() => toggleSection('vulns')}
              >
                <div className="grid grid-cols-5 gap-3">
                  <VulnStat severity="critical" count={results.stats.criticalVulns} />
                  <VulnStat severity="high" count={results.stats.highVulns} />
                  <VulnStat severity="medium" count={results.stats.mediumVulns} />
                  <VulnStat severity="low" count={results.stats.lowVulns} />
                  <VulnStat
                    severity="info"
                    count={
                      results.stats.totalVulnerabilities -
                      results.stats.criticalVulns -
                      results.stats.highVulns -
                      results.stats.mediumVulns -
                      results.stats.lowVulns
                    }
                  />
                </div>
              </CollapsibleSection>

              {/* Detailed Stats */}
              <CollapsibleSection
                title="Detailed Statistics"
                isExpanded={expandedSections.has('stats')}
                onToggle={() => toggleSection('stats')}
              >
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <DetailStat label="Total Ports Scanned" value={results.stats.totalPorts} />
                  <DetailStat label="Open Ports" value={results.stats.openPorts} color="text-green-500" />
                  <DetailStat label="Total Subdomains" value={results.stats.totalSubdomains} />
                  <DetailStat label="Alive Subdomains" value={results.stats.aliveSubdomains} color="text-green-500" />
                  <DetailStat label="HTTP Endpoints" value={results.stats.totalEndpoints} />
                  <DetailStat label="Technologies Detected" value={results.technologies.length} />
                </div>
              </CollapsibleSection>

              {/* Tools Used */}
              <CollapsibleSection
                title="Tools Used"
                isExpanded={expandedSections.has('tools')}
                onToggle={() => toggleSection('tools')}
              >
                <div className="flex flex-wrap gap-2">
                  {results.toolsUsed.map((tool) => (
                    <span
                      key={tool}
                      className="px-3 py-1 bg-grok-recon-blue/10 border border-grok-recon-blue text-grok-recon-blue rounded-full text-sm font-medium"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </CollapsibleSection>
            </div>
          )}

          {activeTab === 'ports' && (
            <div className="space-y-3">
              {results.ports.length === 0 ? (
                <p className="text-center text-grok-text-muted py-8">No ports discovered</p>
              ) : (
                results.ports.map((port, idx) => (
                  <PortResultCard key={idx} port={port} />
                ))
              )}
            </div>
          )}

          {activeTab === 'subdomains' && (
            <div className="space-y-2">
              {results.subdomains.length === 0 ? (
                <p className="text-center text-grok-text-muted py-8">No subdomains discovered</p>
              ) : (
                results.subdomains.map((subdomain, idx) => (
                  <SubdomainResultCard key={idx} subdomain={subdomain} />
                ))
              )}
            </div>
          )}

          {activeTab === 'endpoints' && (
            <div className="space-y-2">
              {results.httpEndpoints.length === 0 ? (
                <p className="text-center text-grok-text-muted py-8">No HTTP endpoints discovered</p>
              ) : (
                results.httpEndpoints.map((endpoint, idx) => (
                  <EndpointResultCard key={idx} endpoint={endpoint} />
                ))
              )}
            </div>
          )}

          {activeTab === 'vulns' && (
            <div className="space-y-3">
              {results.vulnerabilities.length === 0 ? (
                <p className="text-center text-grok-text-muted py-8">No vulnerabilities identified</p>
              ) : (
                results.vulnerabilities
                  .sort((a, b) => {
                    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
                    return severityOrder[a.severity] - severityOrder[b.severity];
                  })
                  .map((vuln) => (
                    <VulnerabilityCard key={vuln.id} vulnerability={vuln} getSeverityColor={getSeverityColor} getSeverityIcon={getSeverityIcon} />
                  ))
              )}
            </div>
          )}

          {activeTab === 'tech' && (
            <div className="space-y-2">
              {results.technologies.length === 0 ? (
                <p className="text-center text-grok-text-muted py-8">No technologies detected</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {results.technologies.map((tech, idx) => (
                    <TechnologyCard key={idx} technology={tech} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Subcomponents

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactElement;
}

function StatCard({ label, value, icon }: StatCardProps) {
  return (
    <div className="bg-grok-surface-2 border border-grok-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-grok-text-muted uppercase font-medium">{label}</span>
        {icon}
      </div>
      <p className="text-2xl font-bold text-grok-text-heading">{value}</p>
    </div>
  );
}

interface VulnStatProps {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  count: number;
}

function VulnStat({ severity, count }: VulnStatProps) {
  const colors: Record<string, string> = {
    critical: 'bg-red-500/10 border-red-500 text-red-500',
    high: 'bg-orange-500/10 border-orange-500 text-orange-500',
    medium: 'bg-yellow-500/10 border-yellow-500 text-yellow-500',
    low: 'bg-blue-500/10 border-blue-500 text-blue-500',
    info: 'bg-gray-500/10 border-gray-500 text-gray-500',
  };

  return (
    <div className={cn('border rounded-lg p-3 text-center', colors[severity])}>
      <p className="text-2xl font-bold">{count}</p>
      <p className="text-xs uppercase font-medium mt-1">{severity}</p>
    </div>
  );
}

interface DetailStatProps {
  label: string;
  value: number;
  color?: string;
}

function DetailStat({ label, value, color = 'text-grok-text-heading' }: DetailStatProps) {
  return (
    <div className="flex justify-between items-center p-2 bg-grok-surface-2 rounded">
      <span className="text-grok-text-muted">{label}</span>
      <span className={cn('font-semibold', color)}>{value}</span>
    </div>
  );
}

interface CollapsibleSectionProps {
  title: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function CollapsibleSection({ title, isExpanded, onToggle, children }: CollapsibleSectionProps) {
  return (
    <div className="border border-grok-border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 bg-grok-surface-2 hover:bg-grok-surface-1 transition-colors"
      >
        <h3 className="font-semibold text-grok-text-heading">{title}</h3>
        {isExpanded ? (
          <ChevronDown className="w-5 h-5 text-grok-text-muted" />
        ) : (
          <ChevronRight className="w-5 h-5 text-grok-text-muted" />
        )}
      </button>
      {isExpanded && <div className="p-4 bg-grok-surface-1">{children}</div>}
    </div>
  );
}

interface PortResultCardProps {
  port: DetailedPortScanResult;
}

function PortResultCard({ port }: PortResultCardProps) {
  return (
    <div className="bg-grok-surface-2 border border-grok-border rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-grok-text-heading font-mono">
              {port.port}/{port.protocol}
            </span>
            <span className={cn(
              'px-2 py-1 rounded text-xs font-medium',
              port.state === 'open' ? 'bg-green-500/10 text-green-500' : 'bg-gray-500/10 text-gray-500'
            )}>
              {port.state}
            </span>
            {port.service && (
              <span className="text-sm text-grok-text-muted">
                {port.service} {port.version && `(${port.version})`}
              </span>
            )}
          </div>
          {port.banner && (
            <p className="mt-2 text-xs font-mono text-grok-text-muted bg-grok-void p-2 rounded">
              {port.banner}
            </p>
          )}
          {port.cpe && port.cpe.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {port.cpe.map((cpe, idx) => (
                <span key={idx} className="text-xs px-2 py-1 bg-grok-recon-blue/10 text-grok-recon-blue rounded">
                  {cpe}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface SubdomainResultCardProps {
  subdomain: DetailedSubdomainResult;
}

function SubdomainResultCard({ subdomain }: SubdomainResultCardProps) {
  return (
    <div className="bg-grok-surface-2 border border-grok-border rounded-lg p-3 flex items-center justify-between">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-grok-text-heading">{subdomain.subdomain}</span>
          {subdomain.alive !== undefined && (
            <span className={cn(
              'w-2 h-2 rounded-full',
              subdomain.alive ? 'bg-green-500' : 'bg-gray-500'
            )} />
          )}
          {subdomain.httpStatus && (
            <span className="text-xs text-grok-text-muted">HTTP {subdomain.httpStatus}</span>
          )}
        </div>
        {subdomain.ipAddresses && subdomain.ipAddresses.length > 0 && (
          <p className="text-xs text-grok-text-muted mt-1">
            {subdomain.ipAddresses.join(', ')}
          </p>
        )}
      </div>
      <span className="text-xs text-grok-text-muted">{subdomain.source}</span>
    </div>
  );
}

interface EndpointResultCardProps {
  endpoint: import('@/types').HttpEndpoint;
}

function EndpointResultCard({ endpoint }: EndpointResultCardProps) {
  const [showHeaders, setShowHeaders] = useState(false);

  return (
    <div className="bg-grok-surface-2 border border-grok-border rounded-lg p-3">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn(
              'px-2 py-1 rounded text-xs font-medium font-mono',
              endpoint.statusCode >= 200 && endpoint.statusCode < 300
                ? 'bg-green-500/10 text-green-500'
                : endpoint.statusCode >= 400
                  ? 'bg-red-500/10 text-red-500'
                  : 'bg-yellow-500/10 text-yellow-500'
            )}>
              {endpoint.statusCode}
            </span>
            <a
              href={endpoint.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-grok-recon-blue hover:underline truncate flex items-center gap-1"
            >
              {endpoint.url}
              <ExternalLink className="w-3 h-3 flex-shrink-0" />
            </a>
          </div>
          {endpoint.title && (
            <p className="text-xs text-grok-text-muted mt-1 truncate">{endpoint.title}</p>
          )}
          {endpoint.technologies && endpoint.technologies.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {endpoint.technologies.map((tech, idx) => (
                <span key={idx} className="text-xs px-2 py-1 bg-grok-recon-blue/10 text-grok-recon-blue rounded">
                  {tech}
                </span>
              ))}
            </div>
          )}
          {endpoint.headers && (
            <button
              onClick={() => setShowHeaders(!showHeaders)}
              className="text-xs text-grok-text-muted hover:text-grok-text-heading mt-2"
            >
              {showHeaders ? 'Hide' : 'Show'} Headers
            </button>
          )}
          {showHeaders && endpoint.headers && (
            <div className="mt-2 bg-grok-void p-2 rounded text-xs font-mono">
              {Object.entries(endpoint.headers).map(([key, value]) => (
                <div key={key} className="text-grok-text-muted">
                  <span className="text-grok-recon-blue">{key}:</span> {value}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface VulnerabilityCardProps {
  vulnerability: VulnerabilityFinding;
  getSeverityColor: (severity: VulnerabilityFinding['severity']) => string;
  getSeverityIcon: (severity: VulnerabilityFinding['severity']) => React.ReactElement;
}

function VulnerabilityCard({ vulnerability, getSeverityColor, getSeverityIcon }: VulnerabilityCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={cn('border rounded-lg overflow-hidden', getSeverityColor(vulnerability.severity))}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 flex items-start gap-3 hover:bg-grok-surface-2 transition-colors"
      >
        <div className="flex-shrink-0 mt-1">
          {getSeverityIcon(vulnerability.severity)}
        </div>
        <div className="flex-1 text-left">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-semibold text-grok-text-heading">{vulnerability.title}</h4>
            <div className="flex items-center gap-2 flex-shrink-0">
              {vulnerability.cvss && (
                <span className="text-xs font-mono px-2 py-1 bg-grok-void rounded">
                  CVSS: {vulnerability.cvss}
                </span>
              )}
              {vulnerability.cve && (
                <span className="text-xs font-mono px-2 py-1 bg-grok-void rounded">
                  {vulnerability.cve}
                </span>
              )}
            </div>
          </div>
          {vulnerability.affectedComponent && (
            <p className="text-xs text-grok-text-muted mt-1">
              Component: {vulnerability.affectedComponent}
            </p>
          )}
        </div>
        {isExpanded ? (
          <ChevronDown className="w-5 h-5 text-grok-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight className="w-5 h-5 text-grok-text-muted flex-shrink-0" />
        )}
      </button>
      {isExpanded && (
        <div className="border-t border-current/20 p-4 bg-grok-surface-1 space-y-3">
          <div>
            <h5 className="text-xs font-semibold text-grok-text-muted uppercase mb-1">Description</h5>
            <p className="text-sm text-grok-text-body">{vulnerability.description}</p>
          </div>
          {vulnerability.remediation && (
            <div>
              <h5 className="text-xs font-semibold text-grok-text-muted uppercase mb-1">Remediation</h5>
              <p className="text-sm text-grok-text-body">{vulnerability.remediation}</p>
            </div>
          )}
          {vulnerability.references && vulnerability.references.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-grok-text-muted uppercase mb-1">References</h5>
              <ul className="text-sm space-y-1">
                {vulnerability.references.map((ref, idx) => (
                  <li key={idx}>
                    <a
                      href={ref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-grok-recon-blue hover:underline flex items-center gap-1"
                    >
                      {ref}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface TechnologyCardProps {
  technology: import('@/types').DetectedTechnology;
}

function TechnologyCard({ technology }: TechnologyCardProps) {
  return (
    <div className="bg-grok-surface-2 border border-grok-border rounded-lg p-3">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h4 className="font-semibold text-grok-text-heading">
            {technology.name}
            {technology.version && (
              <span className="text-grok-text-muted font-normal ml-2">v{technology.version}</span>
            )}
          </h4>
          <p className="text-xs text-grok-text-muted mt-1">{technology.category}</p>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-16 bg-grok-void rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-grok-recon-blue"
              style={{ width: `${technology.confidence * 100}%` }}
            />
          </div>
          <span className="text-xs text-grok-text-muted">{Math.round(technology.confidence * 100)}%</span>
        </div>
      </div>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
