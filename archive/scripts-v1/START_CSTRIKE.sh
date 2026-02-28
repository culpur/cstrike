#!/bin/bash

# CStrike Startup Script
# This script starts both the API server and frontend development server

set -e

echo "🚀 Starting CStrike..."
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "api_server.py" ]; then
    echo -e "${RED}Error: api_server.py not found. Please run this script from the cstrike root directory.${NC}"
    exit 1
fi

# Function to cleanup on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down CStrike...${NC}"

    # Kill API server
    if [ ! -z "$API_PID" ]; then
        kill $API_PID 2>/dev/null || true
        echo -e "${GREEN}✓ API server stopped${NC}"
    fi

    # Kill frontend dev server
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null || true
        echo -e "${GREEN}✓ Frontend dev server stopped${NC}"
    fi

    exit 0
}

# Trap Ctrl+C
trap cleanup INT TERM

# Start API server
echo -e "${YELLOW}Starting API server on port 8000...${NC}"
python3 api_server.py &
API_PID=$!
sleep 2

# Check if API server started
if ps -p $API_PID > /dev/null 2>&1; then
    echo -e "${GREEN}✓ API server running (PID: $API_PID)${NC}"
else
    echo -e "${RED}✗ Failed to start API server${NC}"
    exit 1
fi

# Start frontend dev server
echo ""
echo -e "${YELLOW}Starting frontend dev server on port 3000...${NC}"
cd web
npm run dev &
FRONTEND_PID=$!
cd ..
sleep 3

# Check if frontend started
if ps -p $FRONTEND_PID > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Frontend dev server running (PID: $FRONTEND_PID)${NC}"
else
    echo -e "${RED}✗ Failed to start frontend dev server${NC}"
    kill $API_PID 2>/dev/null || true
    exit 1
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}🎉 CStrike is now running!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "  ${YELLOW}Frontend:${NC} http://localhost:3000"
echo -e "  ${YELLOW}API:${NC}      http://localhost:8000"
echo -e "  ${YELLOW}Docs:${NC}     http://localhost:8000/docs"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

# Keep script running
wait
