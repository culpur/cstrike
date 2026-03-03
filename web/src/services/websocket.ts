/**
 * WebSocket Service - Real-time communication using Socket.IO
 */

import { io, Socket } from 'socket.io-client';
import type { WSMessageType } from '@/types';

type MessageHandler<T = unknown> = (data: T) => void;

class WebSocketService {
  private socket: Socket | null = null;
  private handlers: Map<WSMessageType, Set<MessageHandler>> = new Map();
  private isConnecting = false;

  constructor() {
    // Don't auto-connect in constructor
  }

  private getSocketUrl(): string {
    // In development, use current host (Vite will proxy)
    // In production, use configured API URL
    if (import.meta.env.DEV) {
      return window.location.origin;
    } else {
      return import.meta.env.VITE_API_URL || window.location.origin;
    }
  }

  /**
   * Connect to Socket.IO server
   */
  connect(): void {
    if (this.socket?.connected || this.isConnecting) {
      console.log('[Socket.IO] Already connected or connecting');
      return;
    }

    this.isConnecting = true;
    const url = this.getSocketUrl();
    console.log('[Socket.IO] Connecting to', url);

    this.socket = io(url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      console.log('[Socket.IO] Connected');
      this.isConnecting = false;
      this.notifyConnectionStatus(true);
    });

    this.socket.on('disconnect', () => {
      console.log('[Socket.IO] Disconnected');
      this.isConnecting = false;
      this.notifyConnectionStatus(false);
    });

    this.socket.on('connect_error', (error) => {
      console.error('[Socket.IO] Connection error:', error);
      this.isConnecting = false;
    });

    // Listen for status updates from server
    this.socket.on('status_update', (data) => {
      this.handleServerMessage('status_update', data);
    });

    this.socket.on('phase_change', (data) => {
      this.handleServerMessage('phase_change', data);
    });

    // Listen for exploitation events
    this.socket.on('exploit_result', (data) => {
      this.handleServerMessage('exploit_result', data);
    });

    this.socket.on('exploit_started', (data) => {
      this.handleServerMessage('exploit_started', data);
    });

    this.socket.on('exploit_completed', (data) => {
      this.handleServerMessage('exploit_completed', data);
    });

    this.socket.on('exploit_failed', (data) => {
      this.handleServerMessage('exploit_failed', data);
    });

    this.socket.on('vulnerability_discovered', (data) => {
      this.handleServerMessage('vulnerability_discovered', data);
    });

    this.socket.on('shell_obtained', (data) => {
      this.handleServerMessage('shell_obtained', data);
    });

    this.socket.on('credential_extracted', (data) => {
      this.handleServerMessage('credential_extracted', data);
    });

    this.socket.on('file_downloaded', (data) => {
      this.handleServerMessage('file_downloaded', data);
    });

    this.socket.on('loot_item', (data) => {
      this.handleServerMessage('loot_item', data);
    });

    this.socket.on('ai_thought', (data) => {
      this.handleServerMessage('ai_thought', data);
    });

    this.socket.on('log_entry', (data) => {
      this.handleServerMessage('log_entry', data);
    });

    this.socket.on('vulnapi_output', (data) => {
      this.handleServerMessage('vulnapi_output', data);
    });

    // Recon and scan lifecycle events
    this.socket.on('recon_output', (data) => {
      this.handleServerMessage('recon_output', data);
    });

    this.socket.on('tool_update', (data) => {
      this.handleServerMessage('tool_update', data);
    });

    this.socket.on('scan_complete', (data) => {
      this.handleServerMessage('scan_complete', data);
    });

    // System metrics (dashboard)
    this.socket.on('system_metrics', (data) => {
      this.handleServerMessage('system_metrics', data);
    });

    // AI command execution events
    this.socket.on('ai_command_execution', (data) => {
      this.handleServerMessage('ai_command_execution', data);
    });

    // Service auto-start notifications
    this.socket.on('service_auto_start', (data) => {
      this.handleServerMessage('service_auto_start', data);
    });

    // Exploit case / task events
    this.socket.on('task_created', (data) => {
      this.handleServerMessage('task_created', data);
    });

    this.socket.on('task_started', (data) => {
      this.handleServerMessage('task_started', data);
    });

    this.socket.on('task_output', (data) => {
      this.handleServerMessage('task_output', data);
    });

    this.socket.on('task_completed', (data) => {
      this.handleServerMessage('task_completed', data);
    });

    this.socket.on('task_failed', (data) => {
      this.handleServerMessage('task_failed', data);
    });

    this.socket.on('case_gate_reached', (data) => {
      this.handleServerMessage('case_gate_reached', data);
    });

    this.socket.on('case_phase_changed', (data) => {
      this.handleServerMessage('case_phase_changed', data);
    });

    // Port and subdomain discovery events
    this.socket.on('port_discovered', (data) => {
      this.handleServerMessage('port_discovered', data);
    });

    this.socket.on('subdomain_discovered', (data) => {
      this.handleServerMessage('subdomain_discovered', data);
    });

    // Scan started event
    this.socket.on('scan_started', (data) => {
      this.handleServerMessage('scan_started', data);
    });

    // Terminal / shell session events
    this.socket.on('terminal_output', (data) => {
      this.handleServerMessage('terminal_output', data);
    });

    this.socket.on('terminal_session_created', (data) => {
      this.handleServerMessage('terminal_session_created', data);
    });

    this.socket.on('terminal_session_closed', (data) => {
      this.handleServerMessage('terminal_session_closed', data);
    });

    // Exploit track spawned
    this.socket.on('exploit_track_spawned', (data) => {
      this.handleServerMessage('exploit_track_spawned', data);
    });

    // Scan pause / resume
    this.socket.on('scan_paused', (data) => {
      this.handleServerMessage('scan_paused', data);
    });

    this.socket.on('scan_resumed', (data) => {
      this.handleServerMessage('scan_resumed', data);
    });
  }

  /**
   * Disconnect from Socket.IO server
   */
  disconnect(): void {
    console.log('[Socket.IO] Disconnecting');
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * Send message to server
   */
  send<T = unknown>(type: WSMessageType, data: T): void {
    if (!this.socket || !this.socket.connected) {
      console.warn('[Socket.IO] Cannot send message - not connected');
      return;
    }

    this.socket.emit(type, data);
  }

  /**
   * Subscribe to specific message type
   */
  on<T = unknown>(type: WSMessageType, handler: MessageHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }

    const handlers = this.handlers.get(type)!;
    handlers.add(handler as MessageHandler);

    // Return unsubscribe function
    return () => {
      handlers.delete(handler as MessageHandler);
      if (handlers.size === 0) {
        this.handlers.delete(type);
      }
    };
  }

  /**
   * Unsubscribe from all messages of a type
   */
  off(type: WSMessageType): void {
    this.handlers.delete(type);
  }

  /**
   * Clear all handlers
   */
  clearHandlers(): void {
    this.handlers.clear();
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  private handleServerMessage(type: WSMessageType, data: unknown): void {
    // Call registered handlers for this message type
    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          console.error(`[Socket.IO] Handler error for ${type}:`, error);
        }
      });
    }
  }


  private notifyConnectionStatus(connected: boolean): void {
    // Use dedicated connection_status type instead of hijacking system_metrics
    this.handleServerMessage('status_update', { connected });
  }
}

// Export singleton instance
export const wsService = new WebSocketService();
