#!/usr/bin/env python3

import subprocess
import sys
import os
import json
from datetime import datetime

# Load .env config
with open("/root/qs/.env", "r") as f:
    config = json.load(f)

ALLOW_EXPLOITATION = config.get("allow_exploitation", False)
SCAN_MODES = config.get("scan_modes", [])
TARGET_SCOPE = config.get("target_scope", [])
MAX_RUNTIME = config.get("max_runtime", 300)
MAX_THREADS = config.get("max_threads", 10)
ALLOWED_TOOLS = config.get("allowed_tools", [])

LOGFILE = "/root/qs/log/ai-actions.log"
os.makedirs(os.path.dirname(LOGFILE), exist_ok=True)

def log_command(cmd):
    with open(LOGFILE, "a") as f:
        f.write(f"{datetime.now().isoformat()} :: {' '.join(cmd)}\n")

def target_allowed(cmd):
    return any(target in ' '.join(cmd) for target in TARGET_SCOPE)

def mode_allowed(cmd):
    tool = cmd[0]
    if tool in ["nmap", "masscan"] and "port" in SCAN_MODES:
        return True
    if tool in ["curl", "httpx", "httprobe", "whatweb", "nikto", "wafw00f", "shcheck", "wpscan", "aquatone"] and "http" in SCAN_MODES:
        return True
    if tool in ["ffuf"] and "dirbusting" in SCAN_MODES:
        return True
    if tool in ["dig", "traceroute", "host", "dnsrecon"] and "dns" in SCAN_MODES:
        return True
    if tool in ["subfinder", "amass", "theHarvester"] and "subdomain" in SCAN_MODES:
        return True
    if tool in ["theHarvester"] and "osint" in SCAN_MODES:
        return True
    if tool in ["enum4linux-ng", "wpscan", "nikto"] and "vulnscan" in SCAN_MODES:
        return True
    if tool in ["vulnapi"] and "apiscan" in SCAN_MODES:
        return True
    if tool in ["hydra", "msfconsole"] and ALLOW_EXPLOITATION:
        return True
    return tool in ALLOWED_TOOLS

def main():
    if len(sys.argv) < 2:
        print("Usage: run_command.py <command> [args...]")
        sys.exit(1)

    cmd = sys.argv[1:]

    if not mode_allowed(cmd):
        print(f"Command '{cmd[0]}' is not allowed in current scan_modes or due to allow_exploitation=False.")
        sys.exit(1)

    if not target_allowed(cmd):
        print("Target is out of scope.")
        sys.exit(1)

    log_command(cmd)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=MAX_RUNTIME)
        print(result.stdout)
        if result.stderr:
            print("[stderr]", result.stderr)
    except subprocess.TimeoutExpired:
        print("Command timed out.")
    except Exception as e:
        print(f"Execution error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
