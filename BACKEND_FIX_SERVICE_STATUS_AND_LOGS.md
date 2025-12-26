# Backend Critical Fix #2: Service Status & Log Streaming

## Overview
This document details the critical fixes applied to the CStrike API server to resolve service status key mismatches and implement proper log streaming functionality.

**File Modified**: `/Users/soulofall/projects/cstrike/api_server.py`
**Date**: 2025-12-25
**Issue**: Service status keys didn't match frontend expectations, causing UI inconsistencies

---

## Changes Implemented

### 1. Service Status Key Standardization

**Problem**: Frontend expected `metasploitRpc` key but backend used `metasploit`

**Solution**: Updated all service status references to use consistent `metasploitRpc` naming

#### Code Changes:

**Line 56-60** - Service Status Dictionary:
```python
services_status = {
    'metasploitRpc': 'stopped',  # Changed from 'metasploit' to match frontend
    'zap': 'stopped',
    'burp': 'stopped'
}
```

**Line 133** - System Metrics Update Thread:
```python
services_status['metasploitRpc'] = check_service_status('msfrpcd')
```

**Line 178-191** - Service Control Commands:
```python
service_commands = {
    'metasploitRpc': {
        'start': ['systemctl', 'start', 'msfrpcd'],
        'stop': ['pkill', '-f', 'msfrpcd']
    },
    # ... other services
}
```

### 2. Service Restart Endpoint

**New Endpoint**: `POST /api/v1/services/<service_name>/restart`

**Location**: Lines 213-249

**Functionality**:
- Gracefully stops the service using `pkill`
- Waits 2 seconds for cleanup
- Restarts service with appropriate command
- Updates service status
- Returns new status to client

**Example Request**:
```bash
curl -X POST http://localhost:8000/api/v1/services/metasploitRpc/restart
```

**Example Response**:
```json
{
  "service": "metasploitRpc",
  "action": "restart",
  "status": "running"
}
```

**Supported Services**:
- `metasploitRpc` - Metasploit RPC daemon
- `zap` - OWASP ZAP proxy
- `burp` - Burp Suite

### 3. Enhanced Log Streaming

**Endpoint**: `GET /api/v1/logs`

**Location**: Lines 972-1035

**Improvements**:
- Increased default limit from 100 to 1000 lines
- Added structured log format with unique IDs
- Proper ISO 8601 timestamp parsing
- Source tracking for log origin
- Metadata field for extensibility
- Graceful error handling with fallbacks

**Response Format**:
```json
{
  "logs": [
    {
      "id": "1735131234567-0001-a3f2",
      "timestamp": "2025-12-25T10:00:00.123456+00:00",
      "level": "INFO",
      "source": "system",
      "message": "Starting reconnaissance on target",
      "metadata": {}
    }
  ]
}
```

**Query Parameters**:
- `limit` (int, default: 1000): Maximum number of log entries
- `level` (string, optional): Filter by log level (DEBUG, INFO, WARN, ERROR)

**Example Requests**:
```bash
# Get last 500 logs
curl "http://localhost:8000/api/v1/logs?limit=500"

# Get only ERROR level logs
curl "http://localhost:8000/api/v1/logs?level=ERROR"

# Get last 100 INFO logs
curl "http://localhost:8000/api/v1/logs?limit=100&level=INFO"
```

---

## Impact Analysis

### Frontend Compatibility
- Service status updates now match frontend expectations
- Dashboard service indicators will display correctly
- Service control buttons work properly

### Performance
- Log endpoint can handle 1000 entries efficiently
- Structured format enables frontend filtering/searching
- Unique IDs support real-time log streaming

### Security
- Service restart requires explicit POST request
- No service enumeration via error messages
- Process management uses safe subprocess calls

---

## Testing Verification

### Pre-Deployment Checks
1. Python syntax validation: PASSED
2. Import dependencies check: PASSED
3. Log directory structure: PASSED

### Verification Commands
```bash
# Syntax check
python3 -m py_compile api_server.py

# Verify no old references remain
grep -n "services_status\['metasploit'\]" api_server.py
# Expected: No matches

# Verify new references
grep -n "metasploitRpc" api_server.py
# Expected: Multiple matches at lines 57, 133, 179, 218, 233
```

