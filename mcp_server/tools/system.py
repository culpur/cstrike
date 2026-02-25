# cstrike/mcp_server/tools/system.py — System & config MCP tools

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from mcp_server.config import get_config_masked


def register(mcp, guardrails):

    @mcp.tool()
    async def get_config() -> str:
        """Get the current CStrike configuration with sensitive values masked. Shows target scope, scan modes, allowed tools, and service connections."""
        cfg = get_config_masked()
        return json.dumps(cfg)

    @mcp.tool()
    async def get_target_scope() -> str:
        """Get the list of authorized target domains/IPs from the current scope configuration."""
        cfg = guardrails.config
        return json.dumps({"target_scope": cfg.get("target_scope", [])})

    @mcp.tool()
    async def run_shell_command(command: str, timeout: int = 300) -> str:
        """Execute a shell command with full guardrail enforcement (scope, allowlist, mode checks). command: space-separated command string."""
        from modules.utils import run_command_with_log
        cmd_list = command.split()
        if not cmd_list:
            return json.dumps({"error": "Empty command"})

        tool_name = os.path.basename(cmd_list[0])
        # Extract first non-flag argument as a possible target for scope check
        target = next((a for a in cmd_list[1:] if not a.startswith("-")), "localhost")
        guardrails.enforce(tool_name, target)

        effective_timeout = min(timeout, guardrails.get_timeout())
        try:
            output = await asyncio.to_thread(run_command_with_log, cmd_list, effective_timeout)
            return json.dumps({"command": command, "output": output, "returncode": 0})
        except Exception as e:
            return json.dumps({"command": command, "error": str(e), "returncode": 1})
