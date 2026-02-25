# cstrike/mcp_server/tools/zap_burp.py — ZAP/Burp Suite MCP tools

import asyncio
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from modules.utils import get_target_dir


def register(mcp, guardrails):

    @mcp.tool()
    async def zap_start(gui: bool = False) -> str:
        """Start OWASP ZAP proxy scanner. Set gui=true for GUI mode, false for daemon mode."""
        from modules.zap_burp import start_zap
        await asyncio.to_thread(start_zap, gui)
        return json.dumps({"status": "started", "mode": "gui" if gui else "daemon"})

    @mcp.tool()
    async def burp_start() -> str:
        """Start Burp Suite scanner."""
        from modules.zap_burp import start_burp
        await asyncio.to_thread(start_burp)
        return json.dumps({"status": "started"})

    @mcp.tool()
    async def zap_active_scan(target: str) -> str:
        """Run an active ZAP scan against a target URL."""
        guardrails.enforce("zap.sh", target)
        target_dir = get_target_dir(target)
        os.makedirs(target_dir, exist_ok=True)
        from modules.zap_burp import run_web_scans
        await asyncio.to_thread(run_web_scans, target, target_dir)
        return json.dumps({"tool": "zap_scan", "target": target, "status": "completed"})

    @mcp.tool()
    async def check_service_running(service_name: str) -> str:
        """Check if a service process is running. service_name: msfrpcd, zap, burpsuite, etc."""
        try:
            result = await asyncio.to_thread(
                subprocess.run, ["pgrep", "-f", service_name],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
            running = result.returncode == 0
            return json.dumps({"service": service_name, "running": running})
        except Exception as e:
            return json.dumps({"service": service_name, "running": False, "error": str(e)})
