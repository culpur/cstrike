# Concurrent Scanning API Reference

## Overview

The CStrike API supports concurrent scanning operations, allowing multiple reconnaissance scans to run simultaneously. This document provides complete API specifications for all concurrent scanning endpoints.

## Base URL

```
http://localhost:8000/api/v1
```

## Authentication

Currently no authentication required. Future versions will implement JWT-based authentication.

---

## Endpoints

### 1. Start Single Scan

Start a reconnaissance scan on a single target.

**Endpoint:** `POST /recon/start`

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "target": "string (required)",
  "tools": ["string"] (optional, defaults to [])
}
```

**Example Request:**
```bash
curl -X POST http://localhost:8000/api/v1/recon/start \
  -H "Content-Type: application/json" \
  -d '{
    "target": "https://example.com",
    "tools": ["nmap", "whatweb", "nuclei"]
  }'
```

**Success Response (200):**
```json
{
  "scan_id": "scan_1735141234567_8234",
  "status": "started",
  "target": "https://example.com"
}
```

**Error Responses:**

*400 Bad Request - Missing target:*
```json
{
  "error": "Target required"
}
```

**Notes:**
- Each scan receives a unique ID based on timestamp and target hash
- Scans run in independent daemon threads
- Multiple scans can run concurrently
- Scan progress emitted via WebSocket events

---

### 2. Get Active Scans

Retrieve a list of all currently running scans.

**Endpoint:** `GET /recon/active`

**Example Request:**
```bash
curl http://localhost:8000/api/v1/recon/active
```

**Success Response (200):**
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
    },
    {
      "scan_id": "scan_1735141234568_9123",
      "target": "https://test.com",
      "tools": ["nuclei"],
      "running_tools": ["nuclei"],
      "started_at": "2025-12-25T10:30:15.000Z",
      "status": "running"
    }
  ],
  "count": 2
}
```

**Response Fields:**
- `scan_id` - Unique identifier for the scan
- `target` - Target URL being scanned
- `tools` - Tools configured for the scan
- `running_tools` - Tools currently executing (may differ from tools)
- `started_at` - ISO 8601 timestamp when scan started
- `status` - Current scan status (always "running" for active scans)
- `count` - Total number of active scans

**Notes:**
- Only returns scans with status "running"
- Completed and failed scans not included
- Response updates in real-time

---

### 3. Get Scan Status

Retrieve the status of a specific scan by ID.

**Endpoint:** `GET /recon/status/{scan_id}`

**Path Parameters:**
- `scan_id` - The unique scan identifier

**Example Request:**
```bash
curl http://localhost:8000/api/v1/recon/status/scan_1735141234567_8234
```

**Success Response - Running Scan (200):**
```json
{
  "status": "running",
  "target": "https://example.com",
  "tools": ["nmap", "whatweb"],
  "running_tools": ["nmap"],
  "started_at": "2025-12-25T10:30:00.000Z"
}
```

**Success Response - Completed Scan (200):**
```json
{
  "status": "completed",
  "target": "https://example.com",
  "tools": ["nmap", "whatweb"],
  "started_at": "2025-12-25T10:30:00.000Z",
  "completed_at": "2025-12-25T10:35:00.000Z",
  "results": {
    "ports": [80, 443],
    "technologies": ["nginx", "php"]
  }
}
```

**Success Response - Failed Scan (200):**
```json
{
  "status": "failed",
  "target": "https://example.com",
  "tools": ["nmap"],
  "started_at": "2025-12-25T10:30:00.000Z",
  "completed_at": "2025-12-25T10:31:00.000Z",
  "error": "Connection timeout"
}
```

**Success Response - Cancelled Scan (200):**
```json
{
  "status": "cancelled",
  "target": "https://example.com",
  "tools": ["nmap"],
  "started_at": "2025-12-25T10:30:00.000Z",
  "completed_at": "2025-12-25T10:31:30.000Z",
  "error": "Scan cancelled"
}
```

**Error Response (404):**
```json
{
  "error": "Scan not found"
}
```

**Status Values:**
- `running` - Scan is currently executing
- `completed` - Scan finished successfully
- `failed` - Scan encountered an error
- `cancelled` - Scan was manually stopped
- `cancelling` - Cancellation in progress

---

### 4. Start Batch Scan

Start scans on multiple targets simultaneously.

**Endpoint:** `POST /recon/batch`

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "targets": ["string"] (required, min 1, max 10),
  "tools": ["string"] (required)
}
```

**Example Request:**
```bash
curl -X POST http://localhost:8000/api/v1/recon/batch \
  -H "Content-Type: application/json" \
  -d '{
    "targets": [
      "https://example.com",
      "https://test.com",
      "https://demo.com"
    ],
    "tools": ["nmap", "whatweb"]
  }'
