/**
 * SectionPanel — reusable panel with header bar.
 * Mirrors the cs-panel / cs-panel-header CSS classes from the CStrike theme.
 */

import type { ReactNode } from 'react';

interface SectionPanelProps {
  title: string;
  icon?: ReactNode;
  badge?: string;
  action?: ReactNode;
  children: ReactNode;
  noPadding?: boolean;
}

export function SectionPanel({
  title,
  icon,
  badge,
  action,
  children,
  noPadding,
}: SectionPanelProps) {
  return (
    <div className="cs-panel">
      <div className="cs-panel-header flex items-center justify-between">
        <span className="flex items-center gap-2">
          {icon}
          {title}
        </span>
        <div className="flex items-center gap-2">
          {badge && (
            <span className="text-[10px] font-mono text-[var(--grok-text-muted)]">{badge}</span>
          )}
          {action}
        </div>
      </div>
      <div className={noPadding ? '' : 'p-4'}>{children}</div>
    </div>
  );
}
