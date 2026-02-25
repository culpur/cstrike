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
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import threading
import time
import tempfile

# Import CStrike modules
from modules.recon import run_recon_layered
from modules.exploitation import run_exploitation_chain, run_bruteforce_enumeration
from modules.utils import get_target_dir
from modules.loot_tracker import (
    get_loot, add_loot, generate_credential_heatmap,
    get_credentials, get_all_credentials, get_credential_by_id,
    update_credential_validation
)
from modules.credential_validator import validate_credential, validate_credentials_batch
from modules.ai_assistant import ask_ai, get_thoughts, parse_ai_commands
from modules.zap_burp import start_zap, start_burp, run_web_scans
from modules.metasploit import start_msf_rpc, run_msf_exploits
from modules.vulnapi import run_vulnapi_full_scan, run_vulnapi_curl_scan, run_vulnapi_openapi_scan

app = Flask(__name__)
CORS(app, origins=['http://localhost:3000'])
socketio = SocketIO(app, cors_allowed_origins=['http://localhost:3000'], async_mode='gevent')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s'
)


# ==================== WEBSOCKET LOG STREAMING ====================

def emit_log(level, source, message, metadata=None):
    """Emit log entry via WebSocket"""
    socketio.emit('log_entry', {
        'id': f"{int(time.time() * 1000)}-{os.urandom(2).hex()}",
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'level': level,
        'source': source,
        'message': message,
        'metadata': metadata or {}
    })


class WebSocketLogHandler(logging.Handler):
    """Custom logging handler that emits logs via WebSocket"""
    def emit(self, record):
        try:
            # Extract metadata from record
            metadata = {}
            if hasattr(record, 'target'):
                metadata['target'] = record.target
            if hasattr(record, 'scan_id'):
                metadata['scan_id'] = record.scan_id
            if hasattr(record, 'tool'):
                metadata['tool'] = record.tool

            # Emit via WebSocket
            emit_log(
                level=record.levelname,
                source=record.name,
                message=record.getMessage(),
                metadata=metadata
            )
        except Exception as e:
            # Don't let logging errors crash the app
            print(f"WebSocket log handler error: {e}")

# Load configuration
CONFIG_PATH = Path('.env')
CONFIG = json.loads(CONFIG_PATH.read_text()) if CONFIG_PATH.exists() else {}
TARGETS = CONFIG.get("target_scope", [])

# Global state
active_scans = {}
active_scans_lock = threading.Lock()  # Thread safety for concurrent scans
scan_threads = {}  # Track running threads for cancellation
system_metrics = {
    'cpu': 0,
    'memory': 0,  # Changed from 'ram' to match frontend
    'vpnIp': None,  # Changed from 'vpn_ip' to camelCase, None instead of string
    'uptime': 0,
    'timestamp': 0
}
services_status = {
    'metasploitRpc': 'stopped',  # Changed from 'metasploit' to match frontend
    'zap': 'stopped',
    'burp': 'stopped'
}
current_phase = 'idle'


