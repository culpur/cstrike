# Frontend-Backend Integration Troubleshooting Guide

## Quick Diagnosis Summary

**ROOT CAUSE IDENTIFIED**: The Vite development server is NOT running on port 3000, causing all frontend API requests to fail with 500 errors.

**STATUS**:
- Backend API Server: RUNNING on port 8000
- Frontend Dev Server: NOT RUNNING (should be on port 3000)
- Vite Proxy Configuration: CORRECT (no changes needed)

---

## The Problem

When the frontend tries to make API requests to `http://localhost:3000/api/v1/*`, it expects:
1. Vite dev server to receive the request on port 3000
2. Vite proxy to forward the request to the backend on port 8000
3. Backend responds with data
4. Vite proxy returns the response to the frontend

**Currently**: Step 1 fails because Vite dev server is not running.

---

## Verification

### Backend API (Port 8000) - WORKING
```bash
curl http://localhost:8000/api/v1/targets
# Response: {"targets": ["culpur.net"]} ✅
```

The backend is running correctly with proper CORS configuration:
- Listening on: `http://localhost:8000`
- CORS Origin: `http://localhost:3000`
- All endpoints responding correctly

### Frontend Dev Server (Port 3000) - NOT RUNNING
```bash
lsof -i :3000
# No output = nothing listening on port 3000 ❌
```

### Vite Proxy Configuration - CORRECT
File: `/Users/soulofall/projects/cstrike/web/vite.config.ts`

```typescript
export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
```

This configuration is PERFECT - no changes needed!

---

## Solution: Start the Frontend Dev Server

### Option 1: Use the Automated Startup Script (RECOMMENDED)

```bash
# Start both backend and frontend
/Users/soulofall/projects/cstrike/START_DEV_SERVERS.sh

# Or start only frontend (if backend is already running)
/Users/soulofall/projects/cstrike/START_DEV_SERVERS.sh frontend

# Check status
/Users/soulofall/projects/cstrike/START_DEV_SERVERS.sh status

# Stop all servers
/Users/soulofall/projects/cstrike/START_DEV_SERVERS.sh stop
```

### Option 2: Manual Startup

```bash
# Terminal 1: Backend (if not running)
cd /Users/soulofall/projects/cstrike
python3 api_server.py

# Terminal 2: Frontend
cd /Users/soulofall/projects/cstrike/web
npm run dev
```

### Option 3: Background Processes

```bash
# Start backend in background
cd /Users/soulofall/projects/cstrike
nohup python3 api_server.py > logs/backend.log 2>&1 &

# Start frontend in background
cd /Users/soulofall/projects/cstrike/web
nohup npm run dev > ../logs/frontend.log 2>&1 &

# Monitor logs
tail -f logs/backend.log logs/frontend.log
```

---

## Post-Startup Verification

After starting the frontend, verify both servers are running:

```bash
# Check ports
lsof -i :3000  # Should show Vite/Node process
lsof -i :8000  # Should show Python process

# Test backend directly
curl http://localhost:8000/api/v1/targets

# Test frontend proxy
curl http://localhost:3000/api/v1/targets

# Both should return: {"targets": ["culpur.net"]}
```

Then open your browser and navigate to: `http://localhost:3000`

---

## Troubleshooting Common Issues

### Issue 1: Port 3000 Already in Use

```bash
# Find what's using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or kill all processes on port 3000
lsof -ti:3000 | xargs kill -9
```

### Issue 2: Port 8000 Already in Use

```bash
# Find what's using port 8000
lsof -i :8000

# If it's not the CStrike API, kill it
kill -9 <PID>

# Or kill all processes on port 8000
lsof -ti:8000 | xargs kill -9
```

### Issue 3: npm dependencies not installed

```bash
cd /Users/soulofall/projects/cstrike/web
npm install
```

### Issue 4: Vite build errors

```bash
cd /Users/soulofall/projects/cstrike/web

# Clear cache
rm -rf node_modules/.vite

# Rebuild
npm run dev
```

### Issue 5: CORS errors persist after starting frontend

This should NOT happen if using the proxy, but if it does:

1. Verify you're accessing `http://localhost:3000` (not `http://localhost:8000`)
2. Check browser console for actual error
3. Verify Vite proxy is active by checking browser Network tab
4. The request should show as coming from `localhost:3000`

---

## Expected Flow After Fix

1. User opens browser to `http://localhost:3000`
2. Vite dev server serves the React application
3. React app makes request to `/api/v1/targets`
4. Vite proxy intercepts the request
5. Vite forwards to `http://localhost:8000/api/v1/targets`
6. Backend API responds with data
7. Vite proxy returns data to frontend
8. React app displays the data

---

## Network Request Debugging

### In Browser DevTools (Network Tab)

**Correct Request Flow:**
```
Request URL: http://localhost:3000/api/v1/targets
Status: 200 OK
Type: xhr/fetch
```

