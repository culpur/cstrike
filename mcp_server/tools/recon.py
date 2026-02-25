# cstrike/mcp_server/tools/recon.py — Reconnaissance MCP tools

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from modules.utils import run_command_with_log, save_result, get_target_dir


def register(mcp, guardrails):

    @mcp.tool()
    async def whois_lookup(target: str) -> str:
        """Run WHOIS lookup on a target domain to get registration, registrar, and nameserver info."""
        guardrails.enforce("whois", target)
        cmd = ["whois", target]
        output = await asyncio.to_thread(run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "whois", cmd, output)
        return json.dumps({"tool": "whois", "target": target, "output": output})

    @mcp.tool()
    async def dig_a_record(target: str) -> str:
        """Query DNS A records for a target domain to resolve IP addresses."""
        guardrails.enforce("dig", target)
        cmd = ["dig", "A", target]
        output = await asyncio.to_thread(run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "dig_A", cmd, output)
        return json.dumps({"tool": "dig_A", "target": target, "output": output})

    @mcp.tool()
    async def dig_mx_record(target: str) -> str:
        """Query DNS MX records to find mail servers for a target domain."""
        guardrails.enforce("dig", target)
        cmd = ["dig", "MX", target]
        output = await asyncio.to_thread(run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "dig_MX", cmd, output)
        return json.dumps({"tool": "dig_MX", "target": target, "output": output})

    @mcp.tool()
    async def dig_ns_record(target: str) -> str:
        """Query DNS NS records to find authoritative nameservers for a target domain."""
        guardrails.enforce("dig", target)
        cmd = ["dig", "NS", target]
        output = await asyncio.to_thread(run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "dig_NS", cmd, output)
        return json.dumps({"tool": "dig_NS", "target": target, "output": output})

    @mcp.tool()
    async def dig_txt_record(target: str) -> str:
        """Query DNS TXT records for SPF, DKIM, DMARC, and other text records."""
        guardrails.enforce("dig", target)
        cmd = ["dig", "TXT", target]
        output = await asyncio.to_thread(run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "dig_TXT", cmd, output)
        return json.dumps({"tool": "dig_TXT", "target": target, "output": output})

    @mcp.tool()
    async def dig_any(target: str) -> str:
        """Query all available DNS records for a target domain."""
        guardrails.enforce("dig", target)
        cmd = ["dig", target]
        output = await asyncio.to_thread(run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "dig", cmd, output)
        return json.dumps({"tool": "dig", "target": target, "output": output})

    @mcp.tool()
    async def dnsrecon_scan(target: str) -> str:
        """Run dnsrecon for comprehensive DNS enumeration including zone transfers and brute-force."""
        guardrails.enforce("dnsrecon", target)
        cmd = ["dnsrecon", "-d", target]
        output = await asyncio.to_thread(run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "dnsrecon", cmd, output)
        return json.dumps({"tool": "dnsrecon", "target": target, "output": output})

    @mcp.tool()
    async def subfinder_enum(target: str) -> str:
        """Discover subdomains using subfinder passive enumeration."""
        guardrails.enforce("subfinder", target)
        cmd = ["subfinder", "-d", target, "-silent"]
        output = await asyncio.to_thread(run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "subfinder", cmd, output)
        subdomains = [line.strip() for line in output.splitlines() if line.strip()]
        return json.dumps({"tool": "subfinder", "target": target, "subdomains": subdomains, "count": len(subdomains)})

    @mcp.tool()
    async def amass_enum(target: str) -> str:
        """Run Amass passive subdomain enumeration on a target domain."""
        guardrails.enforce("amass", target)
        cmd = ["amass", "enum", "-d", target, "-nocolor", "-passive"]
        output = await asyncio.to_thread(run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "amass", cmd, output)
        subdomains = [line.strip() for line in output.splitlines() if line.strip()]
        return json.dumps({"tool": "amass", "target": target, "subdomains": subdomains, "count": len(subdomains)})

    @mcp.tool()
    async def nmap_scan(target: str, scan_type: str = "tcp_connect", ports: str = "all") -> str:
        """Port scan a target using nmap. scan_type: tcp_connect, syn, or udp. ports: all, top-1000, or a custom range like 80,443,8080."""
        guardrails.enforce("nmap", target)
        cmd = ["nmap"]
        if scan_type == "tcp_connect":
            cmd.append("-sT")
        elif scan_type == "syn":
            cmd.append("-sS")
        elif scan_type == "udp":
            cmd.append("-sU")
        if ports == "all":
            cmd.append("-p-")
        elif ports != "top-1000":
            cmd.extend(["-p", ports])
        cmd.extend(["-T4", "-Pn", target])

        output = await asyncio.to_thread(run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "nmap", cmd, output)

        from modules.recon import extract_ports_for_chaining
        open_ports = extract_ports_for_chaining(output)
        target_dir = get_target_dir(target)
        os.makedirs(target_dir, exist_ok=True)
        with open(os.path.join(target_dir, "exploitable_ports.json"), "w") as f:
            json.dump(open_ports, f)

        return json.dumps({"tool": "nmap", "target": target, "open_ports": open_ports, "output": output})

    @mcp.tool()
    async def curl_headers(target: str) -> str:
        """Fetch HTTP response headers from a target URL using curl."""
        guardrails.enforce("curl", target)
        cmd = ["curl", "-I", "--max-time", "10", target]
        output = await asyncio.to_thread(run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "curl_headers", cmd, output)
        return json.dumps({"tool": "curl_headers", "target": target, "output": output})

    @mcp.tool()
    async def whatweb_scan(target: str) -> str:
        """Identify web technologies, CMS, frameworks, and server software using WhatWeb."""
        guardrails.enforce("whatweb", target)
        cmd = ["whatweb", target]
        output = await asyncio.to_thread(run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "whatweb", cmd, output)
        return json.dumps({"tool": "whatweb", "target": target, "output": output})

    @mcp.tool()
    async def wafw00f_scan(target: str) -> str:
        """Detect web application firewalls (WAF) protecting a target using wafw00f."""
        guardrails.enforce("wafw00f", target)
        cmd = ["wafw00f", target]
        output = await asyncio.to_thread(run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "wafw00f", cmd, output)
        return json.dumps({"tool": "wafw00f", "target": target, "output": output})

    @mcp.tool()
    async def nikto_scan(target: str) -> str:
        """Run Nikto web server vulnerability scanner against a target."""
        guardrails.enforce("nikto", target)
        cmd = ["nikto", "-host", target]
        output = await asyncio.to_thread(run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "nikto", cmd, output)
        return json.dumps({"tool": "nikto", "target": target, "output": output})

    @mcp.tool()
    async def httpx_probe(target: str) -> str:
        """Probe HTTP/HTTPS endpoints using httpx with technology detection and status codes."""
        guardrails.enforce("httpx", target)
        target_dir = get_target_dir(target)
        os.makedirs(target_dir, exist_ok=True)

        from modules.recon import run_httpx_input_mode
        await asyncio.to_thread(run_httpx_input_mode, target, target_dir)

        httpx_file = os.path.join(target_dir, "httpx.json")
        if os.path.exists(httpx_file):
            with open(httpx_file) as f:
                try:
                    data = json.load(f)
                except json.JSONDecodeError:
                    data = {}
            save_result(target, "httpx", ["httpx", target], json.dumps(data))
            return json.dumps({"tool": "httpx", "target": target, "results": data})
        return json.dumps({"tool": "httpx", "target": target, "results": {}})

    @mcp.tool()
    async def run_full_recon(target: str) -> str:
        """Run the complete layered reconnaissance pipeline against a target. This runs all recon tools (whois, dig, nmap, subfinder, amass, nikto, etc.) and compiles results."""
        guardrails.enforce("nmap", target)
        from modules.recon import run_recon_layered
        results = await asyncio.to_thread(run_recon_layered, target)
        return json.dumps({"tool": "full_recon", "target": target, "results": results})
