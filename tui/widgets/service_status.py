"""Service status sidebar widget — colored dots with service names."""

from __future__ import annotations

from textual.app import ComposeResult
from textual.containers import Vertical
from textual.widgets import Label, Static

from service_manager import ServiceManager, ServiceStatus

_STATUS_DISPLAY = {
    ServiceStatus.STOPPED: ("○", "dot-stopped"),
    ServiceStatus.STARTING: ("◌", "dot-starting"),
    ServiceStatus.HEALTHY: ("●", "dot-healthy"),
    ServiceStatus.UNHEALTHY: ("◑", "dot-failed"),
    ServiceStatus.FAILED: ("✗", "dot-failed"),
}


class ServiceStatusPanel(Static):
    """Displays service health indicators in the sidebar."""

    def __init__(self, svc_mgr: ServiceManager, **kwargs) -> None:
        super().__init__(**kwargs)
        self.svc_mgr = svc_mgr
        self._labels: dict[str, Label] = {}

    def compose(self) -> ComposeResult:
        for name, svc in self.svc_mgr.services.items():
            dot, css_class = _STATUS_DISPLAY.get(svc.status, ("?", "dot-stopped"))
            label = Label(f" {dot} {name}", classes=f"svc-line {css_class}")
            self._labels[name] = label
            yield label

    def refresh_status(self) -> None:
        """Poll service health and update dots."""
        for name, svc in self.svc_mgr.services.items():
            # Refresh actual health
            if svc.status in (ServiceStatus.HEALTHY, ServiceStatus.STARTING, ServiceStatus.UNHEALTHY):
                if self.svc_mgr.is_healthy(svc):
                    svc.status = ServiceStatus.HEALTHY
                elif svc.status == ServiceStatus.HEALTHY:
                    svc.status = ServiceStatus.UNHEALTHY

            dot, css_class = _STATUS_DISPLAY.get(svc.status, ("?", "dot-stopped"))
            if name in self._labels:
                self._labels[name].update(f" {dot} {name}")
                self._labels[name].set_classes(f"svc-line {css_class}")