**Headers to verify:**
```
Request Headers:
  Origin: http://localhost:3000

Response Headers:
  Access-Control-Allow-Origin: http://localhost:3000
  Content-Type: application/json
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ Browser: http://localhost:3000                              │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        │ HTTP Request to /api/v1/targets
                        │
┌───────────────────────▼─────────────────────────────────────┐
│ Vite Dev Server (Port 3000)                                 │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Proxy Configuration (vite.config.ts)                    │ │
│ │                                                          │ │
│ │ '/api' → http://localhost:8000                          │ │
│ │ '/socket.io' → http://localhost:8000 (WebSocket)        │ │
│ └─────────────────────────────────────────────────────────┘ │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        │ Proxied to http://localhost:8000/api/v1/targets
                        │
┌───────────────────────▼─────────────────────────────────────┐
│ Flask Backend API (Port 8000)                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ CORS Configuration (api_server.py)                      │ │
│ │                                                          │ │
│ │ CORS(app, origins=['http://localhost:3000'])            │ │
│ │ SocketIO(cors_allowed_origins=['...'])                  │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ Endpoints:                                                   │
│   GET  /api/v1/status                                       │
│   GET  /api/v1/targets                                      │
│   POST /api/v1/targets                                      │
│   POST /api/v1/recon/start                                  │
│   GET  /api/v1/loot/<target>                                │
│   ...                                                        │
└──────────────────────────────────────────────────────────────┘
```

---

## Files Checked and Verified

### ✅ Backend Configuration
- **File**: `/Users/soulofall/projects/cstrike/api_server.py`
- **Status**: CORRECT
- **CORS**: Properly configured for `http://localhost:3000`
- **Port**: 8000
- **Process**: Running (PID can be found with `ps aux | grep api_server.py`)

### ✅ Frontend Vite Configuration
- **File**: `/Users/soulofall/projects/cstrike/web/vite.config.ts`
- **Status**: CORRECT
- **Proxy**: Properly configured for `/api` and `/socket.io`
- **Port**: 3000
- **Process**: NOT RUNNING ❌ (This is the problem!)

### ✅ Frontend Package Configuration
- **File**: `/Users/soulofall/projects/cstrike/web/package.json`
- **Status**: CORRECT
- **Dependencies**: All necessary packages installed
- **Scripts**: `npm run dev` command available

---

## Quick Reference Commands

```bash
# Check if servers are running
lsof -i :3000 :8000

# Start both servers (recommended)
/Users/soulofall/projects/cstrike/START_DEV_SERVERS.sh

# Test backend
curl http://localhost:8000/api/v1/targets

# Test frontend proxy (after starting Vite)
curl http://localhost:3000/api/v1/targets

# View logs
tail -f /Users/soulofall/projects/cstrike/logs/backend.log
tail -f /Users/soulofall/projects/cstrike/logs/frontend.log

# Stop all servers
/Users/soulofall/projects/cstrike/START_DEV_SERVERS.sh stop
```

---

## Success Criteria

After starting the frontend dev server, you should see:

1. ✅ Backend running on port 8000
2. ✅ Frontend running on port 3000
3. ✅ Browser can access `http://localhost:3000`
4. ✅ API requests to `/api/v1/*` return data (not 500 errors)
5. ✅ WebSocket connection to `/socket.io` works
6. ✅ No CORS errors in browser console

---

## Additional Notes

### Why Vite Proxy Instead of Direct Backend Calls?

1. **Avoids CORS issues**: Same-origin requests don't trigger CORS
2. **Simpler development**: No need to configure CORS for every endpoint
3. **Production-like setup**: Mirrors how a reverse proxy works in production
4. **WebSocket support**: Proxies WebSocket connections properly

### Why This Configuration is Correct

The current Vite configuration is production-ready and follows best practices:

- ✅ Specific proxy paths (`/api`, `/socket.io`)
- ✅ `changeOrigin: true` for proper host headers
- ✅ WebSocket support (`ws: true` for Socket.IO)
- ✅ Target points to correct backend URL

**No changes needed to vite.config.ts!**

### Startup Order Best Practice

1. **Backend first**: Start `api_server.py` on port 8000
2. **Frontend second**: Start Vite dev server on port 3000
3. **Verify both**: Check both ports are listening
4. **Access frontend**: Open browser to `http://localhost:3000`

The automated startup script handles this order automatically.

---

## Contact and Support

If issues persist after following this guide:

1. Check both log files for errors
2. Verify Node.js and Python versions are compatible
3. Ensure no firewall is blocking localhost ports
4. Try restarting your terminal/IDE
5. Clear browser cache and try again

**Log Locations:**
- Backend: `/Users/soulofall/projects/cstrike/logs/backend.log`
- Frontend: `/Users/soulofall/projects/cstrike/logs/frontend.log`
