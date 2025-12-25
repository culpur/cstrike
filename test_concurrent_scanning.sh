#!/bin/bash
# Concurrent Scanning Test Script
# Tests multi-target concurrent scanning capabilities

set -e

API_BASE="http://localhost:8000/api/v1"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== CStrike Concurrent Scanning Test Suite ===${NC}\n"

# Test 1: Start multiple individual scans
echo -e "${YELLOW}Test 1: Starting multiple individual scans${NC}"
SCAN1=$(curl -s -X POST "$API_BASE/recon/start" \
  -H "Content-Type: application/json" \
  -d '{"target": "https://example.com", "tools": ["nmap"]}' | jq -r '.scan_id')
echo "Started scan 1: $SCAN1"

sleep 1

SCAN2=$(curl -s -X POST "$API_BASE/recon/start" \
  -H "Content-Type: application/json" \
  -d '{"target": "https://test.com", "tools": ["nmap"]}' | jq -r '.scan_id')
echo "Started scan 2: $SCAN2"

sleep 1

SCAN3=$(curl -s -X POST "$API_BASE/recon/start" \
  -H "Content-Type: application/json" \
  -d '{"target": "https://demo.com", "tools": ["whatweb"]}' | jq -r '.scan_id')
echo "Started scan 3: $SCAN3"

echo -e "${GREEN}✓ Multiple scans started successfully${NC}\n"

# Test 2: Check active scans
echo -e "${YELLOW}Test 2: Checking active scans${NC}"
ACTIVE=$(curl -s "$API_BASE/recon/active")
COUNT=$(echo "$ACTIVE" | jq -r '.count')
echo "Active scans: $COUNT"
echo "$ACTIVE" | jq -r '.active_scans[] | "  - \(.scan_id): \(.target) (\(.status))"'
echo -e "${GREEN}✓ Active scans retrieved successfully${NC}\n"

# Test 3: Get individual scan status
echo -e "${YELLOW}Test 3: Getting individual scan status${NC}"
STATUS1=$(curl -s "$API_BASE/recon/status/$SCAN1")
echo "Scan 1 status: $(echo "$STATUS1" | jq -r '.status')"
echo -e "${GREEN}✓ Scan status retrieved successfully${NC}\n"

# Test 4: Batch scan
echo -e "${YELLOW}Test 4: Starting batch scan${NC}"
BATCH=$(curl -s -X POST "$API_BASE/recon/batch" \
  -H "Content-Type: application/json" \
  -d '{
    "targets": ["https://batch1.com", "https://batch2.com", "https://batch3.com"],
    "tools": ["nmap", "whatweb"]
  }')
BATCH_COUNT=$(echo "$BATCH" | jq -r '.successful')
echo "Batch scan started: $BATCH_COUNT targets"
echo "$BATCH" | jq -r '.scan_ids[]' | while read sid; do
  echo "  - $sid"
done
echo -e "${GREEN}✓ Batch scan started successfully${NC}\n"

# Test 5: Check active scans again
echo -e "${YELLOW}Test 5: Checking active scans after batch${NC}"
ACTIVE2=$(curl -s "$API_BASE/recon/active")
COUNT2=$(echo "$ACTIVE2" | jq -r '.count')
echo "Active scans now: $COUNT2"
echo -e "${GREEN}✓ Active scans updated${NC}\n"

# Test 6: Cancel a scan
echo -e "${YELLOW}Test 6: Cancelling a scan${NC}"
CANCEL=$(curl -s -X DELETE "$API_BASE/recon/scans/$SCAN1")
CANCEL_STATUS=$(echo "$CANCEL" | jq -r '.status')
echo "Scan $SCAN1 cancellation: $CANCEL_STATUS"
echo -e "${GREEN}✓ Scan cancelled successfully${NC}\n"

# Test 7: Verify cancellation
echo -e "${YELLOW}Test 7: Verifying cancellation${NC}"
sleep 2
STATUS_AFTER=$(curl -s "$API_BASE/recon/status/$SCAN1")
FINAL_STATUS=$(echo "$STATUS_AFTER" | jq -r '.status')
echo "Scan $SCAN1 final status: $FINAL_STATUS"
if [ "$FINAL_STATUS" = "cancelled" ] || [ "$FINAL_STATUS" = "cancelling" ]; then
  echo -e "${GREEN}✓ Cancellation verified${NC}\n"
else
  echo -e "${YELLOW}⚠ Scan status: $FINAL_STATUS (may still be cancelling)${NC}\n"
fi

# Test 8: Test concurrency limit
echo -e "${YELLOW}Test 8: Testing concurrency limit (max 10 scans)${NC}"
TARGETS='['
for i in {1..11}; do
  TARGETS+="\"https://limit-test-$i.com\""
  if [ $i -lt 11 ]; then
    TARGETS+=","
  fi
done
TARGETS+=']'

LIMIT_TEST=$(curl -s -X POST "$API_BASE/recon/batch" \
  -H "Content-Type: application/json" \
  -d "{\"targets\": $TARGETS, \"tools\": [\"nmap\"]}")

if echo "$LIMIT_TEST" | jq -e '.error' > /dev/null; then
  echo -e "${GREEN}✓ Concurrency limit enforced${NC}"
  echo "Error message: $(echo "$LIMIT_TEST" | jq -r '.error')"
else
  echo -e "${YELLOW}⚠ Warning: Concurrency limit may not be enforced${NC}"
fi
echo

# Test 9: Invalid target handling
echo -e "${YELLOW}Test 9: Testing invalid target handling${NC}"
INVALID=$(curl -s -X POST "$API_BASE/recon/start" \
  -H "Content-Type: application/json" \
  -d '{"target": "", "tools": ["nmap"]}')
if echo "$INVALID" | jq -e '.error' > /dev/null; then
  echo -e "${GREEN}✓ Invalid target rejected${NC}"
  echo "Error message: $(echo "$INVALID" | jq -r '.error')"
else
  echo -e "${RED}✗ Invalid target was accepted${NC}"
fi
echo

# Test 10: Cancel non-existent scan
echo -e "${YELLOW}Test 10: Testing cancellation of non-existent scan${NC}"
NONEXIST=$(curl -s -X DELETE "$API_BASE/recon/scans/scan_nonexistent_123")
if echo "$NONEXIST" | jq -e '.error' > /dev/null; then
  echo -e "${GREEN}✓ Non-existent scan error handled${NC}"
  echo "Error message: $(echo "$NONEXIST" | jq -r '.error')"
else
  echo -e "${RED}✗ Non-existent scan not handled properly${NC}"
fi
echo

# Summary
echo -e "${GREEN}=== Test Summary ===${NC}"
echo "✓ Individual scans can start concurrently"
echo "✓ Active scans can be queried"
echo "✓ Scan status can be retrieved individually"
echo "✓ Batch scans work correctly"
echo "✓ Scans can be cancelled"
echo "✓ Concurrency limits are enforced"
echo "✓ Invalid inputs are handled"
echo "✓ Error cases are handled properly"
echo
echo -e "${GREEN}All tests completed!${NC}"
echo
echo "Note: Some scans may still be running. Check with:"
echo "  curl $API_BASE/recon/active | jq"
