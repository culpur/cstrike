/**
 * Configuration View - Edit global settings
 */

import { useState, useEffect } from 'react';
import { Save, RefreshCw } from 'lucide-react';
import { Button, Panel, Input } from '@components/ui';
import { useUIStore } from '@stores/uiStore';
import { apiService } from '@services/api';
import type { Config } from '@/types';

const SCAN_MODES = ['port', 'http', 'dns', 'vulnscan', 'web', 'service'];
const ALLOWED_TOOLS = [
  'nmap',
  'subfinder',
  'amass',
  'httpx',
  'nikto',
  'ffuf',
  'sqlmap',
  'nuclei',
  'waybackurls',
  'gau',
  'dnsenum',
];

export function ConfigurationView() {
  const [config, setConfig] = useState<Config>({
    openai_api_key: '',
    allow_exploitation: false,
    scan_modes: ['port', 'http', 'dns'],
    allowed_tools: ['nmap', 'subfinder', 'httpx'],
    max_threads: 10,
    max_runtime: 3600,
    msf_username: 'msf',
    msf_password: '',
    msf_host: 'localhost',
    msf_port: 55553,
    zap_host: 'localhost',
    zap_port: 8080,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const { addToast } = useUIStore();

  // Load configuration on mount
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setIsLoading(true);
    try {
      const data = await apiService.getConfig();
      setConfig(data);
      addToast({
        type: 'success',
        message: 'Configuration loaded',
      });
    } catch (error) {
      console.error('Failed to load configuration:', error);
      addToast({
        type: 'error',
        message: 'Failed to load configuration',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await apiService.updateConfig(config);
      addToast({
        type: 'success',
        message: 'Configuration saved successfully',
      });
    } catch (error) {
      console.error('Failed to save configuration:', error);
      addToast({
        type: 'error',
        message: 'Failed to save configuration',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleScanMode = (mode: string) => {
    setConfig((prev) => ({
      ...prev,
      scan_modes: prev.scan_modes.includes(mode)
        ? prev.scan_modes.filter((m) => m !== mode)
        : [...prev.scan_modes, mode],
    }));
  };

  const toggleTool = (tool: string) => {
    setConfig((prev) => ({
      ...prev,
      allowed_tools: prev.allowed_tools.includes(tool)
        ? prev.allowed_tools.filter((t) => t !== tool)
        : [...prev.allowed_tools, tool],
    }));
  };

  if (isLoading) {
    return (
      <div className="h-full overflow-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <RefreshCw className="w-8 h-8 text-grok-recon-blue animate-spin mx-auto mb-2" />
            <p className="text-grok-text-muted">Loading configuration...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-grok-text-heading">Configuration</h1>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={loadConfig} disabled={isLoading}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Reload
          </Button>
          <Button variant="primary" onClick={handleSave} isLoading={isSaving}>
            <Save className="w-4 h-4 mr-1" />
            Save Configuration
          </Button>
        </div>
      </div>

      {/* API Configuration */}
      <Panel title="API Configuration">
        <div className="space-y-4">
          <Input
            label="OpenAI API Key"
            type="password"
            value={config.openai_api_key}
            onChange={(e) =>
              setConfig({ ...config, openai_api_key: e.target.value })
            }
            placeholder="sk-..."
          />
        </div>
      </Panel>

      {/* Scan Settings */}
      <Panel title="Scan Settings">
        <div className="space-y-6">
          {/* Allow Exploitation Toggle */}
          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={config.allow_exploitation}
                onChange={(e) =>
                  setConfig({ ...config, allow_exploitation: e.target.checked })
                }
                className="w-5 h-5 rounded border-grok-border bg-grok-surface-2 text-grok-recon-blue focus:ring-grok-recon-blue"
              />
              <div>
                <p className="text-sm font-medium text-grok-text-heading">
                  Allow Exploitation
                </p>
                <p className="text-xs text-grok-text-muted">
                  Enable AI to run exploitation tools and attacks
                </p>
              </div>
            </label>
          </div>

          {/* Scan Modes */}
          <div>
            <p className="text-sm font-medium text-grok-text-heading mb-3">
              Scan Modes
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {SCAN_MODES.map((mode) => (
                <label
                  key={mode}
                  className="flex items-center gap-2 px-3 py-2 bg-grok-surface-2 border border-grok-border rounded cursor-pointer hover:bg-grok-surface-3 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={config.scan_modes.includes(mode)}
                    onChange={() => toggleScanMode(mode)}
                    className="rounded border-grok-border bg-grok-surface-2 text-grok-recon-blue focus:ring-grok-recon-blue"
                  />
                  <span className="text-sm text-grok-text-body capitalize">
                    {mode}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Allowed Tools */}
          <div>
            <p className="text-sm font-medium text-grok-text-heading mb-3">
              Allowed Tools
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {ALLOWED_TOOLS.map((tool) => (
                <label
                  key={tool}
                  className="flex items-center gap-2 px-3 py-2 bg-grok-surface-2 border border-grok-border rounded cursor-pointer hover:bg-grok-surface-3 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={config.allowed_tools.includes(tool)}
                    onChange={() => toggleTool(tool)}
                    className="rounded border-grok-border bg-grok-surface-2 text-grok-recon-blue focus:ring-grok-recon-blue"
                  />
                  <span className="text-sm text-grok-text-body font-mono">
                    {tool}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Limits */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Max Threads"
              type="number"
              value={config.max_threads}
              onChange={(e) =>
                setConfig({ ...config, max_threads: parseInt(e.target.value) || 10 })
              }
              min={1}
              max={100}
            />
            <Input
              label="Max Runtime (seconds)"
              type="number"
              value={config.max_runtime}
              onChange={(e) =>
                setConfig({ ...config, max_runtime: parseInt(e.target.value) || 3600 })
              }
              min={60}
              max={86400}
            />
          </div>
        </div>
      </Panel>

      {/* Metasploit Settings */}
      <Panel title="Metasploit RPC Settings">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Host"
            type="text"
            value={config.msf_host}
            onChange={(e) => setConfig({ ...config, msf_host: e.target.value })}
            placeholder="localhost"
          />
          <Input
            label="Port"
            type="number"
            value={config.msf_port}
            onChange={(e) =>
              setConfig({ ...config, msf_port: parseInt(e.target.value) || 55553 })
            }
            min={1}
            max={65535}
          />
          <Input
            label="Username"
            type="text"
            value={config.msf_username}
            onChange={(e) =>
              setConfig({ ...config, msf_username: e.target.value })
            }
            placeholder="msf"
          />
          <Input
            label="Password"
            type="password"
            value={config.msf_password}
            onChange={(e) =>
              setConfig({ ...config, msf_password: e.target.value })
            }
            placeholder="••••••••"
          />
        </div>
      </Panel>

      {/* ZAP Settings */}
      <Panel title="OWASP ZAP Settings">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Host"
            type="text"
            value={config.zap_host}
            onChange={(e) => setConfig({ ...config, zap_host: e.target.value })}
            placeholder="localhost"
          />
          <Input
            label="Port"
            type="number"
            value={config.zap_port}
            onChange={(e) =>
              setConfig({ ...config, zap_port: parseInt(e.target.value) || 8080 })
            }
            min={1}
            max={65535}
          />
        </div>
      </Panel>
    </div>
  );
}
