# Phase 3: Backend AI Workflow Implementation

## Overview
This document outlines the implementation of the full AI-driven autonomous workflow in the CStrike backend API.

## Objective
Transform `/api/v1/recon/start` from a reconnaissance-only endpoint into a complete AI-driven workflow orchestrator that executes all phases automatically.

## Changes Required

### 1. Add Missing Module Imports

Add to the imports section (after line 31):

```python
from modules.ai_assistant import ask_ai, get_thoughts, parse_ai_commands
from modules.zap_burp import start_zap, start_burp, run_web_scans
from modules.metasploit import start_msf_rpc, run_msf_exploits
```

### 2. Implement Auto-Service Management Functions

Add these helper functions after the `update_system_metrics()` function:

```python
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
```

### 3. Implement Full AI Workflow Function

Add this comprehensive workflow function:

```python
def run_full_ai_workflow(target, scan_id, tools, socketio):
    """
    Execute the complete AI-driven workflow for a target

    This mirrors ai_driver.py but with WebSocket event emissions for real-time UI updates.

    Phases:
        1. Reconnaissance (all enabled tools)
        2. AI Analysis #1 (post-recon)
        3. Execute AI-suggested commands
        4. Web Application Scanning (ZAP/Burp auto-start)
        5. Metasploit Exploitation (MSF auto-start)
        6. Exploitation Chain (nuclei, ffuf, etc.)
        7. AI Analysis #2 (post-exploitation)
        8. Execute AI followup commands

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

        logging.info(f"[Phase 1/8] Starting reconnaissance for {target}")
        socketio.emit('recon_output', {
            'scan_id': scan_id,
            'target': target,
            'event': 'started',
            'message': f'Starting reconnaissance on {target}',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

        recon_results = run_recon_layered(target, socketio=socketio, scan_id=scan_id)

        logging.info(f"[Phase 1/8] Reconnaissance completed for {target}")
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

        logging.info(f"[Phase 2/8] AI Analysis #1 (post-recon) for {target}")
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

            logging.info(f"[Phase 3/8] Executing AI-suggested commands for {target}")
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

        logging.info(f"[Phase 4/8] Web application scanning for {target}")

        # Auto-start ZAP and Burp if not running
        ensure_zap_running(socketio=socketio, target=target)
        ensure_burp_running(socketio=socketio, target=target)

        # Run web scans
        run_web_scans(target, target_dir)

        # ==================== PHASE 5: METASPLOIT EXPLOITATION ====================
        current_phase = 'metasploit'
        socketio.emit('phase_change', {
            'phase': 'metasploit',
            'target': target,
            'scan_id': scan_id,
            'message': 'Running Metasploit exploitation',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

        logging.info(f"[Phase 5/8] Metasploit exploitation for {target}")

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

        logging.info(f"[Phase 6/8] Exploitation chain for {target}")
        socketio.emit('exploit_result', {
            'exploit_id': f"{scan_id}_exploit",
            'target': target,
            'event': 'started',
            'message': f'Starting exploitation chain on {target}',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

        run_exploitation_chain(target, target_dir, enabled_tools=['nuclei', 'ffuf'])

        socketio.emit('exploit_result', {
            'exploit_id': f"{scan_id}_exploit",
            'target': target,
            'event': 'completed',
            'message': 'Exploitation chain completed',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

        # ==================== PHASE 7: AI ANALYSIS #2 (POST-EXPLOITATION) ====================
        current_phase = 'ai_analysis_2'
        socketio.emit('phase_change', {
            'phase': 'ai_analysis_2',
            'target': target,
            'scan_id': scan_id,
            'message': 'AI analyzing exploitation results',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

        logging.info(f"[Phase 7/8] AI Analysis #2 (post-exploitation) for {target}")

        # Gather loot for AI analysis
        loot = {
            "usernames": get_loot(target, "username"),
            "passwords": get_loot(target, "password"),
            "protocols": get_loot(target, "protocol"),
            "urls": get_loot(target, "url"),
            "ports": get_loot(target, "port")
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

            # ==================== PHASE 8: EXECUTE AI FOLLOWUP COMMANDS ====================
            current_phase = 'ai_execution_2'
            socketio.emit('phase_change', {
                'phase': 'ai_execution_2',
                'target': target,
                'scan_id': scan_id,
                'message': 'Executing AI followup commands',
                'timestamp': datetime.now(timezone.utc).isoformat()
            })

            logging.info(f"[Phase 8/8] Executing AI followup commands for {target}")
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
```

### 4. Update /api/v1/recon/start Endpoint

Replace the current `start_recon()` function's `run_scan()` inner function with:

```python
def run_scan():
    """Execute full AI-driven workflow (not just recon)"""
    run_full_ai_workflow(target, scan_id, tools, socketio)
```

Update the endpoint docstring to reflect the change:

