# cstrike/modules/black_ops.py

import json
import subprocess
import os
from pathlib import Path

AGENTS_FILE = Path("data/agents.json")


def load_agents():
    if AGENTS_FILE.exists():
        return json.loads(AGENTS_FILE.read_text())
    return {}


def save_agents(data):
    AGENTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    AGENTS_FILE.write_text(json.dumps(data, indent=2))


# Agent management

def register_agent(name, ip, socks_port=9050):
    agents = load_agents()
    agents[name] = {
        "ip": ip,
        "socks_port": socks_port,
        "proxy": f"socks5://{ip}:{socks_port}"
    }
    save_agents(agents)


def remove_agent(name):
    agents = load_agents()
    if name in agents:
        del agents[name]
        save_agents(agents)


def list_agents():
    return load_agents()


# Proxy chaining support

def proxy_command(base_cmd, proxy):
    return ["proxychains4", "-q"] + base_cmd if proxy else base_cmd


def run_through_agent(agent_name, cmd):
    agents = load_agents()
    if agent_name not in agents:
        raise ValueError(f"Agent '{agent_name}' not registered.")

    full_cmd = proxy_command(cmd, agents[agent_name]["proxy"])
    print(f"[BlackOps] Executing through agent {agent_name}: {' '.join(full_cmd)}")
    return subprocess.run(full_cmd, capture_output=True, text=True)


# Loot heatmap (prioritize credentials by sensitivity)

SENSITIVITY_WEIGHTS = {
    "root": 10,
    "admin": 8,
    "support": 5,
    "user": 3
}


def heatmap_loot(loot):
    heatmap = []
    for user in loot.get("usernames", []):
        score = 0
        for label, weight in SENSITIVITY_WEIGHTS.items():
            if label in user.lower():
                score += weight
        heatmap.append((user, score))
    return sorted(heatmap, key=lambda x: x[1], reverse=True)
