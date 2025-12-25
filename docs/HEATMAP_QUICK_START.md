# Credential Heatmap Quick Start Guide

## What is it?

The Credential Heatmap automatically scores and ranks all collected credentials based on likelihood of success, allowing you to prioritize testing efforts.

## How to Use

### 1. Web UI (Recommended)

```
1. Navigate to Loot Tracker
2. Click "Heatmap View" tab
3. View credentials sorted by priority (red = highest)
4. Click "Details" to see scoring breakdown
5. Click "Test Top 10" to validate high-priority credentials
```

### 2. API Direct

```bash
# Get top 50 credentials
curl http://localhost:8000/api/v1/loot/heatmap

# Get top 100 with minimum score of 15
curl "http://localhost:8000/api/v1/loot/heatmap?limit=100&min_score=15"
```

### 3. Python Script

```python
from modules.loot_tracker import generate_credential_heatmap

heatmap = generate_credential_heatmap(limit=20)
for cred in heatmap[:5]:
    print(f"[{cred['score']:.1f}] {cred['username']}@{cred['target']} ({cred['service']})")
```

## Understanding Scores

| Score Range | Priority | Color | Meaning |
|------------|----------|-------|---------|
| 20+ | CRITICAL | Red | Credential reuse + high-value target |
| 15-19 | HIGH | Orange-Red | High-value username or service |
| 10-14 | MEDIUM-HIGH | Orange | Likely to succeed |
| 7-9 | MEDIUM | Yellow | Worth testing |
| 5-6 | MEDIUM-LOW | Yellow | Lower priority |
| 3-4 | LOW | Yellow-Green | Test if time permits |
| <3 | VERY LOW | Green | Low likelihood |

## Scoring Factors

1. **Credential Reuse** (+10 per target)
   - Same password used across multiple targets = HIGHEST PRIORITY

2. **Username Criticality** (+1 to +10)
   - `root`, `admin`, `administrator` = +9 to +10
   - Service accounts (`postgres`, `mysql`) = +7
   - Generic accounts (`user`) = +2

3. **Service Importance** (+3 to +10)
   - SSH, RDP = +10
   - SMB, FTP, VNC = +8
   - Databases = +7
   - HTTP = +5

4. **Password Weakness** (-0 to -10 penalty)
   - Weak passwords = less penalty = HIGHER PRIORITY
   - Strong passwords = more penalty = lower priority
   - Common patterns detected = bonus to priority

## Example Scenarios

### High-Priority Credential (Score: 47.5)
```
Username: root
Password: password
Service: ssh
Found on: 3 targets

Why high priority?
- Credential reuse across 3 targets (+30)
- Root user (+10)
- SSH service (+10)
- Very weak password (-2.5 penalty)
```

### Low-Priority Credential (Score: 2.0)
```
Username: user123
Password: MyStr0ng!P@ssw0rd2024
Service: http
Found on: 1 target

Why low priority?
- No credential reuse (0)
- Generic username (+2)
- HTTP service (+5)
- Strong password (-5 penalty)
```

## Tips for Operators

1. **Start at the Top**: Always test highest-scoring credentials first
2. **Credential Reuse**: Look for patterns - same password across services
3. **Service Pivot**: If SSH creds work, try them on RDP/SMB
4. **Adjust Threshold**: Use `min_score` filter to focus on high-value targets
5. **Batch Testing**: Use "Test Top N" buttons for automated validation

## Common Patterns

### Pattern: Admin Password Reuse
```
Score: 66
admin / admin123 found on 5 targets (SSH, RDP, SMB)
→ Test immediately across all services
```

### Pattern: Default Credentials
```
Score: 38
postgres / postgres on database server
→ Common default, high priority
```

### Pattern: Weak Password + Critical Service
```
Score: 29
root / 123456 on SSH
→ Weak password on critical service = easy win
```

## Quick Reference: Testing Workflow

```
1. Run recon scans
   └─> Loot collected automatically

2. Open Heatmap View
   └─> Credentials scored and sorted

3. Filter by min_score=15
   └─> Focus on high-value targets

4. Test top 10 credentials
   └─> Start with highest ROI

5. Expand successful patterns
   └─> Reuse creds across services/targets

6. Document and report
   └─> Export heatmap as evidence
```

## Troubleshooting

**Q: Heatmap is empty**
A: No loot collected yet. Run reconnaissance scans first.

**Q: All scores are low**
A: No credential reuse detected and passwords are strong. Adjust min_score or expand recon.

**Q: How to test credentials?**
A: Use "Test Top 10" button or integrate with Hydra/Medusa for automated validation.

**Q: Can I customize scoring?**
A: Yes! Edit `modules/loot_tracker.py` - modify `SERVICE_WEIGHTS` and `HIGH_VALUE_USERNAMES` dictionaries.

## Integration with Other Tools

### Export for Hydra
```bash
# Get top 50 credentials as JSON
curl http://localhost:8000/api/v1/loot/heatmap?limit=50 > heatmap.json

# Extract usernames and passwords
jq -r '.credentials[] | "\(.username):\(.password)"' heatmap.json > creds.txt

# Use with Hydra
hydra -C creds.txt ssh://target.com
```

### Export for Custom Scripts
```python
import requests

response = requests.get('http://localhost:8000/api/v1/loot/heatmap?limit=100')
heatmap = response.json()

for cred in heatmap['credentials'][:10]:
    print(f"Testing {cred['username']}@{cred['target']}...")
    # Your testing logic here
```

---

**Pro Tip**: The heatmap updates automatically as new loot is collected. Check it periodically during long reconnaissance operations to identify high-value targets early.
