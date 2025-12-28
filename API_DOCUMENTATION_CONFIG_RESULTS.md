# Configuration and Results Management API Documentation

This document describes the new API endpoints for Configuration Management and Results Browsing added to the CStrike API server.

## Base URL

```
http://localhost:8000/api/v1
```

---

## Configuration Management Endpoints

### GET /api/v1/config

Read the current configuration from the `.env` file with sensitive fields masked.

**Response:**

```json
{
  "openai_api_key": "sk-proj-...",
  "allow_exploitation": true,
  "scan_modes": ["port", "http", "dns", "vulnscan"],
  "allowed_tools": ["nmap", "ffuf", "sqlmap", "nuclei", "hydra"],
  "max_threads": 10,
  "max_runtime": 300,
  "msf_username": "msf",
  "msf_password": "***",
  "msf_host": "127.0.0.1",
  "msf_port": 55552,
  "zap_host": "127.0.0.1",
  "zap_port": 8090,
  "target_scope": ["culpur.net"]
}
```

**Masked Fields:**
- `openai_api_key`: Shows first 8 characters followed by "..."
- `msf_password`: Shows "***"

**Example:**

```bash
curl http://localhost:8000/api/v1/config
```

---

### PUT /api/v1/config

Update the configuration in the `.env` file.

**Request Body:**

Complete configuration object (same structure as GET response).

**Behavior:**
- If `openai_api_key` ends with "...", the existing key is preserved
- If `msf_password` is "***", the existing password is preserved
- Required fields are validated
- Invalid field types are rejected

**Required Fields:**
- `allowed_tools` (array)
- `scan_modes` (array)
- `max_threads` (integer)
- `max_runtime` (integer)

**Response:**

```json
{
  "success": true,
  "message": "Configuration updated"
}
```

**Error Response (400):**

```json
{
  "error": "Missing required field: max_threads"
}
```

**Example:**

```bash
curl -X PUT http://localhost:8000/api/v1/config \
  -H "Content-Type: application/json" \
  -d '{
    "openai_api_key": "...",
    "allow_exploitation": true,
    "scan_modes": ["port", "http"],
    "allowed_tools": ["nmap", "ffuf"],
    "max_threads": 15,
    "max_runtime": 600,
    "msf_username": "msf",
    "msf_password": "***",
    "msf_host": "127.0.0.1",
    "msf_port": 55552,
    "zap_host": "127.0.0.1",
    "zap_port": 8090,
    "target_scope": ["culpur.net"]
  }'
```

---

## Results Management Endpoints

### GET /api/v1/results

List all targets with their scan results status.

**Response:**

```json
{
  "targets": [
    {
      "target": "culpur.net",
      "status": "completed",
      "started_at": "2025-12-28T10:00:00Z",
      "completed_at": "2025-12-28T10:45:00Z",
      "loot_count": 42,
      "results_available": true
    }
  ],
  "count": 1
}
```

**Fields:**
- `target`: Target domain/IP
- `status`: "completed", "running", or "unknown"
- `started_at`: ISO 8601 timestamp (if available)
- `completed_at`: ISO 8601 timestamp (if available)
- `loot_count`: Total number of loot items collected
- `results_available`: Whether results.json exists

**Example:**

```bash
curl http://localhost:8000/api/v1/results
```

---

### GET /api/v1/results/<target>

Get detailed scan results for a specific target.

**Path Parameters:**
- `target`: Target domain/IP (URL-encoded if necessary)

**Response:**

```json
{
  "target": "culpur.net",
  "started_at": "2025-12-28T10:00:00Z",
  "completed_at": "2025-12-28T10:45:00Z",
  "ports": [
    {
      "port": 80,
      "service": "http",
      "version": "nginx 1.18.0"
    },
    {
      "port": 443,
      "service": "https",
      "version": "nginx 1.18.0"
    }
  ],
  "subdomains": [
    "api.culpur.net",
    "login.culpur.net",
    "bema.culpur.net"
  ],
  "urls": [
    "https://culpur.net",
    "https://api.culpur.net"
  ],
  "vulnerabilities": [
    {
      "name": "Missing Security Headers",
      "severity": "low",
      "description": "Server missing recommended security headers",
      "affected_target": "https://culpur.net"
    }
  ],
  "dns_records": {
    "A": ["172.67.152.215", "104.21.23.162"],
    "MX": ["mail.culpur.net"],
    "TXT": ["v=spf1 include:_spf.google.com ~all"]
  },
  "loot": {
    "usernames": ["admin", "root", "user"],
    "passwords": ["password123", "admin123"],
    "urls": ["https://culpur.net/admin"],
    "ports": ["80", "443", "22"]
  }
}
```

**Error Response (404):**

```json
{
  "error": "Target not found"
}
```

```json
{
  "error": "No results available"
}
```

**Example:**

```bash
curl http://localhost:8000/api/v1/results/culpur.net
```

---

### GET /api/v1/results/<target>/download

Download scan results as JSON or Markdown.

**Path Parameters:**
- `target`: Target domain/IP (URL-encoded if necessary)

**Query Parameters:**
- `format`: "json" or "markdown" (default: "json")

**Response (JSON format):**

File download with `Content-Type: application/json` and `Content-Disposition: attachment`.

**Response (Markdown format):**

File download with `Content-Type: text/markdown` and `Content-Disposition: attachment`.