```

**Success Response - All Succeeded (200):**
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

**Partial Success Response (200):**
```json
{
  "status": "started",
  "scan_ids": [
    "scan_1735141234567_8234",
    "scan_1735141234568_9123"
  ],
  "successful": 2,
  "total": 3,
  "failed": [
    {
      "target": "https://invalid-target",
      "reason": "Invalid target format"
    }
  ]
}
```

**Error Responses:**

*400 Bad Request - No targets:*
```json
{
  "error": "targets array required"
}
```

*400 Bad Request - Empty targets:*
```json
{
  "error": "At least one target required"
}
```

*400 Bad Request - Too many targets:*
```json
{
  "error": "Maximum 10 concurrent scans allowed"
}
```

*400 Bad Request - All failed:*
```json
{
  "status": "started",
  "scan_ids": [],
  "successful": 0,
  "total": 2,
  "failed": [
    {
      "target": "https://target1.com",
      "reason": "Invalid target format"
    },
    {
      "target": "https://target2.com",
      "reason": "Invalid target format"
    }
  ]
}
```

**Response Fields:**
- `status` - Always "started" for batch requests
- `scan_ids` - Array of successfully started scan IDs
- `successful` - Number of scans started successfully
- `total` - Total number of targets requested
- `failed` - Array of targets that failed to start (optional)

**Constraints:**
- Maximum 10 targets per batch request
- All scans use the same tool configuration
- Invalid targets are skipped and reported in `failed` array
- At least one successful scan required for 200 response

---

### 5. Cancel Scan

Cancel a running scan and clean up resources.

**Endpoint:** `DELETE /recon/scans/{scan_id}`

**Path Parameters:**
- `scan_id` - The unique scan identifier to cancel

**Example Request:**
```bash
curl -X DELETE http://localhost:8000/api/v1/recon/scans/scan_1735141234567_8234
```

**Success Response (200):**
```json
{
  "scan_id": "scan_1735141234567_8234",
  "status": "cancelling",
  "message": "Scan cancellation requested. The scan will stop shortly."
}
```

**Error Responses:**

*404 Not Found - Scan doesn't exist:*
```json
{
  "error": "Scan not found"
}
```

*400 Bad Request - Scan not running:*
```json
{
  "error": "Scan is not running (status: completed)"
}
```

**Notes:**
- Cancellation is asynchronous (scan stops "shortly")
- Stop event is set immediately
- Scan thread detects stop event and terminates
- Scan status transitions: running → cancelling → cancelled
- Monitor status via GET /recon/status/{scan_id}

---

## WebSocket Events

### Connection

Connect to WebSocket server:
```javascript
const ws = new WebSocket('ws://localhost:8000');
```

### Event: recon_output

Emitted for scan lifecycle events.

**Event Types:**
- `started` - Scan has started
- `completed` - Scan finished successfully
- `failed` - Scan encountered an error
- `cancelled` - Scan was cancelled

**Example - Scan Started:**
```json
{
  "scan_id": "scan_1735141234567_8234",
  "target": "https://example.com",
  "event": "started",
  "message": "Starting reconnaissance on https://example.com",
  "timestamp": "2025-12-25T10:30:00.000Z"
}
```

**Example - Scan Completed:**
```json
{
  "scan_id": "scan_1735141234567_8234",
  "target": "https://example.com",
  "event": "completed",
  "results": {
    "ports": [80, 443],
    "services": ["http", "https"],
    "technologies": ["nginx"]
  },
  "timestamp": "2025-12-25T10:35:00.000Z"
}
```

**Example - Scan Failed:**
```json
{
  "scan_id": "scan_1735141234567_8234",
  "target": "https://example.com",
  "event": "failed",
  "error": "Connection timeout",
  "timestamp": "2025-12-25T10:31:00.000Z"
}
```

**Example - Scan Cancelled:**
```json
{
  "scan_id": "scan_1735141234567_8234",
  "target": "https://example.com",
  "event": "cancelled",
  "message": "Scan cancellation requested",
  "timestamp": "2025-12-25T10:31:30.000Z"
}
```

---

## Data Models

### Scan Object

```typescript
interface Scan {
  scan_id: string;              // Unique identifier
  target: string;               // Target URL
  tools: string[];              // Configured tools
  running_tools?: string[];     // Currently executing tools
  started_at: string;           // ISO 8601 timestamp
  completed_at?: string;        // ISO 8601 timestamp (if finished)
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'cancelling';
  results?: object;             // Scan results (if completed)
  error?: string;               // Error message (if failed/cancelled)
  batch?: boolean;              // True if part of batch scan
}
```

### Active Scans Response

```typescript
interface ActiveScansResponse {
  active_scans: Scan[];
  count: number;
}
```

### Batch Scan Response

```typescript
interface BatchScanResponse {
  status: 'started';
  scan_ids: string[];
  successful: number;
  total: number;
  failed?: Array<{
    target: string;
    reason: string;
  }>;
}
```

---

## Rate Limits

Current implementation has no rate limiting. Recommended limits for production:

- **Individual scans:** 10 per minute per IP
- **Batch scans:** 2 per minute per IP
- **Status queries:** 60 per minute per IP
- **Concurrent scans:** Maximum 10 per server

---

## Error Codes

| HTTP Code | Meaning |
|-----------|---------|
| 200 | Success |
| 400 | Bad Request (invalid input) |
| 404 | Not Found (scan doesn't exist) |
| 500 | Internal Server Error |

---

## Thread Safety

All scan operations use thread-safe locking:

```python
with active_scans_lock:
    # Thread-safe operations
    active_scans[scan_id] = {...}
