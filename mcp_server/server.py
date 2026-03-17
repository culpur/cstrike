# cstrike/mcp_server/server.py — MCP Server for CStrike pentesting tools
#
# Usage:
#   python -m mcp_server              # stdio transport (for CLI/agent use)
#   python -m mcp_server --sse        # SSE transport (for web integration)

import logging
import os
import sys

# Ensure project root is on path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from mcp.server.fastmcp import FastMCP
from mcp_server.config import load_config
from mcp_server.guardrails import CStrikeGuardrails

log = logging.getLogger("cstrike.mcp_server")

# Initialize server
mcp = FastMCP("cstrike")

# Load config and guardrails
config = load_config()
guardrails = CStrikeGuardrails(config)

# Register all tool modules with per-module error isolation
from mcp_server.tools import recon, exploitation, vulnapi_tools, metasploit
from mcp_server.tools import zap_burp, black_ops, credentials, loot, system
from mcp_server.tools import web_exploit, network_enum, impacket
from mcp_server.tools import ssl_tls, osint, password_crypto
from mcp_server.tools import post_exploit, cloud_container
from mcp_server.tools import poscoin, osint_investigation

_TOOL_MODULES = [
    recon, exploitation, vulnapi_tools, metasploit,
    zap_burp, black_ops, credentials, loot, system,
    web_exploit, network_enum, impacket,
    ssl_tls, osint, password_crypto,
    post_exploit, cloud_container,
    poscoin, osint_investigation,
]

for module in _TOOL_MODULES:
    try:
        module.register(mcp, guardrails)
    except Exception as e:
        log.error(f"Failed to register tool module {module.__name__}: {e}")

# Register resources and prompts
from mcp_server import resources, prompts
resources.register(mcp)
prompts.register(mcp)


def get_mcp_tool_definitions():
    """Convert MCP tool schemas to OpenAI/Ollama tool calling format.

    Returns list of tool dicts in the format:
    [{"type": "function", "function": {"name": ..., "description": ..., "parameters": ...}}]
    """
    tools = []
    for tool in mcp._tool_manager._tools.values():
        # FastMCP stores input schema in different attributes depending on version
        schema = {}
        for attr in ("parameters", "inputSchema", "input_schema"):
            if hasattr(tool, attr):
                val = getattr(tool, attr)
                if val:
                    schema = val
                    break

        tools.append({
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description or "",
                "parameters": schema,
            }
        })
    return tools


async def execute_mcp_tool(tool_name, arguments):
    """Execute an MCP tool by name with arguments.

    This is the tool_executor callback for the AI provider agentic loop.
    Uses FastMCP's call_tool for proper type coercion and validation.
    """
    from mcp_server.guardrails import GuardrailViolation
    import json

    try:
        result = await mcp.call_tool(tool_name, arguments)
        # call_tool returns a list of content objects; extract text
        if hasattr(result, '__iter__'):
            texts = []
            for item in result:
                if hasattr(item, 'text'):
                    texts.append(item.text)
                elif isinstance(item, str):
                    texts.append(item)
            return "\n".join(texts) if texts else json.dumps({"result": "ok"})
        return str(result)
    except GuardrailViolation as e:
        return json.dumps({"error": f"Guardrail violation: {str(e)}"})
    except Exception as e:
        return json.dumps({"error": f"Tool execution failed: {str(e)}"})


def execute_mcp_tool_sync(tool_name, arguments):
    """Synchronous wrapper for execute_mcp_tool.

    Used by the AI provider tool_executor callback which expects sync calls.
    """
    import asyncio
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        # Already in an async context — create a new event loop in a thread
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as pool:
            future = pool.submit(asyncio.run, execute_mcp_tool(tool_name, arguments))
            return future.result()
    else:
        return asyncio.run(execute_mcp_tool(tool_name, arguments))


def run_server(transport="stdio"):
    """Start the MCP server."""
    mcp.run(transport=transport)
