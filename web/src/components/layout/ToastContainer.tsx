/**
 * ToastContainer Component — Dark-ops toast notifications
 */

import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { useUIStore } from '@stores/uiStore';
import type { ToastNotification } from '@/types';

const TOAST_CONFIG = {
  success: {
    icon: CheckCircle,
    label: 'SUCCESS',
    borderColor: 'var(--grok-success)',
    glowColor: 'rgba(0,255,136,0.15)',
    textColor: 'var(--grok-success)',
  },
  error: {
    icon: AlertCircle,
    label: 'ERROR',
    borderColor: 'var(--grok-error)',
    glowColor: 'rgba(255,51,68,0.15)',
    textColor: 'var(--grok-error)',
  },
  warning: {
    icon: AlertTriangle,
    label: 'WARNING',
    borderColor: 'var(--grok-warning)',
    glowColor: 'rgba(255,170,0,0.15)',
    textColor: 'var(--grok-warning)',
  },
  info: {
    icon: Info,
    label: 'INFO',
    borderColor: 'var(--grok-recon-blue)',
    glowColor: 'rgba(34,102,255,0.15)',
    textColor: 'var(--grok-recon-blue)',
  },
} as const;

export function ToastContainer() {
  const { toasts, removeToast } = useUIStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2" style={{ width: '380px', maxWidth: 'calc(100vw - 2rem)' }}>
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}

function Toast({
  toast,
  onClose,
}: {
  toast: ToastNotification;
  onClose: () => void;
}) {
  const config = TOAST_CONFIG[toast.type];
  const Icon = config.icon;

  return (
    <div
      className="animate-slide-in-right rounded-lg overflow-hidden"
      style={{
        background: 'var(--grok-surface-1)',
        border: '1px solid var(--grok-border)',
        borderLeft: `3px solid ${config.borderColor}`,
        boxShadow: `0 8px 24px rgba(0,0,0,0.5), 0 0 20px ${config.glowColor}`,
      }}
    >
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{ background: config.glowColor }}
      >
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5" style={{ color: config.textColor }} />
          <span
            className="text-[10px] font-mono font-bold uppercase tracking-wider"
            style={{ color: config.textColor }}
          >
            {config.label}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-0.5 rounded transition-colors hover:bg-[var(--grok-surface-3)]"
        >
          <X className="w-3 h-3 text-[var(--grok-text-muted)]" />
        </button>
      </div>

      {/* Message */}
      <div className="px-3 py-2.5">
        <p className="text-xs text-[var(--grok-text-body)] leading-relaxed">
          {toast.message}
        </p>
      </div>
    </div>
  );
}
