# cstrike/mcp_server/tools/network_enum.py — Network enumeration tools

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from modules.utils import run_command_with_log, save_result, get_target_dir


def register(mcp, guardrails):

    @mcp.tool()
    async def enum4linux_scan(target: str, username: str = "",
                              password: str = "") -> str:
        """Run enum4linux-ng for full SMB/NetBIOS/RPC enumeration. Returns
        structured JSON with users, groups, shares, and OS info."""
        guardrails.enforce("enum4linux-ng", target)

        target_safe = target.replace(".", "_").replace("/", "_")
        out_file = f"/tmp/enum4linux_{target_safe}.json"
        cmd = ["enum4linux-ng", "-A", "-oJ", out_file, target]
        if username:
            cmd.extend(["-u", username])
        if password:
            cmd.extend(["-p", password])

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())

        if os.path.exists(out_file):
            with open(out_file) as f:
                data = json.load(f)
            save_result(target, "enum4linux", cmd, json.dumps(data))
            return json.dumps({"tool": "enum4linux-ng", "target": target,
                               "results": data})

        save_result(target, "enum4linux", cmd, output)
        return json.dumps({"tool": "enum4linux-ng", "target": target,
                           "output": output})

    @mcp.tool()
    async def smbmap_scan(target: str, username: str = "",
                          password: str = "", domain: str = "",
                          recursive: bool = False) -> str:
        """Enumerate SMB shares and permissions on a target. Set recursive=true
        to list directory contents of accessible shares."""
        guardrails.enforce("smbmap", target)

        cmd = ["smbmap", "-H", target]
        if username:
            cmd.extend(["-u", username])
        if password:
            cmd.extend(["-p", password])
        if domain:
            cmd.extend(["-d", domain])
        if recursive:
            cmd.append("-R")

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "smbmap", cmd, output)
        return json.dumps({"tool": "smbmap", "target": target,
                           "output": output})

    @mcp.tool()
    async def ldapsearch_query(target: str, base_dn: str,
                               filter: str = "(objectclass=*)",
                               bind_dn: str = "",
                               password: str = "") -> str:
        """Query an LDAP directory. base_dn: search root (e.g. DC=domain,DC=com).
        filter: LDAP search filter. bind_dn + password for authenticated queries,
        omit for anonymous bind."""
        guardrails.enforce("ldapsearch", target)

        cmd = ["ldapsearch", "-H", f"ldap://{target}", "-x",
               "-b", base_dn]
        if bind_dn:
            cmd.extend(["-D", bind_dn, "-w", password])
        cmd.append(filter)

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "ldapsearch", cmd, output)
        return json.dumps({"tool": "ldapsearch", "target": target,
                           "base_dn": base_dn, "output": output})

    @mcp.tool()
    async def snmpwalk_scan(target: str, community: str = "public",
                            version: str = "2c", oid: str = "") -> str:
        """Walk the SNMP MIB tree on a target. community: SNMP community string.
        version: 1, 2c, or 3. oid: specific OID subtree to walk."""
        guardrails.enforce("snmpwalk", target)

        cmd = ["snmpwalk", "-c", community, "-v", version, target]
        if oid:
            cmd.append(oid)

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "snmpwalk", cmd, output)
        return json.dumps({"tool": "snmpwalk", "target": target,
                           "community": community, "output": output})

    @mcp.tool()
    async def onesixtyone_scan(target: str,
                               community_file: str = "") -> str:
        """Brute-force SNMP community strings against a target using
        onesixtyone. community_file: path to wordlist of community strings."""
        guardrails.enforce("onesixtyone", target)

        cf = community_file or "/usr/share/doc/onesixtyone/dict.txt"
        cmd = ["onesixtyone", "-c", cf, target]

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "onesixtyone", cmd, output)
        return json.dumps({"tool": "onesixtyone", "target": target,
                           "output": output})

    @mcp.tool()
    async def rpcclient_enum(target: str, username: str = "",
                             password: str = "",
                             command: str = "enumdomusers") -> str:
        """Enumerate Windows RPC services via rpcclient. Uses null session when
        no credentials are provided. command: RPC command to execute
        (enumdomusers, enumdomgroups, querydominfo, netshareenum, etc.)."""
        guardrails.enforce("rpcclient", target)

        cmd = ["rpcclient", target, "-c", command]
        if username:
            cmd.extend(["-U", f"{username}%{password}"])
        else:
            cmd.append("-N")

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "rpcclient", cmd, output)
        return json.dumps({"tool": "rpcclient", "target": target,
                           "command": command, "output": output})

    @mcp.tool()
    async def masscan_scan(target: str, ports: str = "1-65535",
                           rate: int = 1000) -> str:
        """High-speed port scan using masscan. Scans the full port range by
        default at configurable rate. Requires sudo for raw sockets."""
        guardrails.enforce("masscan", target)

        target_safe = target.replace(".", "_").replace("/", "_")
        out_file = f"/tmp/masscan_{target_safe}.json"
        cmd = ["sudo", "masscan", target, "-p", ports,
               "--rate", str(rate), "-oJ", out_file]

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())

        if os.path.exists(out_file):
            with open(out_file) as f:
                raw = f.read()
            try:
                data = json.loads(raw)
                save_result(target, "masscan", cmd, json.dumps(data))
                return json.dumps({"tool": "masscan", "target": target,
                                   "ports": ports, "results": data})
            except json.JSONDecodeError:
                save_result(target, "masscan", cmd, raw)
                return json.dumps({"tool": "masscan", "target": target,
                                   "ports": ports, "output": raw})

        save_result(target, "masscan", cmd, output)
        return json.dumps({"tool": "masscan", "target": target,
                           "ports": ports, "output": output})

    # Allowlisted nmap flags for rustscan passthrough
    _ALLOWED_NMAP_FLAGS = {
        "-sV", "-sC", "-sS", "-sT", "-sU", "-sN", "-sF", "-sX",
        "-A", "-O", "-Pn", "-n", "--open", "--top-ports",
        "-p", "-T0", "-T1", "-T2", "-T3", "-T4", "-T5",
        "--version-intensity", "--min-rate", "--max-rate",
    }

    @mcp.tool()
    async def rustscan_scan(target: str, ports: str = "",
                            nmap_flags: str = "-sV") -> str:
        """Fast port scanner that pipes results to nmap for service detection.
        ports: specific ports (e.g. '80,443,8080') or empty for all.
        nmap_flags: safe nmap flags passed after -- separator."""
        guardrails.enforce("rustscan", target)

        cmd = ["rustscan", "-a", target]
        if ports:
            cmd.extend(["-p", ports])
        if nmap_flags:
            flags = nmap_flags.split()
            # Validate each flag against allowlist
            for flag in flags:
                base_flag = flag.split("=")[0] if "=" in flag else flag
                if base_flag not in _ALLOWED_NMAP_FLAGS and not base_flag.lstrip("-").isdigit():
                    return json.dumps({
                        "error": f"nmap flag '{flag}' is not allowed. "
                                 f"Allowed: {sorted(_ALLOWED_NMAP_FLAGS)}"
                    })
            cmd.append("--")
            cmd.extend(flags)

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())
        save_result(target, "rustscan", cmd, output)
        return json.dumps({"tool": "rustscan", "target": target,
                           "output": output})
