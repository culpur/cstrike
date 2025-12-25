#!/bin/bash

###############################################################################
# CStrike Development Environment Startup Script
#
# This script starts both the backend API server and frontend dev server
# in the correct order with proper error handling and health checks.
#
# Usage:
#   ./START_DEV_SERVERS.sh          # Start both servers
#   ./START_DEV_SERVERS.sh backend  # Start only backend
#   ./START_DEV_SERVERS.sh frontend # Start only frontend
#   ./START_DEV_SERVERS.sh stop     # Stop all servers
###############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project paths
PROJECT_ROOT="/Users/soulofall/projects/cstrike"
WEB_DIR="$PROJECT_ROOT/web"
BACKEND_SCRIPT="$PROJECT_ROOT/api_server.py"

# Log files
BACKEND_LOG="$PROJECT_ROOT/logs/backend.log"
FRONTEND_LOG="$PROJECT_ROOT/logs/frontend.log"

# PID files
BACKEND_PID="$PROJECT_ROOT/.backend.pid"
FRONTEND_PID="$PROJECT_ROOT/.frontend.pid"

###############################################################################
# Helper Functions
###############################################################################

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0  # Port is in use
    else
        return 1  # Port is free
    fi
}

wait_for_port() {
    local port=$1
    local max_wait=$2
    local waited=0

    while ! check_port $port; do
        if [ $waited -ge $max_wait ]; then
            return 1  # Timeout
        fi
        sleep 1
        waited=$((waited + 1))
    done
    return 0  # Success
}

stop_server() {
    local pid_file=$1
    local name=$2

    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if ps -p $pid > /dev/null 2>&1; then
            log_info "Stopping $name (PID: $pid)..."
            kill $pid 2>/dev/null || true
            sleep 2

            # Force kill if still running
            if ps -p $pid > /dev/null 2>&1; then
                log_warning "Force killing $name..."
                kill -9 $pid 2>/dev/null || true
            fi

            rm -f "$pid_file"
            log_success "$name stopped"
        else
            log_warning "$name PID file exists but process not found"
            rm -f "$pid_file"
        fi
    fi
}

###############################################################################
# Backend Server Functions
###############################################################################

start_backend() {
    log_info "Starting Backend API Server..."

    # Check if already running
    if check_port 8000; then
        log_warning "Port 8000 is already in use. Backend may already be running."
        local pid=$(lsof -ti:8000)
        echo $pid > "$BACKEND_PID"
        log_success "Backend API: http://localhost:8000"
        return 0
    fi

    # Ensure log directory exists
    mkdir -p "$PROJECT_ROOT/logs"

    # Start backend in background
    cd "$PROJECT_ROOT"
    nohup python3 "$BACKEND_SCRIPT" > "$BACKEND_LOG" 2>&1 &
    local pid=$!
    echo $pid > "$BACKEND_PID"

    log_info "Backend starting (PID: $pid)..."

    # Wait for backend to be ready
    if wait_for_port 8000 30; then
        log_success "Backend API: http://localhost:8000"
        log_success "Backend API Documentation: http://localhost:8000/api/v1/"

        # Test endpoint
        if curl -s http://localhost:8000/api/v1/targets > /dev/null; then
            log_success "Backend health check passed"
        else
            log_warning "Backend started but health check failed"
        fi
    else
        log_error "Backend failed to start within 30 seconds"
        log_error "Check logs: tail -f $BACKEND_LOG"
        return 1
    fi
}

###############################################################################
# Frontend Server Functions
###############################################################################

start_frontend() {
    log_info "Starting Frontend Dev Server..."

    # Check if already running
    if check_port 3000; then
        log_warning "Port 3000 is already in use. Frontend may already be running."
        local pid=$(lsof -ti:3000)
        echo $pid > "$FRONTEND_PID"
        log_success "Frontend: http://localhost:3000"
        return 0
    fi

    # Check if node_modules exists
    if [ ! -d "$WEB_DIR/node_modules" ]; then
        log_warning "node_modules not found. Running npm install..."
        cd "$WEB_DIR"
        npm install
    fi

    # Ensure log directory exists
    mkdir -p "$PROJECT_ROOT/logs"

    # Start frontend in background
    cd "$WEB_DIR"
    nohup npm run dev > "$FRONTEND_LOG" 2>&1 &
    local pid=$!
    echo $pid > "$FRONTEND_PID"

    log_info "Frontend starting (PID: $pid)..."

    # Wait for frontend to be ready
    if wait_for_port 3000 45; then
        log_success "Frontend: http://localhost:3000"
        log_success "Frontend health check passed"
    else
        log_error "Frontend failed to start within 45 seconds"
        log_error "Check logs: tail -f $FRONTEND_LOG"
        return 1
    fi
}

###############################################################################
# Main Script Logic
###############################################################################

stop_all() {
    log_info "Stopping all servers..."
    stop_server "$FRONTEND_PID" "Frontend"
    stop_server "$BACKEND_PID" "Backend"

    # Kill any remaining processes on ports
    if check_port 3000; then
        log_warning "Cleaning up remaining processes on port 3000..."
        lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    fi

    if check_port 8000; then
        log_warning "Cleaning up remaining processes on port 8000..."
        lsof -ti:8000 | xargs kill -9 2>/dev/null || true
    fi

    log_success "All servers stopped"
}

show_status() {
    echo ""
    log_info "=== CStrike Development Environment Status ==="
    echo ""

    # Backend status
    if check_port 8000; then
        local backend_pid=$(lsof -ti:8000)
        log_success "Backend API: RUNNING (PID: $backend_pid, Port: 8000)"
        echo "          URL: http://localhost:8000"
        echo "          Logs: $BACKEND_LOG"
    else
        log_error "Backend API: NOT RUNNING"
    fi

    echo ""

    # Frontend status
    if check_port 3000; then
        local frontend_pid=$(lsof -ti:3000)
        log_success "Frontend: RUNNING (PID: $frontend_pid, Port: 3000)"
        echo "          URL: http://localhost:3000"
        echo "          Logs: $FRONTEND_LOG"
    else
        log_error "Frontend: NOT RUNNING"
    fi

    echo ""
    log_info "=== Quick Commands ==="
    echo "  View Backend Logs:  tail -f $BACKEND_LOG"
    echo "  View Frontend Logs: tail -f $FRONTEND_LOG"
    echo "  Stop All Servers:   $0 stop"
    echo ""
}

###############################################################################
# Main Entry Point
###############################################################################

case "${1:-all}" in
    backend)
        start_backend
        show_status
        ;;
    frontend)
        start_frontend
        show_status
        ;;
    stop)
        stop_all
        ;;
    status)
        show_status
        ;;
    all|*)
        log_info "=== Starting CStrike Development Environment ==="
        echo ""

        # Start backend first
        if ! start_backend; then
            log_error "Failed to start backend. Aborting."
            exit 1
        fi

        echo ""

        # Start frontend
        if ! start_frontend; then
            log_error "Failed to start frontend."
            log_info "Backend is still running. You can access it at http://localhost:8000"
            exit 1
        fi

        echo ""
        log_success "=== Development Environment Ready ==="
        echo ""
        show_status

        log_info "Press Ctrl+C to stop servers, or run: $0 stop"
        echo ""

        # Keep script running and tail logs
        trap stop_all EXIT INT TERM
        tail -f "$BACKEND_LOG" "$FRONTEND_LOG" 2>/dev/null || sleep infinity
        ;;
esac
