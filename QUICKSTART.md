# CStrike Development - Quick Start Guide

## 🚀 Start Development (One Command)

```bash
START_DEV_SERVERS.sh
```

This starts both backend and frontend with health checks.

---

## 📍 Access Points

| Service | URL | Status Check |
|---------|-----|--------------|
| **Frontend** | http://localhost:3000 | `lsof -i :3000` |
| **Backend API** | http://localhost:8000 | `lsof -i :8000` |
| **WebSocket** | ws://localhost:8000/socket.io | Backend logs |

---

## 🔧 Manual Start (Alternative)

### Terminal 1: Backend
```bash
cd 
python3 api_server.py
```

### Terminal 2: Frontend
```bash
cd web
npm run dev
```

---

## ✅ Health Check

```bash
# Check both services running
lsof -i :3000 :8000

# Test backend
curl http://localhost:8000/api/v1/targets

# Test frontend proxy
curl http://localhost:3000/api/v1/targets

# Both should return: {"targets": ["culpur.net"]}
```

---

## 🛑 Stop Development

```bash
START_DEV_SERVERS.sh stop
```

Or press `Ctrl+C` in the terminal running the script.

---

## 📊 Check Status

```bash
START_DEV_SERVERS.sh status
```

---

## 🐛 Common Issues

### Issue: "Failed to fetch" or 500 errors

**Cause**: Frontend dev server not running

**Fix**:
```bash
cd web
npm run dev
```

### Issue: Port already in use

**Fix**:
```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Kill process on port 8000
lsof -ti:8000 | xargs kill -9

# Then restart
START_DEV_SERVERS.sh
```

### Issue: API requests not working

**Check**:
1. Both servers running? `lsof -i :3000 :8000`
2. Accessing via proxy? Use `http://localhost:3000` NOT `http://localhost:8000`
3. Using relative paths? Use `/api/v1/targets` NOT `http://localhost:8000/api/v1/targets`

---

## 📝 View Logs

```bash
# Backend logs
tail -f logs/backend.log

# Frontend logs
tail -f logs/frontend.log

# Both logs (when using automated script, this happens automatically)
tail -f logs/*.log
```

---

## 🔑 Key Rules

1. ✅ **Always start both servers** before development
2. ✅ **Access frontend via port 3000** (not 8000)
3. ✅ **Use relative API paths** in frontend code (`/api/v1/...`)
4. ✅ **Never hardcode backend URL** in frontend
5. ✅ **Use the Vite proxy** for all API requests

---

## 📚 Full Documentation

- **Troubleshooting**: `FRONTEND_BACKEND_TROUBLESHOOTING.md`
- **Development Guide**: `web/README_DEVELOPMENT.md`
- **Issue Resolution**: `ISSUE_RESOLUTION_SUMMARY.md`

---

## 🎯 Development Workflow

```bash
# 1. Start servers
START_DEV_SERVERS.sh

# 2. Open browser
open http://localhost:3000

# 3. Make changes (frontend auto-reloads via HMR)

# 4. For backend changes, restart backend:
#    Press Ctrl+C in backend terminal
#    Then: python3 api_server.py

# 5. When done
#    Press Ctrl+C or run stop command
```

---

## 💡 Pro Tips

- Use automated script for consistent startup
- Keep browser DevTools Network tab open during development
- Watch backend logs for API errors
- Frontend changes hot-reload automatically
- Backend changes require manual restart

---

**Need help?** Check the troubleshooting guide or contact DevOps.
