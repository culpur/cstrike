"""Startup screen — service boot progress with per-service status."""

from __future__ import annotations

import logging

from textual.app import ComposeResult
from textual.containers import Vertical
from textual.screen import Screen
from textual.widgets import Label, RichLog, Static

from service_manager import ServiceManager, ServiceStatus

logger = logging.getLogger("cstrike.tui.startup")

# Status indicator characters
_DOTS = {
    ServiceStatus.STOPPED: ("○", "status-stopped"),
    ServiceStatus.STARTING: ("◌", "status-starting"),
    ServiceStatus.HEALTHY: ("●", "status-healthy"),
    ServiceStatus.UNHEALTHY: ("◑", "status-failed"),
    ServiceStatus.FAILED: ("✗", "status-failed"),
}


class StartupScreen(Screen):
    """Boot screen showing service startup progress."""

    def __init__(self, config: dict, svc_mgr: ServiceManager) -> None:
        super().__init__()
        self.config = config
        self.svc_mgr = svc_mgr
        self._service_labels: dict[str, Label] = {}

    def compose(self) -> ComposeResult:
        with Vertical(id="startup-container"):
            yield Label("CStrike — Starting Services", id="startup-title")

            # One row per registered service
            for name, svc in self.svc_mgr.services.items():
                dot, css_class = _DOTS[svc.status]
                label = Label(
                    f"  {dot}  {name:<16} port {svc.port}",
                    classes=f"service-row {css_class}",
                )
                self._service_labels[name] = label
                yield label

            yield RichLog(id="startup-log", highlight=True, markup=True)

    def on_mount(self) -> None:
        """Start services in a background worker."""
        self.run_worker(self._boot_services, thread=True)

    async def _boot_services(self) -> None:
        """Worker: start all services with status callback."""
        log_widget = self.query_one("#startup-log", RichLog)

        def on_status(name: str, status: ServiceStatus, detail: str):
            self.call_from_thread(self._update_service_row, name, status, detail)
            self.call_from_thread(log_widget.write, f"[{status.value:>10}] {name}: {detail}")

        # Wire callback into service manager
        self.svc_mgr._on_status = on_status

        self.call_from_thread(log_widget.write, "[bold]Starting services...[/bold]")
        success = self.svc_mgr.start_parallel()

        if success:
            self.call_from_thread(log_widget.write, "\n[bold green]All required services healthy.[/bold green]")
            self.call_from_thread(self._transition_to_dashboard)
        else:
            # Check if any required service failed
            failed = [
                name for name, svc in self.svc_mgr.services.items()
                if svc.status == ServiceStatus.FAILED and not svc.optional
            ]
            if failed:
                self.call_from_thread(
                    log_widget.write,
                    f"\n[bold red]Required services failed: {', '.join(failed)}[/bold red]"
                )
                self.call_from_thread(
                    log_widget.write,
                    "[dim]Press q to quit, or wait for manual start.[/dim]"
                )
            else:
                # Only optional services failed — proceed
                self.call_from_thread(
                    log_widget.write,
                    "\n[bold yellow]Some optional services unavailable.[/bold yellow]"
                )
                self.call_from_thread(self._transition_to_dashboard)

    def _update_service_row(self, name: str, status: ServiceStatus, detail: str) -> None:
        """Update the label for a service row."""
        if name not in self._service_labels:
            return
        svc = self.svc_mgr.services.get(name)
        if not svc:
            return
        dot, css_class = _DOTS.get(status, ("?", "status-stopped"))
        label = self._service_labels[name]
        label.update(f"  {dot}  {name:<16} {detail}")
        # Reset classes and apply new status class
        label.set_classes(f"service-row {css_class}")

    def _transition_to_dashboard(self) -> None:
        """Post ServicesReady message to trigger screen switch."""
        from tui.app import ServicesReady
        self.app.post_message(ServicesReady())
