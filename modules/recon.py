# /opt/ai_driver/modules/recon.py

import os
import subprocess
import json
import time
import socket
from datetime import datetime, timezone
from modules.utils import (
    run_command_with_log,
    save_result,
    load_results,
    get_target_dir,
)

CHAIN_PORTS = ["80", "443", "8080", "3000", "5000", "8443", "53", "21", "22", "25"]
RETRYABLE_TOOLS = ["nikto", "wafw00f", "nuclei"]
LOOT_FILE = "loot.json"

RECON_COMMANDS = [
    ("whois", lambda t: ["whois", t]),
    ("dig_A", lambda t: ["dig", "A", t]),
    ("dig_MX", lambda t: ["dig", "MX", t]),
    ("dig_NS", lambda t: ["dig", "NS", t]),
    ("dig_TXT", lambda t: ["dig", "TXT", t]),
    ("dig", lambda t: ["dig", t]),
    ("dnsrecon", lambda t: ["dnsrecon", "-d", t]),
    ("subfinder", lambda t: ["subfinder", "-d", t, "-silent"]),
    ("amass", lambda t: ["amass", "enum", "-d", t, "-nocolor", "-passive"]),
    # Use -sT for TCP connect scan (doesn't require root/sudo)
    ("nmap", lambda t: ["nmap", "-sT", "-p-", "-T4", "-Pn", t]),
    ("curl_headers", lambda t: ["curl", "-I", "--max-time", "10", t]),
    ("whatweb", lambda t: ["whatweb", t]),
    ("wafw00f", lambda t: ["wafw00f", t]),
    ("nikto", lambda t: ["nikto", "-host", t]),
    ("httpx", lambda t: ["httpx", "-silent", "-title", "-tech-detect", "-status-code", "-no-color", "-json", "-input", "-"]),
]


def extract_ports_for_chaining(nmap_output):
    ports = []
    for line in nmap_output.splitlines():
        if "/tcp" in line and "open" in line:
            port = line.split("/")[0].strip()
            if port in CHAIN_PORTS:
                ports.append(port)
    return ports


def extract_usernames_from_output(name, output):
    usernames = set()
    if name == "nikto":
        for line in output.splitlines():
            if "username" in line.lower():
                parts = line.split()
                for part in parts:
                    if part.isalnum() and len(part) >= 3:
                        usernames.add(part)
    return list(usernames)


def resolve_and_store_ip(target, target_dir):
    try:
        ip = socket.gethostbyname(target)
        with open(os.path.join(target_dir, "ip.txt"), "w") as f:
            f.write(ip)
    except Exception as e:
        print(f"[!] Could not resolve IP for {target}: {e}")


def write_url_targets(target, target_dir, ports):
    urls = []
    for port in ports:
        for scheme in ["http", "https"]:
            if port == "80" and scheme == "http":
                urls.append(f"http://{target}")
            elif port == "443" and scheme == "https":
                urls.append(f"https://{target}")
            else:
                urls.append(f"{scheme}://{target}:{port}")
    with open(os.path.join(target_dir, "urls.json"), "w") as f:
        json.dump(sorted(set(urls)), f, indent=2)


def run_httpx_input_mode(target, target_dir):
    urls_file = os.path.join(target_dir, "urls.tmp")
    with open(urls_file, "w") as f:
        f.write(f"http://{target}\nhttps://{target}\n")

    command = ["httpx", "-silent", "-title", "-tech-detect", "-status-code", "-no-color", "-json", "-input", urls_file]
    try:
        output = run_command_with_log(command, timeout=300)
        save_result(target, "httpx", command, output)

        loot_path = os.path.join(target_dir, LOOT_FILE)
        loot = {}
        if os.path.exists(loot_path):
            with open(loot_path) as lf:
                loot = json.load(lf)

        urls = []
        for line in output.splitlines():
            try:
                data = json.loads(line)
                if "url" in data:
                    urls.append(data["url"])
            except json.JSONDecodeError:
                continue

        if urls:
            loot.setdefault("urls", []).extend(urls)
            loot["urls"] = sorted(set(loot["urls"]))

        with open(loot_path, "w") as lf:
            json.dump(loot, lf, indent=2)

    except Exception as e:
        print(f"[!] httpx input error: {e}")


def run_recon_layered(target):
    print(f"[+] Starting layered recon for {target}")
    results = load_results(target)
    target_dir = get_target_dir(target)
    os.makedirs(target_dir, exist_ok=True)

    resolve_and_store_ip(target, target_dir)

    loot = {"usernames": [], "urls": []}
    loot_path = os.path.join(target_dir, LOOT_FILE)
    if os.path.exists(loot_path):
        with open(loot_path) as f:
            loot = json.load(f)

    ports_for_url_generation = []

    for name, cmd_func in RECON_COMMANDS:
        if name == "httpx":
            run_httpx_input_mode(target, target_dir)
            continue

        if name in results:
            continue  # Skip if already done

        command = cmd_func(target)
        print(f"[+] Running: {' '.join(command)}")
        try:
            output = run_command_with_log(command, timeout=300)
            save_result(target, name, command, output)

            if name == "nmap":
                ports = extract_ports_for_chaining(output)
                ports_for_url_generation = ports
                with open(os.path.join(target_dir, "exploitable_ports.json"), "w") as f:
                    json.dump(ports, f)

            # Loot enrichment
            new_users = extract_usernames_from_output(name, output)
            if new_users:
                loot.setdefault("usernames", []).extend(new_users)
                loot["usernames"] = sorted(set(loot["usernames"]))

        except subprocess.TimeoutExpired:
            print(f"[!] Timeout: {' '.join(command)}")
        except Exception as e:
            print(f"[!] Error running {name}: {e}")
            if name in RETRYABLE_TOOLS:
                print(f"[*] Retrying {name}...")
                time.sleep(5)
                try:
                    output = run_command_with_log(command, timeout=300)
                    save_result(target, name, command, output)
                except Exception as e:
                    print(f"[!] Second failure: {e}")

    # Optional post-Nmap URL generation
    if ports_for_url_generation:
        write_url_targets(target, target_dir, ports_for_url_generation)

    with open(loot_path, "w") as f:
        json.dump(loot, f, indent=2)

    results_path = os.path.join(target_dir, "results.json")
    compiled = load_results(target)
    with open(results_path, "w") as f:
        json.dump(compiled, f, indent=2)

    print(f"[+] Recon complete. Results written to {results_path}")
    return compiled
