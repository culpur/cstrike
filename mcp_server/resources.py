# cstrike/mcp_server/resources.py — MCP resources for CStrike data

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from modules.utils import load_results, get_target_dir
from modules.loot_tracker import get_loot
from modules.black_ops import list_agents
from mcp_server.config import get_config_masked, get_config


def register(mcp):

    @mcp.resource("results://{target}")
    def get_results(target: str) -> str:
        """All compiled scan results for a target."""
        results = load_results(target)
        return json.dumps(results, indent=2)

    @mcp.resource("results://{target}/{tool_name}")
    def get_tool_result(target: str, tool_name: str) -> str:
        """Specific tool result for a target."""
        target_dir = get_target_dir(target)
        result_file = os.path.join(target_dir, f"{tool_name}.json")
        if os.path.exists(result_file):
            with open(result_file) as f:
                return f.read()
        return json.dumps({"error": f"No results for {tool_name} on {target}"})

    @mcp.resource("loot://{target}")
    def get_all_loot(target: str) -> str:
        """All loot categories for a target."""
        loot_path = os.path.join(get_target_dir(target), "loot.json")
        if os.path.exists(loot_path):
            with open(loot_path) as f:
                return f.read()
        return json.dumps({})

    @mcp.resource("loot://{target}/{category}")
    def get_loot_category(target: str, category: str) -> str:
        """Specific loot category for a target."""
        items = get_loot(target, category)
        return json.dumps(items)

    @mcp.resource("credentials://{target}")
    def get_credentials(target: str) -> str:
        """All credentials for a target."""
        creds_path = os.path.join(get_target_dir(target), "credentials.json")
        if os.path.exists(creds_path):
            with open(creds_path) as f:
                return f.read()
        return json.dumps([])

    @mcp.resource("credentials://all")
    def get_all_credentials() -> str:
        """All credentials across all targets."""
        results_dir = "results"
        all_creds = []
        if os.path.isdir(results_dir):
            for target_name in os.listdir(results_dir):
                creds_path = os.path.join(results_dir, target_name, "credentials.json")
                if os.path.exists(creds_path):
                    with open(creds_path) as f:
                        try:
                            creds = json.load(f)
                            if isinstance(creds, list):
                                all_creds.extend(creds)
                        except json.JSONDecodeError:
                            pass
        return json.dumps(all_creds)

    @mcp.resource("config://current")
    def get_current_config() -> str:
        """Current configuration with secrets masked."""
        return json.dumps(get_config_masked(), indent=2)

    @mcp.resource("config://allowed_tools")
    def get_allowed_tools() -> str:
        """Tool allowlist from config."""
        cfg = get_config()
        return json.dumps(cfg.get("allowed_tools", []))

    @mcp.resource("config://scan_modes")
    def get_scan_modes() -> str:
        """Active scan modes from config."""
        cfg = get_config()
        return json.dumps(cfg.get("scan_modes", []))

    @mcp.resource("agents://list")
    def get_agents() -> str:
        """Registered proxy agents."""
        agents = list_agents()
        return json.dumps(agents, indent=2)