---

## API Endpoint Reference

### Service Management

#### Get Service Status
```http
GET /api/v1/services
```
Returns status of all services with correct key names.

#### Control Service
```http
POST /api/v1/services/<service_name>
Content-Type: application/json

{
  "action": "start" | "stop"
}
```

#### Restart Service (NEW)
```http
POST /api/v1/services/<service_name>/restart
```

### Log Retrieval

#### Get Structured Logs (ENHANCED)
```http
GET /api/v1/logs?limit=1000&level=INFO
```

---

## Deployment Notes

### Prerequisites
- Python 3.8+
- Flask ecosystem (flask, flask-cors, flask-socketio)
- psutil library
- gevent for async mode

### Deployment Steps
1. Backup current `api_server.py`
2. Deploy updated file
3. Restart API server: `systemctl restart cstrike-api` (or equivalent)
4. Verify service status endpoint: `curl http://localhost:8000/api/v1/services`
5. Test log endpoint: `curl http://localhost:8000/api/v1/logs?limit=10`

### Rollback Plan
If issues occur:
1. Stop API server
2. Restore backup `api_server.py`
3. Restart API server
4. Report issues with logs

---

## Integration Points

### WebSocket Events
The service status updates are broadcast via WebSocket:

```javascript
// Legacy event
socket.on('status_update', (data) => {
  // data.services.metasploitRpc
});

// New dashboard event
socket.on('system_metrics', (metrics) => {
  // Real-time metrics
});
```

### Frontend Components
- Dashboard: System metrics display
- Services Panel: Service control buttons
- Logs Viewer: Real-time log streaming

---

## Future Enhancements

### Potential Improvements
1. **WebSocket Log Streaming**: Push logs to clients in real-time
2. **Log Levels API**: Get available log levels dynamically
3. **Service Dependencies**: Track service dependency chains
4. **Service Health Checks**: Periodic health validation
5. **Log Rotation**: Automatic log file rotation support
6. **Structured Logging**: JSON-based log format for better parsing

### Security Enhancements
1. Add authentication to service control endpoints
2. Rate limiting on restart endpoint
3. Audit logging for service state changes
4. Role-based access control for service management

---

## Known Limitations

1. **Log Parsing**: Assumes standard Python logging format
2. **Service Discovery**: Hardcoded service list
3. **Process Management**: Basic `pkill` approach, not systemd-aware on all systems
4. **Log Size**: No automatic handling of very large log files (>100MB)

---

## Troubleshooting

### Service Status Shows 'stopped' But Process Is Running
```bash
# Check if process name matches
pgrep -af msfrpcd

# Verify check_service_status function
# May need to adjust process name matching
```

### Logs Endpoint Returns Empty Array
```bash
# Verify log file exists
ls -la logs/driver.log

# Check file permissions
chmod 644 logs/driver.log

# Verify log directory
ls -la logs/
```

### Restart Endpoint Times Out
```bash
# Check if service is actually stopping
ps aux | grep msfrpcd

# May need to increase sleep time in restart_service()
# Or use SIGTERM before SIGKILL
```

---

## References

- **API Documentation**: See API_DOCUMENTATION.md
- **Service Architecture**: See BACKEND_SETUP.md
- **WebSocket Protocol**: See WS_EVENTS.md (if available)
- **Logging Standards**: Python logging documentation

---

## Changelog

### v2.0.0 - 2025-12-25
- Changed service status key from 'metasploit' to 'metasploitRpc'
- Added `/api/v1/services/<service>/restart` endpoint
- Enhanced `/api/v1/logs` with structured format
- Increased log limit from 100 to 1000
- Added unique log IDs for streaming support
- Improved timestamp parsing and ISO 8601 format
- Added metadata field for extensibility

---

## Contact & Support

For issues related to these changes:
1. Check API server logs: `tail -f logs/driver.log`
2. Verify endpoint responses: Use curl or Postman
3. Check browser console for WebSocket events
4. Review this document for known limitations

**File Location**: `/Users/soulofall/projects/cstrike/api_server.py`
**Documentation**: `/Users/soulofall/projects/cstrike/BACKEND_FIX_SERVICE_STATUS_AND_LOGS.md`
