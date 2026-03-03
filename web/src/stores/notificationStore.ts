/**
 * Notification Store - Persistent notification center for real-time alerts
 *
 * Tracks high-signal events: vulnerabilities found, credentials extracted,
 * shells obtained, scan lifecycle, and errors. Separate from transient toasts
 * which auto-dismiss. Notifications accumulate until explicitly cleared.
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { generateId } from '@utils/index';

// ============================================================================
// Types
// ============================================================================

export type NotificationType =
  | 'vuln_found'
  | 'cred_found'
  | 'shell_obtained'
  | 'scan_complete'
  | 'scan_started'
  | 'error';

export type NotificationSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  severity?: NotificationSeverity;
}

// ============================================================================
// Store interface
// ============================================================================

interface NotificationState {
  notifications: Notification[];
}

interface NotificationActions {
  addNotification: (
    notification: Omit<Notification, 'id' | 'timestamp' | 'read'>
  ) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
}

// Zustand v5 requires the combined type as the generic
type NotificationStore = NotificationState & NotificationActions;

// ============================================================================
// Store implementation
// ============================================================================

const MAX_NOTIFICATIONS = 100;

export const useNotificationStore = create<NotificationStore>((set) => ({
  // ── State ──────────────────────────────────────────────────────────────────

  notifications: [],

  // ── Actions ────────────────────────────────────────────────────────────────

  addNotification: (notification) =>
    set((state) => {
      const entry: Notification = {
        ...notification,
        id: generateId(),
        timestamp: Date.now(),
        read: false,
      };

      // Keep newest MAX_NOTIFICATIONS; drop oldest when limit is exceeded
      const next = [entry, ...state.notifications];
      if (next.length > MAX_NOTIFICATIONS) {
        next.splice(MAX_NOTIFICATIONS);
      }

      return { notifications: next };
    }),

  markRead: (id) =>
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
    })),

  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
    })),

  clearAll: () => set({ notifications: [] }),
}));

// ============================================================================
// Selectors
// ============================================================================

/**
 * Returns the count of unread notifications.
 * Use this selector in components that only need the badge number so they
 * do not re-render when notification content changes but the count stays the same.
 */
export const useUnreadCount = () =>
  useNotificationStore(
    (state) => state.notifications.filter((n) => !n.read).length
  );

/**
 * Returns the most recent N notifications for the dropdown panel.
 * Uses useShallow so that .slice() results are compared element-by-element
 * instead of by reference — prevents infinite re-render loops.
 */
export const useRecentNotifications = (limit = 20) =>
  useNotificationStore(useShallow((state) => state.notifications.slice(0, limit)));
