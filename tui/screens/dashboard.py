"""Dashboard screen — main operational view with tabbed layout and sidebar."""

from __future__ import annotations

import logging
import subprocess

import psutil
from textual.app import ComposeResult
from textual.containers import Horizontal, Vertical
from textual.screen import Screen
from textual.widgets import Label, Static, TabbedContent, TabPane
from textual.timer import Timer

from service_manager import ServiceManager, ServiceStatus
from tui.widgets.service_status import ServiceStatusPanel
from tui.widgets.target_table import TargetTable
from tui.widgets.log_viewer import LogViewer
from tui.widgets.ai_thoughts import AIThoughtsPanel
from tui.widgets.loot_summary import LootSummary

logger = logging.getLogger("cstrike.tui.dashboard")


def _get_vpn_ip() -> str:
    """Detect VPN IP from wg0 or tun0."""
    for iface in ("wg0", "tun0"):
        try:
            check = subprocess.run(
                ["ip", "link", "show", iface],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            if check.returncode != 0:
                # macOS fallback
                check = subprocess.run(
                    ["ifconfig", iface],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    text=True,
                )
                if check.returncode != 0:
                    continue
                for line in check.stdout.splitlines():
                    line = line.strip()
                    if line.startswith("inet "):
                        return line.split()[1]
            else:
                output = subprocess.check_output(
                    ["ip", "-4", "addr", "show", iface],
                    stderr=subprocess.DEVNULL,
                    text=True,
                )
                for line in output.splitlines():
                    line = line.strip()
                    if line.startswith("inet "):
                        return line.split()[1].split("/")[0]
        except (FileNotFoundError, subprocess.SubprocessError):
            continue
    return "N/A"


class DashboardScreen(Screen):
    """Main operational dashboard with tabs and service sidebar."""

    def __init__(self, config: dict, svc_mgr: ServiceManager) -> None:
        super().__init__()
        self.config = config
        self.svc_mgr = svc_mgr
        self._metrics_timer: Timer | None = None

    def compose(self) -> ComposeResult:
        # Header
        yield Label(
            "CStrike | VPN: ... | CPU: -% RAM: -%",
            id="header-bar",
        )

        with Horizontal(id="main-content"):
            # Sidebar
            with Vertical(id="sidebar"):
                yield Label("SERVICES", id="sidebar-services-title")
                yield ServiceStatusPanel(self.svc_mgr, id="sidebar-services")
                yield Label("PHASE", id="sidebar-phase-title")
                yield Label("  idle", id="phase-label")

            # Tabbed main content
            with TabbedContent(id="tab-content"):
                with TabPane("Dashboard", id="dashboard-pane"):
                    yield TargetTable(self.config)
                with TabPane("Logs", id="logs-pane"):
                    yield LogViewer()
                with TabPane("AI", id="ai-pane"):
                    yield AIThoughtsPanel()
                with TabPane("Findings", id="findings-pane"):
                    yield LootSummary(self.config)

        # Footer
        yield Label(
            " q:Quit  d:Dashboard  l:Logs  a:AI  f:Findings  s:Scan  r:Refresh",
            id="footer-bar",
        )

    def on_mount(self) -> None:
        """Start periodic metrics updates."""
        self._metrics_timer = self.set_interval(2.0, self._update_metrics)
        self._update_metrics()

    def _update_metrics(self) -> None:
        """Refresh header bar with VPN IP and system metrics."""
        try:
            cpu = psutil.cpu_percent(interval=0)
            ram = psutil.virtual_memory().percent
            vpn = _get_vpn_ip()
            header = self.query_one("#header-bar", Label)
            header.update(
                f"CStrike | VPN: {vpn} | CPU: {cpu:.0f}% RAM: {ram:.0f}%"
            )
        except Exception:
            pass

        # Refresh service status widget
        try:
            svc_panel = self.query_one(ServiceStatusPanel)
            svc_panel.refresh_status()
        except Exception:
            pass

    def switch_tab(self, tab_name: str) -> None:
        """Switch the active tab by name."""
        tab_map = {
            "dashboard": "dashboard-pane",
            "logs": "logs-pane",
            "ai": "ai-pane",
            "findings": "findings-pane",
        }
        pane_id = tab_map.get(tab_name)
        if pane_id:
            try:
                tabs = self.query_one(TabbedContent)
                tabs.active = pane_id
            except Exception:
                pass

    def refresh_services(self) -> None:
        """Force refresh service status."""
        self._update_metrics()

    def start_pipeline(self) -> None:
        """Run the pipeline in a background worker thread."""
        self.run_worker(self._run_pipeline_worker, thread=True)

    async def _run_pipeline_worker(self) -> None:
        """Worker: execute the pipeline with phase callbacks."""
        from modules.driver import run_pipeline
        from modules.ai_assistant import register_thought_observer
        from tui.app import PhaseChanged, LogEntry, AIThought, PipelineFinished

        phase_label = self.query_one("#phase-label", Label)

        def on_phase(phase: str, status: str):
            self.call_from_thread(phase_label.update, f"  {phase}: {status}")
            self.call_from_thread(
                self.app.post_message, PhaseChanged(phase, status)
            )
            # Also push to log viewer
            log_viewer = self.query_one(LogViewer)
            self.call_from_thread(log_viewer.append_line, f"[{status:>7}] {phase}")

        def on_thought(thought: str):
            ai_panel = self.query_one(AIThoughtsPanel)
            self.call_from_thread(ai_panel.append_thought, thought)

        register_thought_observer(on_thought)

        try:
            run_pipeline(self.config, on_phase=on_phase)
        except Exception as e:
            logger.error(f"Pipeline error: {e}")
            self.call_from_thread(phase_label.update, f"  ERROR: {e}")
        finally:
            from modules.ai_assistant import unregister_thought_observer
            unregister_thought_observer(on_thought)
            self.call_from_thread(phase_label.update, "  idle")
            self.call_from_thread(self.app.post_message, PipelineFinished())
