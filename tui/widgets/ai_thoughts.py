"""AI thoughts panel — displays AI reasoning in real time."""

from __future__ import annotations

from textual.app import ComposeResult
from textual.widgets import RichLog, Static


class AIThoughtsPanel(Static):
    """Displays streaming AI thoughts from the observer pattern."""

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)

    def compose(self) -> ComposeResult:
        yield RichLog(id="ai-log", highlight=True, markup=True, wrap=True)

    def on_mount(self) -> None:
        """Load any existing thoughts from the buffer."""
        try:
            from modules.ai_assistant import get_thoughts
            thoughts = get_thoughts()
            log_widget = self.query_one("#ai-log", RichLog)
            for thought in thoughts:
                log_widget.write(f"[cyan]{thought}[/cyan]")
        except Exception:
            pass

    def append_thought(self, thought: str) -> None:
        """Add a new thought line to the display."""
        try:
            log_widget = self.query_one("#ai-log", RichLog)
            log_widget.write(f"[cyan]{thought}[/cyan]")
        except Exception:
            pass
