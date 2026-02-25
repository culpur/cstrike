# cstrike/mcp_server/tools/metasploit.py — Metasploit RPC MCP tools

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

# Module-level MSF client (stateful connection)
_msf_client = None


def register(mcp, guardrails):

    @mcp.tool()
    async def msf_connect() -> str:
        """Connect to the Metasploit RPC daemon using credentials from config. Must be called before running exploits."""
        global _msf_client
        from modules.metasploit import start_msf_rpc
        _msf_client = await asyncio.to_thread(start_msf_rpc)
        if _msf_client:
            return json.dumps({"status": "connected", "message": "Metasploit RPC connection established."})
        return json.dumps({"status": "failed", "message": "Could not connect to Metasploit RPC. Ensure msfrpcd is running."})

    @mcp.tool()
    async def msf_list_exploits(search: str = "") -> str:
        """List available Metasploit exploit modules. Optionally filter by search term."""
        global _msf_client
        if not _msf_client:
            return json.dumps({"error": "Not connected. Call msf_connect first."})
        try:
            def _list():
                exploits = list(_msf_client.modules.exploits)
                if search:
                    exploits = [e for e in exploits if search.lower() in e.lower()]
                return exploits
            exploits = await asyncio.to_thread(_list)
            return json.dumps({"exploits": exploits[:50], "total": len(exploits)})
        except Exception as e:
            return json.dumps({"error": str(e)})

    @mcp.tool()
    async def msf_run_exploit(exploit_name: str, target: str, options: str = "{}") -> str:
        """Run a Metasploit exploit module against a target. options: JSON string of module options like RHOSTS, LHOST, LPORT."""
        global _msf_client
        guardrails.enforce("msfconsole", target)
        if not guardrails.check_exploitation_allowed():
            return json.dumps({"error": "Exploitation is disabled in config."})
        if not _msf_client:
            return json.dumps({"error": "Not connected. Call msf_connect first."})
        try:
            opts = json.loads(options) if isinstance(options, str) else options

            def _run():
                exploit = _msf_client.modules.use("exploit", exploit_name)
                exploit["RHOSTS"] = target
                for k, v in opts.items():
                    exploit[k] = v
                return exploit.execute()

            result = await asyncio.to_thread(_run)
            return json.dumps({"exploit": exploit_name, "target": target, "result": str(result)})
        except Exception as e:
            return json.dumps({"error": str(e)})
