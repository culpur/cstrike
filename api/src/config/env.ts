/**
 * Environment configuration — single source of truth for all env vars.
 */

export const env = {
  // Server
  PORT: parseInt(process.env.PORT || '3001', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  HOST: process.env.HOST || '0.0.0.0',

  // Database
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://cstrike:cstrike@localhost:5432/cstrike',

  // Redis
  REDIS_URL: process.env.REDIS_URL || 'redis://:cstrike@localhost:6379',

  // CORS
  CORS_ORIGINS: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),

  // Host tool paths (bind-mounted from host)
  HOST_BIN_PATH: process.env.HOST_BIN_PATH || '/host/usr/bin',
  HOST_SBIN_PATH: process.env.HOST_SBIN_PATH || '/host/usr/sbin',
  HOST_LOCAL_BIN_PATH: process.env.HOST_LOCAL_BIN_PATH || '/host/usr/local/bin',
  HOST_OPT_PATH: process.env.HOST_OPT_PATH || '/host/opt',

  // ZAP
  ZAP_HOST: process.env.ZAP_HOST || '127.0.0.1',
  ZAP_PORT: parseInt(process.env.ZAP_PORT || '8090', 10),

  // Metasploit RPC
  MSF_HOST: process.env.MSF_HOST || '127.0.0.1',
  MSF_PORT: parseInt(process.env.MSF_PORT || '55553', 10),
  MSF_PASSWORD: process.env.MSF_PASSWORD || 'msf',

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  // Metrics interval (ms)
  METRICS_INTERVAL: parseInt(process.env.METRICS_INTERVAL || '2000', 10),
} as const;
