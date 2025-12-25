# Credential Validation System

## Overview

The Credential Validation System provides automated testing of discovered credentials against target services. It supports multiple service types (SSH, HTTP, FTP, RDP, SMB) and provides real-time feedback through WebSocket events.

## Architecture

### Components

1. **Backend Validator** (`/Users/soulofall/projects/cstrike/modules/credential_validator.py`)
   - Core validation logic for different service types
   - Handles connection attempts with proper timeout and error handling
   - Returns detailed validation results with metadata

2. **Loot Tracker** (`/Users/soulofall/projects/cstrike/modules/loot_tracker.py`)
   - Stores credentials with validation metadata
   - Tracks validation status and results
   - Provides credential retrieval and update functions

3. **API Endpoints** (`/Users/soulofall/projects/cstrike/api_server.py`)
   - POST `/api/v1/loot/credentials/validate` - Single credential validation
   - POST `/api/v1/loot/credentials/validate/batch` - Batch validation
   - GET `/api/v1/loot/credentials` - Retrieve credentials

4. **Frontend UI** (`/Users/soulofall/projects/cstrike/web/src/modules/loot/LootView.tsx`)
   - Credential table with validation status indicators
   - Individual "Test" buttons per credential
   - "Test All" button for batch validation
   - Real-time WebSocket updates

## Features

### Supported Services

| Service | Port | Status | Notes |
|---------|------|--------|-------|
| SSH | 22 | Fully Supported | Tests authentication + command execution |
| HTTP/HTTPS | 80/443 | Fully Supported | Tests Basic Auth |
| FTP | 21 | Fully Supported | Tests login + directory listing |
| RDP | 3389 | Partial | Port check only (requires additional tools) |
| SMB | 445 | Partial | Port check only (requires additional tools) |

### Validation Process

1. **Credential Discovery**: Credentials are discovered during reconnaissance
2. **Storage**: Stored in `/results/<target>/credentials.json`
3. **Validation Request**: User triggers validation via UI
4. **Background Processing**: Validation runs in background thread
5. **Real-time Updates**: WebSocket events update UI immediately
6. **Result Storage**: Validation results stored with credential metadata

### Security Features

- All validation runs in isolated background threads (non-blocking)
- Credentials never logged to disk (only stored in encrypted format if configured)
- Timeout enforcement (10 seconds per validation attempt)
- Rate limiting via batch size limits (max 50 concurrent)
- Service-specific error handling prevents information leakage

## API Reference

### POST /api/v1/loot/credentials/validate

Validate a single credential against target service.

**Request Body:**
```json
{
  "credential_id": "cred_123_1640000000.0",
  "target": "192.168.1.10",
  "username": "admin",
  "password": "password123",
  "service": "ssh",
  "port": 22
}
```

**Response:**
```json
{
  "status": "started",
  "message": "Credential validation initiated",
  "credential_id": "cred_123_1640000000.0"
}
```

**WebSocket Event (on completion):**
```json
{
  "event": "credential_validated",
  "credential_id": "cred_123_1640000000.0",
  "result": {
    "credential_id": "cred_123_1640000000.0",
    "valid": true,
    "service": "ssh",
    "target": "192.168.1.10",
    "username": "admin",
    "tested_at": "2025-12-25T10:00:00Z",
    "error": null,
    "details": {
      "port": 22,
      "protocol": "ssh",
      "access_level": "full",
      "whoami": "admin"
    }
  }
}
```

### POST /api/v1/loot/credentials/validate/batch

Validate multiple credentials in batch.

**Request Body:**
```json
{
  "credentials": [
    {
      "credential_id": "cred_1",
      "target": "192.168.1.10",
      "username": "admin",
      "password": "password123",
      "service": "ssh",
      "port": 22
    },
    {
      "credential_id": "cred_2",
      "target": "192.168.1.20",
      "username": "root",
      "password": "toor",
      "service": "ftp",
      "port": 21
    }
  ]
}
```

