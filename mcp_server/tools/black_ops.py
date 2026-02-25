# cstrike/mcp_server/tools/black_ops.py — Proxy chaining & agent MCP tools

import asyncio
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from modules.utils import save_result

# Allowlist of commands permitted through proxychains
_PROXY_ALLOWED_CMDS = {
    "nmap", "curl", "wget", "nikto", "whatweb", "gobuster",
    "feroxbuster", "ffuf", "sqlmap", "nuclei", "httpx",
    "smbmap", "enum4linux-ng", "ldapsearch", "snmpwalk",
}


def register(mcp, guardrails):

    @mcp.tool()
    async def register_proxy_agent(name: str, ip: str, socks_port: int = 9050) -> str:
        """Register a SOCKS5 proxy agent for traffic routing through proxychains."""
        guardrails.enforce("proxychains4", ip)
        if not guardrails.check_exploitation_allowed():
            return json.dumps({"error": "Exploitation is disabled in config."})

        from modules.black_ops import register_agent
        await asyncio.to_thread(register_agent, name, ip, socks_port)
        save_result(ip, "register_proxy_agent", ["register", name, ip], f"socks5://{ip}:{socks_port}")
        return json.dumps({"status": "registered", "agent": name, "proxy": f"socks5://{ip}:{socks_port}"})

    @mcp.tool()
    async def remove_proxy_agent(name: str) -> str:
        """Remove a registered proxy agent."""
        guardrails.enforce("proxychains4", "localhost")
        if not guardrails.check_exploitation_allowed():
            return json.dumps({"error": "Exploitation is disabled in config."})

        from modules.black_ops import remove_agent
        await asyncio.to_thread(remove_agent, name)
        return json.dumps({"status": "removed", "agent": name})

    @mcp.tool()
    async def list_proxy_agents() -> str:
        """List all registered proxy agents with their SOCKS5 connection details."""
        guardrails.enforce("proxychains4", "localhost")

        from modules.black_ops import list_agents
        agents = await asyncio.to_thread(list_agents)
        return json.dumps({"agents": agents})

    @mcp.tool()
    async def run_through_proxy(agent_name: str, command: str) -> str:
        """Execute an allowed command through a registered proxy agent via
        proxychains4. Only allowlisted security tools are permitted."""
        guardrails.enforce("proxychains4", "localhost")
        if not guardrails.check_exploitation_allowed():
            return json.dumps({"error": "Exploitation is disabled in config."})

        cmd_list = command.split()
        if not cmd_list:
            return json.dumps({"error": "Empty command."})

        base_cmd = os.path.basename(cmd_list[0])
        if base_cmd not in _PROXY_ALLOWED_CMDS:
            return json.dumps({
                "error": f"Command '{base_cmd}' is not allowed through proxy. "
                         f"Allowed: {sorted(_PROXY_ALLOWED_CMDS)}"
            })

        from modules.black_ops import run_through_agent
        result = await asyncio.to_thread(run_through_agent, agent_name, cmd_list)
        save_result("proxy", "run_through_proxy", cmd_list, result.stdout)
        return json.dumps({
            "agent": agent_name, "command": command,
            "stdout": result.stdout, "stderr": result.stderr,
            "returncode": result.returncode
        })
