/**
 * Panel Component - Container panel with Grok styling
 */

import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@utils/index';

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  action?: ReactNode;
  noPadding?: boolean;
}

export function Panel({
  title,
  action,
  noPadding = false,
  className,
  children,
  ...props
}: PanelProps) {
  return (
    <div
      className={cn(
        'bg-grok-surface-1 border border-grok-border rounded-lg overflow-hidden',
        className
      )}
      {...props}
    >
      {title && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-grok-border">
          <h3 className="text-sm font-semibold text-grok-text-heading uppercase tracking-wide">
            {title}
          </h3>
          {action && <div>{action}</div>}
        </div>
      )}
      <div className={cn(!noPadding && 'p-4')}>{children}</div>
    </div>
  );
}
