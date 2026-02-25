# /opt/ai_driver/modules/utils.py

import os
import json
import subprocess
import logging
from datetime import datetime, timezone

log = logging.getLogger("ai_driver")


def run_command_with_log(cmd, timeout=300):
    log.info(f"[+] Running: {' '.join(cmd)}")
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=timeout)
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        log.error(f"[!] Command timed out: {' '.join(cmd)}")
        return f"[!] Command timed out: {' '.join(cmd)}"
    except Exception as e:
        log.error(f"[!] Error running command: {' '.join(cmd)} - {str(e)}")
        return f"[!] Error running command: {' '.join(cmd)} - {str(e)}"


def get_target_dir(target):
    base_dir = os.path.join("targets", target, target)
    os.makedirs(base_dir, exist_ok=True)
    return base_dir


def save_result(target, command, output):
    target_dir = get_target_dir(target)
    path = os.path.join(target_dir, "results.json")

    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "command": command,
        "output": output
    }

    if os.path.exists(path):
        with open(path, "r") as f:
            data = json.load(f)
    else:
        data = {"history": []}

    data["history"].append(entry)

    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def load_results(target):
    target_dir = get_target_dir(target)
    path = os.path.join(target_dir, "results.json")
    if os.path.exists(path):
        with open(path, "r") as f:
            return json.load(f)
    return {"history": []}
