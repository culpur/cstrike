/**
 * MetricCard Component - Display system metrics and stats
 */

import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@utils/index';

interface MetricCardProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: string | number;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}

export function MetricCard({
  label,
  value,
  icon,
  trend,
  trendValue,
  variant = 'default',
  className,
  ...props
}: MetricCardProps) {
  const variantStyles = {
    default: 'border-grok-border',
    success: 'border-grok-success',
    warning: 'border-grok-warning',
    danger: 'border-grok-error',
  };

  const trendStyles = {
    up: 'text-grok-success',
    down: 'text-grok-error',
    neutral: 'text-grok-text-muted',
  };

  return (
    <div
      className={cn(
        'bg-grok-surface-1 border rounded-[7px] p-4 transition-colors hover:bg-grok-surface-2',
        variantStyles[variant],
        className
      )}
      {...props}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-[9px] text-grok-text-muted uppercase tracking-[0.1em] mb-1.5">
            {label}
          </p>
          <p className="text-[21px] font-bold text-grok-text-heading font-mono leading-none">
            {value}
          </p>
          {trend && trendValue && (
            <p className={cn('text-[9px] mt-1.5', trendStyles[trend])}>
              {trendValue}
            </p>
          )}
        </div>
        {icon && (
          <div className="ml-3 text-grok-text-muted">{icon}</div>
        )}
      </div>
    </div>
  );
}
