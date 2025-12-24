/**
 * ToastContainer Component - Display toast notifications
 */

import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { useUIStore } from '@stores/uiStore';
import { cn } from '@utils/index';
import type { ToastNotification } from '@/types';

export function ToastContainer() {
  const { toasts, removeToast } = useUIStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-md">
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
  const icons = {
    success: CheckCircle,
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
  };

  const colors = {
    success: 'border-grok-success text-grok-success',
    error: 'border-grok-error text-grok-error',
    warning: 'border-grok-warning text-grok-warning',
    info: 'border-grok-info text-grok-info',
  };

  const Icon = icons[toast.type];

  return (
    <div
      className={cn(
        'bg-grok-surface-1 border-l-4 rounded-lg shadow-lg p-4 flex items-start gap-3',
        'animate-in slide-in-from-right duration-300',
        colors[toast.type]
      )}
    >
      <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-grok-text-body">{toast.message}</p>
      </div>
      <button
        onClick={onClose}
        className="p-1 hover:bg-grok-surface-2 rounded transition-colors"
      >
        <X className="w-4 h-4 text-grok-text-muted" />
      </button>
    </div>
  );
}
