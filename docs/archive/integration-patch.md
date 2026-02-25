# Scan Results Viewer Integration Patch

## Changes Required for ReconnaissanceView.tsx

### 1. Add imports at the top:
```typescript
import { Eye } from 'lucide-react';
import type { CompleteScanResults } from '@/types';
import { ScanResultsView } from './components/ScanResultsView';
```

### 2. Add state variables in the component:
```typescript
const [viewingScanResults, setViewingScanResults] = useState<CompleteScanResults | null>(null);
const [targetScanIds, setTargetScanIds] = useState<Map<string, string>>(new Map());
```

### 3. Add store actions to destructuring:
```typescript
const {
  // ... existing
  storeScanResults,
  getScanResults,
} = useReconStore();
```

### 4. Update the handleStartScan function to track scan IDs:
```typescript
// Inside handleStartScan, after setActiveScanId(scanId):
setTargetScanIds(prev => new Map(prev).set(targetId, scanId));
```

### 5. Update poll scan status useEffect to store results:
```typescript
// Inside the pollInterval callback, after status check:
if (status.status === 'completed' && status.results) {
  const results = parseScanResults(activeScanId, status.target || '', status.results);
  storeScanResults(activeScanId, results);
}
```

### 6. Add handleViewResults function:
```typescript
const handleViewResults = (targetId: string): void => {
  const scanId = targetScanIds.get(targetId);
  if (!scanId) {
    addToast({
      type: 'warning',
      message: 'No scan results available for this target',
    });
    return;
  }

  const results = getScanResults(scanId);
  if (results) {
    setViewingScanResults(results);
  } else {
    addToast({
      type: 'warning',
      message: 'Scan results not found',
    });
  }
};
```

### 7. Update the target list to include "View Results" button:
```typescript
{/* Inside the target card, before status badge */}
{target.status === 'complete' && targetScanIds.has(target.id) && (
  <Button
    size="sm"
    variant="secondary"
    onClick={() => handleViewResults(target.id)}
  >
    <Eye className="w-3 h-3 mr-1" />
    View Results
  </Button>
)}
```

### 8. Add the modal at the end of JSX (before closing div):
```typescript
{/* Scan Results Modal */}
{viewingScanResults && (
  <ScanResultsView
    results={viewingScanResults}
    onClose={() => setViewingScanResults(null)}
  />
)}
```

### 9. Add parseScanResults helper function at the bottom:
```typescript
function parseScanResults(scanId: string, target: string, rawResults: unknown): CompleteScanResults {
  const results = rawResults as Record<string, unknown>;

  return {
    scanId,
    target,
    startTime: Date.now() - 300000, // Placeholder
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

## Summary

These changes integrate the comprehensive scan results viewer into the existing ReconnaissanceView:

1. **View Results Button**: Appears for completed scans next to the status badge
2. **Scan ID Tracking**: Maps target IDs to scan IDs for result retrieval
3. **Result Storage**: Automatically stores full scan results when completed
4. **Modal Display**: Shows detailed results in the ScanResultsView modal
5. **Export Functionality**: Already built into ScanResultsView (JSON/CSV exports)

The export functionality is already implemented in the ScanResultsView component with dedicated JSON and CSV export buttons in the modal header.
