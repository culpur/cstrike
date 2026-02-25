# cstrike/mcp_server/tools/loot.py — Loot tracker MCP tools

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))


def register(mcp, guardrails):

    @mcp.tool()
    async def add_loot(target: str, category: str, value: str) -> str:
        """Add a discovered item to the loot tracker. category: username, password, url, port, protocol, vulnerability, reused."""
        from modules.loot_tracker import add_loot as _add
        await asyncio.to_thread(_add, target, category, value)
        return json.dumps({"status": "added", "target": target, "category": category, "value": value})

    @mcp.tool()
    async def get_loot(target: str, category: str = "") -> str:
        """Query loot for a target. Leave category empty to get all categories. category: username, password, url, port, protocol, vulnerability."""
        from modules.loot_tracker import get_loot as _get
        if category:
            items = await asyncio.to_thread(_get, target, category)
            return json.dumps({"target": target, "category": category, "items": items, "count": len(items)})
        else:
            # Load full loot file
            from modules.utils import get_target_dir
            loot_path = os.path.join(get_target_dir(target), "loot.json")
            if os.path.exists(loot_path):
                with open(loot_path) as f:
                    loot = json.load(f)
                return json.dumps({"target": target, "loot": loot})
            return json.dumps({"target": target, "loot": {}})

    @mcp.tool()
    async def get_all_loot(target: str) -> str:
        """Get the complete loot file for a target including all categories: usernames, passwords, URLs, ports, protocols, vulnerabilities."""
        from modules.utils import get_target_dir
        loot_path = os.path.join(get_target_dir(target), "loot.json")
        if os.path.exists(loot_path):
            with open(loot_path) as f:
                loot = json.load(f)
            return json.dumps({"target": target, "loot": loot})
        return json.dumps({"target": target, "loot": {}})
