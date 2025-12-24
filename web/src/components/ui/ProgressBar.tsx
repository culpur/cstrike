/**
 * ProgressBar Component - Animated progress indicator
 */

import { type HTMLAttributes } from 'react';
import { cn } from '@utils/index';

interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  value: number; // 0-100
  variant?: 'default' | 'success' | 'warning' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  animated?: boolean;
}

export function ProgressBar({
  value,
  variant = 'default',
  size = 'md',
  showLabel = false,
  animated = false,
  className,
  ...props
}: ProgressBarProps) {
  const clampedValue = Math.min(100, Math.max(0, value));

  const variantColors = {
    default: 'bg-grok-recon-blue',
    success: 'bg-grok-success',
    warning: 'bg-grok-warning',
    danger: 'bg-grok-error',
  };

  const sizes = {
    sm: 'h-1',
    md: 'h-2',
    lg: 'h-3',
  };

  return (
    <div className={cn('w-full', className)} {...props}>
      {showLabel && (
        <div className="flex justify-between mb-1 text-xs text-grok-text-muted">
          <span>Progress</span>
          <span>{clampedValue}%</span>
        </div>
      )}
      <div
        className={cn(
          'w-full bg-grok-surface-3 rounded-full overflow-hidden',
          sizes[size]
        )}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300 ease-out',
            variantColors[variant],
            animated && 'animate-pulse'
          )}
          style={{ width: `${clampedValue}%` }}
        />
      </div>
    </div>
  );
}
