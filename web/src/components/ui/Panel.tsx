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
        'bg-grok-surface-1 border border-grok-border rounded-[7px] overflow-hidden',
        className
      )}
      {...props}
    >
      {title && (
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-grok-border">
          <h3 className="text-[11px] font-semibold text-grok-text-muted uppercase tracking-[0.08em]">
            {title}
          </h3>
          {action && <div>{action}</div>}
        </div>
      )}
      <div className={cn(!noPadding && 'p-4')}>{children}</div>
    </div>
  );
}
