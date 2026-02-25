# cstrike/modules/metasploit.py

import os
import json
from pathlib import Path
from pymetasploit3.msfrpc import MsfRpcClient
from modules.utils import get_target_dir

# Load creds from .env
CONFIG = json.loads(Path(".env").read_text())
MSF_USERNAME = CONFIG.get("msf_username", "msf")
MSF_PASSWORD = CONFIG.get("msf_password", "")
MSF_HOST = CONFIG.get("msf_host", "127.0.0.1")
MSF_PORT = CONFIG.get("msf_port", 55552)


def start_msf_rpc():
    try:
        client = MsfRpcClient(
            password=MSF_PASSWORD,
            username=MSF_USERNAME,
            port=MSF_PORT,
            ssl=False,
            server=MSF_HOST
        )
        print(f"[+] Connected to Metasploit RPC on {MSF_HOST}:{MSF_PORT} as {MSF_USERNAME}")
        return client
    except Exception as e:
        print(f"[!] Failed to connect to Metasploit RPC: {e}")
        return None


def run_msf_exploits(client, target):
    print(f"[*] Running example Metasploit RPC logic for {target}")
    target_dir = get_target_dir(target)
    output_path = os.path.join(target_dir, "metasploit_results.txt")

    try:
        with open(output_path, "w") as f:
            f.write(f"[+] Connected to Metasploit RPC.\n")
            f.write(f"[+] Example: Listing available exploits...\n")

            exploits = client.modules.exploits
            f.write(f"Total exploits: {len(exploits)}\n")
            for exp in exploits[:10]:
                f.write(f" - {exp}\n")
        print(f"[✓] Wrote Metasploit output to {output_path}")
    except Exception as e:
        print(f"[!] Error during exploitation logic: {e}")
