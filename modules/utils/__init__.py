# cstrike/modules/utils/__init__.py

import re
import subprocess
import json
import os
from datetime import datetime

# Patterns to redact from saved command lines and output
_REDACT_PATTERNS = [
    # DOMAIN/USER:PASSWORD@TARGET format (impacket-style)
    re.compile(r'([\w./\\]+:)[^@\s]+(@[\w.\-]+)'),
    # -p PASSWORD, -w PASSWORD flags
    re.compile(r'(-[pw]\s+)\S+'),
    # --password VALUE
    re.compile(r'(--password[= ])\S+'),
    # -hashes LM:NT
    re.compile(r'(-hashes\s+)\S+'),
]


def _redact_sensitive(text):
    """Redact passwords and hashes from command strings."""
    if not isinstance(text, str):
        return text
    result = text
    for pattern in _REDACT_PATTERNS:
        result = pattern.sub(r'\1****\2' if pattern.groups else r'\1****', result)
    return result


def run_command_with_log(command, timeout=300):
    # Redact the log line but run the real command
    safe_cmd = _redact_sensitive(' '.join(command))
    print(f"[>] Executing: {safe_cmd}")
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout, text=True)
    return result.stdout

def save_result(target, name, command, output):
    target_dir = get_target_dir(target)
    os.makedirs(target_dir, exist_ok=True)
    # Redact sensitive data in saved command
    safe_command = [_redact_sensitive(c) for c in command] if isinstance(command, list) else _redact_sensitive(command)
    data = {
        "command": safe_command,
        "output": output,
        "timestamp": datetime.now().isoformat()
    }
    with open(os.path.join(target_dir, f"{name}.json"), "w") as f:
        json.dump(data, f, indent=2)

def load_results(target):
    target_dir = get_target_dir(target)
    results = {}
    if not os.path.isdir(target_dir):
        return results
    for filename in os.listdir(target_dir):
        if filename.endswith(".json") and filename != "results.json":
            name = filename[:-5]
            with open(os.path.join(target_dir, filename)) as f:
                try:
                    results[name] = json.load(f)
                except json.JSONDecodeError:
                    results[name] = {"error": "Failed to parse"}
    return results

def get_target_dir(target):
    return os.path.join("results", target.replace("https://", "").replace("http://", "").replace("/", "_"))

def compile_results(target):
    target_dir = get_target_dir(target)
    combined = {}

    for filename in os.listdir(target_dir):
        if filename.endswith(".json") and filename != "results.json":
            name = filename[:-5]
            with open(os.path.join(target_dir, filename), "r") as f:
                try:
                    combined[name] = json.load(f)
                except json.JSONDecodeError:
                    combined[name] = {"error": "Failed to parse"}

    with open(os.path.join(target_dir, "results.json"), "w") as f:
        json.dump(combined, f, indent=2)

    print(f"[+] Compiled results written to: {os.path.join(target_dir, 'results.json')}")
