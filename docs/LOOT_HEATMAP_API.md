# Loot Heatmap & Credential Scoring API Documentation

## Overview

The Loot Heatmap feature provides intelligent credential scoring and prioritization based on multiple factors including credential reuse, username criticality, service importance, and password complexity. This enables offensive security operators to focus testing efforts on the most likely successful credential pairs.

## Architecture

### Backend Components

#### 1. Scoring Algorithm (`modules/loot_tracker.py`)

**Location**: `/Users/soulofall/projects/cstrike/modules/loot_tracker.py`

**Core Functions**:

- `score_credential(username, password, service, target, all_loot)` - Calculates priority score for a credential pair
- `generate_credential_heatmap(limit)` - Generates sorted list of scored credentials
- `_calculate_password_complexity(password)` - Analyzes password strength
- `_get_username_weight(username)` - Assigns weight based on username criticality
- `_get_service_weight(service)` - Assigns weight based on service criticality

**Scoring Formula**:
```
score = (reuse_count * 10) + username_weight + service_weight - (complexity_score / 2)
```

**Factors**:

1. **Credential Reuse** (10 points per target)
   - Tracks how many targets have the same username or password
   - Higher reuse = exponentially higher priority (credential reuse is critical)

2. **Username Criticality** (1-10 points)
   - `root`: 10 points
   - `admin`, `administrator`: 9 points
   - `sa`, `system`, `sysadmin`, `superuser`: 8 points
   - `postgres`, `mysql`, `wheel`, `sudo`: 7 points
   - `operator`: 6 points
   - `service`: 5 points
   - `user`: 2 points
   - Other: 1 point

3. **Service Criticality** (3-10 points)
   - `ssh`, `rdp`: 10 points
   - `telnet`: 9 points
   - `ftp`, `smb`: 8 points
   - `vnc`: 8 points
   - `mysql`, `postgres`, `mssql`: 7 points
   - `mongodb`, `redis`: 6 points
   - `http`, `https`: 5 points
   - Other: 3 points

4. **Password Complexity** (-0 to -10 penalty)
   - **Weak passwords** (0-5 complexity) = minimal penalty = **higher priority**
   - **Strong passwords** (16+ complexity) = maximum penalty = lower priority
   - Complexity factors:
     - Length (6-8: +1, 8-12: +3, 12+: +6)
     - Lowercase letters: +2
     - Uppercase letters: +3
     - Numbers: +2
     - Special characters: +4
     - Common patterns detected: -5
     - Repeating characters: -2

#### 2. API Endpoint (`api_server.py`)

**Endpoint**: `GET /api/v1/loot/heatmap`

**Query Parameters**:
- `limit` (int, default: 50, max: 500) - Maximum number of credentials to return
- `min_score` (float, default: 0) - Minimum score threshold for filtering

**Response Format**:
```json
{
  "credentials": [
    {
      "username": "admin",
      "password": "password123",
      "service": "ssh",
      "target": "192.168.1.100",
      "score": 28.5,
      "breakdown": {
        "reuse_count": 2,
        "reuse_score": 20,
        "username_weight": 9,
        "service_weight": 10,
        "complexity_score": 8,
        "complexity_penalty": 4.0
      }
    }
  ],
  "count": 50,
  "timestamp": "2025-12-25T10:30:00.000Z"
}
```

**HTTP Status Codes**:
- `200` - Success
- `500` - Server error (e.g., file I/O failure)

**Security Considerations**:
- Limit is capped at 500 to prevent memory exhaustion
- No authentication required (internal API)
- Passwords are not exposed in plaintext in UI (masked)

### Frontend Components

#### 1. TypeScript Types (`web/src/types/index.ts`)

```typescript
export interface ScoreBreakdown {
  reuse_count: number;
  reuse_score: number;
  username_weight: number;
  service_weight: number;
  complexity_score: number;
  complexity_penalty: number;
}

export interface ScoredCredential {
  username: string;
  password: string;
  service: string;
  target: string;
  score: number;
  breakdown: ScoreBreakdown;
}

export interface HeatmapResponse {
  credentials: ScoredCredential[];
  count: number;
  timestamp: string;
}
```

#### 2. API Service (`web/src/services/api.ts`)

```typescript
async getLootHeatmap(limit = 50, minScore = 0): Promise<HeatmapResponse> {
  const { data } = await this.client.get('/loot/heatmap', {
    params: { limit, min_score: minScore },
  });
  return data;
}
```

#### 3. Heatmap View Component (`web/src/modules/loot/LootView.tsx`)

**Features**:
- **View Mode Toggle**: Switch between "All Loot" and "Heatmap View"
- **Visual Priority Indicators**: Color-coded score badges (red=high, yellow=medium, green=low)
- **Score Filtering**: Filter by minimum score threshold
- **Breakdown Details**: Expandable details showing scoring factors
- **Quick Actions**:
  - "Test Top 10" button
  - "Test Top 25" button
  - Refresh button
- **Color Gradient**:
  - Score ≥ 20: `#ff3333` (Red - Critical Priority)
  - Score 15-19: `#ff6633` (Orange-Red - High Priority)
  - Score 10-14: `#ff9933` (Orange - Medium-High Priority)
  - Score 7-9: `#ffcc33` (Yellow-Orange - Medium Priority)
  - Score 5-6: `#ffff33` (Yellow - Medium-Low Priority)
  - Score 3-4: `#ccff33` (Yellow-Green - Low-Medium Priority)
  - Score < 3: `#99ff33` (Green - Low Priority)

