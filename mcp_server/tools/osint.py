# cstrike/mcp_server/tools/osint.py — OSINT & open-source intelligence tools

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from modules.utils import run_command_with_log, save_result, get_target_dir


def register(mcp, guardrails):

    @mcp.tool()
    async def theharvester_scan(target: str,
                                sources: str = "anubis,crtsh,dnsdumpster,hackertarget",
                                limit: int = 200) -> str:
        """Gather emails, subdomains, hosts, and IPs from public sources using
        theHarvester. sources: comma-separated data sources."""
        guardrails.enforce("theHarvester", target)

        target_safe = target.replace(".", "_").replace("/", "_")
        out_file = f"/tmp/harvester_{target_safe}"
        cmd = ["theHarvester", "-d", target, "-b", sources,
               "-l", str(limit), "-f", out_file]

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())

        json_file = f"{out_file}.json"
        if os.path.exists(json_file):
            with open(json_file) as f:
                data = json.load(f)
            save_result(target, "theHarvester", cmd, json.dumps(data))
            return json.dumps({"tool": "theHarvester", "target": target,
                               "results": data})

        save_result(target, "theHarvester", cmd, output)
        return json.dumps({"tool": "theHarvester", "target": target,
                           "output": output})

    @mcp.tool()
    async def shodan_host(target: str) -> str:
        """Look up a host IP on Shodan for open ports, services, banners,
        vulnerabilities, and organization info. Requires Shodan API key
        configured via 'shodan init'."""
        guardrails.enforce("shodan", target)

        cmd = ["shodan", "host", target]

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "shodan_host", cmd, output)
        return json.dumps({"tool": "shodan", "target": target,
                           "output": output})

    @mcp.tool()
    async def shodan_search(query: str, fields: str = "ip_str,port,org,hostnames",
                            limit: int = 25) -> str:
        """Search Shodan for internet-connected devices matching a query.
        query: Shodan dork (e.g. 'apache port:8080 country:US')."""
        guardrails.enforce("shodan", query)

        cmd = ["shodan", "search", "--fields", fields,
               "--limit", str(limit), query]

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())
        save_result("shodan_search", "shodan", cmd, output)
        return json.dumps({"tool": "shodan_search", "query": query,
                           "output": output})

    @mcp.tool()
    async def sherlock_lookup(username: str) -> str:
        """Search for a username across 300+ social networks using Sherlock.
        Returns sites where the username was found."""
        guardrails.enforce("sherlock", username)

        target_safe = username.replace(".", "_").replace("/", "_")
        out_file = f"/tmp/sherlock_{target_safe}.json"
        cmd = ["sherlock", username, "--print-found", "--json", out_file]

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())

        if os.path.exists(out_file):
            with open(out_file) as f:
                data = json.load(f)
            save_result(username, "sherlock", cmd, json.dumps(data))
            return json.dumps({"tool": "sherlock", "username": username,
                               "results": data})

        save_result(username, "sherlock", cmd, output)
        return json.dumps({"tool": "sherlock", "username": username,
                           "output": output})
