/**
 * StatusBadge Component - Status indicator with color variants
 */

import { type HTMLAttributes } from 'react';
import { cn } from '@utils/index';
import type { ServiceStatus, PhaseType } from '@/types';

interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status: ServiceStatus | PhaseType | 'success' | 'error' | 'warning' | 'info' | 'pending' | 'complete' | 'failed' | 'scanning';
  label?: string;
  showDot?: boolean;
}

export function StatusBadge({
  status,
  label,
  showDot = true,
  className,
  ...props
}: StatusBadgeProps) {
  const getStatusColor = () => {
    switch (status) {
      case 'running':
      case 'success':
      case 'exploit':
      case 'scanning':
        return 'text-grok-success border-grok-success/30 bg-grok-success/10';
      case 'stopped':
      case 'idle':
      case 'pending':
        return 'text-grok-text-muted border-grok-border bg-grok-surface-2';
      case 'error':
      case 'failed':
        return 'text-grok-error border-grok-error/30 bg-grok-error/10';
      case 'complete':
        return 'text-grok-success border-grok-success/30 bg-grok-success/10';
      case 'warning':
      case 'starting':
      case 'stopping':
        return 'text-grok-warning border-grok-warning/30 bg-grok-warning/10';
      case 'info':
      case 'recon':
        return 'text-grok-recon-blue border-grok-recon-blue/30 bg-grok-recon-blue/10';
      case 'ai':
        return 'text-grok-ai-purple border-grok-ai-purple/30 bg-grok-ai-purple/10';
      case 'zap':
      case 'metasploit':
        return 'text-grok-warning border-grok-warning/30 bg-grok-warning/10';
      default:
        return 'text-grok-text-body border-grok-border bg-grok-surface-2';
    }
  };

  const getDotAnimation = () => {
    if (
      status === 'running' ||
      status === 'starting' ||
      status === 'recon' ||
      status === 'ai'
    ) {
      return 'animate-pulse';
    }
    return '';
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium border',
        getStatusColor(),
        className
      )}
      {...props}
    >
      {showDot && (
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full',
            'bg-current',
            getDotAnimation()
          )}
        />
      )}
      {label || status}
    </span>
  );
}
