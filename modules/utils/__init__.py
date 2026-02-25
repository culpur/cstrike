# cstrike/modules/utils/__init__.py

import subprocess
import json
import os
from datetime import datetime

def run_command_with_log(command, timeout=300):
    print(f"[>] Executing: {' '.join(command)}")
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout, text=True)
    return result.stdout

def save_result(target, name, command, output):
    target_dir = get_target_dir(target)
    os.makedirs(target_dir, exist_ok=True)
    data = {
        "command": command,
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
