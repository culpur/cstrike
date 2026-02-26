"""CStrike TUI — main Textual application.

Manages screen transitions, keybindings, and worker lifecycle.
The ServiceManager and config are injected at construction.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.message import Message

from service_manager import ServiceManager, ServiceStatus
from tui.screens.startup import StartupScreen
from tui.screens.dashboard import DashboardScreen

logger = logging.getLogger("cstrike.tui")

CSS_PATH = Path(__file__).parent / "app.tcss"


# ── Messages passed from workers to the UI ─────────────────────────────────

class ServiceStatusChanged(Message):
    """A managed service changed status."""
    def __init__(self, name: str, status: ServiceStatus, detail: str = "") -> None:
        super().__init__()
        self.service_name = name
        self.status = status
        self.detail = detail


class PhaseChanged(Message):
    """Pipeline phase changed."""
    def __init__(self, phase: str, status: str) -> None:
        super().__init__()
        self.phase = phase
        self.status = status


class LogEntry(Message):
    """A new log line to display."""
    def __init__(self, line: str, level: str = "info") -> None:
        super().__init__()
        self.line = line
        self.level = level


class AIThought(Message):
    """An AI reasoning step."""
    def __init__(self, thought: str) -> None:
        super().__init__()
        self.thought = thought


class LootUpdated(Message):
    """Loot/findings data changed."""
    def __init__(self, category: str = "", value: str = "") -> None:
        super().__init__()
        self.category = category
        self.value = value


class PipelineFinished(Message):
    """Pipeline run completed."""
    pass


class ServicesReady(Message):
    """All required services are healthy."""
    pass


# ── Application ─────────────────────────────────────────────────────────────

class CStrikeApp(App):
    """CStrike terminal UI application."""

    TITLE = "CStrike"
    CSS_PATH = CSS_PATH

    BINDINGS = [
        Binding("q", "quit_app", "Quit", priority=True),
        Binding("d", "switch_tab('dashboard')", "Dashboard", show=True),
        Binding("l", "switch_tab('logs')", "Logs", show=True),
        Binding("a", "switch_tab('ai')", "AI", show=True),
        Binding("f", "switch_tab('findings')", "Findings", show=True),
        Binding("s", "start_scan", "Scan", show=True),
        Binding("r", "refresh_status", "Refresh", show=True),
    ]

    def __init__(
        self,
        config: dict,
        service_manager: ServiceManager,
        no_services: bool = False,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self.config = config
        self.svc_mgr = service_manager
        self.no_services = no_services
        self._pipeline_running = False

    def on_mount(self) -> None:
        """Show startup screen (or jump to dashboard if --no-services)."""
        if self.no_services:
            self.push_screen(DashboardScreen(self.config, self.svc_mgr))
        else:
            self.push_screen(StartupScreen(self.config, self.svc_mgr))

    # ── Actions ──────────────────────────────────────

    def action_quit_app(self) -> None:
        """Graceful shutdown: stop services, then exit."""
        self.log.info("Shutting down services...")
        self.svc_mgr.stop_all()
        self.exit()

    def action_switch_tab(self, tab: str) -> None:
        """Switch the active tab on the dashboard."""
        screen = self.screen
        if isinstance(screen, DashboardScreen):
            screen.switch_tab(tab)

    def action_start_scan(self) -> None:
        """Trigger a pipeline scan from the TUI."""
        if self._pipeline_running:
            self.notify("Pipeline already running", severity="warning")
            return
        screen = self.screen
        if isinstance(screen, DashboardScreen):
            screen.start_pipeline()
            self._pipeline_running = True

    def action_refresh_status(self) -> None:
        """Refresh service status indicators."""
        screen = self.screen
        if isinstance(screen, DashboardScreen):
            screen.refresh_services()

    # ── Message handlers ─────────────────────────────

    def on_services_ready(self, message: ServicesReady) -> None:
        """Transition from startup screen to dashboard."""
        self.pop_screen()
        self.push_screen(DashboardScreen(self.config, self.svc_mgr))

    def on_pipeline_finished(self, message: PipelineFinished) -> None:
        self._pipeline_running = False
        self.notify("Pipeline complete", severity="information")
