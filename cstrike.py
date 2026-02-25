#!/usr/bin/env python3
# CStrike - Autonomous penetration testing orchestrator

import os
import json
import logging
import subprocess
import threading
from pathlib import Path
from datetime import datetime, timezone

from modules.recon import run_recon_layered
from modules.exploitation import run_exploitation_chain
from modules.zap_burp import start_zap, start_burp, run_web_scans
from modules.metasploit import start_msf_rpc, run_msf_exploits
from modules.ai_assistant import ask_ai, ask_ai_with_tools, parse_ai_commands
from modules.loot_tracker import get_loot
from modules.vulnapi import run_vulnapi_full_scan
from dashboard import live_dashboard

# MCP agentic mode (optional — falls back to hardcoded pipeline)
try:
    from mcp_server.server import get_mcp_tool_definitions, execute_mcp_tool_sync
    MCP_AVAILABLE = True
except ImportError:
    MCP_AVAILABLE = False

logging.basicConfig(
    filename="logs/driver.log",
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s"
)

CONFIG = json.loads(Path(".env").read_text())
TARGETS = CONFIG.get("target_scope", [])


def is_process_running(name):
    try:
        output = os.popen(f"pgrep -f '{name}'").read()
        return bool(output.strip())
    except Exception:
        return False


def execute_ai_commands(commands, log_path, trigger_exploitation=False, target=None, target_dir=None):
    command_logs = []

    for cmd in commands:
        log_entry = {"command": cmd, "timestamp": datetime.now(timezone.utc).isoformat()}
        try:
            logging.info(f"[AI ➔ Command] {' '.join(cmd)}")
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=300)
            log_entry["status"] = "success" if result.returncode == 0 else "fail"
            log_entry["stdout"] = result.stdout.strip()
            log_entry["stderr"] = result.stderr.strip()

            # Auto-trigger exploitation if AI suggests nuclei/sqlmap/ffuf/etc
            if trigger_exploitation and any(tool in cmd for tool in ["nuclei", "sqlmap", "ffuf"]):
                logging.info("[AI Trigger] Auto-running exploitation chain from suggestion.")
                if target and target_dir:
                    run_exploitation_chain(target, target_dir)

        except Exception as e:
            log_entry["status"] = "error"
            log_entry["stderr"] = str(e)
        command_logs.append(log_entry)

    log_path.write_text(json.dumps(command_logs, indent=2))


def cstrike_driver_agentic(target, target_dir):
    """MCP agentic mode — AI drives the entire workflow via tool calls."""
    logging.info(f"[MCP] Running agentic mode for {target}")

    # Run initial recon to give the AI something to work with
    recon_results = run_recon_layered(target)

    # Let the AI drive everything via MCP tools
    result = ask_ai_with_tools(
        recon_results,
        tool_executor=execute_mcp_tool_sync,
        target=target,
        max_iterations=CONFIG.get("ai_max_iterations", 15),
    )

    if result:
        (target_dir / "ai_agentic_result.json").write_text(json.dumps({
            "mode": "agentic",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "result": result,
        }, indent=2))

    logging.info(f"[MCP] Agentic mode complete for {target}")


def cstrike_driver_classic(target, target_dir):
    """Classic hardcoded pipeline — text-mode AI suggestions parsed into shell commands."""
    timestamp = datetime.now(timezone.utc).isoformat()

    # Run recon
    recon_results = run_recon_layered(target)

    # First AI suggestions (after recon)
    ai_response = ask_ai(recon_results)
    commands = parse_ai_commands(ai_response)

    (target_dir / "ai_suggestions.json").write_text(json.dumps({
        "stage": "post_recon",
        "timestamp": timestamp,
        "response": ai_response,
        "commands": commands
    }, indent=2))

    execute_ai_commands(commands, target_dir / "ai_commands_post_recon.json", trigger_exploitation=True, target=target, target_dir=target_dir)

    # Start ZAP/Burp if not running
    if not is_process_running("zap"):
        start_zap()
    else:
        logging.info("[~] ZAP is already running")
    if not is_process_running("burpsuite"):
        start_burp()
    else:
        logging.info("[~] Burp Suite is already running")

    # Run web app scans
    run_web_scans(target, target_dir)

    # Run VulnAPI API security scanning
    logging.info(f"[+] Running VulnAPI scan for {target}")
    run_vulnapi_full_scan(target)

    # Run Metasploit
    msf_client = start_msf_rpc()
    if msf_client:
        run_msf_exploits(msf_client, target)

    # Exploitation logic
    run_exploitation_chain(target, target_dir)

    # Second AI suggestions (after exploitation)
    loot = {
        "usernames": get_loot(target, "username"),
        "passwords": get_loot(target, "password"),
        "protocols": get_loot(target, "protocol"),
        "api_vulnerabilities": get_loot(target, "vulnerability")
    }

    ai_followup = ask_ai({"recon": recon_results, "loot": loot})
    followup_commands = parse_ai_commands(ai_followup)

    (target_dir / "ai_suggestions_followup.json").write_text(json.dumps({
        "stage": "post_exploitation",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "response": ai_followup,
        "commands": followup_commands
    }, indent=2))

    execute_ai_commands(followup_commands, target_dir / "ai_commands_post_exploitation.json", trigger_exploitation=True, target=target, target_dir=target_dir)

    logging.info(f"[✓] Completed all phases for {target}")


def cstrike_driver():
    use_mcp = CONFIG.get("mcp_enabled", False) and MCP_AVAILABLE

    if use_mcp:
        logging.info("[+] MCP agentic mode enabled")
    else:
        logging.info("[+] Classic pipeline mode")

    for target in TARGETS:
        logging.info(f"[+] Starting target: {target}")

        target_dir = Path("results") / target
        target_dir.mkdir(parents=True, exist_ok=True)

        # Start dashboard in background thread
        dashboard_thread = threading.Thread(target=live_dashboard, args=(), daemon=True)
        dashboard_thread.start()

        if use_mcp:
            cstrike_driver_agentic(target, target_dir)
        else:
            cstrike_driver_classic(target, target_dir)


if __name__ == "__main__":
    cstrike_driver()
