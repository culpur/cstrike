# Quick Integration Guide - Scan Results Viewer

## What's Been Built

A complete scan results visualization system with:
- Comprehensive TypeScript types for all scan data
- Full-featured ScanResultsView modal component
- Updated reconStore with result storage
- JSON/CSV export functionality
- Six-tab interface for different result categories
- Severity-based color coding

## Files Created/Modified

### New Files
- `/src/modules/reconnaissance/components/ScanResultsView.tsx` - Main results modal
- `/src/modules/reconnaissance/integration-patch.md` - Integration instructions
- `/src/modules/reconnaissance/SCAN_RESULTS_IMPLEMENTATION.md` - Full documentation

### Modified Files
- `/src/types/index.ts` - Added comprehensive scan result types
- `/src/stores/reconStore.ts` - Added result storage functionality
- `/src/utils/index.ts` - Added formatDuration utility

### File Needing Integration
- `/src/modules/reconnaissance/ReconnaissanceView.tsx` - Apply patch

## 5-Minute Integration

### Step 1: Add Imports
At the top of `ReconnaissanceView.tsx`, add:
```typescript
import { Eye } from 'lucide-react';
import type { CompleteScanResults } from '@/types';
import { ScanResultsView } from './components/ScanResultsView';
```

### Step 2: Add State
Add these two lines in the component state section:
```typescript
const [viewingScanResults, setViewingScanResults] = useState<CompleteScanResults | null>(null);
const [targetScanIds, setTargetScanIds] = useState<Map<string, string>>(new Map());
```

### Step 3: Update Store Destructuring
Add these two actions:
```typescript
const {
  // ... existing properties
  storeScanResults,
  getScanResults,
} = useReconStore();
```

### Step 4: Track Scan IDs
In `handleStartScan`, after `setActiveScanId(scanId)`, add:
```typescript
setTargetScanIds(prev => new Map(prev).set(targetId, scanId));
```

### Step 5: Store Results When Complete
In the scan polling useEffect, when status is completed, add:
```typescript
if (status.status === 'completed' && status.results) {
  const results = parseScanResults(activeScanId, status.target || '', status.results);
  storeScanResults(activeScanId, results);
}
```

### Step 6: Add View Results Handler
Add this function with the other handlers:
```typescript
const handleViewResults = (targetId: string): void => {
  const scanId = targetScanIds.get(targetId);
  if (!scanId) {
    addToast({ type: 'warning', message: 'No scan results available for this target' });
    return;
  }
  const results = getScanResults(scanId);
  if (results) {
    setViewingScanResults(results);
  } else {
    addToast({ type: 'warning', message: 'Scan results not found' });
  }
};
```

### Step 7: Add View Results Button
In the target list, add this before the status badge:
```typescript
{target.status === 'complete' && targetScanIds.has(target.id) && (
  <Button size="sm" variant="secondary" onClick={() => handleViewResults(target.id)}>
    <Eye className="w-3 h-3 mr-1" />
    View Results
  </Button>
)}
```

### Step 8: Add Modal
At the end of the JSX, before the closing `</div>`:
```typescript
{viewingScanResults && (
  <ScanResultsView
    results={viewingScanResults}
    onClose={() => setViewingScanResults(null)}
  />
)}
```

### Step 9: Add Parser Helper
At the bottom of the file, add:
```typescript
function parseScanResults(scanId: string, target: string, rawResults: unknown): CompleteScanResults {
  const results = rawResults as Record<string, unknown>;
  return {
    scanId,
    target,
    startTime: Date.now() - 300000,
    endTime: Date.now(),
    status: 'completed',
    toolsUsed: (results.tools_used as ReconToolType[]) || [],
    ports: (results.ports as CompleteScanResults['ports']) || [],
    subdomains: (results.subdomains as CompleteScanResults['subdomains']) || [],
    httpEndpoints: (results.http_endpoints as CompleteScanResults['httpEndpoints']) || [],
    technologies: (results.technologies as CompleteScanResults['technologies']) || [],
    vulnerabilities: (results.vulnerabilities as CompleteScanResults['vulnerabilities']) || [],
    stats: {
      totalPorts: ((results.ports as unknown[]) || []).length,
      openPorts: ((results.ports as unknown[]) || []).length,
      totalSubdomains: ((results.subdomains as unknown[]) || []).length,
      aliveSubdomains: ((results.subdomains as unknown[]) || []).filter((s: unknown) => (s as {alive?: boolean}).alive).length,
      totalEndpoints: ((results.http_endpoints as unknown[]) || []).length,
      totalVulnerabilities: ((results.vulnerabilities as unknown[]) || []).length,
      criticalVulns: ((results.vulnerabilities as unknown[]) || []).filter((v: unknown) => (v as {severity: string}).severity === 'critical').length,
      highVulns: ((results.vulnerabilities as unknown[]) || []).filter((v: unknown) => (v as {severity: string}).severity === 'high').length,
      mediumVulns: ((results.vulnerabilities as unknown[]) || []).filter((v: unknown) => (v as {severity: string}).severity === 'medium').length,
      lowVulns: ((results.vulnerabilities as unknown[]) || []).filter((v: unknown) => (v as {severity: string}).severity === 'low').length,
    },
    rawOutput: results.raw_output as string[] | undefined,
    errors: results.errors as string[] | undefined,
  };
}
```

## Done!

That's it! The scan results viewer is now fully integrated.

## How to Use

1. Start a scan on any target
2. Wait for completion (status badge shows "complete")
3. Click "View Results" button
4. Explore results in the modal:
   - **Overview**: Summary and stats
   - **Ports**: Discovered open ports
   - **Subdomains**: Found subdomains
   - **Endpoints**: HTTP endpoints
   - **Vulnerabilities**: Security findings
   - **Technologies**: Tech stack detected
5. Export as JSON or CSV using header buttons
6. Close modal when done

## Troubleshooting

**"No scan results available"**
- Ensure scan completed successfully
- Check that backend returns results in getScanStatus response

**Results not displaying**
- Verify backend response format matches parseScanResults expectations
- Check browser console for type errors
- Ensure all types are imported correctly

**Export not working**
- Check browser allows downloads
- Verify export functions have proper data

## Backend Expected Format

The `getScanStatus(scanId)` API should return:
```json
{
  "status": "completed",
  "target": "https://example.com",
  "results": {
    "tools_used": ["nmap", "subfinder"],
    "ports": [...],
    "subdomains": [...],
    "http_endpoints": [...],
    "technologies": [...],
    "vulnerabilities": [...]
  }
}
```

Adjust `parseScanResults()` if your format differs.

## Questions?

See `SCAN_RESULTS_IMPLEMENTATION.md` for full documentation.
