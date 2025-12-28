# CStrike Troubleshooting Guide

## Quick Start

### Option 1: Use the Startup Script (Recommended)
```bash
./START_CSTRIKE.sh
```

This automatically starts both the API server (port 8000) and frontend dev server (port 3000).

### Option 2: Manual Startup
```bash
# Terminal 1 - API Server
python3 api_server.py

# Terminal 2 - Frontend
cd web
npm run dev
```

---

## Common Errors and Solutions

### 🔴 Error: `ERR_CONNECTION_REFUSED` or `Failed to load resource`

**Symptoms:**
```
PUT http://100.73.226.113:3000/api/v1/config net::ERR_CONNECTION_REFUSED
WebSocket connection to 'ws://100.73.226.113:3000/socket.io/' failed
```

**Root Cause:** API server is not running

**Solution:**
```bash
# Check if API server is running
ps aux | grep api_server.py

# If not running, start it:
python3 api_server.py
```

**Expected Output:**
```
 * Running on http://0.0.0.0:8000
```

---

### 🔴 Error: `404 NOT FOUND` on `/api/v1/results/undefined`

**Symptoms:**
```
:3000/api/v1/results/undefined:1  Failed to load resource: the server responded with a status of 404 (NOT FOUND)
ResultsView.tsx:48 Failed to load target results: AxiosError
```

**Root Cause:** Trying to load results for a target that doesn't exist or `selectedTarget` is undefined

**Solution:**
1. Make sure API server is running
2. Add a target in the `/targets` page first
3. Run a scan on the target
4. Then go to `/results` page

This error is harmless - it just means no target is selected yet.

---

### 🔴 Error: `WebSocket is closed before the connection is established`

**Symptoms:**
```
websocket.ts:34 [Socket.IO] Already connected or connecting
socket__io-client.js:1500 WebSocket connection to 'ws://...' failed
```

**Root Cause:**
1. API server not running, OR
2. Multiple connection attempts happening simultaneously

**Solution:**
```bash
# 1. Ensure API server is running
python3 api_server.py

# 2. Hard refresh the browser
# Chrome/Edge: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
# Firefox: Ctrl+F5 (Windows) or Cmd+Shift+R (Mac)
```

The "Already connected or connecting" message is normal - it prevents duplicate connections.

---

### 🔴 Warning: `Each child in a list should have a unique "key" prop`

**Symptoms:**
```
react-dom_client.js:18618 Each child in a list should have a unique "key" prop.
Check the render method of `ResultsView`.
```

**Root Cause:** React warning about list rendering (cosmetic issue)

**Impact:** None - this is a warning, not an error. The app works fine.

**Status:** All map functions in ResultsView have proper keys. This warning may be coming from a third-party component or browser extension.

**Solution:** Can be safely ignored. To hide it:
1. Open browser DevTools
2. Click the filter icon
3. Uncheck "Warnings"

---

### 🟡 Warning: `Password field is not contained in a form`

**Symptoms:**
```
[DOM] Password field is not contained in a form: (More info: https://goo.gl/9p2vKq)
```

**Root Cause:** Browser warning about password input fields not wrapped in `<form>` tags

**Location:** Configuration page (`/config`) - password fields for API keys

**Impact:** Cosmetic only - functionality works fine

**Solution (Optional):** Can be safely ignored. Modern SPAs often don't use `<form>` tags.

---

## Port Configuration

### Default Ports
- **API Server:** 8000 (configured in `api_server.py` line 2016)
- **Frontend Dev Server:** 3000 (configured in `vite.config.ts` line 22)
- **WebSocket:** Uses same port as API server (8000)

### Proxy Configuration
The frontend dev server (port 3000) proxies API requests to port 8000:
- `/api/*` → `http://localhost:8000/api/*`
- `/socket.io/*` → `http://localhost:8000/socket.io/*`

This is configured in `web/vite.config.ts`.

### Changing Ports

#### Change API Server Port:
Edit `api_server.py` line 2016:
```python
socketio.run(app, host='0.0.0.0', port=8000, ...)  # Change 8000 to your port
```

Then update `web/vite.config.ts` proxy target:
```typescript
proxy: {
  '/api': {
    target: 'http://localhost:YOUR_PORT',  // Update this
    ...
  },
  ...
}
```

#### Change Frontend Port:
Edit `web/vite.config.ts` line 22:
```typescript
server: {
  port: 3000,  // Change to your preferred port
  ...
}
```

---

## Network Configuration

### Access from Other Devices

