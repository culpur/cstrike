# cstrike/mcp_server/guardrails.py

from .config import get_config


class GuardrailViolation(Exception):
    """Raised when a guardrail check fails."""
    pass


# Tool-to-scan-mode mapping (ported from run_command.py)
TOOL_MODE_MAP = {
    "port":        ["nmap", "masscan"],
    "http":        ["curl", "httpx", "httprobe", "whatweb", "nikto", "wafw00f",
                    "shcheck", "wpscan", "aquatone"],
    "dirbusting":  ["ffuf", "gobuster", "feroxbuster"],
    "dns":         ["dig", "traceroute", "host", "dnsrecon", "whois"],
    "subdomain":   ["subfinder", "amass", "theHarvester"],
    "osint":       ["theHarvester", "shodan", "sherlock"],
    "vulnscan":    ["enum4linux-ng", "wpscan", "nikto", "nuclei"],
    "apiscan":     ["vulnapi"],
    "web_exploit": ["sqlmap", "xsstrike", "commix", "gobuster", "feroxbuster",
                    "arjun", "jwt_tool.py"],
    "smb":         ["smbmap", "rpcclient", "enum4linux-ng",
                    "impacket-psexec", "impacket-smbexec"],
    "ldap":        ["ldapsearch"],
    "snmp":        ["snmpwalk", "onesixtyone"],
    "network":     ["masscan", "rustscan"],
    "ssl":         ["testssl", "sslscan", "sslyze"],
    "password":    ["hashcat", "john", "cewl", "hashid"],
    "cloud":       ["trivy", "kube-hunter", "gowitness", "eyewitness"],
    "lateral":     ["impacket-secretsdump", "impacket-psexec",
                    "impacket-wmiexec", "impacket-smbexec",
                    "impacket-GetUserSPNs",
                    "chisel", "responder", "bloodhound-python",
                    "proxychains4"],
    "credentials": ["cstrike-credentials", "hydra"],
}

EXPLOITATION_TOOLS = [
    "hydra", "msfconsole", "msfrpcd", "sqlmap",
    "commix", "xsstrike",
    "impacket-secretsdump", "impacket-psexec",
    "impacket-wmiexec", "impacket-smbexec", "impacket-GetUserSPNs",
    "responder", "chisel", "bloodhound-python",
]


class CStrikeGuardrails:
    """Enforces scope, allowlist, and timeout constraints on tool execution."""

    def __init__(self, config=None):
        self._config = config or get_config()

    @property
    def config(self):
        return self._config

    def validate_target(self, target):
        """Check target is within configured scope."""
        scope = self.config.get("target_scope", [])
        if not scope:
            return True
        return any(s in target for s in scope)

    def validate_tool(self, tool_name):
        """Check tool is on the allowlist."""
        allowed = self.config.get("allowed_tools", [])
        if not allowed:
            return True
        return tool_name in allowed

    def validate_mode(self, tool_name):
        """Check scan mode is enabled for this tool type."""
        modes = self.config.get("scan_modes", [])

        # Check mode mapping first (if modes are configured)
        if modes:
            mode_ok = True
            found_in_map = False
            for mode, tools in TOOL_MODE_MAP.items():
                if tool_name in tools:
                    found_in_map = True
                    if mode in modes:
                        mode_ok = True
                        break
                    mode_ok = False
            if found_in_map and not mode_ok:
                return False

        # Exploitation tools ALWAYS need allow_exploitation, regardless of
        # mode check result. This prevents tools like sqlmap/commix from
        # bypassing the exploitation gate just because they passed mode check.
        if tool_name in EXPLOITATION_TOOLS:
            return self.config.get("allow_exploitation", False)

        # Unknown tools pass mode check (caught by allowlist)
        return True

    def check_exploitation_allowed(self):
        """Check if active exploitation is enabled."""
        return self.config.get("allow_exploitation", False)

    def get_timeout(self):
        """Return configured max_runtime."""
        return self.config.get("max_runtime", 300)

    def enforce(self, tool_name, target=None):
        """Enforce all guardrails. Raises GuardrailViolation on failure."""
        if target and not self.validate_target(target):
            raise GuardrailViolation(
                f"Target '{target}' is out of scope. "
                f"Allowed: {self.config.get('target_scope', [])}"
            )

        if not self.validate_tool(tool_name):
            raise GuardrailViolation(
                f"Tool '{tool_name}' is not in the allowed tools list."
            )

        if not self.validate_mode(tool_name):
            raise GuardrailViolation(
                f"Tool '{tool_name}' is not enabled in current scan_modes."
            )
