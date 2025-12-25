# Credential Validation System - Setup Guide

## Installation

### Python Dependencies

The credential validation system requires the following Python packages:

```bash
# Navigate to project root
cd /Users/soulofall/projects/cstrike

# Install required packages
pip install paramiko requests

# Optional: For enhanced functionality
pip install pysmb rdpy  # SMB and RDP support (experimental)
```

### Verify Installation

```bash
python3 -c "import paramiko; import requests; print('Dependencies installed successfully')"
```

## Configuration

### 1. Backend Setup

No configuration changes required. The validator uses sensible defaults:

- **Connection Timeout**: 10 seconds
- **Max Batch Size**: 50 credentials
- **Supported Services**: SSH, HTTP/HTTPS, FTP, (RDP partial, SMB partial)

### 2. API Server

The API endpoints are automatically registered when starting the server:

```bash
python api_server.py
```

Expected output:
```
INFO Starting CStrike API Server...
INFO REST API: http://localhost:8000/api/v1/
INFO WebSocket: ws://localhost:8000/
INFO Credential validation endpoints registered
```

### 3. Frontend

No additional setup required. The validation UI is integrated into LootView.

```bash
cd web
npm install  # If not already done
npm run dev
```

## Quick Start

### 1. Add Test Credentials

Create a test target directory and add credentials:

```bash
mkdir -p results/testhost
cat > results/testhost/credentials.json <<EOF
[
  {
    "id": "cred_test_1",
    "target": "localhost",
    "username": "testuser",
    "password": "testpass",
    "source": "manual",
    "service": "ssh",
    "port": 22,
    "validated": false,
    "validation_result": null,
    "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "tested_at": null
  }
]
EOF
```

### 2. Test Validation via API

```bash
# Single credential validation
curl -X POST http://localhost:8000/api/v1/loot/credentials/validate \
  -H "Content-Type: application/json" \
  -d '{
    "credential_id": "cred_test_1",
    "target": "localhost",
    "username": "testuser",
    "password": "testpass",
    "service": "ssh",
    "port": 22
  }'
```

Expected response:
```json
{
  "status": "started",
  "message": "Credential validation initiated",
  "credential_id": "cred_test_1"
}
```

### 3. Monitor Results

Check the credentials file for validation results:

```bash
cat results/testhost/credentials.json | jq '.[0].validation_result'
```

### 4. Test via UI

1. Navigate to http://localhost:3000
2. Go to Loot Tracker view
3. You should see the credential in the table
4. Click "Test" button next to the credential
5. Watch for real-time status updates (Testing... → Valid/Invalid)

## Validation Examples

### SSH Validation

```python
from modules.credential_validator import validate_credential

result = validate_credential(
    credential_id="test_ssh",
    target="192.168.1.10",
    username="admin",
    password="password123",
    service="ssh",
    port=22
)

print(f"Valid: {result['valid']}")
print(f"Details: {result['details']}")
```

### HTTP Basic Auth Validation

```python
result = validate_credential(
    credential_id="test_http",
    target="http://192.168.1.20",
    username="admin",
    password="password123",
    service="http",
    port=80
)
```

### FTP Validation

```python
result = validate_credential(
    credential_id="test_ftp",
    target="192.168.1.30",
    username="ftpuser",
    password="ftppass",
    service="ftp",
    port=21
)
```

### Batch Validation

```python
from modules.credential_validator import validate_credentials_batch

credentials = [
    {
        "credential_id": "cred_1",
        "target": "192.168.1.10",
        "username": "admin",
        "password": "pass1",
        "service": "ssh",
        "port": 22
    },
    {
        "credential_id": "cred_2",
        "target": "192.168.1.20",
        "username": "root",
        "password": "pass2",
        "service": "ftp",
        "port": 21
    }
]

results = validate_credentials_batch(credentials)

for result in results:
    print(f"{result['credential_id']}: {result['valid']}")
```

## Testing Checklist

- [ ] Backend server running (`python api_server.py`)
- [ ] Frontend server running (`npm run dev`)
- [ ] Python dependencies installed (`paramiko`, `requests`)
- [ ] WebSocket connection active (check browser console)
- [ ] Test credential created in results directory
- [ ] API endpoint accessible (test with curl)
- [ ] UI displays credentials table
- [ ] Individual validation works (click "Test" button)
- [ ] Batch validation works (click "Test All" button)
- [ ] Real-time updates appear (WebSocket events)
- [ ] Validation results stored in credentials.json

## Common Setup Issues

### Issue: ModuleNotFoundError: No module named 'paramiko'

**Solution:**
```bash
pip install paramiko
```

### Issue: Connection timeout on all validations

**Solution:**
- Check network connectivity to target
- Verify target service is running
- Ensure no firewall blocking connections
- Try increasing timeout in `credential_validator.py`:
  ```python
  CONNECTION_TIMEOUT = 30  # Increase from 10
  ```

### Issue: WebSocket not connecting

**Solution:**
- Check CORS settings in `api_server.py`
- Verify frontend is using correct WebSocket URL
- Check browser console for connection errors
- Restart backend server

### Issue: Credentials not appearing in UI

**Solution:**
- Check `results/<target>/credentials.json` exists
- Verify JSON format is valid
- Check backend logs for errors
- Reload frontend page

## Performance Tuning

### Adjust Timeout

Edit `/Users/soulofall/projects/cstrike/modules/credential_validator.py`:

```python
# Increase timeout for slow networks
CONNECTION_TIMEOUT = 30  # Default: 10
```

### Adjust Batch Size

Edit `/Users/soulofall/projects/cstrike/api_server.py`:

```python
# Increase max batch size
MAX_BATCH_SIZE = 100  # Default: 50
```

### Enable Debug Logging

Edit `/Users/soulofall/projects/cstrike/api_server.py`:

```python
logging.basicConfig(
    level=logging.DEBUG,  # Changed from INFO
    format='%(asctime)s %(levelname)s %(message)s'
)
```

## Security Considerations

### 1. Network Isolation

Run validation in isolated network segment:
- Use VPN or separate VLAN
- Avoid production networks
- Monitor outbound connections

### 2. Credential Handling

- Never commit credentials to git
- Use encrypted storage if possible
- Clear credentials after testing
- Implement access controls

### 3. Rate Limiting

Avoid flooding target services:
- Use reasonable batch sizes
- Implement delays between validations
- Monitor target service health

### 4. Logging

Sanitize logs before sharing:
```bash
# Remove sensitive data from logs
sed -i 's/"password":"[^"]*"/"password":"REDACTED"/g' logs/driver.log
```

## Next Steps

1. **Integration with Reconnaissance**
   - Credentials automatically validated after discovery
   - Heatmap scoring prioritizes validation

2. **Advanced Features**
   - Custom validation rules
   - Service-specific checks
   - Credential rotation testing

3. **Reporting**
   - Export validated credentials
   - Generate validation reports
   - Track success rates

## Support

For issues or questions:
1. Check backend logs: `/Users/soulofall/projects/cstrike/logs/driver.log`
2. Check browser console for frontend errors
3. Review API documentation: `/Users/soulofall/projects/cstrike/docs/CREDENTIAL_VALIDATION_SYSTEM.md`
4. Verify all dependencies installed correctly

## Summary

The credential validation system is now configured and ready to use. Follow the quick start guide to test the functionality, then integrate it into your offensive security workflow.

Key features enabled:
- SSH, HTTP, and FTP credential validation
- Real-time WebSocket updates
- Batch processing (up to 50 credentials)
- Detailed validation results
- Production-ready error handling

Happy testing!
