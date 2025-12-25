# CStrike Development Checklist

## Daily Development Startup

### Before You Start Coding

- [ ] Navigate to project directory: `cd /Users/soulofall/projects/cstrike`
- [ ] Pull latest changes: `git pull`
- [ ] Start development servers: `./START_DEV_SERVERS.sh`
- [ ] Wait for health checks to pass
- [ ] Verify frontend loads: Open `http://localhost:3000` in browser
- [ ] Check browser console for errors (should be clean)

### Verification Steps

- [ ] Backend API running on port 8000: `lsof -i :8000`
- [ ] Frontend running on port 3000: `lsof -i :3000`
- [ ] Backend health: `curl http://localhost:8000/api/v1/targets`
- [ ] Proxy working: `curl http://localhost:3000/api/v1/targets`
- [ ] Browser DevTools Network tab shows successful requests

---

## During Development

### Frontend Changes

- [ ] Changes auto-reload via HMR (no manual refresh needed)
- [ ] Check browser console for errors
- [ ] Verify API calls in Network tab
- [ ] Test in browser at `http://localhost:3000`

### Backend Changes

- [ ] Stop backend: `Ctrl+C` in backend terminal
- [ ] Restart backend: `python3 api_server.py`
- [ ] Wait for server to start (watch for "CStrike API Server starting")
- [ ] Verify endpoints work: `curl http://localhost:8000/api/v1/targets`

### API Integration

- [ ] Use relative paths in frontend: `/api/v1/...` NOT `http://localhost:8000/api/v1/...`
- [ ] Check Vite proxy is working (requests show as `localhost:3000` in Network tab)
- [ ] No CORS errors in browser console
- [ ] Backend logs show incoming requests

---

## Before Committing Code

### Code Quality

- [ ] Run linter: `cd web && npm run lint`
- [ ] Fix any linting errors
- [ ] Remove console.log statements (unless intentional)
- [ ] Remove commented-out code
- [ ] Update TypeScript types if needed

### Testing

- [ ] Test all modified features manually
- [ ] Test API endpoints with curl or Postman
- [ ] Check browser console for errors
- [ ] Verify WebSocket connections (if applicable)
- [ ] Test on different browsers (Chrome, Firefox, Safari)

### Build Verification

- [ ] Frontend builds successfully: `cd web && npm run build`
- [ ] No TypeScript errors
- [ ] No build warnings (or document why they exist)

### Documentation

- [ ] Update README if new features added
- [ ] Document new API endpoints
- [ ] Add code comments for complex logic
- [ ] Update TypeScript types/interfaces

---

## End of Day Shutdown

### Clean Shutdown

- [ ] Save all work and commit changes
- [ ] Stop dev servers: `./START_DEV_SERVERS.sh stop` or `Ctrl+C`
- [ ] Verify no orphaned processes: `lsof -i :3000 :8000`
- [ ] Clean up any test files or logs
- [ ] Push commits to remote (if ready)

### Optional Cleanup

- [ ] Clear node_modules cache: `cd web && rm -rf node_modules/.vite`
- [ ] Review and clean logs: `ls -lh logs/`
- [ ] Archive old logs if needed

---

## Troubleshooting Checklist

### Frontend Not Loading

- [ ] Is Vite running? `lsof -i :3000`
- [ ] If not, start it: `cd web && npm run dev`
- [ ] Check frontend logs: `tail -f logs/frontend.log`
- [ ] Clear browser cache and hard refresh
- [ ] Check for build errors in terminal

### API Requests Failing

- [ ] Is backend running? `lsof -i :8000`
- [ ] If not, start it: `python3 api_server.py`
- [ ] Test backend directly: `curl http://localhost:8000/api/v1/targets`
- [ ] Check backend logs: `tail -f logs/backend.log`
- [ ] Verify you're accessing via proxy (port 3000, not 8000)
- [ ] Check Vite proxy config: `cat web/vite.config.ts`

### Port Conflicts

- [ ] Identify process using port: `lsof -i :3000` or `lsof -i :8000`
- [ ] Kill process: `kill -9 <PID>`
- [ ] Restart servers: `./START_DEV_SERVERS.sh`

### WebSocket Issues

- [ ] Backend WebSocket enabled: Check `api_server.py` has SocketIO
- [ ] Frontend Socket.IO client connected: Check browser console
- [ ] Proxy supports WebSocket: Check `ws: true` in vite.config.ts
- [ ] No firewall blocking WebSocket connections

### CORS Errors

- [ ] Are you accessing via `http://localhost:3000`? (NOT port 8000)
- [ ] Using relative API paths? (`/api/v1/...` NOT `http://...`)
- [ ] Backend CORS configured: `origins=['http://localhost:3000']`
- [ ] Not making direct backend calls from frontend

