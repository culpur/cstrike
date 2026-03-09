/**
 * UpdateView — Self-update page with animated step-by-step progress.
 *
 * Shows available update info, "Apply Update" button, step progress with
 * collapsible raw output, and a "Back to Command Center" link on completion.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  ArrowUpCircle,
  Check,
  Loader2,
  X,
  ChevronDown,
  ChevronUp,
  LayoutDashboard,
  GitBranch,
  Package,
  RefreshCw,
  Activity,
  ShieldCheck,
} from 'lucide-react';
import { apiService } from '../../services/api';
import { useUpdateStore } from '../../stores/updateStore';
import { useUIStore } from '../../stores/uiStore';

const STEP_ICONS = [GitBranch, Package, Package, RefreshCw, RefreshCw, ShieldCheck];

export function UpdateView() {
  const { setActiveView, addToast } = useUIStore();
  const {
    updateInfo,
    updateStatus,
    steps,
    error,
    setSteps,
    setCurrentStep,
    setUpdateStatus,
    setError,
    reset,
    setUpdateAvailable,
  } = useUpdateStore();
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [polling, setPolling] = useState(false);

  // Poll update status during update
  useEffect(() => {
    if (updateStatus !== 'updating') {
      setPolling(false);
      return;
    }
    setPolling(true);

    const poll = async () => {
      try {
        const status = await apiService.getUpdateStatus();
        setSteps(status.steps as Array<{ id: string; label: string; status: 'pending' | 'running' | 'completed' | 'error'; output: string; startedAt?: number; completedAt?: number }>);
        setCurrentStep(status.currentStep);

        if (status.status === 'completed') {
          setUpdateStatus('completed');
        } else if (status.status === 'error') {
          setUpdateStatus('error');
          setError(status.error || 'Unknown error');
        }
      } catch {
        // API may be down during restart — keep polling silently
      }
    };

    const interval = setInterval(poll, 2000);
    poll(); // immediate first poll
    return () => clearInterval(interval);
  }, [updateStatus, setSteps, setCurrentStep, setUpdateStatus, setError]);

  const startUpdate = useCallback(async () => {
    try {
      setUpdateStatus('updating');
      await apiService.executeUpdate();
    } catch (err: any) {
      if (updateStatus !== 'updating') {
        setUpdateStatus('error');
        setError(err.message);
        addToast({ type: 'error', message: 'Failed to start update', duration: 5000 });
      }
    }
  }, [updateStatus, setUpdateStatus, setError, addToast]);

  const toggleStep = (idx: number) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const handleBackToCommandCenter = async () => {
    try {
      await apiService.resetUpdateState();
    } catch { /* ignore */ }
    reset();
    setUpdateAvailable(false);
    setActiveView('dashboard');
  };

  return (
    <div className="h-full overflow-y-auto p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <ArrowUpCircle className="w-6 h-6 text-[var(--grok-success)]" />
        <h1 className="text-lg font-bold text-[var(--grok-text-heading)]">
          System Update
        </h1>
      </div>

      {/* Update info card */}
      {updateInfo && updateStatus !== 'completed' && (
        <div className="cs-panel p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-mono text-[var(--grok-text-heading)]">
              {updateInfo.commits} new commit{updateInfo.commits > 1 ? 's' : ''}
            </span>
            {updateInfo.latestTag && (
              <span className="text-xs font-mono px-2 py-0.5 bg-[var(--grok-success)]/10 text-[var(--grok-success)] rounded">
                {updateInfo.latestTag}
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--grok-text-muted)] font-mono">
            Latest: {updateInfo.latestCommit} — {updateInfo.latestMessage}
          </p>
        </div>
      )}

      {/* Start button */}
      {updateStatus === 'available' && (
        <button
          onClick={startUpdate}
          className="cs-btn cs-btn-primary w-full py-3 mb-6 flex items-center justify-center gap-2 rounded border border-[var(--grok-success)] bg-[var(--grok-success)]/10 text-[var(--grok-success)] hover:bg-[var(--grok-success)]/20 transition-colors font-semibold"
        >
          <ArrowUpCircle className="w-4 h-4" />
          Apply Update
        </button>
      )}

      {/* Step progress */}
      {(updateStatus === 'updating' || updateStatus === 'completed' || updateStatus === 'error') && (
        <div className="space-y-3">
          {steps.map((step, idx) => {
            const Icon = STEP_ICONS[idx] || Activity;
            const isExpanded = expandedSteps.has(idx);

            return (
              <div key={step.id} className="cs-panel overflow-hidden">
                <button
                  onClick={() => step.output && toggleStep(idx)}
                  className="w-full flex items-center gap-3 p-3 text-left"
                >
                  {/* Step icon with status */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                    step.status === 'completed' ? 'bg-[var(--grok-success)]/20' :
                    step.status === 'running' ? 'bg-[var(--grok-recon-blue)]/20' :
                    step.status === 'error' ? 'bg-[var(--grok-error,#ef4444)]/20' :
                    'bg-[var(--grok-surface-2)]'
                  }`}>
                    {step.status === 'completed' && <Check className="w-4 h-4 text-[var(--grok-success)]" />}
                    {step.status === 'running' && <Loader2 className="w-4 h-4 text-[var(--grok-recon-blue)] animate-spin" />}
                    {step.status === 'error' && <X className="w-4 h-4 text-[var(--grok-error,#ef4444)]" />}
                    {step.status === 'pending' && <Icon className="w-4 h-4 text-[var(--grok-text-muted)]" />}
                  </div>

                  <span className={`text-sm font-medium flex-1 transition-colors ${
                    step.status === 'completed' ? 'text-[var(--grok-success)]' :
                    step.status === 'running' ? 'text-[var(--grok-recon-blue)]' :
                    step.status === 'error' ? 'text-[var(--grok-error,#ef4444)]' :
                    'text-[var(--grok-text-muted)]'
                  }`}>
                    {step.label}
                  </span>

                  {step.output && (
                    isExpanded
                      ? <ChevronUp className="w-4 h-4 text-[var(--grok-text-muted)]" />
                      : <ChevronDown className="w-4 h-4 text-[var(--grok-text-muted)]" />
                  )}
                </button>

                {/* Collapsible raw output */}
                {isExpanded && step.output && (
                  <div className="px-3 pb-3">
                    <pre className="text-[11px] font-mono p-3 bg-[var(--grok-surface-1)] rounded max-h-48 overflow-y-auto text-[var(--grok-text-body)] whitespace-pre-wrap break-all">
                      {step.output}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Error message */}
      {updateStatus === 'error' && error && (
        <div className="cs-panel p-4 mt-4 border-l-4 border-[var(--grok-error,#ef4444)]">
          <p className="text-sm text-[var(--grok-error,#ef4444)]">{error}</p>
          <button
            onClick={handleBackToCommandCenter}
            className="mt-3 text-xs text-[var(--grok-text-muted)] hover:text-[var(--grok-text-heading)] underline"
          >
            Dismiss and return to Command Center
          </button>
        </div>
      )}

      {/* Completion card */}
      {updateStatus === 'completed' && (
        <div className="cs-panel p-6 mt-6 text-center animate-fade-in">
          <Check className="w-12 h-12 text-[var(--grok-success)] mx-auto mb-3" />
          <h2 className="text-lg font-bold text-[var(--grok-text-heading)] mb-2">
            Update Complete
          </h2>
          <p className="text-sm text-[var(--grok-text-muted)] mb-4">
            CStrike has been updated successfully.
          </p>
          <button
            onClick={handleBackToCommandCenter}
            className="inline-flex items-center gap-2 px-4 py-2 rounded border border-[var(--grok-success)] bg-[var(--grok-success)]/10 text-[var(--grok-success)] hover:bg-[var(--grok-success)]/20 transition-colors font-semibold text-sm"
          >
            <LayoutDashboard className="w-4 h-4" />
            Back to Command Center
          </button>
        </div>
      )}

      {/* Polling indicator */}
      {polling && (
        <div className="flex items-center gap-2 justify-center mt-4 text-xs text-[var(--grok-text-muted)]">
          <Loader2 className="w-3 h-3 animate-spin" />
          Monitoring update progress...
        </div>
      )}
    </div>
  );
}