Markdown report includes:
- Summary (target, timestamps)
- Open Ports table
- Discovered Subdomains list
- Discovered URLs list
- Vulnerabilities (categorized by severity)
- Loot Collected (usernames, passwords)
- DNS Records (by type)

**Error Response (404):**

```json
{
  "error": "Target not found"
}
```

```json
{
  "error": "No results"
}
```

**Error Response (400):**

```json
{
  "error": "Invalid format. Use \"json\" or \"markdown\""
}
```

**Example (JSON):**

```bash
curl http://localhost:8000/api/v1/results/culpur.net/download?format=json \
  -o culpur_net_results.json
```

**Example (Markdown):**

```bash
curl http://localhost:8000/api/v1/results/culpur.net/download?format=markdown \
  -o culpur_net_report.md
```

---

## WebSocket Events

### log_entry Event

Real-time log streaming via WebSocket.

**Event Name:** `log_entry`

**Payload:**

```json
{
  "id": "1735392000000-a3f2",
  "timestamp": "2025-12-28T12:00:00.000Z",
  "level": "INFO",
  "source": "system",
  "message": "Scan completed successfully",
  "metadata": {
    "target": "culpur.net",
    "scan_id": "scan_1735392000000_1234",
    "tool": "nmap"
  }
}
```

**Fields:**
- `id`: Unique log entry identifier
- `timestamp`: ISO 8601 timestamp
- `level`: "DEBUG", "INFO", "WARNING", "ERROR"
- `source`: Logger name/source
- `message`: Log message
- `metadata`: Additional context (optional)
  - `target`: Target being scanned
  - `scan_id`: Associated scan ID
  - `tool`: Tool that generated the log

**Usage (JavaScript):**

```javascript
const socket = io('http://localhost:8000');

socket.on('log_entry', (log) => {
  console.log(`[${log.level}] ${log.message}`);
  if (log.metadata.target) {
    console.log(`  Target: ${log.metadata.target}`);
  }
});
```

---

## Testing

A comprehensive test script is provided at `/test_new_endpoints.py`.

**Run tests:**

```bash
# Start the API server first
python3 api_server.py

# In another terminal, run the tests
python3 test_new_endpoints.py
```

**Tests included:**
1. GET /api/v1/config - Verify secrets are masked
2. PUT /api/v1/config - Update configuration
3. GET /api/v1/results - List all targets
4. GET /api/v1/results/<target> - Get detailed results
5. Download JSON format
6. Download Markdown format
7. Validation and error handling

---

## Sample Data

Sample test data is available in `/results/culpur.net/`:
- `results.json` - Complete scan results
- `loot.json` - Collected loot items

---

## Error Handling

All endpoints follow consistent error response format:

```json
{
  "error": "Error description"
}
```

**Common Status Codes:**
- `200 OK` - Success
- `400 Bad Request` - Invalid input or validation error
- `404 Not Found` - Resource not found
- `500 Internal Server Error` - Server error

---

## Security Considerations

1. **Secret Masking**: Sensitive fields (`openai_api_key`, `msf_password`) are automatically masked in GET responses
2. **Secret Preservation**: Masked values in PUT requests preserve existing secrets
3. **Input Validation**: All inputs are validated for type and required fields
4. **Path Traversal**: Target paths are validated to prevent directory traversal attacks
5. **Rate Limiting**: Consider implementing rate limiting for production use

---

## Integration Examples

### Python

```python
import requests

# Get configuration
response = requests.get('http://localhost:8000/api/v1/config')
config = response.json()

# Update max threads
config['max_threads'] = 20
requests.put('http://localhost:8000/api/v1/config', json=config)

# Get all results
response = requests.get('http://localhost:8000/api/v1/results')
targets = response.json()['targets']

# Download markdown report
response = requests.get('http://localhost:8000/api/v1/results/culpur.net/download?format=markdown')
with open('report.md', 'wb') as f:
    f.write(response.content)
```

### JavaScript (Fetch API)

```javascript
// Get configuration
const config = await fetch('http://localhost:8000/api/v1/config')
  .then(res => res.json());

// Update configuration
await fetch('http://localhost:8000/api/v1/config', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...config, max_threads: 20 })
});

// Get target results
const results = await fetch('http://localhost:8000/api/v1/results/culpur.net')
  .then(res => res.json());

// Download JSON report
const blob = await fetch('http://localhost:8000/api/v1/results/culpur.net/download?format=json')
  .then(res => res.blob());
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'results.json';
a.click();
```

### cURL

```bash
# Get config
curl http://localhost:8000/api/v1/config

# Update config
curl -X PUT http://localhost:8000/api/v1/config \
  -H "Content-Type: application/json" \
  -d @config.json

# Get all results
curl http://localhost:8000/api/v1/results

# Get target results
curl http://localhost:8000/api/v1/results/culpur.net

# Download markdown report
curl http://localhost:8000/api/v1/results/culpur.net/download?format=markdown \
  -o report.md
```

---

## Changelog

**2025-12-28** - Initial implementation
- Added GET/PUT /api/v1/config endpoints
- Added GET /api/v1/results endpoints
- Added GET /api/v1/results/<target> endpoint
- Added GET /api/v1/results/<target>/download endpoint
- Added WebSocket log streaming via log_entry event
- Added markdown report generation
- Created comprehensive test suite
