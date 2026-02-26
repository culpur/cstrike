#!/usr/bin/env python3
"""CStrike — Autonomous penetration testing orchestrator.

Single entry point: starts services, validates config, launches TUI or
runs headless pipeline.

Usage:
    python cstrike.py              # Start services + TUI (default)
    python cstrike.py --headless   # Start services + run pipeline in text mode
    python cstrike.py -t target    # Override target, launch TUI
    python cstrike.py --no-services # TUI only, assume services running
    python cstrike.py status       # Print service status and exit
    python cstrike.py stop         # Stop all managed services
"""

import logging
import sys
from pathlib import Path

import click

# Ensure logs directory exists
Path("logs").mkdir(exist_ok=True)

logging.basicConfig(
    filename="logs/driver.log",
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)


@click.group(invoke_without_command=True)
@click.option("-t", "--target", default=None, help="Override target scope")
@click.option("--headless", is_flag=True, help="Run pipeline without TUI")
@click.option("--no-services", is_flag=True, help="Skip service startup")
@click.pass_context
def cli(ctx, target, headless, no_services):
    """CStrike — autonomous penetration testing orchestrator."""
    ctx.ensure_object(dict)

    if ctx.invoked_subcommand is not None:
        return

    # Default action: start services + TUI (or headless pipeline)
    from config_validator import validate_or_exit
    from service_manager import ServiceManager

    config = validate_or_exit()

    # Override target if provided
    if target:
        config["target_scope"] = [target]

    svc_mgr = ServiceManager()
    svc_mgr.register_defaults(config)

    if headless:
        _run_headless(config, svc_mgr, no_services)
    else:
        _run_tui(config, svc_mgr, no_services)


def _run_headless(config: dict, svc_mgr, no_services: bool):
    """Start services and run pipeline in text mode (no TUI)."""
    from rich.console import Console
    from modules.driver import run_pipeline

    console = Console()

    if not no_services:
        console.print("[bold]Starting services...[/bold]")

        def on_status(name, status, detail):
            console.print(f"  [{status.value:>10}] {name}: {detail}")

        svc_mgr._on_status = on_status
        success = svc_mgr.start_parallel()

        if not success:
            console.print("[bold red]Required services failed to start.[/bold red]")
            svc_mgr.stop_all()
            sys.exit(1)

        console.print("[bold green]Services ready.[/bold green]\n")

    def on_phase(phase, status):
        console.print(f"  [{status:>7}] {phase}")

    try:
        console.print("[bold]Running pipeline...[/bold]")
        run_pipeline(config, on_phase=on_phase)
        console.print("\n[bold green]Pipeline complete.[/bold green]")
    except KeyboardInterrupt:
        console.print("\n[yellow]Interrupted.[/yellow]")
    finally:
        if not no_services:
            console.print("[dim]Stopping services...[/dim]")
            svc_mgr.stop_all()


def _run_tui(config: dict, svc_mgr, no_services: bool):
    """Launch the Textual TUI."""
    from tui.app import CStrikeApp

    app = CStrikeApp(
        config=config,
        service_manager=svc_mgr,
        no_services=no_services,
    )
    app.run()


@cli.command()
def status():
    """Print service status and exit."""
    from rich.console import Console
    from rich.table import Table
    from config_validator import validate_or_exit
    from service_manager import ServiceManager

    config = validate_or_exit()
    svc_mgr = ServiceManager()
    svc_mgr.register_defaults(config)

    console = Console()
    table = Table(title="CStrike Service Status")
    table.add_column("Service", style="cyan")
    table.add_column("Port", style="white")
    table.add_column("Status", style="white")
    table.add_column("PID", style="dim")

    statuses = svc_mgr.get_status()
    for name, info in statuses.items():
        status_val = info["status"]
        style = {
            "healthy": "green",
            "unhealthy": "yellow",
            "failed": "red",
            "stopped": "dim",
            "starting": "yellow",
        }.get(status_val, "white")

        table.add_row(
            name,
            str(info["port"]),
            f"[{style}]{status_val}[/{style}]",
            str(info["pid"] or "-"),
        )

    console.print(table)


@cli.command()
def stop():
    """Stop all managed services."""
    from rich.console import Console
    from config_validator import validate_or_exit
    from service_manager import ServiceManager

    config = validate_or_exit()
    svc_mgr = ServiceManager()
    svc_mgr.register_defaults(config)

    console = Console()

    # Find running services by checking ports
    running = []
    for name, svc in svc_mgr.services.items():
        if svc_mgr.is_healthy(svc):
            running.append(name)
            console.print(f"  [yellow]Stopping {name} (port {svc.port})...[/yellow]")

    if not running:
        console.print("[dim]No managed services are running.[/dim]")
        return

    # For services we didn't start, we can't SIGTERM their PID.
    # Use pkill as fallback for externally-started services.
    import subprocess
    process_map = {
        "api_server": "api_server.py",
        "frontend": "vite",
        "msfrpcd": "msfrpcd",
        "zap": "zap",
    }

    for name in running:
        pattern = process_map.get(name, name)
        try:
            subprocess.run(
                ["pkill", "-f", pattern],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            console.print(f"  [green]Stopped {name}[/green]")
        except Exception as e:
            console.print(f"  [red]Failed to stop {name}: {e}[/red]")


if __name__ == "__main__":
    cli()
