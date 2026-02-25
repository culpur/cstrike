# cstrike/modules/zap_burp.py

import subprocess
import time
import datetime
import json
from pathlib import Path

def timestamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def save_result(target_dir, cmd, output):
    result = {
        "timestamp": timestamp(),
        "command": cmd if isinstance(cmd, str) else " ".join(cmd),
        "output": output
    }
    result_file = Path(target_dir) / "results.json"
    if result_file.exists():
        data = json.loads(result_file.read_text())
    else:
        data = {"history": []}
    data["history"].append(result)
    result_file.write_text(json.dumps(data, indent=2))

def start_zap(gui=True):
    try:
        print("[+] Starting OWASP ZAP...")
        cmd = ["zap.sh"]
        if not gui:
            cmd.append("-daemon")
        subprocess.Popen(cmd)
        time.sleep(10)
        print("[✓] ZAP started.")
    except Exception as e:
        print(f"[!] Failed to start ZAP: {e}")

def start_burp():
    try:
        print("[+] Starting Burp Suite...")
        subprocess.Popen(["burpsuite"])
        time.sleep(10)
        print("[✓] Burp started.")
    except Exception as e:
        print(f"[!] Failed to start Burp Suite: {e}")

def run_web_scans(target, output_base="targets"):
    print(f"[+] Triggering web app scans for: {target}")
    target_dir = Path(output_base) / target
    target_dir.mkdir(parents=True, exist_ok=True)

    # Placeholders — Replace with proper ZAP/Burp API or CLI scan calls
    zap_scan_cmd = f"curl http://localhost:8080/JSON/ascan/action/scan/?url=http://{target}"
    burp_scan_cmd = f"echo Trigger Burp Suite scan for {target}"

    try:
        print("[*] Starting ZAP active scan...")
        zap_out = subprocess.run(zap_scan_cmd, shell=True, capture_output=True, text=True, timeout=300)
        save_result(target_dir, zap_scan_cmd, zap_out.stdout + zap_out.stderr)
    except Exception as e:
        print(f"[!] ZAP scan failed: {e}")

    try:
        print("[*] Placeholder: Simulating Burp scan command...")
        save_result(target_dir, burp_scan_cmd, "Burp Suite scan placeholder")
    except Exception as e:
        print(f"[!] Burp scan failed: {e}")
