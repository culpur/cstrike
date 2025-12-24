#!/bin/bash
# CStrike Web UI Startup Script
# Starts both the Python API server and React frontend

set -e

echo "🚀 Starting CStrike Web UI..."
echo ""

# Check if in correct directory
if [ ! -f "api_server.py" ]; then
    echo "❌ Error: Must run from cstrike project root"
    exit 1
fi

# Install Python dependencies if needed
if ! python3 -c "import flask" 2>/dev/null; then
    echo "📦 Installing Python dependencies..."
    pip install -r api_requirements.txt
fi

# Install Node dependencies if needed
if [ ! -d "web/node_modules" ]; then
    echo "📦 Installing Node dependencies..."
    cd web && npm install && cd ..
fi

# Start Python API server in background
echo "🐍 Starting Python API server on port 8000..."
python3 api_server.py > logs/api_server.log 2>&1 &
API_PID=$!
echo "   API Server PID: $API_PID"

# Wait for API server to start
sleep 3

# Check if API server is running
if ! kill -0 $API_PID 2>/dev/null; then
    echo "❌ API server failed to start. Check logs/api_server.log"
    exit 1
fi

echo "✅ API server running at http://localhost:8000"
echo ""

# Start React frontend
echo "⚛️  Starting React frontend on port 3000..."
cd web
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ CStrike Web UI is running!"
echo ""
echo "📊 Dashboard:  http://localhost:3000"
echo "🔌 API Server: http://localhost:8000"
echo "📡 WebSocket:  ws://localhost:8000"
echo ""
echo "Logs:"
echo "  - API: tail -f logs/api_server.log"
echo "  - Web: (in terminal)"
echo ""
echo "Press Ctrl+C to stop both servers"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Trap Ctrl+C to kill both processes
trap "echo ''; echo '🛑 Stopping servers...'; kill $API_PID $FRONTEND_PID 2>/dev/null; exit 0" INT

# Wait for frontend process
wait $FRONTEND_PID
