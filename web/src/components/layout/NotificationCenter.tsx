/**
 * NotificationCenter — Bell-icon dropdown for real-time alerts
 *
 * Sits in the header area (top-right). Accumulates high-signal events from
 * the notification store: vulnerabilities, credentials, shells, scan status,
 * and errors. Unread count shows as a red badge on the bell.
 *
 * Accessibility:
 * - Bell is a <button> with aria-label, aria-haspopup, aria-expanded
 * - Dropdown has role="dialog" with aria-label
 * - Each item row has role="listitem"
 * - Escape key dismisses the dropdown
 * - Focus-visible ring on all interactive elements
 */

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Bell,
  AlertTriangle,
  Key,
  Terminal,
  CheckCircle,
  XCircle,
  Loader,
  Trash2,
  CheckCheck,
  X,
} from 'lucide-react';
import {
  useNotificationStore,
  useUnreadCount,
  useRecentNotifications,
  type Notification,
  type NotificationType,
} from '@stores/notificationStore';
import { getRelativeTime, cn } from '@utils/index';

// ============================================================================
// Type-to-icon + color mapping
// ============================================================================

interface TypeMeta {
  icon: React.ComponentType<{ className?: string }>;
  color: string;       // Tailwind text-color class
  label: string;
}

const TYPE_META: Record<NotificationType, TypeMeta> = {
  vuln_found: {
    icon: AlertTriangle,
    color: 'text-grok-warning',
    label: 'VULN',
  },
  cred_found: {
    icon: Key,
    color: 'text-grok-loot-green',
    label: 'CRED',
  },
  shell_obtained: {
    icon: Terminal,
    color: 'text-grok-exploit-red',
    label: 'SHELL',
  },
  scan_complete: {
    icon: CheckCircle,
    color: 'text-grok-recon-blue',
    label: 'SCAN',
  },
  scan_started: {
    icon: Loader,
    color: 'text-grok-scan-cyan',
    label: 'SCAN',
  },
  error: {
    icon: XCircle,
    color: 'text-grok-error',
    label: 'ERROR',
  },
};

// ============================================================================
// NotificationItem — individual row inside the dropdown
// ============================================================================

interface NotificationItemProps {
  notification: Notification;
  onMarkRead: (id: string) => void;
}

const NotificationItem = memo<NotificationItemProps>(
  ({ notification, onMarkRead }) => {
    const meta = TYPE_META[notification.type];
    const Icon = meta.icon;

    const handleClick = useCallback(() => {
      if (!notification.read) {
        onMarkRead(notification.id);
      }
    }, [notification.id, notification.read, onMarkRead]);

    return (
      <div
        role="listitem"
        onClick={handleClick}
        className={cn(
          'flex gap-3 px-4 py-3 transition-colors cursor-default',
          'border-b border-[var(--grok-border)] last:border-b-0',
          notification.read
            ? 'opacity-50 hover:opacity-70'
            : 'hover:bg-[var(--grok-surface-3)] animate-fade-in'
        )}
      >
        {/* Type icon */}
        <div className="flex-shrink-0 mt-0.5">
          <Icon className={cn('w-4 h-4', meta.color)} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {/* Unread indicator */}
              {!notification.read && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-[var(--grok-exploit-red)] flex-shrink-0"
                  aria-label="unread"
                />
              )}
              <p
                className={cn(
                  'text-xs font-semibold truncate',
                  'text-[var(--grok-text-heading)]'
                )}
              >
                {notification.title}
              </p>
            </div>

            <span
              className="text-[10px] font-mono text-[var(--grok-text-muted)] flex-shrink-0 pt-px"
              title={new Date(notification.timestamp).toLocaleString()}
            >
              {getRelativeTime(notification.timestamp)}
            </span>
          </div>

          <p className="text-xs text-[var(--grok-text-body)] mt-0.5 line-clamp-2 leading-relaxed">
            {notification.message}
          </p>

          {/* Severity badge when present */}
          {notification.severity && (
            <span
              className={cn(
                'inline-block mt-1 text-[10px] font-mono uppercase tracking-wider',
                'px-1.5 py-px rounded',
                notification.severity === 'critical' &&
                  'bg-[var(--grok-exploit-red)]/15 text-[var(--grok-exploit-red)]',
                notification.severity === 'high' &&
                  'bg-[var(--grok-warning)]/15 text-[var(--grok-warning)]',
                notification.severity === 'medium' &&
                  'bg-[var(--grok-warning)]/10 text-[var(--grok-warning)]',
                notification.severity === 'low' &&
                  'bg-[var(--grok-recon-blue)]/15 text-[var(--grok-recon-blue)]',
                notification.severity === 'info' &&
                  'bg-[var(--grok-surface-3)] text-[var(--grok-text-muted)]'
              )}
            >
              {notification.severity}
            </span>
          )}
        </div>
      </div>
    );
  }
);

NotificationItem.displayName = 'NotificationItem';

