"""Target table widget — shows configured targets and scan status."""

from __future__ import annotations

from pathlib import Path

from textual.app import ComposeResult
from textual.widgets import DataTable, Static


class TargetTable(Static):
    """Displays the target list from config with scan status."""

    def __init__(self, config: dict, **kwargs) -> None:
        super().__init__(**kwargs)
        self.config = config

    def compose(self) -> ComposeResult:
        yield DataTable(id="target-dt")

    def on_mount(self) -> None:
        table = self.query_one("#target-dt", DataTable)
        table.add_columns("Target", "Exploitation", "Status", "Results")

        targets = self.config.get("target_scope", [])
        allow_exploit = self.config.get("allow_exploitation", False)

        for target in targets:
            results_dir = Path("results") / target
            has_results = results_dir.exists() and any(results_dir.glob("*.json"))
            status = "scanned" if has_results else "pending"
            exploit = "enabled" if allow_exploit else "disabled"
            results_count = len(list(results_dir.glob("*.json"))) if has_results else 0

            table.add_row(
                target,
                exploit,
                status,
                str(results_count) if results_count else "-",
            )

    def refresh_targets(self) -> None:
        """Rebuild the table with fresh data."""
        try:
            table = self.query_one("#target-dt", DataTable)
            table.clear()
            self.on_mount()
        except Exception:
            pass
