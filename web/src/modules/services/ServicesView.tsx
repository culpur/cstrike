/**
 * Services View - Control Metasploit, ZAP, and Burp Suite
 */

import { useEffect } from 'react';
import { Play, Square, RefreshCw } from 'lucide-react';
import { Button, Panel, StatusBadge } from '@components/ui';
import { useSystemStore } from '@stores/systemStore';
import { useUIStore } from '@stores/uiStore';
import { apiService } from '@services/api';
import { wsService } from '@services/websocket';
import type { ServiceStatus } from '@/types';

export function ServicesView() {
  const { services, updateServiceStatus } = useSystemStore();
  const { addToast } = useUIStore();

  // Real-time service status updates
  useEffect(() => {
    const unsubscribe = wsService.on<{
      services: {
        metasploitRpc: ServiceStatus;
        zap: ServiceStatus;
        burp: ServiceStatus;
      }
    }>('status_update', (data) => {
      if (data.services) {
        updateServiceStatus('metasploitRpc', data.services.metasploitRpc);
        updateServiceStatus('zap', data.services.zap);
        updateServiceStatus('burp', data.services.burp);
      }
    });

    return () => unsubscribe();
  }, [updateServiceStatus]);

  const handleStartService = async (
    service: 'metasploit' | 'zap' | 'burp'
  ) => {
    updateServiceStatus(
      service === 'metasploit' ? 'metasploitRpc' : service,
      'starting'
    );

    try {
      await apiService.startService(service);
      updateServiceStatus(
        service === 'metasploit' ? 'metasploitRpc' : service,
        'running'
      );
      addToast({
        type: 'success',
        message: `${service} started successfully`,
      });
    } catch (error) {
      updateServiceStatus(
        service === 'metasploit' ? 'metasploitRpc' : service,
        'error'
      );
      addToast({
        type: 'error',
        message: `Failed to start ${service}`,
      });
    }
  };

  const handleStopService = async (
    service: 'metasploit' | 'zap' | 'burp'
  ) => {
    updateServiceStatus(
      service === 'metasploit' ? 'metasploitRpc' : service,
      'stopping'
    );

    try {
      await apiService.stopService(service);
      updateServiceStatus(
        service === 'metasploit' ? 'metasploitRpc' : service,
        'stopped'
      );
      addToast({
        type: 'info',
        message: `${service} stopped`,
      });
    } catch (error) {
      updateServiceStatus(
        service === 'metasploit' ? 'metasploitRpc' : service,
        'error'
      );
      addToast({
        type: 'error',
        message: `Failed to stop ${service}`,
      });
    }
  };

  const handleRestartService = async (service: 'metasploitRpc' | 'zap' | 'burp') => {
    updateServiceStatus(service, 'stopping');

    try {
      // Map to backend service names
      const backendName = service === 'metasploitRpc' ? 'metasploit' : service;
      await apiService.restartService(backendName);

      updateServiceStatus(service, 'running');
      addToast({
        type: 'success',
        message: `${service} restarted successfully`,
      });
    } catch (error) {
      updateServiceStatus(service, 'error');
      addToast({
        type: 'error',
        message: `Failed to restart ${service}`,
      });
    }
  };

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold text-grok-text-heading">Service Control</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <ServiceCard
          name="Metasploit RPC"
          description="Rapid7 Metasploit Framework - Exploitation and post-exploitation"
          status={services.metasploitRpc}
          onStart={() => handleStartService('metasploit')}
          onStop={() => handleStopService('metasploit')}
          onRestart={() => handleRestartService('metasploitRpc')}
          port="55553"
          docs="https://docs.rapid7.com/metasploit/"
        />

        <ServiceCard
          name="OWASP ZAP"
          description="Zed Attack Proxy - Web application security scanner"
          status={services.zap}
          onStart={() => handleStartService('zap')}
          onStop={() => handleStopService('zap')}
          onRestart={() => handleRestartService('zap')}
          port="8080"
          docs="https://www.zaproxy.org/docs/"
        />

        <ServiceCard
          name="Burp Suite"
          description="Web vulnerability scanner and proxy"
          status={services.burp}
          onStart={() => handleStartService('burp')}
          onStop={() => handleStopService('burp')}
          onRestart={() => handleRestartService('burp')}
          port="8081"
          docs="https://portswigger.net/burp/documentation"
        />
      </div>

      {/* Service Information */}
      <Panel title="Service Information">
        <div className="space-y-4 text-sm text-grok-text-body">
          <div>
            <h3 className="font-semibold text-grok-text-heading mb-2">
              Metasploit RPC
            </h3>
            <p className="text-grok-text-muted">
              The Metasploit Framework RPC server enables programmatic control of
              Metasploit modules, exploits, and post-exploitation tools. Used for
              automated vulnerability exploitation and payload delivery.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-grok-text-heading mb-2">OWASP ZAP</h3>
            <p className="text-grok-text-muted">
              ZAP performs automated web application security scans, detecting
              vulnerabilities like XSS, SQL injection, and security misconfigurations.
              Integrates with CStrike for comprehensive web security testing.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-grok-text-heading mb-2">Burp Suite</h3>
            <p className="text-grok-text-muted">
              Burp Suite provides advanced web vulnerability scanning and manual
              testing capabilities. Acts as an intercepting proxy for detailed
              analysis of web application traffic and vulnerabilities.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

interface ServiceCardProps {
  name: string;
  description: string;
  status: ServiceStatus;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  port: string;
  docs: string;
}

function ServiceCard({
  name,
  description,
  status,
  onStart,
  onStop,
  onRestart,
  port,
  docs,
}: ServiceCardProps) {
  const isRunning = status === 'running';
  const isTransitioning = status === 'starting' || status === 'stopping';

  return (
    <Panel>
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-grok-text-heading">{name}</h3>
            <StatusBadge status={status} />
          </div>
          <p className="text-sm text-grok-text-muted">{description}</p>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-grok-text-muted">Port:</span>
            <span className="text-grok-text-body font-mono">{port}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-grok-text-muted">Documentation:</span>
            <a
              href={docs}
              target="_blank"
              rel="noopener noreferrer"
              className="text-grok-recon-blue hover:underline"
            >
              View Docs
            </a>
          </div>
        </div>

        <div className="flex gap-2">
          {isRunning ? (
            <Button
              variant="danger"
              className="flex-1"
              onClick={onStop}
              disabled={isTransitioning}
            >
              <Square className="w-4 h-4 mr-1" />
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              className="flex-1"
              onClick={onStart}
              disabled={isTransitioning}
              isLoading={isTransitioning}
            >
              <Play className="w-4 h-4 mr-1" />
              Start
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={onRestart}
            disabled={!isRunning || isTransitioning}
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </Panel>
  );
}