// ============================================================================
// EmptyState — shown when the notification list is empty
// ============================================================================

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <Bell className="w-8 h-8 text-[var(--grok-text-muted)] mb-3 opacity-40" />
      <p className="text-xs text-[var(--grok-text-muted)]">No notifications</p>
      <p className="text-[10px] text-[var(--grok-text-muted)] mt-1 opacity-60">
        Alerts will appear here when events are detected
      </p>
    </div>
  );
}

// ============================================================================
// NotificationCenter — the exported component
// ============================================================================

export const NotificationCenter = memo(function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);

  // Selectors — each subscribes independently to minimize re-renders.
  // Action selectors return stable function references (never cause re-renders).
  const unreadCount = useUnreadCount();
  const recentNotifications = useRecentNotifications(20);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const clearAll = useNotificationStore((s) => s.clearAll);

  // ── Refs for click-outside detection ──────────────────────────────────────

  const containerRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const close = useCallback(() => setIsOpen(false), []);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        close();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen, close]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        close();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, close]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleMarkAllRead = useCallback(() => {
    markAllRead();
  }, [markAllRead]);

  const handleClearAll = useCallback(() => {
    clearAll();
  }, [clearAll]);

  const handleMarkRead = useCallback(
    (id: string) => {
      markRead(id);
    },
    [markRead]
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  const badgeCount = Math.min(unreadCount, 99);
  const hasNotifications = recentNotifications.length > 0;
  const hasUnread = unreadCount > 0;

  return (
    <div ref={containerRef} className="relative">
      {/* ── Bell button ─────────────────────────────────────────────────── */}
      <button
        onClick={toggle}
        aria-label={
          unreadCount > 0
            ? `Notifications — ${unreadCount} unread`
            : 'Notifications'
        }
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className={cn(
          'relative flex items-center justify-center w-8 h-8 rounded transition-all',
          'text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)]',
          'hover:bg-[var(--grok-surface-2)]',
          isOpen && 'bg-[var(--grok-surface-2)] text-[var(--grok-text-body)]'
        )}
      >
        <Bell className="w-4 h-4" />

        {/* Unread count badge */}
        {badgeCount > 0 && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute -top-1 -right-1 min-w-[16px] h-4 px-1',
              'flex items-center justify-center rounded-full',
              'bg-[var(--grok-exploit-red)] text-white',
              'text-[9px] font-mono font-bold leading-none',
              'pointer-events-none'
            )}
          >
            {badgeCount}
          </span>
        )}
      </button>

      {/* ── Dropdown panel ──────────────────────────────────────────────── */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Notification center"
          className={cn(
            'absolute right-0 top-full mt-2 z-50',
            'w-80 rounded-lg shadow-2xl',
            'bg-[var(--grok-surface-2)] border border-[var(--grok-border)]',
            'animate-fade-in',
            // Keep the panel inside the viewport on narrow viewports
            'max-w-[calc(100vw-1rem)]'
          )}
          style={{
            boxShadow:
              '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(42,42,58,0.5)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--grok-border)]">
            <div className="flex items-center gap-2">
              <Bell className="w-3.5 h-3.5 text-[var(--grok-text-muted)]" />
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--grok-text-heading)]">
                Notifications
              </span>
              {hasUnread && (
                <span
                  className={cn(
                    'text-[10px] font-mono px-1.5 py-px rounded-full',
                    'bg-[var(--grok-exploit-red)]/20 text-[var(--grok-exploit-red)]'
                  )}
                >
                  {unreadCount} new
                </span>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1">
              {hasUnread && (
                <button
                  onClick={handleMarkAllRead}
                  title="Mark all read"
                  aria-label="Mark all notifications as read"
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium',
                    'text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)]',
                    'hover:bg-[var(--grok-surface-3)] transition-colors'
                  )}
                >
                  <CheckCheck className="w-3 h-3" />
                  <span>All read</span>
                </button>
              )}

              {hasNotifications && (
                <button
                  onClick={handleClearAll}
                  title="Clear all notifications"
                  aria-label="Clear all notifications"
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium',
                    'text-[var(--grok-text-muted)] hover:text-[var(--grok-error)]',
                    'hover:bg-[var(--grok-surface-3)] transition-colors'
                  )}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}

              <button
                onClick={close}
                title="Close"
                aria-label="Close notification panel"
                className={cn(
                  'flex items-center justify-center w-6 h-6 rounded',
                  'text-[var(--grok-text-muted)] hover:text-[var(--grok-text-body)]',
                  'hover:bg-[var(--grok-surface-3)] transition-colors'
                )}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <div
            role="list"
            className="overflow-y-auto"
            style={{ maxHeight: '420px' }}
          >
            {hasNotifications ? (
              recentNotifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onMarkRead={handleMarkRead}
                />
              ))
            ) : (
              <EmptyState />
            )}
          </div>

          {/* Footer — notification count summary */}
          {hasNotifications && (
            <div className="px-4 py-2 border-t border-[var(--grok-border)]">
              <p className="text-[10px] font-mono text-[var(--grok-text-muted)] text-center">
                {recentNotifications.length} notification
                {recentNotifications.length !== 1 ? 's' : ''}
                {unreadCount > 0 ? ` — ${unreadCount} unread` : ' — all read'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
