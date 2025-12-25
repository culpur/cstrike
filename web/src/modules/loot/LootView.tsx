/**
 * Loot View - Display collected credentials, URLs, ports, etc.
 */

import { useState, useEffect } from 'react';
import { Download, Check, X, Clock, Target } from 'lucide-react';
import { Button, Panel, Input } from '@components/ui';
import { useLootStore } from '@stores/lootStore';
import { useReconStore } from '@stores/reconStore';
import { useUIStore } from '@stores/uiStore';
import { wsService } from '@services/websocket';
import { apiService } from '@services/api';
import { formatDateTime, exportAsJson, exportAsCsv } from '@utils/index';
import type { LootItem, LootCategory } from '@/types';

export function LootView() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<LootCategory | 'all'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [validating, setValidating] = useState<Set<string>>(new Set());

  const { items, credentials, stats, addLootItem, validateCredential } =
    useLootStore();
  const { targets } = useReconStore();
  const { addToast } = useUIStore();

  // Load existing loot for all targets on mount
  useEffect(() => {
    const loadLoot = async () => {
      setIsLoading(true);
      try {
        // Load loot for all known targets
        const lootPromises = targets.map((target) =>
          apiService.getLoot(target.url).catch((err) => {
            console.error(`Failed to load loot for ${target.url}:`, err);
            return [];
          })
        );

        // Also load loot for 'all' (global loot)
        lootPromises.push(
          apiService.getLoot('all').catch((err) => {
            console.error('Failed to load global loot:', err);
            return [];
          })
        );

        const allLoot = await Promise.all(lootPromises);

        // Flatten and add all loot items
        allLoot.flat().forEach((item) => {
          addLootItem(item);
        });

        // Load credentials
        try {
          const creds = await apiService.getCredentials();
          // Add credentials to store if needed
          console.log('Loaded credentials:', creds);
        } catch (error) {
          console.error('Failed to load credentials:', error);
        }
      } catch (error) {
        console.error('Failed to load loot:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadLoot();
  }, [targets, addLootItem]);

  // Setup WebSocket listeners
  useEffect(() => {
    const unsubLoot = wsService.on<LootItem>('loot_item', (data: any) => {
      // Handle different loot_item events
      if (data.event === 'credential_validated') {
        const { credential_id, result } = data;

        // Update credential validation state
        validateCredential(credential_id, result.valid);

        // Remove from validating set
        setValidating((prev) => {
          const next = new Set(prev);
          next.delete(credential_id);
          return next;
        });

        // Show toast notification
        addToast({
          type: result.valid ? 'success' : 'warning',
          message: result.valid
            ? `Credential validated: ${result.username}@${result.target}`
            : `Invalid credential: ${result.username}@${result.target}`,
        });
      } else if (data.event === 'batch_validation_complete') {
        addToast({
          type: 'success',
          message: `Batch validation complete: ${data.valid}/${data.total} valid`,
        });
      } else {
        // Regular loot item
        addLootItem(data);
      }
    });

    return () => {
      unsubLoot();
    };
  }, [addLootItem, validateCredential, addToast]);

  const handleExportJson = () => {
    exportAsJson({ items, credentials, stats }, `cstrike-loot-${Date.now()}`);
    addToast({
      type: 'success',
      message: 'Loot exported as JSON',
    });
  };

  const handleExportCsv = () => {
    const data = items.map((item) => ({
      category: item.category,
      value: item.value,
      source: item.source,
      target: item.target,
      timestamp: new Date(item.timestamp).toISOString(),
    }));

    exportAsCsv(data, `cstrike-loot-${Date.now()}`);
    addToast({
      type: 'success',
      message: 'Loot exported as CSV',
    });
  };

  const handleValidateCredential = async (cred: any) => {
    try {
      // Add to validating set
      setValidating((prev) => new Set(prev).add(cred.id));

      // Infer service from port if available, otherwise default to SSH
      let service = 'ssh';
      if (cred.port) {
        const portMap: Record<number, string> = {
          22: 'ssh',
          21: 'ftp',
          23: 'telnet',
          3389: 'rdp',
          445: 'smb',
          80: 'http',
          443: 'https',
        };
        service = portMap[cred.port] || 'ssh';
      }

      await apiService.validateCredential(
        cred.id,
        cred.target,
        cred.username,
        cred.password,
        service,
        cred.port
      );

      addToast({
        type: 'info',
        message: 'Credential validation started',
      });
    } catch (error) {
      // Remove from validating set on error
      setValidating((prev) => {
        const next = new Set(prev);
        next.delete(cred.id);
        return next;
      });

      addToast({
        type: 'error',
        message: 'Failed to start credential validation',
      });
    }
  };

  const handleValidateAll = async () => {
    try {
      const credentialsToValidate = credentials
        .filter((cred) => !cred.validated)
        .map((cred) => {
          // Infer service from port if available
          let service = 'ssh';
          if (cred.port) {
            const portMap: Record<number, string> = {
              22: 'ssh',
              21: 'ftp',
              23: 'telnet',
              3389: 'rdp',
              445: 'smb',
              80: 'http',
              443: 'https',
            };
            service = portMap[cred.port as number] || 'ssh';
          }

          return {
            credential_id: cred.id,
            target: cred.target,
            username: cred.username,
            password: cred.password,
            service,
            port: cred.port as number | undefined,
          };
        });

      if (credentialsToValidate.length === 0) {
        addToast({
          type: 'info',
          message: 'No credentials to validate',
        });
        return;
      }

      // Add all to validating set
      setValidating((prev) => {
        const next = new Set(prev);
        credentialsToValidate.forEach((c) => next.add(c.credential_id));
        return next;
      });

      await apiService.validateCredentialsBatch(credentialsToValidate);

      addToast({
        type: 'success',
        message: `Batch validation started for ${credentialsToValidate.length} credentials`,
      });
    } catch (error) {
      addToast({
        type: 'error',
        message: 'Failed to start batch validation',
      });
    }
  };

  // Filter items
  const filteredItems = items.filter((item) => {
    if (selectedCategory !== 'all' && item.category !== selectedCategory) {
      return false;
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        item.value.toLowerCase().includes(query) ||
        item.source.toLowerCase().includes(query) ||
        item.target.toLowerCase().includes(query)
      );
    }

    return true;
  });

  const categories: Array<{ key: LootCategory | 'all'; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'credential', label: 'Credentials' },
    { key: 'username', label: 'Usernames' },
    { key: 'password', label: 'Passwords' },
    { key: 'hash', label: 'Hashes' },
    { key: 'url', label: 'URLs' },
    { key: 'port', label: 'Ports' },
    { key: 'file', label: 'Files' },
  ];

  const unvalidatedCount = credentials.filter((c) => !c.validated).length;

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-grok-text-heading">Loot Tracker</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleExportCsv}>
            <Download className="w-4 h-4 mr-1" />
            CSV
          </Button>
          <Button variant="secondary" onClick={handleExportJson}>
            <Download className="w-4 h-4 mr-1" />
            JSON
          </Button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Items" value={stats.totalItems} />
        <StatCard label="Unique Targets" value={stats.uniqueTargets} />
        <StatCard
          label="Validated Credentials"
          value={stats.validatedCredentials}
          variant="success"
        />
        <StatCard
          label="Credentials"
          value={stats.byCategory.credential || 0}
          variant="warning"
        />
      </div>

      {/* Filters */}
      <Panel title="Filters">
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {categories.map((cat) => (
              <button
                key={cat.key}
                onClick={() => setSelectedCategory(cat.key)}
                className={cn(
                  'px-3 py-1.5 rounded text-sm font-medium transition-colors',
                  selectedCategory === cat.key
                    ? 'bg-grok-loot-green text-white'
                    : 'bg-grok-surface-2 text-grok-text-body hover:bg-grok-surface-3'
                )}
              >
                {cat.label}
                {cat.key !== 'all' && (
                  <span className="ml-1.5 text-xs opacity-75">
                    ({stats.byCategory[cat.key as LootCategory] || 0})
                  </span>
                )}
              </button>
            ))}
          </div>
          <Input
            placeholder="Search loot..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </Panel>

      {/* Credentials Table */}
      {credentials.length > 0 && (
        <Panel
          title={`Credentials (${credentials.length})`}
          action={
            unvalidatedCount > 0 && (
              <Button
                size="sm"
                variant="primary"
                onClick={handleValidateAll}
                disabled={validating.size > 0}
              >
                <Target className="w-4 h-4 mr-1" />
                Test All ({unvalidatedCount})
              </Button>
            )
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-grok-border">
                <tr className="text-left text-grok-text-muted">
                  <th className="pb-2 pr-4">Username</th>
                  <th className="pb-2 pr-4">Password</th>
                  <th className="pb-2 pr-4">Target</th>
                  <th className="pb-2 pr-4">Source</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-grok-border">
                {credentials.slice(-50).reverse().map((cred) => {
                  const isValidating = validating.has(cred.id);

                  return (
                    <tr key={cred.id} className="text-grok-text-body">
                      <td className="py-2 pr-4 font-mono">{cred.username}</td>
                      <td className="py-2 pr-4 font-mono">
                        {'*'.repeat(Math.min(cred.password.length, 12))}
                      </td>
                      <td className="py-2 pr-4">{cred.target}</td>
                      <td className="py-2 pr-4 text-grok-text-muted">{cred.source}</td>
                      <td className="py-2 pr-4">
                        {isValidating ? (
                          <span className="flex items-center gap-1 text-grok-warning">
                            <Clock className="w-3 h-3 animate-spin" />
                            Testing...
                          </span>
                        ) : cred.validated ? (
                          <span className="flex items-center gap-1 text-grok-success">
                            <Check className="w-3 h-3" />
                            Valid
                          </span>
                        ) : cred.validated === false ? (
                          <span className="flex items-center gap-1 text-grok-error">
                            <X className="w-3 h-3" />
                            Invalid
                          </span>
                        ) : (
                          <span className="text-grok-text-muted">Not tested</span>
                        )}
                      </td>
                      <td className="py-2">
                        {!cred.validated && !isValidating && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleValidateCredential(cred)}
                          >
                            Test
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Loot Items */}
      <Panel title={`Items (${filteredItems.length})`}>
        {isLoading ? (
          <p className="text-sm text-grok-text-muted text-center py-8">
            Loading loot...
          </p>
        ) : filteredItems.length === 0 ? (
          <p className="text-sm text-grok-text-muted text-center py-8">
            No loot items found
          </p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {filteredItems.slice(-100).reverse().map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 bg-grok-surface-2 rounded border border-grok-border"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-2 py-0.5 bg-grok-loot-green/20 text-grok-loot-green rounded">
                      {item.category}
                    </span>
                    <span className="text-xs text-grok-text-muted">
                      {formatDateTime(item.timestamp)}
                    </span>
                  </div>
                  <p className="text-sm text-grok-text-heading font-mono truncate">
                    {item.value}
                  </p>
                  <p className="text-xs text-grok-text-muted mt-1">
                    Target: {item.target} • Source: {item.source}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function StatCard({
  label,
  value,
  variant = 'default',
}: {
  label: string;
  value: number;
  variant?: 'default' | 'success' | 'warning';
}) {
  const colors = {
    default: 'text-grok-text-heading',
    success: 'text-grok-success',
    warning: 'text-grok-warning',
  };

  return (
    <div className="bg-grok-surface-1 border border-grok-border rounded-lg p-4">
      <p className="text-xs text-grok-text-muted uppercase tracking-wide mb-1">
        {label}
      </p>
      <p className={cn('text-2xl font-semibold', colors[variant])}>{value}</p>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