```

This ensures:
- No race conditions between concurrent operations
- Consistent state when querying active scans
- Safe cleanup of completed scans

---

## Best Practices

### 1. Poll Active Scans

Don't rely solely on WebSocket events. Poll active scans periodically:

```javascript
setInterval(async () => {
  const response = await fetch('/api/v1/recon/active');
  const data = await response.json();
  updateUI(data.active_scans);
}, 3000);
```

### 2. Handle Partial Failures

Batch scans may partially succeed:

```javascript
const result = await fetch('/api/v1/recon/batch', {
  method: 'POST',
  body: JSON.stringify({ targets, tools })
});

if (result.failed && result.failed.length > 0) {
  console.warn('Some targets failed:', result.failed);
}
```

### 3. Monitor Scan Status

Track scan lifecycle:

```javascript
async function monitorScan(scanId) {
  const interval = setInterval(async () => {
    const response = await fetch(`/api/v1/recon/status/${scanId}`);
    const data = await response.json();

    if (data.status !== 'running') {
      clearInterval(interval);
      handleCompletion(data);
    }
  }, 2000);
}
```

### 4. Graceful Cancellation

Always verify cancellation:

```javascript
async function cancelScan(scanId) {
  await fetch(`/api/v1/recon/scans/${scanId}`, { method: 'DELETE' });

  // Wait and verify
  await new Promise(resolve => setTimeout(resolve, 2000));
  const status = await fetch(`/api/v1/recon/status/${scanId}`);
  const data = await status.json();

  if (data.status === 'cancelled') {
    console.log('Scan cancelled successfully');
  }
}
```

---

## Examples

### Complete Workflow

```javascript
// 1. Start batch scan
const batchResponse = await fetch('/api/v1/recon/batch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    targets: ['https://example.com', 'https://test.com'],
    tools: ['nmap', 'whatweb']
  })
});

const batch = await batchResponse.json();
console.log(`Started ${batch.successful} scans`);

// 2. Monitor active scans
const activeResponse = await fetch('/api/v1/recon/active');
const active = await activeResponse.json();
console.log(`Currently running: ${active.count} scans`);

// 3. Check specific scan
const scanId = batch.scan_ids[0];
const statusResponse = await fetch(`/api/v1/recon/status/${scanId}`);
const status = await statusResponse.json();
console.log(`Scan ${scanId}: ${status.status}`);

// 4. Cancel if needed
if (status.status === 'running') {
  await fetch(`/api/v1/recon/scans/${scanId}`, { method: 'DELETE' });
  console.log('Cancellation requested');
}
```

---

## Troubleshooting

### Issue: Scans not starting

**Check active scan count:**
```bash
curl http://localhost:8000/api/v1/recon/active | jq '.count'
```

If count is 10, you've hit the concurrency limit.

### Issue: Cancellation not working

**Verify scan is running:**
```bash
curl http://localhost:8000/api/v1/recon/status/SCAN_ID | jq '.status'
```

Only running scans can be cancelled.

### Issue: Scan stuck in "cancelling"

Some tools may not respond to interruption immediately. Wait 30 seconds and check again.

---

## Version History

- **v1.0** (2025-12-25) - Initial concurrent scanning implementation
  - Individual scan endpoint
  - Active scans endpoint
  - Batch scan endpoint
  - Cancel scan endpoint
  - Thread-safe operations
  - WebSocket events

---

## Support

For issues or questions, check:
- Documentation: `/Users/soulofall/projects/cstrike/docs/`
- Backend code: `/Users/soulofall/projects/cstrike/api_server.py`
- Frontend code: `/Users/soulofall/projects/cstrike/web/src/`