**Response:**
```json
{
  "status": "started",
  "count": 2,
  "message": "Batch validation initiated for 2 credentials"
}
```

**WebSocket Events:**

Individual validations:
```json
{
  "event": "credential_validated",
  "credential_id": "cred_1",
  "result": { ... }
}
```

Batch completion:
```json
{
  "event": "batch_validation_complete",
  "total": 2,
  "valid": 1,
  "invalid": 1,
  "timestamp": "2025-12-25T10:00:00Z"
}
```

### GET /api/v1/loot/credentials

Retrieve stored credentials.

**Query Parameters:**
- `target` (optional): Filter by target host

**Response:**
```json
{
  "credentials": [
    {
      "id": "cred_0_1640000000.0",
      "target": "192.168.1.10",
      "username": "admin",
      "password": "password123",
      "source": "nmap-ssh-brute",
      "service": "ssh",
      "port": 22,
      "validated": true,
      "validation_result": {
        "valid": true,
        "service": "ssh",
        "tested_at": "2025-12-25T10:00:00Z",
        "error": null,
        "details": { ... }
      },
      "created_at": "2025-12-25T09:00:00Z",
      "tested_at": "2025-12-25T10:00:00Z"
    }
  ],
  "count": 1,
  "timestamp": "2025-12-25T10:05:00Z"
}
```

## Frontend Integration

### Usage in LootView

```typescript
// Single credential validation
const handleValidateCredential = async (cred) => {
  await apiService.validateCredential(
    cred.id,
    cred.target,
    cred.username,
    cred.password,
    'ssh',  // auto-detected from port
    cred.port
  );
};

// Batch validation
const handleValidateAll = async () => {
  const credentials = unvalidatedCredentials.map(cred => ({
    credential_id: cred.id,
    target: cred.target,
    username: cred.username,
    password: cred.password,
    service: inferServiceFromPort(cred.port),
    port: cred.port
  }));

  await apiService.validateCredentialsBatch(credentials);
};
```

### WebSocket Event Handling

```typescript
wsService.on('loot_item', (data) => {
  if (data.event === 'credential_validated') {
    // Update credential in store
    validateCredential(data.credential_id, data.result.valid);

    // Show notification
    addToast({
      type: data.result.valid ? 'success' : 'warning',
      message: `Credential ${data.result.valid ? 'validated' : 'invalid'}`
    });
  }
});
```

### UI States

| State | Icon | Color | Description |
|-------|------|-------|-------------|
| Not tested | - | Gray | Credential hasn't been validated |
| Testing... | Clock (spinning) | Yellow | Validation in progress |
| Valid | Check | Green | Credential successfully validated |
| Invalid | X | Red | Credential validation failed |

## Validation Result Storage

Credentials are stored in `/results/<target>/credentials.json`:

```json
[
  {
    "id": "cred_0_1640000000.0",
    "target": "192.168.1.10",
    "username": "admin",
    "password": "password123",
    "source": "nmap-ssh-brute",
    "service": "ssh",
    "port": 22,
    "validated": true,
    "validation_result": {
      "credential_id": "cred_0_1640000000.0",
      "valid": true,
      "service": "ssh",
      "target": "192.168.1.10",
      "username": "admin",
      "tested_at": "2025-12-25T10:00:00Z",
      "error": null,
      "details": {
        "port": 22,
        "protocol": "ssh",
        "access_level": "full",
        "whoami": "admin"
      }
    },
    "created_at": "2025-12-25T09:00:00Z",
    "tested_at": "2025-12-25T10:00:00Z"
  }
]
```

## Error Handling

### Common Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| Connection timeout | Target unreachable or slow | Increase timeout in validator |
| Authentication failed | Invalid credentials | Expected - credential marked invalid |
| Port not reachable | Service not running | Check target service status |
| Unsupported service | Service type not implemented | Use supported services only |

### Error Response Format

