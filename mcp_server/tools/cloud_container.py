# cstrike/mcp_server/tools/cloud_container.py — Cloud & container security tools

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from modules.utils import run_command_with_log, save_result, get_target_dir


def register(mcp, guardrails):

    @mcp.tool()
    async def trivy_scan(image: str, severity: str = "CRITICAL,HIGH",
                         format: str = "json") -> str:
        """Scan a container image for vulnerabilities using Trivy. severity:
        comma-separated (CRITICAL, HIGH, MEDIUM, LOW, UNKNOWN). Returns
        structured JSON by default."""
        guardrails.enforce("trivy", image)

        cmd = ["trivy", "image", "--severity", severity,
               "-f", format, image]

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())
        save_result(image, "trivy", cmd, output)

        if format == "json":
            try:
                data = json.loads(output)
                return json.dumps({"tool": "trivy", "image": image,
                                   "results": data})
            except json.JSONDecodeError:
                pass

        return json.dumps({"tool": "trivy", "image": image,
                           "output": output})

    @mcp.tool()
    async def kube_hunter_scan(target: str = "", cidr: str = "",
                               active: bool = False) -> str:
        """Scan Kubernetes clusters for security weaknesses using kube-hunter.
        target: API server address. cidr: network CIDR to scan. active=true
        enables exploitation of findings (requires exploit gate)."""
        if target:
            guardrails.enforce("kube-hunter", target)
        if active and not guardrails.check_exploitation_allowed():
            return json.dumps({"error": "Exploitation is disabled — active scanning requires allow_exploitation."})

        cmd = ["kube-hunter", "--report", "json"]
        if target:
            cmd.extend(["--remote", target])
        elif cidr:
            cmd.extend(["--cidr", cidr])
        if active:
            cmd.append("--active")

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())

        save_result(target or cidr or "cluster", "kube_hunter", cmd, output)

        try:
            data = json.loads(output)
            return json.dumps({"tool": "kube-hunter",
                               "target": target or cidr or "cluster",
                               "results": data})
        except json.JSONDecodeError:
            return json.dumps({"tool": "kube-hunter",
                               "target": target or cidr or "cluster",
                               "output": output})

    @mcp.tool()
    async def gowitness_screenshot(url: str = "", file: str = "",
                                   nmap_file: str = "") -> str:
        """Take screenshots of web pages using gowitness. Provide a single url,
        a file with one URL per line, or an nmap XML file for batch capture."""
        target = url or file or nmap_file
        guardrails.enforce("gowitness", target)

        cmd = ["gowitness"]
        if url:
            cmd.extend(["scan", "single", "-u", url])
        elif file:
            cmd.extend(["scan", "file", "-f", file])
        elif nmap_file:
            cmd.extend(["scan", "nmap", "-f", nmap_file])
        else:
            return json.dumps({"error": "Provide url, file, or nmap_file."})
        cmd.append("--write-db")

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "gowitness", cmd, output)
        return json.dumps({"tool": "gowitness", "target": target,
                           "output": output})

    @mcp.tool()
    async def eyewitness_scan(file: str, web: bool = True,
                              timeout: int = 10) -> str:
        """Take screenshots and gather header info for a list of URLs using
        EyeWitness. file: path to file with URLs. Returns output directory."""
        guardrails.enforce("eyewitness", file)

        target_safe = os.path.basename(file).replace(".", "_")
        out_dir = f"/tmp/eyewitness_{target_safe}"
        cmd = ["eyewitness", "-f", file, "-d", out_dir,
               "--timeout", str(timeout), "--no-prompt"]
        if web:
            cmd.append("--web")

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())
        save_result(file, "eyewitness", cmd, output)
        return json.dumps({"tool": "eyewitness", "file": file,
                           "output_dir": out_dir, "output": output})
