#!/usr/bin/env python3
# CStrike AI Driver - Autonomous penetration testing orchestrator

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
from modules.ai_assistant import ask_ai, parse_ai_commands
from modules.loot_tracker import get_loot
from dashboard import live_dashboard

logging.basicConfig(
    filename="/opt/ai_driver/logs/driver.log",
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


def ai_driver():
    for target in TARGETS:
        logging.info(f"[+] Starting recon for target: {target}")
        timestamp = datetime.now(timezone.utc).isoformat()

        target_dir = Path("results") / target
        target_dir.mkdir(parents=True, exist_ok=True)

        # Start dashboard in background thread
        dashboard_thread = threading.Thread(target=live_dashboard, args=(), daemon=True)
        dashboard_thread.start()

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
            "protocols": get_loot(target, "protocol")
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


if __name__ == "__main__":
    ai_driver()