```json
{
  "credential_id": "cred_123",
  "valid": false,
  "service": "ssh",
  "target": "192.168.1.10",
  "username": "admin",
  "tested_at": "2025-12-25T10:00:00Z",
  "error": "Connection timeout",
  "details": null
}
```

## Performance Considerations

- **Timeout**: 10 seconds per validation attempt
- **Batch Size**: Maximum 50 credentials per batch
- **Threading**: Each validation runs in isolated thread
- **Concurrent Limits**: No global limit (managed by batch size)

### Optimization Tips

1. Use batch validation for multiple credentials
2. Validate high-priority credentials first (use heatmap scoring)
3. Monitor WebSocket connection for real-time updates
4. Avoid re-validating already validated credentials

## Security Best Practices

1. **Credential Storage**
   - Never log credentials in plain text
   - Use encrypted storage if available
   - Implement proper access controls

2. **Network Operations**
   - Use timeout enforcement
   - Handle connection errors gracefully
   - Don't expose internal network details

3. **Rate Limiting**
   - Respect batch size limits
   - Avoid flooding target services
   - Implement backoff strategies if needed

4. **Logging**
   - Log validation attempts (without credentials)
   - Track success/failure rates
   - Monitor for anomalies

## Testing

### Manual Testing

1. Start API server: `python api_server.py`
2. Start frontend: `cd web && npm run dev`
3. Navigate to Loot Tracker
4. Add test credentials or run reconnaissance
5. Click "Test" on individual credentials
6. Click "Test All" for batch validation
7. Monitor real-time updates

### Example Test Credential

```bash
# Add test credential via API
curl -X POST http://localhost:8000/api/v1/loot/credentials/validate \
  -H "Content-Type: application/json" \
  -d '{
    "credential_id": "test_cred_1",
    "target": "localhost",
    "username": "testuser",
    "password": "testpass",
    "service": "ssh",
    "port": 22
  }'
```

## Troubleshooting

### Validation Not Starting

- Check backend logs for errors
- Verify API server is running
- Confirm WebSocket connection active

### No Real-time Updates

- Check WebSocket connection in browser console
- Verify socketio event listeners registered
- Confirm backend emitting events

### Validation Always Fails

- Check target service is reachable
- Verify credentials are correct
- Review timeout settings
- Check network connectivity

## Future Enhancements

1. **Additional Service Support**
   - Full RDP validation (requires rdpy)
   - Full SMB validation (requires pysmb)
   - Database services (MySQL, PostgreSQL, MongoDB)
   - Web application logins

2. **Advanced Features**
   - Credential rotation testing
   - Session persistence validation
   - Privilege escalation checks
   - Multi-factor authentication handling

3. **Performance Improvements**
   - Connection pooling
   - Parallel validation with thread pools
   - Caching of validation results
   - Smart retry logic

4. **Reporting**
   - Validation success rate metrics
   - Credential quality scoring
   - Export validated credentials
   - Integration with external tools

## Dependencies

### Backend
- `paramiko` - SSH client library
- `ftplib` - Standard library FTP client
- `requests` - HTTP client library
- `flask-socketio` - WebSocket support

### Frontend
- `lucide-react` - Icons
- `zustand` - State management
- `axios` - HTTP client

## File Locations

```
/Users/soulofall/projects/cstrike/
├── modules/
│   ├── credential_validator.py     # Core validation logic
│   └── loot_tracker.py              # Credential storage
├── api_server.py                    # REST API + WebSocket
└── web/src/
    ├── services/api.ts              # API client
    └── modules/loot/LootView.tsx    # UI component
```

## Summary

The Credential Validation System provides a comprehensive solution for testing discovered credentials against target services. With support for multiple service types, real-time WebSocket updates, and batch processing capabilities, it streamlines the credential validation workflow in offensive security operations.

Key benefits:
- Automated validation across multiple service types
- Real-time status updates via WebSocket
- Batch processing for efficiency
- Detailed validation results with metadata
- Production-ready error handling and security

For questions or issues, consult the backend logs at `/logs/driver.log` or review the API documentation above.