```python
@app.route('/api/v1/recon/start', methods=['POST'])
def start_recon():
    """
    Start FULL AI-DRIVEN WORKFLOW for target

    This endpoint triggers the complete autonomous workflow:
    1. Reconnaissance
    2. AI Analysis #1 (post-recon)
    3. Execute AI commands
    4. Web scans (ZAP/Burp auto-start)
    5. Metasploit exploitation (MSF auto-start)
    6. Exploitation chain
    7. AI Analysis #2 (post-exploitation)
    8. Execute AI followup commands

    Request Body:
        {
            "target": "culpur.net",
            "tools": []  # Optional, for future use (AI currently decides)
        }

    Returns:
        {
            "scan_id": "scan_1234567890_1234",
            "status": "started",
            "target": "culpur.net",
            "message": "Full AI workflow initiated"
        }
    """
```

### 5. Remove Deprecated Manual Trigger Endpoints

Comment out or remove these endpoints (lines ~891-964 and ~967-1027):

- `/api/v1/ai/analyze` (line 891-964) - AI analyzes automatically after recon
- `/api/v1/exploit/start` (line 967-1027) - AI handles exploitation automatically

Add deprecation notices:

```python
# ==================== DEPRECATED ENDPOINTS ====================
# The following endpoints are deprecated as of Phase 3 redesign.
# The AI workflow is now fully autonomous and triggered by /api/v1/recon/start

# @app.route('/api/v1/ai/analyze', methods=['POST'])
# def analyze_with_ai():
#     """DEPRECATED: AI analysis now runs automatically as part of /api/v1/recon/start"""
#     return jsonify({
#         'error': 'This endpoint is deprecated. AI analysis runs automatically during scans.',
#         'suggestion': 'Use POST /api/v1/recon/start to trigger the full AI workflow'
#     }), 410  # HTTP 410 Gone

# @app.route('/api/v1/exploit/start', methods=['POST'])
# def start_exploitation():
#     """DEPRECATED: Exploitation now runs automatically as part of /api/v1/recon/start"""
#     return jsonify({
#         'error': 'This endpoint is deprecated. Exploitation runs automatically during scans.',
#         'suggestion': 'Use POST /api/v1/recon/start to trigger the full AI workflow'
#     }), 410  # HTTP 410 Gone
```

### 6. Keep Service Control Endpoints (Modified)

Keep the service control endpoints but add a note that services are auto-managed during scans:

```python
@app.route('/api/v1/services/<service_name>', methods=['POST'])
def control_service(service_name):
    """
    Start or stop a service manually

    NOTE: Services are auto-started during scans as needed.
    This endpoint is provided for manual testing/debugging only.
    """
    # ... existing implementation ...
```

## Testing Checklist

After implementation:

1. [ ] Test reconnaissance phase with WebSocket events
2. [ ] Verify AI analysis executes automatically after recon
3. [ ] Confirm AI commands are executed and logged
4. [ ] Check ZAP auto-starts when needed
5. [ ] Check Burp auto-starts when needed
6. [ ] Check Metasploit RPC auto-starts when needed
7. [ ] Verify web scans execute
8. [ ] Verify exploitation chain executes
9. [ ] Confirm AI followup analysis runs
10. [ ] Verify AI followup commands execute
11. [ ] Check all WebSocket events emit correctly
12. [ ] Test scan cancellation still works
13. [ ] Verify deprecated endpoints return 410 status
14. [ ] Test concurrent multi-target scans

## WebSocket Events

The following WebSocket events are emitted during the workflow:

- `phase_change` - Phase transitions (8 phases)
- `recon_output` - Reconnaissance progress
- `ai_thought` - AI decision-making process
- `ai_command_execution` - AI command execution status
- `service_auto_start` - Service auto-start notifications
- `exploit_result` - Exploitation progress
- `scan_complete` - Final completion status

## File Outputs

Results are saved to `results/<target>/`:

- `results.json` - Reconnaissance data
- `ai_suggestions_post_recon.json` - AI analysis after recon
- `ai_commands.json` - Executed AI commands log
- `ai_suggestions_post_exploitation.json` - AI analysis after exploitation
- `metasploit_results.txt` - Metasploit output
- `loot.json` - Collected credentials and data

## Error Handling

All phases include comprehensive error handling:
- Exceptions are logged
- WebSocket error events are emitted
- Scan status is updated to 'failed'
- Subsequent phases are skipped if critical failure occurs
- Phase always resets to 'idle' in finally block

## Implementation Priority

1. **High Priority** (Core Functionality):
   - Auto-service management functions
   - Full AI workflow function
   - Update /api/v1/recon/start

2. **Medium Priority** (Quality of Life):
   - Deprecate manual trigger endpoints
   - Update docstrings

3. **Low Priority** (Testing):
   - Comprehensive testing
   - Performance optimization

## Deployment Notes

- Backup current `api_server.py` before changes
- Test in development environment first
- Ensure all module dependencies are installed
- Verify OpenAI API key is configured
- Check Metasploit RPC credentials are set
- Confirm ZAP and Burp Suite paths are correct

## Rollback Plan

If issues occur:
1. Restore from `api_server.py.backup`
2. Restart API server
3. Test basic functionality
4. Review error logs for root cause

## Success Criteria

- Single "Start Scan" triggers all 8 phases
- AI analysis runs automatically (no manual trigger)
- Services auto-start when needed
- WebSocket events provide real-time updates
- Frontend receives comprehensive progress data
- Deprecated endpoints return proper HTTP 410 status
- All phases complete successfully for test target
