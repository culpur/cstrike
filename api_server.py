#!/usr/bin/env python3
"""
CStrike API Server
Provides REST API and WebSocket endpoints for the CStrike Web UI
"""

import os
import json
import logging
import psutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import threading
import time

# Import CStrike modules
from modules.recon import run_recon_layered
from modules.exploitation import run_exploitation_chain
from modules.loot_tracker import get_loot, add_loot
from modules.ai_assistant import ask_ai, get_thoughts

app = Flask(__name__)
CORS(app, origins=['http://localhost:3000'])
socketio = SocketIO(app, cors_allowed_origins=['http://localhost:3000'], async_mode='gevent')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s'
)

# Load configuration
CONFIG_PATH = Path('.env')
CONFIG = json.loads(CONFIG_PATH.read_text()) if CONFIG_PATH.exists() else {}
TARGETS = CONFIG.get("target_scope", [])

# Global state
active_scans = {}
system_metrics = {
    'cpu': 0,
    'ram': 0,
    'vpn_ip': 'Not connected',
    'uptime': 0
}
services_status = {
    'metasploit': 'stopped',
    'zap': 'stopped',
    'burp': 'stopped'
}
current_phase = 'idle'


def get_vpn_ip():
    """Get VPN IP address from wg0 or tun0"""
    for iface in ['wg0', 'tun0']:
        try:
            result = subprocess.run(
                ['ip', 'link', 'show', iface],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            if result.returncode == 0:
                output = subprocess.check_output(
                    ['curl', '--interface', iface, '-s', 'https://ifconfig.me'],
                    stderr=subprocess.DEVNULL
                ).decode().strip()
                return output
        except Exception:
            continue
    return 'Not connected'


def check_service_status(service_name):
    """Check if a service is running"""
    try:
        result = subprocess.run(['pgrep', '-f', service_name], stdout=subprocess.DEVNULL)
        return 'running' if result.returncode == 0 else 'stopped'
    except Exception:
        return 'unknown'


def update_system_metrics():
    """Background thread to update system metrics"""
    global system_metrics, services_status

    start_time = time.time()

    while True:
        try:
            # Update metrics
            system_metrics['cpu'] = psutil.cpu_percent(interval=1)
            system_metrics['ram'] = psutil.virtual_memory().percent
            system_metrics['vpn_ip'] = get_vpn_ip()
            system_metrics['uptime'] = int(time.time() - start_time)

            # Update service status
            services_status['metasploit'] = check_service_status('msfrpcd')
            services_status['zap'] = check_service_status('zap')
            services_status['burp'] = check_service_status('burpsuite')

            # Broadcast to WebSocket clients
            socketio.emit('status_update', {
                'metrics': system_metrics,
                'services': services_status,
                'phase': current_phase
            })

        except Exception as e:
            logging.error(f"Error updating metrics: {e}")

        time.sleep(2)  # Update every 2 seconds


# ==================== REST API ENDPOINTS ====================

@app.route('/api/v1/status', methods=['GET'])
def get_status():
    """Get current system status"""
    return jsonify({
        'metrics': system_metrics,
        'services': services_status,
        'phase': current_phase,
        'timestamp': datetime.now(timezone.utc).isoformat()
    })


@app.route('/api/v1/services', methods=['GET'])
def get_services():
    """Get service status"""
    return jsonify(services_status)


@app.route('/api/v1/services/<service_name>', methods=['POST'])
def control_service(service_name):
    """Start or stop a service"""
    action = request.json.get('action')  # 'start' or 'stop'

    service_commands = {
        'metasploit': {
            'start': ['systemctl', 'start', 'msfrpcd'],
            'stop': ['pkill', '-f', 'msfrpcd']
        },
        'zap': {
            'start': ['zap', '-daemon'],
            'stop': ['pkill', '-f', 'zap']
        },
        'burp': {
            'start': ['burpsuite'],
            'stop': ['pkill', '-f', 'burpsuite']
        }
    }

    if service_name not in service_commands:
        return jsonify({'error': 'Unknown service'}), 404

    if action not in ['start', 'stop']:
        return jsonify({'error': 'Invalid action'}), 400

    try:
        subprocess.Popen(service_commands[service_name][action])
        time.sleep(1)  # Wait for service to start/stop
        services_status[service_name] = check_service_status(service_name)

        return jsonify({
            'service': service_name,
            'action': action,
            'status': services_status[service_name]
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/v1/targets', methods=['GET'])
def get_targets():
    """Get target list"""
    return jsonify({'targets': TARGETS})


@app.route('/api/v1/targets', methods=['POST'])
def add_target():
    """Add a new target"""
    target = request.json.get('target')
    if target and target not in TARGETS:
        TARGETS.append(target)
        # Update config file
        CONFIG['target_scope'] = TARGETS
        CONFIG_PATH.write_text(json.dumps(CONFIG, indent=2))
        return jsonify({'success': True, 'target': target})
    return jsonify({'error': 'Invalid or duplicate target'}), 400


@app.route('/api/v1/targets/<int:target_id>', methods=['DELETE'])
def remove_target(target_id):
    """Remove a target"""
    if 0 <= target_id < len(TARGETS):
        removed = TARGETS.pop(target_id)
        CONFIG['target_scope'] = TARGETS
        CONFIG_PATH.write_text(json.dumps(CONFIG, indent=2))
        return jsonify({'success': True, 'removed': removed})
    return jsonify({'error': 'Invalid target ID'}), 404


@app.route('/api/v1/recon/start', methods=['POST'])
def start_recon():
    """Start reconnaissance scan"""
    target = request.json.get('target')
    tools = request.json.get('tools', [])

    if not target:
        return jsonify({'error': 'Target required'}), 400

    scan_id = f"scan_{int(time.time())}"

    def run_scan():
        global current_phase
        current_phase = 'recon'
        socketio.emit('phase_change', {'phase': 'recon', 'target': target})

        try:
            results = run_recon_layered(target)
            active_scans[scan_id] = {
                'status': 'completed',
                'target': target,
                'results': results,
                'timestamp': datetime.now(timezone.utc).isoformat()
            }
        except Exception as e:
            active_scans[scan_id] = {
                'status': 'failed',
                'error': str(e)
            }

        current_phase = 'idle'

    thread = threading.Thread(target=run_scan)
    thread.start()

    active_scans[scan_id] = {
        'status': 'running',
        'target': target,
        'tools': tools
    }

    return jsonify({'scan_id': scan_id, 'status': 'started'})


@app.route('/api/v1/recon/status/<scan_id>', methods=['GET'])
def get_scan_status(scan_id):
    """Get scan status"""
    if scan_id in active_scans:
        return jsonify(active_scans[scan_id])
    return jsonify({'error': 'Scan not found'}), 404


@app.route('/api/v1/loot/<target>', methods=['GET'])
def get_target_loot(target):
    """Get loot for a target"""
    category = request.args.get('category')

    if category:
        loot = get_loot(target, category)
    else:
        # Get all loot categories
        loot = {
            'usernames': get_loot(target, 'username'),
            'passwords': get_loot(target, 'password'),
            'urls': get_loot(target, 'url'),
            'ports': get_loot(target, 'port')
        }

    return jsonify(loot)


@app.route('/api/v1/ai/thoughts', methods=['GET'])
def get_ai_thoughts():
    """Get recent AI thoughts"""
    thoughts = get_thoughts()
    return jsonify({'thoughts': thoughts})


@app.route('/api/v1/logs', methods=['GET'])
def get_logs():
    """Get recent logs"""
    limit = request.args.get('limit', 100, type=int)
    level = request.args.get('level')  # DEBUG, INFO, WARN, ERROR

    log_file = Path('logs/driver.log')
    if not log_file.exists():
        return jsonify({'logs': []})

    with open(log_file, 'r') as f:
        lines = f.readlines()[-limit:]

    # Filter by level if specified
    if level:
        lines = [line for line in lines if level in line]

    logs = []
    for line in lines:
        try:
            parts = line.split(maxsplit=3)
            if len(parts) >= 4:
                logs.append({
                    'timestamp': f"{parts[0]} {parts[1]}",
                    'level': parts[2],
                    'message': parts[3].strip()
                })
        except Exception:
            logs.append({'message': line.strip()})

    return jsonify({'logs': logs})


# ==================== WEBSOCKET HANDLERS ====================

@socketio.on('connect')
def handle_connect():
    """Handle WebSocket connection"""
    logging.info(f"Client connected: {request.sid}")
    emit('connected', {'message': 'Connected to CStrike API'})


@socketio.on('disconnect')
def handle_disconnect():
    """Handle WebSocket disconnection"""
    logging.info(f"Client disconnected: {request.sid}")


@socketio.on('subscribe')
def handle_subscribe(data):
    """Subscribe to event types"""
    event_types = data.get('events', [])
    logging.info(f"Client {request.sid} subscribed to: {event_types}")
    emit('subscribed', {'events': event_types})


@socketio.on('ping')
def handle_ping():
    """Handle ping for keepalive"""
    emit('pong', {'timestamp': datetime.now(timezone.utc).isoformat()})


# ==================== MAIN ====================

if __name__ == '__main__':
    # Start metrics update thread
    metrics_thread = threading.Thread(target=update_system_metrics, daemon=True)
    metrics_thread.start()

    logging.info("🚀 CStrike API Server starting...")
    logging.info("📡 REST API: http://localhost:8000/api/v1/")
    logging.info("🔌 WebSocket: ws://localhost:8000/")
    logging.info("🎯 Frontend: http://localhost:3000")

    socketio.run(app, host='0.0.0.0', port=8000, debug=True, allow_unsafe_werkzeug=True)
