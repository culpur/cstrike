# Concurrent Scanning Implementation Guide

## Overview

The CStrike platform now supports multi-target concurrent scanning, allowing you to scan multiple targets simultaneously while maintaining thread safety and resource management.

## Backend Architecture

### Thread Safety

All scan operations are protected by a `threading.Lock` to ensure thread-safe access to shared state:

```python
active_scans_lock = threading.Lock()  # Thread safety for concurrent scans
scan_threads = {}  # Track running threads for cancellation
```

### Scan Management

Each scan receives a unique ID and is tracked independently:

```python
scan_id = f"scan_{int(time.time() * 1000)}_{hash(target) % 10000}"
```

Scans can be in the following states:
- `running` - Scan is actively executing
- `completed` - Scan finished successfully
- `failed` - Scan encountered an error
- `cancelled` - Scan was manually stopped
- `cancelling` - Cancellation requested, scan stopping

## API Endpoints

### 1. POST /api/v1/recon/start

Start a reconnaissance scan on a single target.

**Request:**
```json
{
  "target": "https://example.com",
  "tools": ["nmap", "whatweb", "nuclei"]
}
```

**Response:**
```json
{
  "scan_id": "scan_1735141234567_8234",
  "status": "started",
  "target": "https://example.com"
}
```

**Features:**
- Supports concurrent scanning (no single-scan restriction)
- Each scan runs in its own thread
- Thread-safe scan tracking
- Cancellation support via stop events

### 2. GET /api/v1/recon/active

Get a list of all currently running scans.

**Response:**
```json
{
  "active_scans": [
    {
      "scan_id": "scan_1735141234567_8234",
      "target": "https://example.com",
      "tools": ["nmap", "whatweb"],
      "running_tools": ["nmap", "whatweb"],
      "started_at": "2025-12-25T10:30:00.000Z",
      "status": "running"
    }
  ],
  "count": 1
}
```

**Use Cases:**
- Monitor all active scans in real-time
- Display concurrent scan progress in UI
- Track resource utilization

### 3. POST /api/v1/recon/batch

Start scans on multiple targets simultaneously.

**Request:**
```json
{
  "targets": [
    "https://example.com",
    "https://test.com",
    "https://demo.com"
  ],
  "tools": ["nmap", "whatweb"]
}
```

**Response:**
```json
{
  "status": "started",
  "scan_ids": [
    "scan_1735141234567_8234",
    "scan_1735141234568_9123",
    "scan_1735141234569_7456"
  ],
  "successful": 3,
  "total": 3
}
```

**Error Response (partial failure):**
```json
{
  "status": "started",
  "scan_ids": ["scan_1735141234567_8234"],
  "successful": 1,
  "total": 2,
  "failed": [
    {
      "target": "https://invalid-target",
      "reason": "Invalid target format"
    }
  ]
}
```

**Limits:**
- Maximum 10 concurrent scans
- Invalid targets are skipped and reported in `failed` array

### 4. DELETE /api/v1/recon/scans/{scan_id}

Cancel a running scan and clean up resources.

**Response:**
```json
{
  "scan_id": "scan_1735141234567_8234",
  "status": "cancelling",
  "message": "Scan cancellation requested. The scan will stop shortly."
}
```

**Error Cases:**
- Scan not found (404)
- Scan not running (400)

## Frontend Integration

### API Service Methods

```typescript
// Start single scan
await apiService.startRecon(target, tools);

// Get active scans
const response = await apiService.getActiveScans();

// Start batch scan
const result = await apiService.startBatchRecon(targets, tools);

// Cancel scan
await apiService.stopRecon(scanId);
```

### ReconnaissanceView Features

1. **Active Scans Panel**
   - Displays all currently running scans
   - Shows scan ID, target, start time, and running tools
   - Individual cancel button for each scan
   - Auto-refreshes every 3 seconds

2. **Batch Scan Button**
   - "Scan All Targets" button in Tools panel
   - Starts concurrent scans for all configured targets
   - Shows success/failure counts in toast notifications
   - Disabled when no targets or no tools selected

3. **Per-Target Scan Controls**
   - Individual scan/stop buttons for each target
   - Automatically detects if target has active scan
   - Updates button state based on active scans

## WebSocket Events

The backend emits real-time events for scan progress:

### recon_output

```json
{
  "scan_id": "scan_1735141234567_8234",
  "target": "https://example.com",
  "event": "started|completed|failed|cancelled",
  "message": "Status message",
  "timestamp": "2025-12-25T10:30:00.000Z"
}
```

## Thread Safety Guarantees

### Active Scans Dictionary

All operations on `active_scans` are protected:

```python
with active_scans_lock:
    active_scans[scan_id] = {
        'status': 'running',
        'target': target,
        'tools': tools,
        'started_at': datetime.now(timezone.utc).isoformat()
    }
```

### Thread Cleanup

Threads are automatically cleaned up on completion:

```python
with active_scans_lock:
    if scan_id in scan_threads:
        del scan_threads[scan_id]
```

### Stop Events

Each scan has its own stop event for clean cancellation:

```python
stop_event = threading.Event()
if stop_event.is_set():
    raise Exception("Scan cancelled")
```

## Resource Management

### Concurrency Limits