If you want to access CStrike from other devices on your network:

1. **API Server** - Already configured to listen on `0.0.0.0` (all interfaces)

2. **Frontend Dev Server** - Already configured to listen on `0.0.0.0`

3. **Find your IP address:**
   ```bash
   # macOS/Linux
   ifconfig | grep "inet " | grep -v 127.0.0.1

   # Or on macOS
   ipconfig getifaddr en0
   ```

4. **Access from other devices:**
   ```
   http://YOUR_IP:3000
   ```
   Example: `http://100.73.226.113:3000`

5. **Update WebSocket connection** (if needed):

   The frontend automatically uses `window.location.origin` in development, so this should work automatically through the Vite proxy.

---

## Verification Checklist

### ✅ API Server Health Check
```bash
# Check if running
ps aux | grep api_server.py

# Test API endpoint
curl http://localhost:8000/api/v1/status

# Expected response:
{
  "metrics": {...},
  "services": {...},
  "phase": "idle",
  "timestamp": "..."
}
```

### ✅ Frontend Health Check
```bash
# Check if running
ps aux | grep vite

# Access in browser:
http://localhost:3000

# You should see the CStrike dashboard
```

### ✅ WebSocket Connection Check

Open browser DevTools → Console. You should see:
```
[Socket.IO] Connecting to http://localhost:3000
[Socket.IO] Connected
```

If you see connection errors, restart the API server.

---

## Development vs Production

### Development Mode (Current)
- Frontend: Vite dev server on port 3000
- API: Flask server on port 8000
- Proxy: Vite proxies `/api` and `/socket.io` to port 8000
- Hot reload: Enabled
- Source maps: Enabled

### Production Mode

1. **Build frontend:**
   ```bash
   cd web
   npm run build
   ```

2. **Serve frontend:**
   ```bash
   # Option 1: Use a simple HTTP server
   cd web/dist
   python3 -m http.server 3000

   # Option 2: Use nginx, Apache, or any web server
   # Point document root to: /path/to/cstrike/web/dist
   ```

3. **Configure API URL:**

   Edit `web/.env`:
   ```
   VITE_API_URL=http://YOUR_PRODUCTION_API_URL:8000
   ```

   Then rebuild:
   ```bash
   cd web
   npm run build
   ```

---

## Logs and Debugging

### API Server Logs
```bash
# API server outputs to stdout
# If running in background, redirect to file:
python3 api_server.py > api_server.log 2>&1 &

# View logs:
tail -f api_server.log
```

### Frontend Logs
- Open browser DevTools → Console
- All WebSocket events are logged with `[Socket.IO]` prefix
- API errors are logged with `AxiosError`

### Database Issues
```bash
# Check if database file exists
ls -lh database.db

# If missing, it will be created automatically on first run
```

---

## Clean Restart

If you're experiencing persistent issues:

```bash
# 1. Stop all processes
pkill -f api_server.py
pkill -f vite

# 2. Clear frontend build cache
cd web
rm -rf node_modules/.vite
rm -rf dist

# 3. Reinstall frontend dependencies (if needed)
npm install

# 4. Restart everything
cd ..
./START_CSTRIKE.sh
```

---

## Getting Help

### Check Status
```bash
# 1. Verify API server is running
curl http://localhost:8000/api/v1/status

# 2. Check processes
ps aux | grep -E "api_server|vite"

# 3. Check ports
lsof -i :8000  # API server
lsof -i :3000  # Frontend dev server
```

### Useful Commands
```bash
# View API server logs in real-time
tail -f api_server.log

# Test specific API endpoint
curl http://localhost:8000/api/v1/config

# Check WebSocket connection
# (Install wscat: npm install -g wscat)
wscat -c ws://localhost:8000/socket.io/?EIO=4&transport=websocket
```

---

## Quick Reference

| Component | Port | URL | Status Check |
|-----------|------|-----|--------------|
| API Server | 8000 | http://localhost:8000 | `curl localhost:8000/api/v1/status` |
| Frontend Dev | 3000 | http://localhost:3000 | Open in browser |
| WebSocket | 8000 | ws://localhost:8000/socket.io/ | Check browser console |

**Documentation:**
- `REDESIGN_COMPLETE.md` - Project overview
- `FRONTEND_REDESIGN.md` - Design specification
- `API_DOCUMENTATION_CONFIG_RESULTS.md` - API endpoints

**Quick Start:**
```bash
./START_CSTRIKE.sh
```

Then open http://localhost:3000 in your browser.
