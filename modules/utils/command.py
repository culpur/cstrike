# cstrike/modules/utils/command.py

import subprocess

def run_command_with_output(command, timeout=300):
    try:
        print(f"[>] Running: {' '.join(command)}")
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout, text=True)
        return result.stdout
    except subprocess.TimeoutExpired:
        return "[!] Command timed out."
    except Exception as e:
        return f"[!] Error: {e}"
