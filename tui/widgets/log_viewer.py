"""Log viewer widget — live log stream from driver.log."""

from __future__ import annotations

import logging
from pathlib import Path

from textual.app import ComposeResult
from textual.widgets import RichLog, Static

logger = logging.getLogger("cstrike.tui.logs")

LOG_FILE = Path("logs/driver.log")


class LogViewer(Static):
    """Tails driver.log and displays new lines in real time."""

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self._last_pos: int = 0

    def compose(self) -> ComposeResult:
        yield RichLog(id="log-output", highlight=True, markup=True, wrap=True)

    def on_mount(self) -> None:
        """Load existing log and start polling for new lines."""
        self._load_existing()
        self.set_interval(1.0, self._poll_log)

    def _load_existing(self) -> None:
        """Load the last 100 lines of the existing log."""
        if not LOG_FILE.exists():
            return
        try:
            text = LOG_FILE.read_text()
            self._last_pos = len(text)
            lines = text.splitlines()
            tail = lines[-100:] if len(lines) > 100 else lines
            log_widget = self.query_one("#log-output", RichLog)
            for line in tail:
                log_widget.write(self._colorize(line))
        except Exception:
            pass

    def _poll_log(self) -> None:
        """Check for new log lines."""
        if not LOG_FILE.exists():
            return
        try:
            with open(LOG_FILE, "r") as f:
                f.seek(self._last_pos)
                new_data = f.read()
                self._last_pos = f.tell()
            if new_data:
                log_widget = self.query_one("#log-output", RichLog)
                for line in new_data.splitlines():
                    if line.strip():
                        log_widget.write(self._colorize(line))
        except Exception:
            pass

    def append_line(self, line: str) -> None:
        """Manually append a line (used by pipeline phase callback)."""
        try:
            log_widget = self.query_one("#log-output", RichLog)
            log_widget.write(self._colorize(line))
        except Exception:
            pass

    @staticmethod
    def _colorize(line: str) -> str:
        """Apply Rich markup based on log level."""
        if "ERROR" in line:
            return f"[red]{line}[/red]"
        if "WARNING" in line or "WARN" in line:
            return f"[yellow]{line}[/yellow]"
        if "[+]" in line or "healthy" in line.lower():
            return f"[green]{line}[/green]"
        if "[MCP]" in line or "[AI" in line:
            return f"[cyan]{line}[/cyan]"
        return line
