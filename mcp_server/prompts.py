# cstrike/mcp_server/prompts.py — MCP prompt templates for CStrike

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from modules.utils import load_results, get_target_dir
from modules.loot_tracker import get_loot


def _load_target_data(target):
    """Load all available data for a target."""
    results = load_results(target)
    target_dir = get_target_dir(target)

    loot = {}
    loot_path = os.path.join(target_dir, "loot.json")
    if os.path.exists(loot_path):
        with open(loot_path) as f:
            try:
                loot = json.load(f)
            except json.JSONDecodeError:
                pass

    ports = []
    ports_path = os.path.join(target_dir, "exploitable_ports.json")
    if os.path.exists(ports_path):
        with open(ports_path) as f:
            try:
                ports = json.load(f)
            except json.JSONDecodeError:
                pass

    vulnapi = {}
    vulnapi_path = os.path.join(target_dir, "vulnapi_results.json")
    if os.path.exists(vulnapi_path):
        with open(vulnapi_path) as f:
            try:
                vulnapi = json.load(f)
            except json.JSONDecodeError:
                pass

    creds = []
    creds_path = os.path.join(target_dir, "credentials.json")
    if os.path.exists(creds_path):
        with open(creds_path) as f:
            try:
                creds = json.load(f)
            except json.JSONDecodeError:
                pass

    return {
        "results": results,
        "loot": loot,
        "ports": ports,
        "vulnapi": vulnapi,
        "credentials": creds,
    }


def register(mcp):

    @mcp.prompt()
    def analyze_recon(target: str) -> str:
        """Analyze reconnaissance results for a target and suggest next steps."""
        data = _load_target_data(target)
        results_preview = json.dumps(data["results"], indent=2)[:7000]
        return (
            f"You are analyzing reconnaissance results for target: {target}\n\n"
            f"Recon data:\n{results_preview}\n\n"
            f"Open ports: {json.dumps(data['ports'])}\n\n"
            f"Based on this reconnaissance data, analyze:\n"
            f"1. What services and technologies are running?\n"
            f"2. What potential attack vectors exist?\n"
            f"3. What additional reconnaissance would be valuable?\n"
            f"4. Suggest specific tools and commands to run next.\n"
            f"Use the available MCP tools to execute your suggestions."
        )

    @mcp.prompt()
    def plan_exploitation(target: str) -> str:
        """Plan an exploitation strategy based on recon and loot data."""
        data = _load_target_data(target)
        results_preview = json.dumps(data["results"], indent=2)[:5000]
        loot_preview = json.dumps(data["loot"], indent=2)[:2000]
        return (
            f"You are planning exploitation for target: {target}\n\n"
            f"Recon results:\n{results_preview}\n\n"
            f"Open ports: {json.dumps(data['ports'])}\n"
            f"Discovered loot:\n{loot_preview}\n\n"
            f"Plan an exploitation strategy:\n"
            f"1. Prioritize attack vectors by likelihood of success\n"
            f"2. Identify which tools to use for each vector\n"
            f"3. Plan credential reuse attacks if credentials are available\n"
            f"4. Suggest API security testing if web APIs were detected\n"
            f"Execute your plan using the available MCP tools."
        )

    @mcp.prompt()
    def post_exploitation_analysis(target: str) -> str:
        """Analyze post-exploitation results and suggest lateral movement."""
        data = _load_target_data(target)
        loot_preview = json.dumps(data["loot"], indent=2)[:3000]
        creds_preview = json.dumps(data["credentials"], indent=2)[:2000]
        return (
            f"You are analyzing post-exploitation results for target: {target}\n\n"
            f"Discovered loot:\n{loot_preview}\n\n"
            f"Credentials found:\n{creds_preview}\n\n"
            f"Analyze the findings and suggest:\n"
            f"1. Credential reuse opportunities across services\n"
            f"2. Lateral movement paths based on discovered data\n"
            f"3. Privilege escalation vectors\n"
            f"4. Additional targets to pivot to\n"
            f"Use MCP tools to validate credentials and attempt lateral movement."
        )

    @mcp.prompt()
    def credential_analysis(target: str) -> str:
        """Analyze and prioritize discovered credentials."""
        data = _load_target_data(target)
        creds_preview = json.dumps(data["credentials"], indent=2)[:3000]
        usernames = data["loot"].get("usernames", [])
        passwords = data["loot"].get("passwords", [])
        return (
            f"Credential analysis for target: {target}\n\n"
            f"Stored credentials:\n{creds_preview}\n\n"
            f"Discovered usernames: {json.dumps(usernames)}\n"
            f"Discovered passwords: {json.dumps(passwords)}\n"
            f"Open ports: {json.dumps(data['ports'])}\n\n"
            f"Analyze these credentials:\n"
            f"1. Score each credential by priority using score_credential\n"
            f"2. Generate a credential heatmap\n"
            f"3. Validate unvalidated credentials against available services\n"
            f"4. Identify credential reuse opportunities"
        )

    @mcp.prompt()
    def api_security_review(target: str) -> str:
        """Review API security scan results."""
        data = _load_target_data(target)
        vulnapi_preview = json.dumps(data["vulnapi"], indent=2)[:5000]
        return (
            f"API security review for target: {target}\n\n"
            f"VulnAPI scan results:\n{vulnapi_preview}\n\n"
            f"Review the API security findings:\n"
            f"1. Categorize findings by OWASP API Top 10\n"
            f"2. Assess severity and exploitability\n"
            f"3. Suggest additional API endpoints to test\n"
            f"4. Recommend remediation priorities\n"
            f"Use vulnapi_curl_scan or vulnapi_openapi_scan for additional testing."
        )

    @mcp.prompt()
    def generate_report(target: str) -> str:
        """Generate a comprehensive penetration test report."""
        data = _load_target_data(target)
        results_preview = json.dumps(data["results"], indent=2)[:4000]
        loot_preview = json.dumps(data["loot"], indent=2)[:2000]
        vulnapi_preview = json.dumps(data["vulnapi"], indent=2)[:2000]
        creds_preview = json.dumps(data["credentials"], indent=2)[:1000]
        return (
            f"Generate a penetration test report for target: {target}\n\n"
            f"Recon results:\n{results_preview}\n\n"
            f"Exploitation loot:\n{loot_preview}\n\n"
            f"API security findings:\n{vulnapi_preview}\n\n"
            f"Credentials:\n{creds_preview}\n\n"
            f"Create a structured report covering:\n"
            f"1. Executive summary\n"
            f"2. Methodology (tools used, phases completed)\n"
            f"3. Findings by severity (critical, high, medium, low)\n"
            f"4. Credentials discovered and validated\n"
            f"5. Recommendations and remediation priorities"
        )