def get_vpn_ip():
    """Get VPN IP address from wg0 or tun0"""
    import platform

    for iface in ['wg0', 'tun0', 'utun0', 'utun1', 'utun2']:  # Added macOS utun interfaces
        try:
            # Check if interface exists (platform-specific)
            if platform.system() == 'Darwin':  # macOS
                result = subprocess.run(
                    ['ifconfig', iface],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL
                )
                if result.returncode == 0:
                    # Try to get external IP through this interface
                    try:
                        output = subprocess.check_output(
                            ['curl', '--interface', iface, '-s', '--connect-timeout', '2', 'https://ifconfig.me'],
                            stderr=subprocess.DEVNULL,
                            timeout=3
                        ).decode().strip()
                        if output:
                            return output
                    except:
                        pass
            else:  # Linux
                result = subprocess.run(
                    ['ip', 'link', 'show', iface],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
                if result.returncode == 0:
                    output = subprocess.check_output(
                        ['curl', '--interface', iface, '-s', '--connect-timeout', '2', 'https://ifconfig.me'],
                        stderr=subprocess.DEVNULL,
                        timeout=3
                    ).decode().strip()
                    if output:
                        return output
        except Exception:
            continue
    return None  # Changed from 'Not connected' to None


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
            system_metrics['memory'] = psutil.virtual_memory().percent
            system_metrics['vpnIp'] = get_vpn_ip()
            system_metrics['uptime'] = int(time.time() - start_time)
            system_metrics['timestamp'] = int(time.time() * 1000)  # Milliseconds

            # Update service status
            services_status['metasploitRpc'] = check_service_status('msfrpcd')
            services_status['zap'] = check_service_status('zap')
            services_status['burp'] = check_service_status('burpsuite')

            # Broadcast to WebSocket clients
            # Legacy event for backward compatibility
            socketio.emit('status_update', {
                'metrics': system_metrics,
                'services': services_status,
                'phase': current_phase
            })

            # New event for dashboard (matches frontend expectations)
            socketio.emit('system_metrics', system_metrics)

        except Exception as e:
            logging.error(f"Error updating metrics: {e}")

        time.sleep(2)  # Update every 2 seconds

# ==================== AUTO-SERVICE MANAGEMENT ====================

def is_process_running(name):
    """Check if a process is running by name"""
    try:
        output = os.popen(f"pgrep -f '{name}'").read()
        return bool(output.strip())
    except Exception:
        return False


def ensure_zap_running(socketio=None, target=None):
    """
    Ensure ZAP is running, start if not

    Args:
        socketio: Optional SocketIO instance for progress events
        target: Optional target name for tracking
    """
    if not is_process_running("zap"):
        logging.info("[Auto-Service] Starting ZAP...")
        if socketio:
            socketio.emit('service_auto_start', {
                'service': 'zap',
                'target': target,
                'status': 'starting',
                'timestamp': datetime.now(timezone.utc).isoformat()
            })
        start_zap(gui=False)  # Start in daemon mode
        services_status['zap'] = 'running'
        logging.info("[Auto-Service] ZAP started successfully")
    else:
        logging.info("[Auto-Service] ZAP is already running")


def ensure_burp_running(socketio=None, target=None):
    """
    Ensure Burp Suite is running, start if not

    Args:
        socketio: Optional SocketIO instance for progress events
        target: Optional target name for tracking
    """
    if not is_process_running("burpsuite"):
        logging.info("[Auto-Service] Starting Burp Suite...")
        if socketio:
            socketio.emit('service_auto_start', {
                'service': 'burp',
                'target': target,
                'status': 'starting',
                'timestamp': datetime.now(timezone.utc).isoformat()
            })
        start_burp()
        services_status['burp'] = 'running'
        logging.info("[Auto-Service] Burp Suite started successfully")
    else:
        logging.info("[Auto-Service] Burp Suite is already running")


def ensure_msf_running(socketio=None, target=None):
    """
    Ensure Metasploit RPC is running, start if not

    Args:
        socketio: Optional SocketIO instance for progress events
        target: Optional target name for tracking

    Returns:
        MsfRpcClient instance or None
    """
    if not is_process_running("msfrpcd"):
        logging.info("[Auto-Service] Starting Metasploit RPC...")
        if socketio:
            socketio.emit('service_auto_start', {
                'service': 'metasploitRpc',
                'target': target,
                'status': 'starting',
                'timestamp': datetime.now(timezone.utc).isoformat()
            })

        # MSF RPC start is handled by start_msf_rpc()
        client = start_msf_rpc()
        if client:
            services_status['metasploitRpc'] = 'running'
            logging.info("[Auto-Service] Metasploit RPC started successfully")
            return client
        else:
            logging.error("[Auto-Service] Failed to start Metasploit RPC")
            return None
    else:
        logging.info("[Auto-Service] Metasploit RPC is already running")
        return start_msf_rpc()  # Connect to existing instance


def execute_ai_commands(commands, target, target_dir, socketio=None, scan_id=None):
    """
    Execute AI-suggested commands with proper logging and event emission

    Args:
        commands: List of command arrays to execute
        target: Target hostname/IP
        target_dir: Path to target results directory
        socketio: Optional SocketIO instance for progress events
        scan_id: Optional scan ID for tracking
    """
    command_logs = []

    for cmd in commands:
        log_entry = {
            "command": ' '.join(cmd),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

        try:
            logging.info(f"[AI ➔ Command] {' '.join(cmd)}")

            # Emit command execution event
            if socketio:
                socketio.emit('ai_command_execution', {
                    'scan_id': scan_id,
                    'target': target,
                    'command': ' '.join(cmd),
                    'status': 'running',
                    'timestamp': datetime.now(timezone.utc).isoformat()
                })

            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=300
            )

            log_entry["status"] = "success" if result.returncode == 0 else "fail"
            log_entry["stdout"] = result.stdout.strip()
            log_entry["stderr"] = result.stderr.strip()

            # Emit completion event
            if socketio:
                socketio.emit('ai_command_execution', {
                    'scan_id': scan_id,
                    'target': target,
                    'command': ' '.join(cmd),
                    'status': 'success' if result.returncode == 0 else 'failed',
                    'returncode': result.returncode,
                    'timestamp': datetime.now(timezone.utc).isoformat()
                })

            logging.info(f"[AI ➔ Command] Completed with returncode {result.returncode}")

        except Exception as e:
            log_entry["status"] = "error"
            log_entry["stderr"] = str(e)
            logging.error(f"[AI ➔ Command] Failed: {e}")

            if socketio:
                socketio.emit('ai_command_execution', {
                    'scan_id': scan_id,
                    'target': target,
                    'command': ' '.join(cmd),
                    'status': 'error',
                    'error': str(e),
                    'timestamp': datetime.now(timezone.utc).isoformat()
                })

        command_logs.append(log_entry)

    # Save command logs to target directory
    log_file = Path(target_dir) / "ai_commands.json"
    log_file.write_text(json.dumps(command_logs, indent=2))


def run_full_ai_workflow(target, scan_id, tools, socketio):
    """
    Execute the complete AI-driven workflow for a target

    This mirrors cstrike.py but with WebSocket event emissions for real-time UI updates.

    Phases:
        1. Reconnaissance (all enabled tools)
        2. AI Analysis #1 (post-recon)
        3. Execute AI-suggested commands
        4. Web Application Scanning (ZAP/Burp auto-start)
        5. API Security Scanning (VulnAPI)
        6. Metasploit Exploitation (MSF auto-start)
        7. Exploitation Chain (nuclei, ffuf, vulnapi)
        8. AI Analysis #2 (post-exploitation)
        9. Execute AI followup commands

    Args:
        target: Target hostname/IP
        scan_id: Unique scan identifier
        tools: List of tools to enable (currently unused, AI decides)
        socketio: SocketIO instance for event emissions
    """
    global current_phase
    target_dir = get_target_dir(target)

    try:
        # ==================== PHASE 1: RECONNAISSANCE ====================
        current_phase = 'recon'
        socketio.emit('phase_change', {
            'phase': 'recon',
            'target': target,
            'scan_id': scan_id,
            'message': 'Starting reconnaissance phase',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

        logging.info(f"[Phase 1/9] Starting reconnaissance for {target}")
        socketio.emit('recon_output', {
            'scan_id': scan_id,
            'target': target,
            'event': 'started',
            'message': f'Starting reconnaissance on {target}',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

        recon_results = run_recon_layered(target, socketio=socketio, scan_id=scan_id)

        logging.info(f"[Phase 1/9] Reconnaissance completed for {target}")
        socketio.emit('recon_output', {
            'scan_id': scan_id,
            'target': target,
            'event': 'completed',
            'results': recon_results,
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

        # ==================== PHASE 2: AI ANALYSIS #1 (POST-RECON) ====================
        current_phase = 'ai_analysis_1'
        socketio.emit('phase_change', {
            'phase': 'ai_analysis_1',
            'target': target,
            'scan_id': scan_id,
            'message': 'AI analyzing reconnaissance results',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

        logging.info(f"[Phase 2/9] AI Analysis #1 (post-recon) for {target}")
        ai_response = ask_ai(recon_results, socketio=socketio, target=target)

        if ai_response:
            # Save AI suggestions
            suggestions_file = Path(target_dir) / "ai_suggestions_post_recon.json"
            suggestions_file.write_text(json.dumps({
                "stage": "post_recon",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "response": ai_response
            }, indent=2))

            # ==================== PHASE 3: EXECUTE AI COMMANDS ====================
            current_phase = 'ai_execution_1'
            socketio.emit('phase_change', {
                'phase': 'ai_execution_1',
                'target': target,
                'scan_id': scan_id,
                'message': 'Executing AI-suggested commands',
                'timestamp': datetime.now(timezone.utc).isoformat()
            })

            logging.info(f"[Phase 3/9] Executing AI-suggested commands for {target}")
            commands = parse_ai_commands(ai_response, socketio=socketio, target=target)

            if commands:
                execute_ai_commands(
                    commands,
                    target,
                    target_dir,
                    socketio=socketio,
                    scan_id=scan_id
                )

        # ==================== PHASE 4: WEB APPLICATION SCANNING ====================
        current_phase = 'web_scans'
        socketio.emit('phase_change', {
            'phase': 'web_scans',
            'target': target,
            'scan_id': scan_id,
            'message': 'Running web application scans',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

        logging.info(f"[Phase 4/9] Web application scanning for {target}")

        # Auto-start ZAP and Burp if not running
        ensure_zap_running(socketio=socketio, target=target)
        ensure_burp_running(socketio=socketio, target=target)

        # Run web scans
        run_web_scans(target, target_dir)

        # ==================== PHASE 5: API SECURITY SCANNING ====================
        current_phase = 'apiscan'
        socketio.emit('phase_change', {
            'phase': 'apiscan',
            'target': target,
            'scan_id': scan_id,
            'message': 'Running API security scanning (VulnAPI)',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

        logging.info(f"[Phase 5/9] API security scanning for {target}")
        vulnapi_results = run_vulnapi_full_scan(
            target, socketio=socketio, scan_id=scan_id
        )

        # Save VulnAPI summary
        if vulnapi_results and vulnapi_results.get("total_findings", 0) > 0:
            vulnapi_summary_file = Path(target_dir) / "vulnapi_summary.json"
            vulnapi_summary_file.write_text(json.dumps(vulnapi_results, indent=2))

        # ==================== PHASE 6: METASPLOIT EXPLOITATION ====================
        current_phase = 'metasploit'
        socketio.emit('phase_change', {
            'phase': 'metasploit',
            'target': target,
            'scan_id': scan_id,
            'message': 'Running Metasploit exploitation',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

        logging.info(f"[Phase 6/9] Metasploit exploitation for {target}")

        # Auto-start Metasploit RPC if not running
        msf_client = ensure_msf_running(socketio=socketio, target=target)
        if msf_client:
            run_msf_exploits(msf_client, target)

        # ==================== PHASE 6: EXPLOITATION CHAIN ====================
        current_phase = 'exploitation'
        socketio.emit('phase_change', {
            'phase': 'exploitation',
            'target': target,
            'scan_id': scan_id,
            'message': 'Running exploitation chain',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

        logging.info(f"[Phase 7/9] Exploitation chain for {target}")
        socketio.emit('exploit_result', {
            'exploit_id': f"{scan_id}_exploit",
            'target': target,
            'event': 'started',
            'message': f'Starting exploitation chain on {target}',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

        run_exploitation_chain(target, target_dir, enabled_tools=['nuclei', 'ffuf', 'vulnapi'])

        socketio.emit('exploit_result', {
            'exploit_id': f"{scan_id}_exploit",
            'target': target,
            'event': 'completed',
            'message': 'Exploitation chain completed',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

        # ==================== PHASE 8: AI ANALYSIS #2 (POST-EXPLOITATION) ====================
        current_phase = 'ai_analysis_2'
        socketio.emit('phase_change', {
            'phase': 'ai_analysis_2',
            'target': target,
            'scan_id': scan_id,
            'message': 'AI analyzing exploitation results',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

        logging.info(f"[Phase 8/9] AI Analysis #2 (post-exploitation) for {target}")

        # Gather loot for AI analysis
        loot = {
            "usernames": get_loot(target, "username"),
            "passwords": get_loot(target, "password"),
            "protocols": get_loot(target, "protocol"),
            "urls": get_loot(target, "url"),
            "ports": get_loot(target, "port"),
            "api_vulnerabilities": get_loot(target, "vulnerability")
        }

        ai_followup = ask_ai(
            {"recon": recon_results, "loot": loot},
            socketio=socketio,
            target=target
        )

        if ai_followup:
            # Save AI followup suggestions
            followup_file = Path(target_dir) / "ai_suggestions_post_exploitation.json"
            followup_file.write_text(json.dumps({
                "stage": "post_exploitation",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "response": ai_followup
            }, indent=2))

            # ==================== PHASE 9: EXECUTE AI FOLLOWUP COMMANDS ====================
            current_phase = 'ai_execution_2'
            socketio.emit('phase_change', {
                'phase': 'ai_execution_2',
                'target': target,
                'scan_id': scan_id,
                'message': 'Executing AI followup commands',
                'timestamp': datetime.now(timezone.utc).isoformat()
            })

            logging.info(f"[Phase 9/9] Executing AI followup commands for {target}")
            followup_commands = parse_ai_commands(ai_followup, socketio=socketio, target=target)

            if followup_commands:
                execute_ai_commands(
                    followup_commands,
                    target,
                    target_dir,
                    socketio=socketio,
                    scan_id=scan_id
                )

        # ==================== COMPLETION ====================
        logging.info(f"[✓] Completed all phases for {target}")
        socketio.emit('scan_complete', {
            'scan_id': scan_id,
            'target': target,
            'status': 'completed',
            'message': f'Full AI workflow completed for {target}',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

        # Update scan status
        with active_scans_lock:
            active_scans[scan_id].update({
                'status': 'completed',
                'completed_at': datetime.now(timezone.utc).isoformat()
            })

    except Exception as e:
        logging.error(f"[✗] AI workflow failed for {target}: {e}")
        socketio.emit('scan_complete', {
            'scan_id': scan_id,
            'target': target,
            'status': 'failed',
            'error': str(e),
            'message': f'AI workflow failed for {target}: {str(e)}',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

        with active_scans_lock:
            active_scans[scan_id].update({
                'status': 'failed',
                'error': str(e),
                'completed_at': datetime.now(timezone.utc).isoformat()
            })

    finally:
        # Reset phase back to idle
        current_phase = 'idle'
        socketio.emit('phase_change', {
            'phase': 'idle',
            'target': target,
            'scan_id': scan_id,
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

        # Clean up thread reference
        with active_scans_lock:
            if scan_id in scan_threads:
                del scan_threads[scan_id]




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
        'metasploitRpc': {
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


@app.route('/api/v1/services/<service_name>/restart', methods=['POST'])
def restart_service(service_name):
    """Restart a service"""
    # Map frontend names to process names
    process_map = {
        'metasploitRpc': 'msfrpcd',
        'zap': 'zap',
        'burp': 'burpsuite'
    }

    if service_name not in process_map:
        return jsonify({'error': 'Unknown service'}), 404

    try:
        process = process_map[service_name]
        # Stop
        subprocess.run(['pkill', '-f', process], check=False)
        time.sleep(2)

        # Start based on service
        if service_name == 'metasploitRpc':
            subprocess.Popen(['msfrpcd', '-P', 'password', '-S'])
        elif service_name == 'zap':
            subprocess.Popen(['zap.sh', '-daemon'])
        elif service_name == 'burp':
            subprocess.Popen(['burpsuite'])

        time.sleep(1)
        services_status[service_name] = check_service_status(process)

        return jsonify({
            'service': service_name,
            'action': 'restart',
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


@app.route('/api/v1/targets/<path:target_id>', methods=['DELETE'])
def remove_target(target_id):
    """Remove a target by URL or index"""
    # Try to parse as integer index first
    try:
        idx = int(target_id)
        if 0 <= idx < len(TARGETS):
            removed = TARGETS.pop(idx)
            CONFIG['target_scope'] = TARGETS
            CONFIG_PATH.write_text(json.dumps(CONFIG, indent=2))
            return jsonify({'success': True, 'removed': removed})
    except ValueError:
        # Not an integer, treat as URL string
        if target_id in TARGETS:
            TARGETS.remove(target_id)
            CONFIG['target_scope'] = TARGETS
            CONFIG_PATH.write_text(json.dumps(CONFIG, indent=2))
            return jsonify({'success': True, 'removed': target_id})

    return jsonify({'error': 'Target not found'}), 404


@app.route('/api/v1/config', methods=['GET'])
def get_config():
    """
    Read configuration from .env file

    Returns:
        {
          "openai_api_key": "sk-***",  # Masked
          "allow_exploitation": true,
          "scan_modes": ["port", "http", "dns", "vulnscan"],
          "allowed_tools": ["nmap", "ffuf", "sqlmap", ...],
          "max_threads": 10,
          "max_runtime": 300,
          "msf_username": "msf",
          "msf_password": "***",  # Masked
          "msf_host": "127.0.0.1",
          "msf_port": 55552,
          "zap_host": "127.0.0.1",
          "zap_port": 8090
        }
    """
    try:
        config = json.loads(CONFIG_PATH.read_text())

        # Mask sensitive fields
        if 'openai_api_key' in config and config['openai_api_key']:
            config['openai_api_key'] = config['openai_api_key'][:8] + '...'
        if 'msf_password' in config:
            config['msf_password'] = '***'

        return jsonify(config)
    except Exception as e:
        logging.error(f"Failed to read config: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/v1/config', methods=['PUT'])
def update_config():
    """
    Update configuration in .env file

    Request body: Complete config object (same as GET response)

    Note:
    - If API key is masked (ends with ...), preserve existing key
    - If password is ***, preserve existing password
    - Validate required fields
    """
    try:
        new_config = request.json

        if not new_config:
            return jsonify({'error': 'Request body required'}), 400

        # Load existing config
        existing_config = json.loads(CONFIG_PATH.read_text())

        # Preserve masked secrets
        if new_config.get('openai_api_key', '').endswith('...'):
            new_config['openai_api_key'] = existing_config.get('openai_api_key', '')
        if new_config.get('msf_password') == '***':
            new_config['msf_password'] = existing_config.get('msf_password', '')

        # Validate required fields
        required = ['allowed_tools', 'scan_modes', 'max_threads', 'max_runtime']
        for field in required:
            if field not in new_config:
                return jsonify({'error': f'Missing required field: {field}'}), 400

        # Validate field types
        if not isinstance(new_config.get('allowed_tools'), list):
            return jsonify({'error': 'allowed_tools must be an array'}), 400
        if not isinstance(new_config.get('scan_modes'), list):
            return jsonify({'error': 'scan_modes must be an array'}), 400
        if not isinstance(new_config.get('max_threads'), int):
            return jsonify({'error': 'max_threads must be an integer'}), 400
        if not isinstance(new_config.get('max_runtime'), int):
            return jsonify({'error': 'max_runtime must be an integer'}), 400

        # Write to .env
        CONFIG_PATH.write_text(json.dumps(new_config, indent=2))

        # Reload global config
        global CONFIG, TARGETS
        CONFIG = new_config
        TARGETS = CONFIG.get("target_scope", [])

        logging.info("Configuration updated successfully")

        return jsonify({'success': True, 'message': 'Configuration updated'})

    except Exception as e:
        logging.error(f"Failed to update config: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/v1/recon/start', methods=['POST'])
def start_recon():
    """
    Start FULL AI-DRIVEN WORKFLOW for target

    This endpoint triggers the complete autonomous workflow:
    1. Reconnaissance
    2. AI Analysis #1 (post-recon)
    3. Execute AI commands
    4. Web scans (ZAP/Burp auto-start)
    5. API Security Scanning (VulnAPI)
    6. Metasploit exploitation (MSF auto-start)
    7. Exploitation chain
    8. AI Analysis #2 (post-exploitation)
    9. Execute AI followup commands

    Supports concurrent scanning of multiple targets.
    """
    target = request.json.get('target')
    tools = request.json.get('tools', [])

    if not target:
        return jsonify({'error': 'Target required'}), 400

    # Generate unique scan ID with timestamp and target hash
    scan_id = f"scan_{int(time.time() * 1000)}_{hash(target) % 10000}"

    # Create stop event for this scan
    stop_event = threading.Event()

    def run_scan():
        """Execute full AI-driven workflow (not just recon)"""
        run_full_ai_workflow(target, scan_id, tools, socketio)

    # Store scan info BEFORE starting thread to avoid race condition
    with active_scans_lock:
        active_scans[scan_id] = {
            'status': 'running',
            'target': target,
            'tools': tools,
            'started_at': datetime.now(timezone.utc).isoformat(),
            'stop_event': stop_event
        }

    # Create and start thread after scan_id is registered
    thread = threading.Thread(target=run_scan, daemon=True)
    thread.start()

    # Store thread reference
    with active_scans_lock:
        scan_threads[scan_id] = thread

    return jsonify({'scan_id': scan_id, 'status': 'started', 'target': target})


@app.route('/api/v1/recon/status/<scan_id>', methods=['GET'])
def get_scan_status(scan_id):
    """Get scan status"""
    with active_scans_lock:
        if scan_id in active_scans:
            # Return copy without stop_event (not JSON serializable)
            scan_info = {k: v for k, v in active_scans[scan_id].items() if k != 'stop_event'}
            return jsonify(scan_info)
    return jsonify({'error': 'Scan not found'}), 404


@app.route('/api/v1/recon/active', methods=['GET'])
def get_active_scans():
    """Get all currently active (running) scans"""
    with active_scans_lock:
        active = []
        for scan_id, scan_info in active_scans.items():
            if scan_info.get('status') == 'running':
                # Create clean copy without stop_event
                clean_info = {
                    'scan_id': scan_id,
                    'target': scan_info.get('target'),
                    'tools': scan_info.get('tools', []),
                    'running_tools': scan_info.get('running_tools', []),
                    'started_at': scan_info.get('started_at'),
                    'status': scan_info.get('status')
                }
                active.append(clean_info)

    return jsonify({
        'active_scans': active,
        'count': len(active)
    })


@app.route('/api/v1/recon/batch', methods=['POST'])
def start_batch_recon():
    """Start reconnaissance scans on multiple targets simultaneously"""
    targets = request.json.get('targets', [])
    tools = request.json.get('tools', [])

    if not targets or not isinstance(targets, list):
        return jsonify({'error': 'targets array required'}), 400

    if len(targets) == 0:
        return jsonify({'error': 'At least one target required'}), 400

    # Limit concurrent scans for safety
    MAX_CONCURRENT_SCANS = 10
    if len(targets) > MAX_CONCURRENT_SCANS:
        return jsonify({
            'error': f'Maximum {MAX_CONCURRENT_SCANS} concurrent scans allowed'
        }), 400

    scan_ids = []
    failed_targets = []

    for target in targets:
        if not target or not isinstance(target, str):
            failed_targets.append({'target': target, 'reason': 'Invalid target format'})
            continue

        try:
            # Generate unique scan ID
            scan_id = f"scan_{int(time.time() * 1000)}_{hash(target) % 10000}"
            stop_event = threading.Event()

            def run_scan(target_url=target, sid=scan_id, stop_evt=stop_event):
                try:
                    # Emit scan start
                    socketio.emit('recon_output', {
                        'scan_id': sid,
                        'target': target_url,
                        'event': 'started',
                        'message': f'Starting batch reconnaissance on {target_url}',
                        'timestamp': datetime.now(timezone.utc).isoformat()
                    })

                    # Update scan status
                    with active_scans_lock:
                        active_scans[sid]['running_tools'] = tools

                    if stop_evt.is_set():
                        raise Exception("Scan cancelled before execution")

                    results = run_recon_layered(target_url, socketio=socketio, scan_id=sid)

                    if stop_evt.is_set():
                        raise Exception("Scan cancelled")

                    # Emit completion
                    socketio.emit('recon_output', {
                        'scan_id': sid,
                        'target': target_url,
                        'event': 'completed',
                        'results': results,
                        'timestamp': datetime.now(timezone.utc).isoformat()
                    })

                    with active_scans_lock:
                        active_scans[sid].update({
                            'status': 'completed',
                            'results': results,
                            'completed_at': datetime.now(timezone.utc).isoformat()
                        })
                        if sid in scan_threads:
                            del scan_threads[sid]

                except Exception as e:
                    logging.error(f"Batch scan {sid} failed: {e}")
                    socketio.emit('recon_output', {
                        'scan_id': sid,
                        'target': target_url,
                        'event': 'failed',
                        'error': str(e),
                        'timestamp': datetime.now(timezone.utc).isoformat()
                    })

                    with active_scans_lock:
                        active_scans[sid].update({
                            'status': 'failed' if 'cancelled' not in str(e).lower() else 'cancelled',
                            'error': str(e),
                            'completed_at': datetime.now(timezone.utc).isoformat()
                        })
                        if sid in scan_threads:
                            del scan_threads[sid]

            # Create and start thread
            thread = threading.Thread(target=run_scan, daemon=True)
            thread.start()

            # Store scan info
            with active_scans_lock:
                active_scans[scan_id] = {
                    'status': 'running',
                    'target': target,
                    'tools': tools,
                    'started_at': datetime.now(timezone.utc).isoformat(),
                    'stop_event': stop_event,
                    'batch': True
                }
                scan_threads[scan_id] = thread

            scan_ids.append(scan_id)

        except Exception as e:
            logging.error(f"Failed to start scan for {target}: {e}")
            failed_targets.append({'target': target, 'reason': str(e)})

    response = {
        'status': 'started',
        'scan_ids': scan_ids,
        'successful': len(scan_ids),
        'total': len(targets)
    }

    if failed_targets:
        response['failed'] = failed_targets

    return jsonify(response), 200 if len(scan_ids) > 0 else 400


@app.route('/api/v1/recon/scans/<scan_id>', methods=['DELETE'])
def cancel_scan(scan_id):
    """Cancel a running scan and clean up resources"""
    with active_scans_lock:
        if scan_id not in active_scans:
            return jsonify({'error': 'Scan not found'}), 404

        scan_info = active_scans[scan_id]

        if scan_info.get('status') != 'running':
            return jsonify({
                'error': f'Scan is not running (status: {scan_info.get("status")})'
            }), 400

        # Set stop event to signal cancellation
        stop_event = scan_info.get('stop_event')
        if stop_event:
            stop_event.set()

        # Update status
        scan_info['status'] = 'cancelling'
        scan_info['cancel_requested_at'] = datetime.now(timezone.utc).isoformat()

    # Emit cancellation event
    socketio.emit('recon_output', {
        'scan_id': scan_id,
        'target': scan_info.get('target'),
        'event': 'cancelled',
        'message': 'Scan cancellation requested',
        'timestamp': datetime.now(timezone.utc).isoformat()
    })

    return jsonify({
        'scan_id': scan_id,
        'status': 'cancelling',
        'message': 'Scan cancellation requested. The scan will stop shortly.'
    })


@app.route('/api/v1/loot/<path:target>', methods=['GET'])
def get_target_loot(target):
    """Get loot for a target (URL-encoded or path format)"""
    # Flask automatically decodes URL-encoded parameters
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


@app.route('/api/v1/loot/heatmap', methods=['GET'])
def get_loot_heatmap():
    """
    Get credential heatmap with priority scoring.

    Query parameters:
        limit (int): Maximum number of credentials to return (default: 50)
        min_score (float): Minimum score threshold (default: 0)

    Returns:
        JSON array of scored credentials sorted by priority (highest first)
    """
    try:
        limit = request.args.get('limit', 50, type=int)
        min_score = request.args.get('min_score', 0, type=float)

        # Limit bounds checking
        limit = max(1, min(limit, 500))  # Between 1 and 500

        # Generate heatmap
        heatmap = generate_credential_heatmap(limit=limit)

        # Filter by minimum score if specified
        if min_score > 0:
            heatmap = [cred for cred in heatmap if cred['score'] >= min_score]

        return jsonify({
            'credentials': heatmap,
            'count': len(heatmap),
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

    except Exception as e:
        logging.error(f"Heatmap generation failed: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/v1/loot/credentials', methods=['GET'])
def get_all_creds():
    """Get all credentials across all targets"""
    try:
        target = request.args.get('target')

        if target:
            credentials = get_credentials(target)
        else:
            credentials = get_all_credentials()

        return jsonify({
            'credentials': credentials,
            'count': len(credentials),
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

    except Exception as e:
        logging.error(f"Failed to retrieve credentials: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/v1/loot/credentials/validate', methods=['POST'])
def validate_single_credential():
    """
    Validate a single credential against target service

    Request body:
        {
            "credential_id": "cred_123",
            "target": "192.168.1.10",
            "username": "admin",
            "password": "<test_password>",
            "service": "ssh",
            "port": 22  // optional
        }

    Returns:
        {
            "credential_id": "cred_123",
            "valid": true/false,
            "service": "ssh",
            "target": "192.168.1.10",
            "username": "admin",
            "tested_at": "2025-12-25T10:00:00Z",
            "error": null,
            "details": {...}
        }
    """
    try:
        data = request.json

        # Validate required fields
        required_fields = ['credential_id', 'target', 'username', 'password', 'service']
        missing_fields = [field for field in required_fields if field not in data]

        if missing_fields:
            return jsonify({
                'error': f'Missing required fields: {", ".join(missing_fields)}'
            }), 400

        # Extract credential data
        credential_id = data['credential_id']
        target = data['target']
        username = data['username']
        password = data['password']
        service = data['service']
        port = data.get('port')

        # Perform validation in background thread to avoid blocking
        def run_validation():
            try:
                result = validate_credential(
                    credential_id=credential_id,
                    target=target,
                    username=username,
                    password=password,
                    service=service,
                    port=port
                )

                # Update loot tracker with result
                update_credential_validation(credential_id, result)

                # Emit WebSocket event for real-time updates
                socketio.emit('loot_item', {
                    'event': 'credential_validated',
                    'credential_id': credential_id,
                    'result': result,
                    'timestamp': datetime.now(timezone.utc).isoformat()
                })

                logging.info(
                    f"Credential {credential_id} validated: "
                    f"{result['valid']} ({service}://{username}@{target})"
                )

            except Exception as e:
                logging.error(f"Validation thread error for {credential_id}: {e}")

        # Start validation in background
        thread = threading.Thread(target=run_validation, daemon=True)
        thread.start()

        return jsonify({
            'status': 'started',
            'message': 'Credential validation initiated',
            'credential_id': credential_id
        })

    except Exception as e:
        logging.error(f"Credential validation request failed: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/v1/loot/credentials/validate/batch', methods=['POST'])
def validate_batch_credentials():
    """
    Validate multiple credentials in batch

    Request body:
        {
            "credentials": [
                {
                    "credential_id": "cred_1",
                    "target": "192.168.1.10",
                    "username": "admin",
                    "password": "<test_password>",
                    "service": "ssh",
                    "port": 22  // optional
                },
                ...
            ]
        }

    Returns:
        {
            "status": "started",
            "count": 5,
            "message": "Batch validation initiated for 5 credentials"
        }
    """
    try:
        data = request.json
        credentials = data.get('credentials', [])

        if not credentials or not isinstance(credentials, list):
            return jsonify({'error': 'credentials array required'}), 400

        if len(credentials) == 0:
            return jsonify({'error': 'At least one credential required'}), 400

        # Limit batch size for safety
        MAX_BATCH_SIZE = 50
        if len(credentials) > MAX_BATCH_SIZE:
            return jsonify({
                'error': f'Maximum {MAX_BATCH_SIZE} credentials allowed per batch'
            }), 400

        # Validate all credentials have required fields
        for i, cred in enumerate(credentials):
            required_fields = ['credential_id', 'target', 'username', 'password', 'service']
            missing = [f for f in required_fields if f not in cred]

            if missing:
                return jsonify({
                    'error': f'Credential at index {i} missing fields: {", ".join(missing)}'
                }), 400

        # Process batch validation in background
        def run_batch_validation():
            try:
                results = validate_credentials_batch(credentials)

                # Update loot tracker and emit events for each result
                for result in results:
                    credential_id = result['credential_id']

                    # Update storage
                    update_credential_validation(credential_id, result)

                    # Emit WebSocket event
                    socketio.emit('loot_item', {
                        'event': 'credential_validated',
                        'credential_id': credential_id,
                        'result': result,
                        'timestamp': datetime.now(timezone.utc).isoformat()
                    })

                # Emit batch completion event
                valid_count = sum(1 for r in results if r['valid'])
                socketio.emit('loot_item', {
                    'event': 'batch_validation_complete',
                    'total': len(results),
                    'valid': valid_count,
                    'invalid': len(results) - valid_count,
                    'timestamp': datetime.now(timezone.utc).isoformat()
                })

                logging.info(
                    f"Batch validation complete: {valid_count}/{len(results)} valid"
                )

            except Exception as e:
                logging.error(f"Batch validation thread error: {e}")

        # Start batch validation in background
        thread = threading.Thread(target=run_batch_validation, daemon=True)
        thread.start()

        return jsonify({
            'status': 'started',
            'count': len(credentials),
            'message': f'Batch validation initiated for {len(credentials)} credentials'
        })

    except Exception as e:
        logging.error(f"Batch validation request failed: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/v1/ai/thoughts', methods=['GET'])
def get_ai_thoughts():
    """Get recent AI thoughts"""
    thoughts = get_thoughts()
    return jsonify({'thoughts': thoughts})


@app.route('/api/v1/ai/analyze', methods=['POST'])
def analyze_with_ai():
    """
    DEPRECATED: Trigger AI analysis on target data

    This endpoint is deprecated as of Phase 3 redesign.
    AI analysis now runs automatically as part of the full workflow in /api/v1/recon/start

    Use POST /api/v1/recon/start to trigger the complete AI-driven workflow instead.
    """
    logging.warning("DEPRECATED endpoint /api/v1/ai/analyze called - use /api/v1/recon/start instead")

    # Return deprecation warning but still function for backward compatibility
    target = request.json.get('target')
    phase = request.json.get('phase', 'recon')  # recon or exploitation

    if not target:
        return jsonify({'error': 'Target required'}), 400

    def run_ai_analysis():
        global current_phase
        current_phase = f'ai_{phase}'
        socketio.emit('phase_change', {'phase': current_phase, 'target': target})

        try:
            # Load recon results for the target
            from pathlib import Path
            results_file = Path(f'results/{target}/results.json')

            if results_file.exists():
                with open(results_file, 'r') as f:
                    recon_data = json.load(f)
            else:
                recon_data = {'message': f'No recon data found for {target}'}

            # Ask AI for analysis (now emits detailed WebSocket events)
            ai_response = ask_ai(recon_data, socketio=socketio, target=target)

            if ai_response:
                # Parse commands from AI response (also emits events)
                from modules.ai_assistant import parse_ai_commands
                commands = parse_ai_commands(ai_response, socketio=socketio, target=target)

                # Emit execution plan
                if commands:
                    socketio.emit('ai_thought', {
                        'target': target,
                        'thoughtType': 'ai_execution',
                        'content': f'Ready to execute {len(commands)} commands',
                        'metadata': {
                            'commands': [' '.join(cmd) for cmd in commands],
                            'note': 'Commands will be executed when exploitation phase is triggered'
                        },
                        'timestamp': datetime.now(timezone.utc).isoformat()
                    })
                else:
                    socketio.emit('ai_thought', {
                        'target': target,
                        'thoughtType': 'observation',
                        'content': 'No executable commands found in AI response',
                        'timestamp': datetime.now(timezone.utc).isoformat()
                    })

            return {'success': True, 'response': ai_response}

        except Exception as e:
            logging.error(f"AI analysis failed: {e}")
            socketio.emit('ai_thought', {
                'target': target,
                'thoughtType': 'observation',
                'content': f'❌ Analysis failed: {str(e)}',
                'timestamp': datetime.now(timezone.utc).isoformat()
            })
            return {'error': str(e)}

        finally:
            current_phase = 'idle'
            socketio.emit('phase_change', {'phase': 'idle', 'target': target})

    # Run in background thread
    thread = threading.Thread(target=run_ai_analysis, daemon=True)
    thread.start()

    return jsonify({'status': 'started', 'message': 'AI analysis initiated'})


@app.route('/api/v1/exploit/start', methods=['POST'])
def start_exploitation():
    """
    DEPRECATED: Start exploitation chain with configurable tools

    This endpoint is deprecated as of Phase 3 redesign.
    Exploitation now runs automatically as part of the full workflow in /api/v1/recon/start

    Use POST /api/v1/recon/start to trigger the complete AI-driven workflow instead.
    """
    logging.warning("DEPRECATED endpoint /api/v1/exploit/start called - use /api/v1/recon/start instead")

    # Return deprecation warning but still function for backward compatibility
    target = request.json.get('target')
    tools = request.json.get('tools', ['nuclei', 'ffuf'])  # NEW: Tool selection

    if not target:
        return jsonify({'error': 'Target required'}), 400

    exploit_id = f"exploit_{int(time.time())}"

    def run_exploitation():
        global current_phase
        current_phase = 'exploitation'
        socketio.emit('phase_change', {'phase': 'exploitation', 'target': target})

        try:
            socketio.emit('exploit_result', {
                'exploit_id': exploit_id,
                'target': target,
                'event': 'started',
                'message': f'Starting exploitation on {target}',
                'tools': tools,
                'timestamp': datetime.now(timezone.utc).isoformat()
            })

            # Pass tools to exploitation chain
            target_dir = get_target_dir(target)
            run_exploitation_chain(target, target_dir, enabled_tools=tools)

            socketio.emit('exploit_result', {
                'exploit_id': exploit_id,
                'target': target,
                'event': 'completed',
                'message': 'Exploitation chain completed',
                'timestamp': datetime.now(timezone.utc).isoformat()
            })

        except Exception as e:
            logging.error(f"Exploitation {exploit_id} failed: {e}")
            socketio.emit('exploit_result', {
                'exploit_id': exploit_id,
                'target': target,
                'event': 'failed',
                'error': str(e),
                'timestamp': datetime.now(timezone.utc).isoformat()
            })

        finally:
            current_phase = 'idle'
            socketio.emit('phase_change', {'phase': 'idle', 'target': target})

    thread = threading.Thread(target=run_exploitation, daemon=True)
    thread.start()

    return jsonify({
        'exploit_id': exploit_id,
        'status': 'started',
        'target': target,
        'tools': tools
    })


@app.route('/api/v1/exploit/bruteforce', methods=['POST'])
def start_bruteforce():
    """Start targeted bruteforce attack"""
    target = request.json.get('target')
    service = request.json.get('service', 'ssh').lower()
    port = request.json.get('port', 22)
    wordlist = request.json.get('wordlist', 'rockyou.txt')

    if not target:
        return jsonify({'error': 'Target required'}), 400

    exploit_id = f"bruteforce_{int(time.time())}"

    def run_bruteforce():
        global current_phase
        current_phase = 'exploitation'
        socketio.emit('phase_change', {'phase': 'exploitation', 'target': target})

        try:
            socketio.emit('exploit_result', {
                'exploit_id': exploit_id,
                'target': target,
                'service': service,
                'port': port,
                'event': 'started',
                'message': f'Starting bruteforce attack on {service}://{target}:{port}',
                'timestamp': datetime.now(timezone.utc).isoformat()
            })

            # Run Hydra bruteforce
            run_bruteforce_enumeration(target, [str(port)])

            socketio.emit('exploit_result', {
                'exploit_id': exploit_id,
                'target': target,
                'event': 'completed',
                'message': f'Bruteforce attack completed on {service}',
                'timestamp': datetime.now(timezone.utc).isoformat()
            })

        except Exception as e:
            logging.error(f"Bruteforce {exploit_id} failed: {e}")
            socketio.emit('exploit_result', {
                'exploit_id': exploit_id,
                'target': target,
                'event': 'failed',
                'error': str(e),
                'timestamp': datetime.now(timezone.utc).isoformat()
            })

        finally:
            current_phase = 'idle'
            socketio.emit('phase_change', {'phase': 'idle', 'target': target})

    thread = threading.Thread(target=run_bruteforce, daemon=True)
    thread.start()

    return jsonify({
        'status': 'started',
        'exploit_id': exploit_id,
        'target': target,
        'service': service,
        'port': port
    })


# ==================== VULNAPI ENDPOINTS ====================

@app.route('/api/v1/vulnapi/scan', methods=['POST'])
def start_vulnapi_scan():
    """
    Start a VulnAPI scan on a target.

    Request body:
        {
            "target": "example.com",
            "mode": "full" | "curl" | "openapi",
            "url": "https://example.com/api",      // required for curl/openapi mode
            "spec_url": "https://example.com/swagger.json",  // required for openapi mode
            "headers": {"Authorization": "Bearer ..."},  // optional
            "method": "GET"  // optional, default GET
        }

    Returns:
        {
            "status": "started" | "completed",
            "scan_id": "vulnapi_123456",
            "target": "example.com",
            ...results for synchronous modes
        }
    """
    data = request.json or {}
    target = data.get('target')
    mode = data.get('mode', 'full')
    url = data.get('url')
    spec_url = data.get('spec_url')
    headers = data.get('headers')
    method = data.get('method', 'GET')

    if not target:
        return jsonify({'error': 'Target required'}), 400

    scan_id = f"vulnapi_{int(time.time() * 1000)}"

    if mode == 'full':
        # Run full scan in background thread
        def run_scan():
            result = run_vulnapi_full_scan(target, socketio=socketio, scan_id=scan_id)
            socketio.emit('vulnapi_output', {
                'scan_id': scan_id,
                'target': target,
                'event': 'scan_complete',
                'results': result,
                'timestamp': datetime.now(timezone.utc).isoformat()
            })

        thread = threading.Thread(target=run_scan, daemon=True)
        thread.start()

        return jsonify({
            'status': 'started',
            'scan_id': scan_id,
            'target': target,
            'mode': 'full'
        })

    elif mode == 'curl':
        if not url:
            return jsonify({'error': 'url required for curl mode'}), 400

        raw_output, findings = run_vulnapi_curl_scan(
            url, headers=headers, method=method,
            socketio=socketio, scan_id=scan_id, target=target
        )

        return jsonify({
            'status': 'completed',
            'scan_id': scan_id,
            'target': target,
            'mode': 'curl',
            'url': url,
            'findings': findings,
            'total_findings': len(findings)
        })

    elif mode == 'openapi':
        scan_url = spec_url or url
        if not scan_url:
            return jsonify({'error': 'spec_url or url required for openapi mode'}), 400

        raw_output, findings = run_vulnapi_openapi_scan(
            scan_url, socketio=socketio, scan_id=scan_id, target=target
        )

        return jsonify({
            'status': 'completed',
            'scan_id': scan_id,
            'target': target,
            'mode': 'openapi',
            'spec_url': scan_url,
            'findings': findings,
            'total_findings': len(findings)
        })

    else:
        return jsonify({'error': f'Invalid mode: {mode}. Use full, curl, or openapi'}), 400


@app.route('/api/v1/vulnapi/results/<path:target>', methods=['GET'])
def get_vulnapi_results(target):
    """
    Get VulnAPI scan results for a target.

    Returns structured results from vulnapi_results.json if available.
    """
    try:
        target_dir = Path('results') / target
        if not target_dir.exists():
            return jsonify({'error': 'Target not found'}), 404

        results_file = target_dir / 'vulnapi_results.json'
        if not results_file.exists():
            return jsonify({
                'target': target,
                'findings': [],
                'total_findings': 0,
                'message': 'No VulnAPI results available for this target'
            })

        results = json.loads(results_file.read_text())
        return jsonify(results)

    except Exception as e:
        logging.error(f"Failed to get VulnAPI results for {target}: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/v1/results', methods=['GET'])
def get_all_results():
    """
    List all targets with their scan results status

    Returns:
        {
          "targets": [
            {
              "target": "culpur.net",
              "status": "completed",
              "started_at": "2025-01-15T10:00:00Z",
              "completed_at": "2025-01-15T10:45:00Z",
              "loot_count": 42,
              "results_available": true
            },
            ...
          ]
        }
    """
    try:
        results_dir = Path('results')
        if not results_dir.exists():
            return jsonify({'targets': []})

        targets_list = []
        for target_dir in results_dir.iterdir():
            if not target_dir.is_dir():
                continue

            target_info = {
                'target': target_dir.name,
                'status': 'unknown',
                'results_available': False
            }

            # Check for results.json
            results_file = target_dir / 'results.json'
            if results_file.exists():
                target_info['results_available'] = True
                target_info['status'] = 'completed'

                # Try to extract timestamps from results
                try:
                    results_data = json.loads(results_file.read_text())
                    if 'started_at' in results_data:
                        target_info['started_at'] = results_data['started_at']
                    if 'completed_at' in results_data:
                        target_info['completed_at'] = results_data['completed_at']
                except Exception as e:
                    logging.warning(f"Could not parse results for {target_dir.name}: {e}")

            # Check for loot
            loot_file = target_dir / 'loot.json'
            if loot_file.exists():
                try:
                    loot = json.loads(loot_file.read_text())
                    target_info['loot_count'] = sum(
                        len(v) if isinstance(v, list) else 0
                        for v in loot.values()
                    )
                except Exception as e:
                    logging.warning(f"Could not parse loot for {target_dir.name}: {e}")
                    target_info['loot_count'] = 0

            targets_list.append(target_info)

        # Sort by most recent first (if completed_at exists)
        targets_list.sort(
            key=lambda x: x.get('completed_at', ''),
            reverse=True
        )

        return jsonify({'targets': targets_list, 'count': len(targets_list)})

    except Exception as e:
        logging.error(f"Failed to get results: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/v1/results/<path:target>', methods=['GET'])
def get_target_results(target):
    """
    Get detailed scan results for a specific target

    Returns: CompleteScanResults with all discovered data
    """
    try:
        target_dir = Path('results') / target
        if not target_dir.exists():
            return jsonify({'error': 'Target not found'}), 404

        results_file = target_dir / 'results.json'
        if not results_file.exists():
            return jsonify({'error': 'No results available'}), 404

        results = json.loads(results_file.read_text())

        # Load loot
        loot_file = target_dir / 'loot.json'
        if loot_file.exists():
            results['loot'] = json.loads(loot_file.read_text())

        return jsonify(results)

    except Exception as e:
        logging.error(f"Failed to get target results for {target}: {e}")
        return jsonify({'error': str(e)}), 500


def generate_markdown_report(target, results):
    """Generate a markdown report from scan results"""
    md = f"# Scan Report: {target}\n\n"
    md += f"Generated: {datetime.now(timezone.utc).isoformat()}\n\n"

    # Summary section
    md += "## Summary\n\n"
    if 'started_at' in results:
        md += f"- **Started:** {results['started_at']}\n"
    if 'completed_at' in results:
        md += f"- **Completed:** {results['completed_at']}\n"
    md += f"- **Target:** {target}\n\n"

    # Ports section
    if 'ports' in results and results['ports']:
        md += "## Open Ports\n\n"
        md += "| Port | Service | Version |\n"
        md += "|------|---------|----------|\n"
        for port_info in results['ports']:
            port = port_info.get('port', 'N/A')
            service = port_info.get('service', 'N/A')
            version = port_info.get('version', 'N/A')
            md += f"| {port} | {service} | {version} |\n"
        md += "\n"

    # Subdomains section
    if 'subdomains' in results and results['subdomains']:
        md += "## Discovered Subdomains\n\n"
        for subdomain in results['subdomains']:
            md += f"- {subdomain}\n"
        md += "\n"

    # URLs section
    if 'urls' in results and results['urls']:
        md += "## Discovered URLs\n\n"
        for url in results['urls']:
            md += f"- {url}\n"
        md += "\n"

    # Vulnerabilities section
    if 'vulnerabilities' in results and results['vulnerabilities']:
        md += "## Vulnerabilities\n\n"
        for vuln in results['vulnerabilities']:
            severity = vuln.get('severity', 'unknown').upper()
            name = vuln.get('name', 'Unknown')
            description = vuln.get('description', 'No description')
            md += f"### [{severity}] {name}\n\n"
            md += f"{description}\n\n"
            if 'affected_target' in vuln:
                md += f"**Affected:** {vuln['affected_target']}\n\n"

    # Loot section
    if 'loot' in results:
        loot = results['loot']
        md += "## Loot Collected\n\n"

        if 'usernames' in loot and loot['usernames']:
            md += f"### Usernames ({len(loot['usernames'])})\n\n"
            for username in loot['usernames'][:20]:  # Limit to first 20
                md += f"- {username}\n"
            if len(loot['usernames']) > 20:
                md += f"- ... and {len(loot['usernames']) - 20} more\n"
            md += "\n"

        if 'passwords' in loot and loot['passwords']:
            md += f"### Passwords ({len(loot['passwords'])})\n\n"
            for password in loot['passwords'][:20]:
                md += f"- {password}\n"
            if len(loot['passwords']) > 20:
                md += f"- ... and {len(loot['passwords']) - 20} more\n"
            md += "\n"

    # DNS Records section
    if 'dns_records' in results and results['dns_records']:
        md += "## DNS Records\n\n"
        for record_type, records in results['dns_records'].items():
            if records:
                md += f"### {record_type} Records\n\n"
                for record in records:
                    md += f"- {record}\n"
                md += "\n"

    # Footer
    md += "---\n\n"
    md += f"Report generated by CStrike on {datetime.now(timezone.utc).isoformat()}\n"

    return md


@app.route('/api/v1/results/<path:target>/download', methods=['GET'])
def download_target_results(target):
    """
    Download scan results as JSON or Markdown

    Query params:
        format: 'json' or 'markdown' (default: json)
    """
    try:
        format_type = request.args.get('format', 'json')
        target_dir = Path('results') / target

        if not target_dir.exists():
            return jsonify({'error': 'Target not found'}), 404

        if format_type == 'json':
            results_file = target_dir / 'results.json'
            if not results_file.exists():
                return jsonify({'error': 'No results'}), 404
            return send_file(
                results_file,
                as_attachment=True,
                download_name=f'{target.replace("/", "_")}_results.json'
            )

        elif format_type == 'markdown':
            results_file = target_dir / 'results.json'
            if not results_file.exists():
                return jsonify({'error': 'No results'}), 404

            # Generate markdown report
            results = json.loads(results_file.read_text())

            # Load loot if available
            loot_file = target_dir / 'loot.json'
            if loot_file.exists():
                results['loot'] = json.loads(loot_file.read_text())

            markdown = generate_markdown_report(target, results)

            # Create temp file
            with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.md') as f:
                f.write(markdown)
                temp_path = f.name

            return send_file(
                temp_path,
                as_attachment=True,
                download_name=f'{target.replace("/", "_")}_report.md'
            )

        else:
            return jsonify({'error': 'Invalid format. Use "json" or "markdown"'}), 400

    except Exception as e:
        logging.error(f"Failed to download results for {target}: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/v1/logs', methods=['GET'])
def get_logs():
    """Get recent logs with proper structured format"""
    limit = request.args.get('limit', 1000, type=int)
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
    for idx, line in enumerate(lines):
        try:
            parts = line.split(maxsplit=3)
            if len(parts) >= 4:
                # Parse timestamp, level, message
                timestamp_str = f"{parts[0]} {parts[1]}"
                log_level = parts[2]
                message = parts[3].strip()

                # Try to parse timestamp to ISO format
                try:
                    dt = datetime.strptime(timestamp_str, '%Y-%m-%d %H:%M:%S,%f')
                    iso_timestamp = dt.replace(tzinfo=timezone.utc).isoformat()
                except:
                    iso_timestamp = datetime.now(timezone.utc).isoformat()

                logs.append({
                    'id': f"{int(time.time() * 1000)}-{idx:04d}-{os.urandom(2).hex()}",
                    'timestamp': iso_timestamp,
                    'level': log_level,
                    'source': 'system',
                    'message': message,
                    'metadata': {}
                })
            else:
                # Unstructured log line
                logs.append({
                    'id': f"{int(time.time() * 1000)}-{idx:04d}-{os.urandom(2).hex()}",
                    'timestamp': datetime.now(timezone.utc).isoformat(),
                    'level': 'INFO',
                    'source': 'system',
                    'message': line.strip(),
                    'metadata': {}
                })
        except Exception as e:
            # Fallback for parsing errors
            logs.append({
                'id': f"{int(time.time() * 1000)}-{idx:04d}-{os.urandom(2).hex()}",
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'level': 'INFO',
                'source': 'system',
                'message': line.strip(),
                'metadata': {'parse_error': str(e)}
            })

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
    # Add WebSocket log handler to root logger
    ws_handler = WebSocketLogHandler()
    ws_handler.setLevel(logging.INFO)
    logging.root.addHandler(ws_handler)

    # Start metrics update thread
    metrics_thread = threading.Thread(target=update_system_metrics, daemon=True)
    metrics_thread.start()

    logging.info("CStrike API Server starting...")
    logging.info("REST API: http://localhost:8000/api/v1/")
    logging.info("WebSocket: ws://localhost:8000/")
    logging.info("Frontend: http://localhost:3000")

    # Disable reloader to prevent port binding issues
    socketio.run(app, host='0.0.0.0', port=8000, debug=True, use_reloader=False, allow_unsafe_werkzeug=True)
