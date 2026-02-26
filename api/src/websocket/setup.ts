/**
 * Socket.IO server setup — attaches to the HTTP server.
 */

import { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { env } from '../config/env.js';
import { setSocketIO } from './emitter.js';

export function setupWebSocket(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.CORS_ORIGINS,
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
    pingInterval: 10_000,
    pingTimeout: 5_000,
  });

  // Register the global reference
  setSocketIO(io);

  io.on('connection', (socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);

    socket.on('disconnect', (reason) => {
      console.log(`[WS] Client disconnected: ${socket.id} (${reason})`);
    });

    // Client can request immediate status
    socket.on('request_status', () => {
      socket.emit('status_update', { connected: true });
    });
  });

  console.log('[WS] Socket.IO server initialized');
  return io;
}
