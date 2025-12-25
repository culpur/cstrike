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
      reconnectionAttempts: 5,
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
    // Emit connection status event
    const handlers = this.handlers.get('system_metrics'); // Reuse for connection status
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler({ connected });
        } catch (error) {
          console.error('[WebSocket] Connection status handler error:', error);
        }
      });
    }
  }
}

// Export singleton instance
export const wsService = new WebSocketService();
