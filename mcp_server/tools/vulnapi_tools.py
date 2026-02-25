# cstrike/mcp_server/tools/vulnapi_tools.py — VulnAPI MCP tools

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from modules.utils import save_result


def register(mcp, guardrails):

    @mcp.tool()
    async def vulnapi_discover(url: str) -> str:
        """Discover API endpoints on a target URL using VulnAPI. Returns discovered endpoints and API paths."""
        guardrails.enforce("vulnapi", url)
        from modules.vulnapi import run_vulnapi_discover
        output = await asyncio.to_thread(run_vulnapi_discover, url)
        save_result(url, "vulnapi_discover", ["vulnapi", "discover", url], output or "")
        return json.dumps({"tool": "vulnapi_discover", "url": url, "output": output or ""})

    @mcp.tool()
    async def vulnapi_curl_scan(url: str, method: str = "GET") -> str:
        """Scan an API endpoint for OWASP API Top 10 vulnerabilities without needing a spec file. method: GET, POST, PUT, DELETE."""
        guardrails.enforce("vulnapi", url)
        from modules.vulnapi import run_vulnapi_curl_scan as _scan
        raw, findings = await asyncio.to_thread(_scan, url, None, method)
        save_result(url, "vulnapi_curl_scan", ["vulnapi", "scan", "curl", url], json.dumps(findings))
        return json.dumps({
            "tool": "vulnapi_curl_scan", "url": url, "method": method,
            "findings": findings, "total": len(findings)
        })

    @mcp.tool()
    async def vulnapi_openapi_scan(spec_url: str) -> str:
        """Scan an API using its OpenAPI/Swagger specification for OWASP API Top 10 vulnerabilities."""
        guardrails.enforce("vulnapi", spec_url)
        from modules.vulnapi import run_vulnapi_openapi_scan as _scan
        raw, findings = await asyncio.to_thread(_scan, spec_url)
        save_result(spec_url, "vulnapi_openapi_scan", ["vulnapi", "scan", "openapi", spec_url], json.dumps(findings))
        return json.dumps({
            "tool": "vulnapi_openapi_scan", "spec_url": spec_url,
            "findings": findings, "total": len(findings)
        })

    @mcp.tool()
    async def vulnapi_full_scan(target: str) -> str:
        """Run the complete VulnAPI scanning pipeline: discover endpoints, probe for specs, scan all endpoints and specs found. Returns aggregated findings."""
        guardrails.enforce("vulnapi", target)
        from modules.vulnapi import run_vulnapi_full_scan as _full
        results = await asyncio.to_thread(_full, target)
        save_result(target, "vulnapi_full_scan", ["vulnapi", "full", target], json.dumps(results))
        return json.dumps({"tool": "vulnapi_full_scan", "target": target, "results": results})
