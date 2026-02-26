"""Loot summary widget — findings and credentials overview table."""

from __future__ import annotations

import json
from pathlib import Path

from textual.app import ComposeResult
from textual.widgets import DataTable, Static


class LootSummary(Static):
    """Displays discovered credentials and vulnerabilities."""

    def __init__(self, config: dict, **kwargs) -> None:
        super().__init__(**kwargs)
        self.config = config

    def compose(self) -> ComposeResult:
        yield DataTable(id="loot-dt")

    def on_mount(self) -> None:
        table = self.query_one("#loot-dt", DataTable)
        table.add_columns("Target", "Category", "Value", "Source")
        self._load_loot(table)

    def _load_loot(self, table: DataTable) -> None:
        """Scan results directories for loot data."""
        targets = self.config.get("target_scope", [])

        for target in targets:
            results_dir = Path("results") / target
            if not results_dir.exists():
                continue

            # Load loot tracker data
            loot_file = results_dir / "loot.json"
            if loot_file.exists():
                try:
                    loot_data = json.loads(loot_file.read_text())
                    for category, items in loot_data.items():
                        if isinstance(items, list):
                            for item in items[:20]:  # cap display
                                val = item if isinstance(item, str) else str(item)
                                table.add_row(target, category, val, "loot_tracker")
                except (json.JSONDecodeError, OSError):
                    pass

            # Load credential results
            creds_file = results_dir / "credentials.json"
            if creds_file.exists():
                try:
                    creds = json.loads(creds_file.read_text())
                    if isinstance(creds, list):
                        for cred in creds[:20]:
                            user = cred.get("username", "?")
                            svc = cred.get("service", "?")
                            status = cred.get("status", "?")
                            table.add_row(
                                target, "credential", f"{user}@{svc}", status
                            )
                except (json.JSONDecodeError, OSError):
                    pass

        if table.row_count == 0:
            table.add_row("-", "-", "No findings yet", "-")

    def refresh_loot(self) -> None:
        """Reload loot data."""
        try:
            table = self.query_one("#loot-dt", DataTable)
            table.clear()
            self._load_loot(table)
        except Exception:
            pass
