# Quick Start: Configuration and Results API

A quick reference guide for using the new Configuration Management and Results Browsing API endpoints.

---

## Prerequisites

1. Start the API server:
```bash
cd /Users/soulofall/projects/cstrike
python3 api_server.py
```

2. Server will be available at:
- REST API: `http://localhost:8000/api/v1/`
- WebSocket: `ws://localhost:8000/`

---

## Configuration Management

### View Current Configuration

```bash
curl http://localhost:8000/api/v1/config | jq
```

Expected output:
```json
{
  "openai_api_key": "...",      // Masked
  "msf_password": "***",         // Masked
  "allow_exploitation": true,
  "scan_modes": ["port", "http", "dns"],
  "allowed_tools": ["nmap", "ffuf", "nuclei"],
  "max_threads": 10,
  "max_runtime": 300,
  // ... other settings
}
```

### Update Configuration

```bash
# 1. Get current config
curl http://localhost:8000/api/v1/config > config.json

# 2. Edit config.json (change max_threads to 15)
sed -i '' 's/"max_threads": 10/"max_threads": 15/' config.json

# 3. Upload updated config
curl -X PUT http://localhost:8000/api/v1/config \
  -H "Content-Type: application/json" \
  -d @config.json

# Expected response:
# {"success": true, "message": "Configuration updated"}
```

---

## Results Browsing

### List All Scan Results

```bash
curl http://localhost:8000/api/v1/results | jq
```

Expected output:
```json
{
  "targets": [
    {
      "target": "culpur.net",
      "status": "completed",
      "started_at": "2025-12-28T10:00:00Z",
      "completed_at": "2025-12-28T10:45:00Z",
      "loot_count": 7,
      "results_available": true
    }
  ],
  "count": 1
}
```

### View Detailed Results for Target

```bash
curl http://localhost:8000/api/v1/results/culpur.net | jq
```

Expected output:
```json
{
  "target": "culpur.net",
  "started_at": "2025-12-28T10:00:00Z",
  "completed_at": "2025-12-28T10:45:00Z",
  "ports": [...],
  "subdomains": [...],
  "urls": [...],
  "vulnerabilities": [...],
  "dns_records": {...},
  "loot": {...}
}
```

### Download Results as JSON

```bash
curl http://localhost:8000/api/v1/results/culpur.net/download?format=json \
  -o culpur_net_results.json
```

### Download Results as Markdown

```bash
curl http://localhost:8000/api/v1/results/culpur.net/download?format=markdown \
  -o culpur_net_report.md
```

---

## WebSocket Log Streaming

### JavaScript Example

```javascript
const socket = io('http://localhost:8000');

// Listen for real-time logs
socket.on('log_entry', (log) => {
  console.log(`[${log.timestamp}] [${log.level}] ${log.message}`);

  // Access metadata if available
  if (log.metadata.target) {
    console.log(`  Target: ${log.metadata.target}`);
  }
  if (log.metadata.scan_id) {
    console.log(`  Scan ID: ${log.metadata.scan_id}`);
  }
});

socket.on('connect', () => {
  console.log('Connected to CStrike API');
});
```

### Python Example

```python
import socketio

sio = socketio.Client()

@sio.on('log_entry')
def on_log(data):
    print(f"[{data['level']}] {data['message']}")
    if 'target' in data.get('metadata', {}):
        print(f"  Target: {data['metadata']['target']}")

sio.connect('http://localhost:8000')
sio.wait()
```

---

## Testing

### Run Automated Tests

```bash
cd /Users/soulofall/projects/cstrike
python3 test_new_endpoints.py
```

Tests will verify:
- Configuration GET/PUT with secret masking
- Results listing and detailed views
- JSON/Markdown downloads
- Error handling and validation

---

## Common Use Cases

### 1. Update Max Threads for Performance

```bash
# Get config
CONFIG=$(curl -s http://localhost:8000/api/v1/config)

# Update max_threads to 20
echo $CONFIG | jq '.max_threads = 20' | \
curl -X PUT http://localhost:8000/api/v1/config \
  -H "Content-Type: application/json" \
  -d @-
```

### 2. Check if Target Has Results

```bash
TARGET="culpur.net"
curl -s http://localhost:8000/api/v1/results | \
  jq ".targets[] | select(.target == \"$TARGET\")"
```

### 3. Export All Targets as Markdown

```bash
# Get all targets
TARGETS=$(curl -s http://localhost:8000/api/v1/results | jq -r '.targets[].target')

# Download each as markdown
for target in $TARGETS; do
  echo "Downloading report for $target..."
  curl -s "http://localhost:8000/api/v1/results/$target/download?format=markdown" \
    -o "${target//./_}_report.md"
done
```

### 4. Monitor Logs in Real-time

```bash
# Using websocat (install: brew install websocat)
websocat ws://localhost:8000/socket.io/?EIO=4&transport=websocket

# You'll see log_entry events as JSON
```

### 5. Get Summary of All Results

```bash
curl -s http://localhost:8000/api/v1/results | jq '{
  total_targets: .count,
  completed: [.targets[] | select(.status == "completed") | .target],
  total_loot: [.targets[].loot_count] | add
}'
```

---

## Error Handling

### Missing Target (404)

```bash
curl http://localhost:8000/api/v1/results/nonexistent.target

# Response:
# {"error": "Target not found"}
# Status: 404
```

### Invalid Configuration (400)

```bash
curl -X PUT http://localhost:8000/api/v1/config \
  -H "Content-Type: application/json" \
  -d '{"allowed_tools": []}'

# Response:
# {"error": "Missing required field: scan_modes"}
# Status: 400
```

### Invalid Download Format (400)

```bash
curl http://localhost:8000/api/v1/results/culpur.net/download?format=invalid

# Response:
# {"error": "Invalid format. Use \"json\" or \"markdown\""}
# Status: 400
```

---

## Tips

1. **Preserve Secrets**: When updating config, masked values (`...` or `***`) are automatically preserved
2. **URL Encoding**: Target names with special characters are automatically handled
3. **JSON Pretty Print**: Pipe to `jq` for formatted output
4. **Batch Operations**: Use shell loops for bulk operations
5. **Real-time Updates**: Connect WebSocket for live log streaming

---

## Troubleshooting

### Server Not Responding

```bash
# Check if server is running
curl http://localhost:8000/api/v1/status

# If not, start it:
python3 api_server.py
```

### Empty Results List

```bash
# Check if results directory exists
ls -la results/

# Create test data if needed
mkdir -p results/test.target
echo '{"target":"test.target"}' > results/test.target/results.json
```

### WebSocket Not Connecting

```javascript
// Check socket.io version matches server
// Server uses socket.io with gevent async_mode
const socket = io('http://localhost:8000', {
  transports: ['websocket', 'polling']
});
```

---

## API Reference

Full documentation available at:
- `/Users/soulofall/projects/cstrike/API_DOCUMENTATION_CONFIG_RESULTS.md`

Implementation details:
- `/Users/soulofall/projects/cstrike/IMPLEMENTATION_SUMMARY_CONFIG_RESULTS.md`

---

## Support

For issues or questions:
1. Check server logs for errors
2. Verify `.env` file exists and is valid JSON
3. Ensure results directory has proper structure
4. Run test suite to validate installation

---

**Happy Scanning!**