- **Maximum concurrent scans:** 10 (configurable via `MAX_CONCURRENT_SCANS`)
- **Thread type:** Daemon threads (auto-cleanup on exit)
- **Scan isolation:** Each scan runs independently

### Memory Management

- Completed scans remain in `active_scans` for status retrieval
- Thread references cleaned up immediately on completion
- Stop events garbage collected with scan info

## Error Handling

### Backend Error States

1. **Scan Initialization Errors**
   - Invalid target format
   - Missing required parameters
   - Concurrency limit exceeded

2. **Scan Execution Errors**
   - Tool execution failures
   - Network errors
   - Cancellation during execution

3. **Cancellation Errors**
   - Scan not found
   - Scan already completed
   - Scan not in running state

### Frontend Error Handling

```typescript
try {
  await apiService.startBatchRecon(targets, tools);
  addToast({ type: 'success', message: 'Batch scan started' });
} catch (error) {
  addToast({ type: 'error', message: 'Failed to start batch scan' });
}
```

## Testing Concurrent Scans

### Manual Testing

1. **Start Multiple Scans**
   ```bash
   # Terminal 1
   curl -X POST http://localhost:8000/api/v1/recon/start \
     -H "Content-Type: application/json" \
     -d '{"target": "https://example.com", "tools": ["nmap"]}'

   # Terminal 2
   curl -X POST http://localhost:8000/api/v1/recon/start \
     -H "Content-Type: application/json" \
     -d '{"target": "https://test.com", "tools": ["nmap"]}'
   ```

2. **Check Active Scans**
   ```bash
   curl http://localhost:8000/api/v1/recon/active
   ```

3. **Batch Scan**
   ```bash
   curl -X POST http://localhost:8000/api/v1/recon/batch \
     -H "Content-Type: application/json" \
     -d '{
       "targets": ["https://example.com", "https://test.com"],
       "tools": ["nmap", "whatweb"]
     }'
   ```

4. **Cancel Scan**
   ```bash
   curl -X DELETE http://localhost:8000/api/v1/recon/scans/scan_1735141234567_8234
   ```

### UI Testing

1. Add multiple targets via the UI
2. Select reconnaissance tools
3. Click "Scan All Targets" button
4. Verify Active Scans panel shows all running scans
5. Test individual scan cancellation
6. Monitor WebSocket events in browser console

## Performance Considerations

### Optimal Concurrency

- **Low-resource systems:** 2-3 concurrent scans
- **Medium-resource systems:** 5-7 concurrent scans
- **High-resource systems:** 10+ concurrent scans

### Monitoring

Monitor system resources during concurrent scanning:

```python
# CPU usage
system_metrics['cpu'] = psutil.cpu_percent(interval=1)

# Memory usage
system_metrics['ram'] = psutil.virtual_memory().percent
```

### Throttling

Consider implementing rate limiting for scan starts:

```python
# Example: Limit to 1 scan start per second per IP
from flask_limiter import Limiter
limiter = Limiter(app, key_func=get_remote_address)

@app.route('/api/v1/recon/start', methods=['POST'])
@limiter.limit("1 per second")
def start_recon():
    # ...
```

## Security Considerations

1. **Input Validation**
   - Validate all target URLs
   - Sanitize tool names
   - Enforce concurrency limits

2. **Resource Protection**
   - Thread-safe state management
   - Proper cleanup on errors
   - Graceful handling of cancellation

3. **Access Control**
   - Add authentication for scan endpoints
   - Implement per-user scan limits
   - Log all scan operations

## Future Enhancements

1. **Scan Queuing**
   - Queue scans when limit reached
   - Priority-based execution
   - Scheduled scanning

2. **Resource Allocation**
   - Per-scan CPU/memory limits
   - Dynamic concurrency based on system load
   - Tool-specific resource profiles

3. **Advanced Monitoring**
   - Per-scan progress tracking
   - Tool-level status updates
   - Estimated completion times

4. **Scan Templates**
   - Pre-configured tool sets
   - Target groups
   - Recurring scans

## Troubleshooting

### Scans Not Starting

1. Check active scan count: `GET /api/v1/recon/active`
2. Verify concurrency limit not exceeded
3. Check backend logs for errors
4. Verify target format is valid

### Scans Not Cancelling

1. Verify scan is in "running" state
2. Check scan_id is correct
3. Monitor for "cancelling" status
4. Check if recon module supports interruption

### Memory Leaks

1. Monitor active_scans dictionary size
2. Verify completed scans are cleaned up
3. Check thread references are deleted
4. Review scan_threads for orphaned entries

## File Locations

- **Backend API:** `/Users/soulofall/projects/cstrike/api_server.py`
- **Frontend View:** `/Users/soulofall/projects/cstrike/web/src/modules/reconnaissance/ReconnaissanceView.tsx`
- **API Service:** `/Users/soulofall/projects/cstrike/web/src/services/api.ts`
- **Documentation:** `/Users/soulofall/projects/cstrike/docs/CONCURRENT_SCANNING_GUIDE.md`

## Summary

The concurrent scanning implementation provides:

- Thread-safe multi-target scanning
- Real-time scan monitoring and control
- Batch scanning capabilities
- Individual scan cancellation
- Resource management and cleanup
- Comprehensive error handling
- WebSocket-based real-time updates

This enables efficient reconnaissance operations across multiple targets while maintaining system stability and user control.
