"""CStrike pipeline driver — extracted from cstrike.py.

Runs the penetration testing pipeline in either classic (hardcoded phases)
or agentic (MCP tool-calling) mode. Designed to be called from both the
Click CLI and the Textual TUI worker.

Emits PhaseChanged / LogEntry callbacks so the TUI can update in real time.
"""

import json
import logging
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from modules.recon import run_recon_layered
from modules.exploitation import run_exploitation_chain
from modules.zap_burp import start_zap, start_burp, run_web_scans
from modules.metasploit import start_msf_rpc, run_msf_exploits
from modules.ai_assistant import ask_ai, ask_ai_with_tools, parse_ai_commands
from modules.loot_tracker import get_loot
from modules.vulnapi import run_vulnapi_full_scan

logger = logging.getLogger("cstrike.driver")

# MCP agentic mode (optional)
try:
    from mcp_server.server import get_mcp_tool_definitions, execute_mcp_tool_sync
    MCP_AVAILABLE = True
except ImportError:
    MCP_AVAILABLE = False

# Pipeline phases
PHASES = [
    "recon",
    "ai_analysis",
    "web_scanning",
    "vulnapi",
    "metasploit",
    "exploitation",
    "ai_followup",
    "reporting",
]

# Callbacks for TUI integration
PhaseCallback = Callable[[str, str], None]  # (phase, status)


def is_process_running(name: str) -> bool:
    """Check if a process matching name is running."""
    try:
        result = subprocess.run(
            ["pgrep", "-f", name],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return result.returncode == 0
    except FileNotFoundError:
        return False


def execute_ai_commands(
    commands: list,
    log_path: Path,
    trigger_exploitation: bool = False,
    target: str = None,
    target_dir: Path = None,
):
    """Execute AI-suggested shell commands and log results."""
    command_logs = []

    for cmd in commands:
        log_entry = {
            "command": cmd,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        try:
            logger.info(f"[AI -> Command] {' '.join(cmd)}")
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=300,
            )
            log_entry["status"] = "success" if result.returncode == 0 else "fail"
            log_entry["stdout"] = result.stdout.strip()
            log_entry["stderr"] = result.stderr.strip()

            if trigger_exploitation and any(
                tool in cmd for tool in ["nuclei", "sqlmap", "ffuf"]
            ):
                logger.info("[AI Trigger] Auto-running exploitation chain.")
                if target and target_dir:
                    run_exploitation_chain(target, target_dir)

        except Exception as e:
            log_entry["status"] = "error"
            log_entry["stderr"] = str(e)
        command_logs.append(log_entry)

    log_path.write_text(json.dumps(command_logs, indent=2))


def run_agentic(
    target: str,
    target_dir: Path,
    config: dict,
    on_phase: Optional[PhaseCallback] = None,
):
    """MCP agentic mode — AI drives the workflow via tool calls."""
    _notify = on_phase or (lambda *a: None)

    _notify("recon", "running")
    logger.info(f"[MCP] Running agentic mode for {target}")
    recon_results = run_recon_layered(target)
    _notify("recon", "done")

    _notify("ai_analysis", "running")
    result = ask_ai_with_tools(
        recon_results,
        tool_executor=execute_mcp_tool_sync,
        target=target,
        max_iterations=config.get("ai_max_iterations", 15),
    )

    if result:
        (target_dir / "ai_agentic_result.json").write_text(
            json.dumps(
                {
                    "mode": "agentic",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "result": result,
                },
                indent=2,
            )
        )
    _notify("ai_analysis", "done")
    _notify("reporting", "done")

    logger.info(f"[MCP] Agentic mode complete for {target}")


def run_classic(
    target: str,
    target_dir: Path,
    config: dict,
    on_phase: Optional[PhaseCallback] = None,
):
    """Classic hardcoded pipeline — text-mode AI suggestions parsed into shell commands."""
    _notify = on_phase or (lambda *a: None)

    # Phase 1: Recon
    _notify("recon", "running")
    recon_results = run_recon_layered(target)
    _notify("recon", "done")

    # Phase 2: First AI suggestions
    _notify("ai_analysis", "running")
    ai_response = ask_ai(recon_results)
    commands = parse_ai_commands(ai_response)

    timestamp = datetime.now(timezone.utc).isoformat()
    (target_dir / "ai_suggestions.json").write_text(
        json.dumps(
            {
                "stage": "post_recon",
                "timestamp": timestamp,
                "response": ai_response,
                "commands": commands,
            },
            indent=2,
        )
    )

    execute_ai_commands(
        commands,
        target_dir / "ai_commands_post_recon.json",
        trigger_exploitation=True,
        target=target,
        target_dir=target_dir,
    )
    _notify("ai_analysis", "done")

    # Phase 3: Web scanning (ZAP/Burp)
    _notify("web_scanning", "running")
    if not is_process_running("zap"):
        start_zap()
    else:
        logger.info("[~] ZAP is already running")
    if not is_process_running("burpsuite"):
        start_burp()
    else:
        logger.info("[~] Burp Suite is already running")
    run_web_scans(target, target_dir)
    _notify("web_scanning", "done")

    # Phase 4: VulnAPI
    _notify("vulnapi", "running")
    logger.info(f"[+] Running VulnAPI scan for {target}")
    run_vulnapi_full_scan(target)
    _notify("vulnapi", "done")

    # Phase 5: Metasploit
    _notify("metasploit", "running")
    msf_client = start_msf_rpc()
    if msf_client:
        run_msf_exploits(msf_client, target)
    _notify("metasploit", "done")

    # Phase 6: Exploitation chain
    _notify("exploitation", "running")
    run_exploitation_chain(target, target_dir)
    _notify("exploitation", "done")

    # Phase 7: Second AI pass
    _notify("ai_followup", "running")
    loot = {
        "usernames": get_loot(target, "username"),
        "passwords": get_loot(target, "password"),
        "protocols": get_loot(target, "protocol"),
        "api_vulnerabilities": get_loot(target, "vulnerability"),
    }

    ai_followup = ask_ai({"recon": recon_results, "loot": loot})
    followup_commands = parse_ai_commands(ai_followup)

    (target_dir / "ai_suggestions_followup.json").write_text(
        json.dumps(
            {
                "stage": "post_exploitation",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "response": ai_followup,
                "commands": followup_commands,
            },
            indent=2,
        )
    )

    execute_ai_commands(
        followup_commands,
        target_dir / "ai_commands_post_exploitation.json",
        trigger_exploitation=True,
        target=target,
        target_dir=target_dir,
    )
    _notify("ai_followup", "done")

    _notify("reporting", "done")
    logger.info(f"[+] Completed all phases for {target}")


def run_pipeline(
    config: dict,
    on_phase: Optional[PhaseCallback] = None,
):
    """Run the full pipeline for all configured targets.

    Args:
        config: Validated config dict.
        on_phase: Optional callback (phase, status) for TUI updates.
    """
    use_mcp = config.get("mcp_enabled", False) and MCP_AVAILABLE
    targets = config.get("target_scope", [])

    if use_mcp:
        logger.info("[+] MCP agentic mode enabled")
    else:
        logger.info("[+] Classic pipeline mode")

    for target in targets:
        logger.info(f"[+] Starting target: {target}")

        target_dir = Path("results") / target
        target_dir.mkdir(parents=True, exist_ok=True)

        if use_mcp:
            run_agentic(target, target_dir, config, on_phase)
        else:
            run_classic(target, target_dir, config, on_phase)
