# Credential Validation - Quick Reference Card

## Installation

```bash
pip install paramiko requests
```

## API Endpoints

### Single Validation
```bash
POST /api/v1/loot/credentials/validate
{
  "credential_id": "cred_123",
  "target": "192.168.1.10",
  "username": "admin",
  "password": "password123",
  "service": "ssh",
  "port": 22
}
```

### Batch Validation
```bash
POST /api/v1/loot/credentials/validate/batch
{
  "credentials": [
    { "credential_id": "...", "target": "...", ... }
  ]
}
```

### Get Credentials
```bash
GET /api/v1/loot/credentials?target=192.168.1.10
```

## Python Usage

```python
from modules.credential_validator import validate_credential

result = validate_credential(
    credential_id="test",
    target="192.168.1.10",
    username="admin",
    password="password",
    service="ssh",
    port=22
)

print(f"Valid: {result['valid']}")
```

## Frontend Usage

```typescript
// Single validation
await apiService.validateCredential(
  credId, target, username, password, service, port
);

// Batch validation
await apiService.validateCredentialsBatch(credentials);

// Get credentials
const creds = await apiService.getCredentials(target);
```

## WebSocket Events

```javascript
wsService.on('loot_item', (data) => {
  if (data.event === 'credential_validated') {
    console.log(`${data.result.username}: ${data.result.valid}`);
  }
});
```

## Service Support

| Service | Port | Status |
|---------|------|--------|
| SSH | 22 | Full Support |
| HTTP | 80 | Full Support |
| HTTPS | 443 | Full Support |
| FTP | 21 | Full Support |
| RDP | 3389 | Partial (port check) |
| SMB | 445 | Partial (port check) |

## UI Features

- Individual "Test" button per credential
- "Test All (N)" batch validation button
- Real-time status indicators:
  - Gray: Not tested
  - Yellow spinner: Testing...
  - Green checkmark: Valid
  - Red X: Invalid

## Configuration

### Timeout
Edit `modules/credential_validator.py`:
```python
CONNECTION_TIMEOUT = 10  # seconds
```

### Batch Size
Edit `api_server.py`:
```python
MAX_BATCH_SIZE = 50  # credentials
```

## File Locations

```
Backend:
  modules/credential_validator.py
  modules/loot_tracker.py
  api_server.py

Frontend:
  web/src/services/api.ts
  web/src/modules/loot/LootView.tsx

Data:
  results/<target>/credentials.json

Docs:
  docs/CREDENTIAL_VALIDATION_SYSTEM.md
  docs/CREDENTIAL_VALIDATION_SETUP.md
  CREDENTIAL_VALIDATION_IMPLEMENTATION_SUMMARY.md
```

## Common Issues

| Issue | Solution |
|-------|----------|
| Timeout | Increase CONNECTION_TIMEOUT |
| No WebSocket updates | Check socketio connection |
| ModuleNotFoundError | `pip install paramiko` |
| Connection refused | Verify target service running |

## Testing

```bash
# Start backend
python api_server.py

# Start frontend
cd web && npm run dev

# Navigate to
http://localhost:3000/loot
```

## Quick Test

```bash
curl -X POST http://localhost:8000/api/v1/loot/credentials/validate \
  -H "Content-Type: application/json" \
  -d '{
    "credential_id": "test",
    "target": "localhost",
    "username": "testuser",
    "password": "testpass",
    "service": "ssh",
    "port": 22
  }'
```

## Documentation

Full docs: `/Users/soulofall/projects/cstrike/docs/CREDENTIAL_VALIDATION_SYSTEM.md`
Setup guide: `/Users/soulofall/projects/cstrike/docs/CREDENTIAL_VALIDATION_SETUP.md`

---

**Quick Help**: All validation runs in background threads. Results arrive via WebSocket events.