## Usage Examples

### Backend: Generate Heatmap Programmatically

```python
from modules.loot_tracker import generate_credential_heatmap

# Get top 50 credentials
heatmap = generate_credential_heatmap(limit=50)

for cred in heatmap[:10]:
    print(f"Score: {cred['score']:.1f} | {cred['username']}@{cred['target']} ({cred['service']})")
    print(f"  Breakdown: Reuse={cred['breakdown']['reuse_count']}, "
          f"Username={cred['breakdown']['username_weight']}, "
          f"Service={cred['breakdown']['service_weight']}")
```

### Backend: Score Individual Credential

```python
from modules.loot_tracker import score_credential

result = score_credential(
    username='admin',
    password='password123',
    service='ssh',
    target='192.168.1.100'
)

print(f"Score: {result['score']}")
print(f"Breakdown: {result['breakdown']}")
```

### Frontend: Load and Display Heatmap

The heatmap is automatically loaded when switching to "Heatmap View" in the UI. Users can:

1. Click "Heatmap View" tab
2. Adjust minimum score filter if needed
3. Click "Refresh" to reload data
4. Expand "Details" on any credential to see scoring breakdown
5. Click "Test Top 10" to initiate automated testing (placeholder for credential validation)

### API: Fetch Heatmap via HTTP

```bash
# Get top 50 credentials
curl http://localhost:8000/api/v1/loot/heatmap

# Get top 100 credentials with minimum score of 10
curl "http://localhost:8000/api/v1/loot/heatmap?limit=100&min_score=10"
```

## Scoring Examples

### Example 1: High-Priority Credential

```
Username: root
Password: password
Service: ssh
Reuse Count: 3 targets

Score Calculation:
- Reuse: 3 * 10 = 30
- Username: 10 (root)
- Service: 10 (ssh)
- Complexity: 5 (weak password)
- Penalty: 5 / 2 = 2.5

Final Score: 30 + 10 + 10 - 2.5 = 47.5 (CRITICAL PRIORITY)
```

### Example 2: Medium-Priority Credential

```
Username: user
Password: P@ssw0rd123!
Service: http
Reuse Count: 0 targets

Score Calculation:
- Reuse: 0 * 10 = 0
- Username: 2 (user)
- Service: 5 (http)
- Complexity: 14 (medium-strong password)
- Penalty: 14 / 2 = 7

Final Score: 0 + 2 + 5 - 7 = 0 (LOW PRIORITY)
```

### Example 3: Credential Reuse Attack

```
Username: administrator
Password: admin123
Service: rdp
Reuse Count: 5 targets

Score Calculation:
- Reuse: 5 * 10 = 50
- Username: 9 (administrator)
- Service: 10 (rdp)
- Complexity: 6 (weak password)
- Penalty: 6 / 2 = 3

Final Score: 50 + 9 + 10 - 3 = 66 (EXTREME PRIORITY - Credential Reuse!)
```

## Security Best Practices

1. **Data Protection**: Loot data is stored in `results/<target>/loot.json` - ensure proper file permissions
2. **API Access**: The heatmap endpoint should only be accessible from localhost or trusted networks
3. **Rate Limiting**: Consider implementing rate limiting for the heatmap endpoint in production
4. **Credential Testing**: Implement proper throttling and stealth techniques when testing credentials
5. **Logging**: All credential testing should be logged with timestamps and results

## Performance Considerations

- **Heatmap Generation**: O(n²) where n = number of credentials. Typical execution time: <100ms for 1000 credentials
- **Caching**: Consider implementing Redis caching for large-scale operations
- **Pagination**: Frontend limits display to 50 credentials by default to prevent UI lag
- **Memory Usage**: Maximum 500 credentials can be requested to prevent memory exhaustion

## Troubleshooting

### No Credentials in Heatmap

**Cause**: No loot has been collected yet
**Solution**: Run reconnaissance scans first to populate loot data

### Heatmap Load Fails

**Cause**: Backend API unreachable or loot files corrupted
**Solution**:
1. Check API server logs: `logs/driver.log`
2. Verify `results/` directory exists and has proper permissions
3. Check individual `results/<target>/loot.json` files for corruption

### Scores Seem Incorrect

**Cause**: Scoring weights may need tuning for your environment
**Solution**: Adjust weights in `modules/loot_tracker.py`:
- `SERVICE_WEIGHTS` dictionary
- `HIGH_VALUE_USERNAMES` dictionary
- Reuse multiplier (currently 10)

## Future Enhancements

1. **Machine Learning**: Train model on successful credential attempts to improve scoring
2. **Custom Weights**: Allow users to configure scoring weights via UI
3. **Credential Validation**: Integrate with Hydra/Medusa for automated testing
4. **Historical Tracking**: Track credential validation success rate over time
5. **Export Formats**: Export heatmap as CSV, JSON, or wordlists for external tools
6. **Credential Clustering**: Group similar credentials for pattern analysis

## Related Documentation

- [Loot Tracker Module](../modules/loot_tracker.py)
- [API Server Documentation](../api_server.py)
- [Frontend Architecture](../web/README.md)
