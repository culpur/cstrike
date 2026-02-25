# cstrike/mcp_server/tools/ssl_tls.py — SSL/TLS analysis tools

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from modules.utils import run_command_with_log, save_result, get_target_dir


def register(mcp, guardrails):

    @mcp.tool()
    async def testssl_scan(target: str, port: int = 443,
                           fast: bool = False) -> str:
        """Comprehensive SSL/TLS testing using testssl.sh. Checks protocols,
        ciphers, vulnerabilities (BEAST, POODLE, Heartbleed, etc.), and
        certificate details. fast=true skips some slower checks."""
        guardrails.enforce("testssl", target)

        target_safe = target.replace(".", "_").replace("/", "_")
        out_file = f"/tmp/testssl_{target_safe}.json"
        cmd = ["testssl", "--jsonfile", out_file]
        if fast:
            cmd.append("--fast")
        cmd.append(f"{target}:{port}")

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())

        if os.path.exists(out_file):
            with open(out_file) as f:
                data = json.load(f)
            save_result(target, "testssl", cmd, json.dumps(data))
            return json.dumps({"tool": "testssl", "target": target,
                               "port": port, "results": data})

        save_result(target, "testssl", cmd, output)
        return json.dumps({"tool": "testssl", "target": target,
                           "port": port, "output": output})

    @mcp.tool()
    async def sslscan_scan(target: str, port: int = 443) -> str:
        """Scan SSL/TLS configuration using sslscan. Reports supported
        ciphers, protocols, certificate info, and key exchange details."""
        guardrails.enforce("sslscan", target)

        target_safe = target.replace(".", "_").replace("/", "_")
        out_file = f"/tmp/sslscan_{target_safe}.xml"
        cmd = ["sslscan", f"--xml={out_file}", f"{target}:{port}"]

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())

        xml_data = ""
        if os.path.exists(out_file):
            with open(out_file) as f:
                xml_data = f.read()

        save_result(target, "sslscan", cmd, xml_data or output)
        return json.dumps({"tool": "sslscan", "target": target,
                           "port": port, "output": xml_data or output})

    @mcp.tool()
    async def sslyze_scan(target: str, port: int = 443) -> str:
        """Analyze SSL/TLS configuration using sslyze. Provides detailed
        cipher suite enumeration, certificate validation, and protocol support."""
        guardrails.enforce("sslyze", target)

        target_safe = target.replace(".", "_").replace("/", "_")
        out_file = f"/tmp/sslyze_{target_safe}.json"
        cmd = ["sslyze", "--json_out", out_file, f"{target}:{port}"]

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())

        if os.path.exists(out_file):
            with open(out_file) as f:
                data = json.load(f)
            save_result(target, "sslyze", cmd, json.dumps(data))
            return json.dumps({"tool": "sslyze", "target": target,
                               "port": port, "results": data})

        save_result(target, "sslyze", cmd, output)
        return json.dumps({"tool": "sslyze", "target": target,
                           "port": port, "output": output})
