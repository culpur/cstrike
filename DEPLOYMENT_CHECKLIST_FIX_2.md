# Deployment Checklist: Backend Fix #2

## Pre-Deployment
- [x] Code changes completed
- [x] Python syntax validated
- [x] Import dependencies verified
- [x] All service status references updated
- [x] No old 'metasploit' keys remain
- [x] Documentation created
- [x] Verification summary generated

## Deployment Steps

### 1. Backup Current Version
```bash
cd /Users/soulofall/projects/cstrike
cp api_server.py api_server.py.backup.$(date +%Y%m%d_%H%M%S)
```

### 2. Verify Changes
```bash
# Check syntax
python3 -m py_compile api_server.py

# Verify key changes
grep -c "metasploitRpc" api_server.py
# Expected: 5 instances

# Verify no old references
grep "services_status\['metasploit'\]" api_server.py
# Expected: No output
```

### 3. Stop Current API Server
```bash
# If running via systemd
systemctl stop cstrike-api

# If running manually
pkill -f "python.*api_server.py"

# Verify stopped
ps aux | grep api_server.py
```

### 4. Start New API Server
```bash
cd /Users/soulofall/projects/cstrike
python3 api_server.py

# Or with systemd
systemctl start cstrike-api
systemctl status cstrike-api
```

### 5. Verify Server Started
```bash
# Check if listening
lsof -i :8000

# Check logs
tail -f logs/driver.log

# Expected output:
# "🚀 CStrike API Server starting..."
# "📡 REST API: http://localhost:8000/api/v1/"
# "🔌 WebSocket: ws://localhost:8000/"
```

## Post-Deployment Testing

### Test 1: Service Status Endpoint
```bash
curl http://localhost:8000/api/v1/services
```

**Expected Response**:
```json
{
  "metasploitRpc": "stopped",
  "zap": "stopped",
  "burp": "stopped"
}
```

### Test 2: Status Endpoint
```bash
curl http://localhost:8000/api/v1/status
```

**Verify**:
- `services` object contains `metasploitRpc` key
- No `metasploit` key present
- Metrics returned correctly

### Test 3: Logs Endpoint
```bash
curl "http://localhost:8000/api/v1/logs?limit=5"
```

**Verify**:
- Response contains `logs` array
- Each log has: `id`, `timestamp`, `level`, `source`, `message`, `metadata`
- Timestamps are ISO 8601 format

### Test 4: Logs with Level Filter
```bash
curl "http://localhost:8000/api/v1/logs?limit=10&level=INFO"
```

**Verify**:
- Only INFO level logs returned
- Filtering works correctly

### Test 5: Restart Endpoint (if service running)
```bash
# If metasploit is running
curl -X POST http://localhost:8000/api/v1/services/metasploitRpc/restart

# If not running
curl -X POST http://localhost:8000/api/v1/services/metasploitRpc/restart
# Expected: Error or status update
```

**Expected Response**:
```json
{
  "service": "metasploitRpc",
  "action": "restart",
  "status": "running" | "stopped"
}
```

### Test 6: Invalid Service Name
```bash
curl -X POST http://localhost:8000/api/v1/services/invalid/restart
```

**Expected**: 404 error with message "Unknown service"

### Test 7: Frontend Integration
1. Open frontend at http://localhost:3000
2. Navigate to Dashboard
3. Verify:
   - System metrics display correctly
   - Service status shows correct states
   - Service control buttons work
   - Logs viewer displays structured logs

### Test 8: WebSocket Events
Open browser console and verify:
```javascript
socket.on('status_update', (data) => {
  console.log(data.services.metasploitRpc); // Should exist
  console.log(data.services.metasploit);    // Should be undefined
});
```

## Monitoring

### Check Server Health
```bash
# CPU and memory
ps aux | grep api_server.py

# Port listening
netstat -tlnp | grep 8000

# Recent logs
tail -n 50 logs/driver.log

# Error logs only
grep ERROR logs/driver.log | tail -n 20
```

### Watch for Issues
```bash
# Real-time log monitoring
tail -f logs/driver.log

# Watch for errors
tail -f logs/driver.log | grep -i error

# Monitor service status
watch -n 2 'curl -s http://localhost:8000/api/v1/services'
```

## Rollback Procedure

If any issues occur:

### 1. Stop Current Server
```bash
systemctl stop cstrike-api
# or
pkill -f "python.*api_server.py"
```

### 2. Restore Backup
```bash
cd /Users/soulofall/projects/cstrike
cp api_server.py.backup.* api_server.py
# Choose the most recent backup
```

### 3. Restart Server
```bash
systemctl start cstrike-api
systemctl status cstrike-api
```

### 4. Verify Rollback
```bash
curl http://localhost:8000/api/v1/services
# Should work with old format
```

### 5. Report Issues
Document:
- Error messages from logs
- Failed test cases
- Frontend behavior
- Browser console errors

## Success Criteria

- [ ] API server starts without errors
- [ ] Service status endpoint returns `metasploitRpc` key
- [ ] Logs endpoint returns structured format with IDs
- [ ] Restart endpoint works for all services
- [ ] Frontend dashboard displays correctly
- [ ] No console errors in browser
- [ ] WebSocket events received properly
- [ ] Service controls functional

## Post-Deployment Actions

### 1. Document Issues
```bash
# Create deployment log
cat > /Users/soulofall/projects/cstrike/DEPLOYMENT_LOG_FIX_2.txt << EOF
Date: $(date)
Deployed: Backend Fix #2
Status: SUCCESS
Issues: None
Notes: All tests passed
EOF
```

### 2. Update Team
- Notify team of changes
- Share API endpoint updates
- Provide new log format documentation

### 3. Monitor for 24 Hours
- Check logs periodically
- Monitor error rates
- Verify service stability
- Watch for frontend issues

### 4. Clean Up Old Backups
```bash
# After 7 days of stable operation
find /Users/soulofall/projects/cstrike -name "api_server.py.backup.*" -mtime +7 -delete
```

## Support Resources

### Documentation
- `/Users/soulofall/projects/cstrike/BACKEND_FIX_SERVICE_STATUS_AND_LOGS.md`
- `/Users/soulofall/projects/cstrike/QUICK_REFERENCE_BACKEND_FIX_2.md`
- `/Users/soulofall/projects/cstrike/VERIFICATION_SUMMARY_FIX_2.txt`

### Key Files
- Modified: `/Users/soulofall/projects/cstrike/api_server.py`
- Logs: `/Users/soulofall/projects/cstrike/logs/driver.log`

### Testing Commands
```bash
# Quick health check
curl http://localhost:8000/api/v1/status

# Full test suite
cd /Users/soulofall/projects/cstrike
bash DEPLOYMENT_CHECKLIST_FIX_2.md  # Use test commands above
```

---

**Deployment Date**: 2025-12-25
**Version**: 2.0.0
**Status**: Ready for deployment