---

## New Developer Onboarding

### Initial Setup

- [ ] Clone repository: `git clone <repo-url>`
- [ ] Install Python dependencies: `pip install -r requirements.txt`
- [ ] Install Node dependencies: `cd web && npm install`
- [ ] Create .env file (if needed)
- [ ] Make startup script executable: `chmod +x START_DEV_SERVERS.sh`

### First Run

- [ ] Read QUICKSTART.md
- [ ] Read FRONTEND_BACKEND_TROUBLESHOOTING.md
- [ ] Start servers: `./START_DEV_SERVERS.sh`
- [ ] Verify everything works
- [ ] Test making a simple code change

### Learn the Stack

- [ ] Review web/README_DEVELOPMENT.md
- [ ] Understand Vite proxy configuration
- [ ] Learn project structure
- [ ] Review TypeScript types
- [ ] Understand API endpoints

---

## Production Deployment Checklist

### Pre-Deployment

- [ ] All tests passing
- [ ] Production build successful: `cd web && npm run build`
- [ ] Environment variables configured
- [ ] Secrets management in place
- [ ] Database migrations ready (if applicable)
- [ ] Backup current production state

### Deployment

- [ ] Build production frontend: `npm run build`
- [ ] Test production build locally: `npm run preview`
- [ ] Deploy backend first (ensure backward compatibility)
- [ ] Deploy frontend second
- [ ] Verify health checks pass
- [ ] Monitor logs for errors

### Post-Deployment

- [ ] Smoke test all major features
- [ ] Check error monitoring dashboard
- [ ] Verify API endpoints responding
- [ ] Test WebSocket connections
- [ ] Monitor performance metrics
- [ ] Document deployment in CHANGELOG

---

## Emergency Procedures

### Service Down

1. [ ] Check if process is running: `lsof -i :3000 :8000`
2. [ ] Check logs: `tail -f logs/*.log`
3. [ ] Restart service: `./START_DEV_SERVERS.sh`
4. [ ] Verify health checks
5. [ ] Investigate root cause

### Data Loss Prevention

1. [ ] Commit work frequently
2. [ ] Push to remote regularly
3. [ ] Backup database (if applicable)
4. [ ] Don't work directly in production

### Rollback Procedure

1. [ ] Stop current deployment
2. [ ] Restore previous version from git: `git checkout <previous-commit>`
3. [ ] Rebuild: `cd web && npm install && npm run build`
4. [ ] Restart services
5. [ ] Verify functionality
6. [ ] Investigate issue before re-deploying

---

## Performance Optimization

### Frontend

- [ ] Check bundle size: `cd web && npm run build` (check output)
- [ ] Lazy load routes/components where appropriate
- [ ] Optimize images and assets
- [ ] Use React Query cache effectively
- [ ] Minimize re-renders

### Backend

- [ ] Monitor API response times
- [ ] Optimize database queries
- [ ] Add caching where appropriate
- [ ] Use connection pooling
- [ ] Rate limit expensive endpoints

---

## Security Checklist

### Development

- [ ] No hardcoded secrets or API keys
- [ ] Use environment variables for sensitive data
- [ ] Don't commit .env files
- [ ] Validate all user inputs
- [ ] Sanitize data before display

### API Security

- [ ] Authentication on protected endpoints
- [ ] Authorization checks
- [ ] Rate limiting configured
- [ ] Input validation
- [ ] SQL injection prevention
- [ ] XSS protection

---

## Quick Commands Reference

```bash
# Start everything
./START_DEV_SERVERS.sh

# Stop everything
./START_DEV_SERVERS.sh stop

# Check status
./START_DEV_SERVERS.sh status

# View logs
tail -f logs/backend.log
tail -f logs/frontend.log

# Health checks
curl http://localhost:8000/api/v1/targets
curl http://localhost:3000/api/v1/targets

# Check ports
lsof -i :3000 :8000

# Kill port processes
lsof -ti:3000 | xargs kill -9
lsof -ti:8000 | xargs kill -9

# Frontend only
cd web && npm run dev

# Backend only
python3 api_server.py

# Build production
cd web && npm run build
```

---

## Documentation Index

- **Quick Start**: `QUICKSTART.md` - Fast reference for daily use
- **Troubleshooting**: `FRONTEND_BACKEND_TROUBLESHOOTING.md` - Detailed issue resolution
- **Development Guide**: `web/README_DEVELOPMENT.md` - Frontend development details
- **Issue Resolution**: `ISSUE_RESOLUTION_SUMMARY.md` - Historical issue tracking
- **This Checklist**: `DEVELOPER_CHECKLIST.md` - Complete development workflow

---

**Last Updated**: December 25, 2025
**Maintained By**: DevOps Team
