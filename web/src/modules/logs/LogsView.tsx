/**
 * Logs View - Live log streaming with filtering
 */

import { useState, useEffect, useRef } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { Button, Panel } from '@components/ui';
import { useLogStore } from '@stores/logStore';
import { useUIStore } from '@stores/uiStore';
import { wsService } from '@services/websocket';
import { formatTime, getLogLevelColor, exportAsJson, exportAsCsv } from '@utils/index';
import { apiService } from '@services/api';
import type { LogEntry, LogLevel } from '@/types';

export function LogsView() {
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const { logs, filter, addLog, setFilter, clearLogs, getFilteredLogs } = useLogStore();
  const { addToast } = useUIStore();

  const filteredLogs = getFilteredLogs();

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredLogs, autoScroll]);

  // Setup WebSocket listeners
  useEffect(() => {
    const unsubLog = wsService.on<LogEntry>('log_entry', (data) => {
      addLog(data);
    });

    return () => {
      unsubLog();
    };
  }, [addLog]);

  // Load initial logs on mount
  useEffect(() => {
    const loadInitialLogs = async () => {
      try {
        const logs = await apiService.getLogs(1000);
        logs.forEach(log => addLog(log));
      } catch (error) {
        console.error('Failed to load initial logs:', error);
      }
    };

    loadInitialLogs();
  }, [addLog]);

  const handleExportJson = () => {
    exportAsJson(filteredLogs, `cstrike-logs-${Date.now()}`);
    addToast({ type: 'success', message: 'Logs exported as JSON' });
  };

  const handleExportCsv = () => {
    const csvData = filteredLogs.map(log => ({
      timestamp: formatTime(log.timestamp),
      level: log.level,
      source: log.source,
      message: log.message,
    }));
    exportAsCsv(csvData, `cstrike-logs-${Date.now()}`);
    addToast({ type: 'success', message: 'Logs exported as CSV' });
  };

  const handleClearLogs = () => {
    clearLogs();
    addToast({
      type: 'info',
      message: 'Logs cleared',
    });
  };

  const toggleLevel = (level: LogLevel) => {
    const newLevels = filter.levels.includes(level)
      ? filter.levels.filter((l) => l !== level)
      : [...filter.levels, level];
    setFilter({ levels: newLevels });
  };

  const levels: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'];

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-grok-text-heading">Live Logs</h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-grok-text-body cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-grok-border bg-grok-surface-2"
            />
            Auto-scroll
          </label>
          <Button variant="secondary" onClick={handleExportJson}>
            <Download className="w-4 h-4 mr-1" />
            Export JSON
          </Button>
          <Button variant="secondary" onClick={handleExportCsv}>
            <Download className="w-4 h-4 mr-1" />
            Export CSV
          </Button>
          <Button variant="danger" onClick={handleClearLogs}>
            <Trash2 className="w-4 h-4 mr-1" />
            Clear
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Panel title="Filters">
        <div className="space-y-4">
          <div>
            <p className="text-xs text-grok-text-muted mb-2 uppercase tracking-wide">
              Log Levels
            </p>
            <div className="flex gap-2 flex-wrap">
              {levels.map((level) => (
                <button
                  key={level}
                  onClick={() => toggleLevel(level)}
                  className={cn(
                    'px-3 py-1.5 rounded text-sm font-medium transition-colors border',
                    filter.levels.includes(level)
                      ? 'border-current opacity-100'
                      : 'border-grok-border opacity-40',
                    getLogLevelColor(level)
                  )}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <div>
            <input
              type="text"
              placeholder="Search logs..."
              value={filter.searchQuery}
              onChange={(e) => setFilter({ searchQuery: e.target.value })}
              className="w-full px-3 py-2 bg-grok-surface-2 border border-grok-border rounded text-sm text-grok-text-body placeholder:text-grok-text-muted focus:outline-none focus:ring-2 focus:ring-grok-recon-blue"
            />
          </div>

          <div>
            <p className="text-xs text-grok-text-muted mb-2 uppercase tracking-wide">
              Sources
            </p>
            <div className="flex gap-2 flex-wrap">
              {['system', 'recon', 'ai', 'exploit', 'metasploit', 'zap'].map((source) => (
                <button
                  key={source}
                  onClick={() => {
                    const newSources = filter.sources.includes(source)
                      ? filter.sources.filter((s) => s !== source)
                      : [...filter.sources, source];
                    setFilter({ sources: newSources });
                  }}
                  className={cn(
                    'px-3 py-1.5 rounded text-sm font-medium transition-colors border',
                    filter.sources.length === 0 || filter.sources.includes(source)
                      ? 'border-grok-recon-blue text-grok-recon-blue'
                      : 'border-grok-border text-grok-text-muted opacity-40'
                  )}
                >
                  {source}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <LogStat label="Total" value={logs.length} />
        <LogStat label="Filtered" value={filteredLogs.length} />
        <LogStat
          label="Debug"
          value={logs.filter((l) => l.level === 'DEBUG').length}
          color="text-grok-text-muted"
        />
        <LogStat
          label="Info"
          value={logs.filter((l) => l.level === 'INFO').length}
          color="text-grok-info"
        />
        <LogStat
          label="Warnings"
          value={logs.filter((l) => l.level === 'WARN').length}
          color="text-grok-warning"
        />
        <LogStat
          label="Errors"
          value={logs.filter((l) => l.level === 'ERROR' || l.level === 'CRITICAL').length}
          color="text-grok-error"
        />
      </div>

      {/* Log Stream */}
      <Panel title={`Log Stream (${filteredLogs.length})`} noPadding>
        <div className="h-[600px] overflow-y-auto p-4 bg-grok-void font-mono text-xs">
          {filteredLogs.length === 0 ? (
            <p className="text-grok-text-muted text-center py-8">No logs to display</p>
          ) : (
            <div className="space-y-0.5">
              {filteredLogs.map((log) => (
                <LogLine key={log.id} log={log} />
              ))}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

function LogLine({ log }: { log: LogEntry }) {
  const levelColor = getLogLevelColor(log.level);

  return (
    <div className="flex gap-2 hover:bg-grok-surface-1 py-0.5 px-2 -mx-2 rounded">
      <span className="text-grok-text-muted flex-shrink-0">
        [{formatTime(log.timestamp)}]
      </span>
      <span className={cn('flex-shrink-0 w-20', levelColor)}>
        [{log.level.padEnd(8)}]
      </span>
      <span className="text-grok-recon-blue flex-shrink-0 w-32 truncate">
        [{log.source}]
      </span>
      <span className="text-grok-text-body flex-1">{log.message}</span>
    </div>
  );
}

function LogStat({
  label,
  value,
  color = 'text-grok-text-heading',
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="bg-grok-surface-1 border border-grok-border rounded p-3">
      <p className="text-xs text-grok-text-muted uppercase tracking-wide mb-1">
        {label}
      </p>
      <p className={cn('text-lg font-semibold', color)}>{value}</p>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
