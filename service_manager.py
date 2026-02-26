"""CStrike service manager — parallel startup, health checks, graceful shutdown.

Manages lifecycle of all CStrike services (API server, frontend, MSF, ZAP)
with port-based health checks and ordered shutdown.
"""

import logging
import os
import signal
import socket
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Callable, Optional

logger = logging.getLogger("cstrike.services")


class ServiceStatus(str, Enum):
    STOPPED = "stopped"
    STARTING = "starting"
    HEALTHY = "healthy"
    UNHEALTHY = "unhealthy"
    FAILED = "failed"


@dataclass
class ManagedService:
    """A service managed by CStrike."""
    name: str
    start_cmd: list[str]
    port: int
    health_check: str = "port"  # "port" or "process"
    process_name: str = ""  # for process-based health checks
    cwd: Optional[str] = None
    depends_on: list[str] = field(default_factory=list)
    optional: bool = False  # don't fail startup if this can't start
    env: dict = field(default_factory=dict)

    # Runtime state
    process: Optional[subprocess.Popen] = field(default=None, repr=False)
    status: ServiceStatus = ServiceStatus.STOPPED
    error: str = ""


# Callbacks for TUI updates
StatusCallback = Callable[[str, ServiceStatus, str], None]


class ServiceManager:
    """Manages parallel service startup, health polling, and shutdown."""

    def __init__(self, on_status: Optional[StatusCallback] = None):
        self._services: dict[str, ManagedService] = {}
        self._start_order: list[str] = []
        self._on_status = on_status or (lambda *a: None)

    def register(self, service: ManagedService) -> None:
        """Register a service for management."""
        self._services[service.name] = service

    def register_defaults(self, config: dict) -> None:
        """Register default CStrike services from config."""
        base_dir = Path(__file__).parent

        self.register(ManagedService(
            name="api_server",
            start_cmd=["python3", "api_server.py"],
            port=8000,
            cwd=str(base_dir),
        ))

        web_dir = base_dir / "web"
        if web_dir.exists():
            self.register(ManagedService(
                name="frontend",
                start_cmd=["npm", "run", "dev"],
                port=3000,
                cwd=str(web_dir),
                depends_on=["api_server"],
            ))

        self.register(ManagedService(
            name="msfrpcd",
            start_cmd=[
                "msfrpcd", "-P", config.get("msf_password", "msf"),
                "-S", "-a", config.get("msf_host", "127.0.0.1"),
                "-p", str(config.get("msf_port", 55552)),
            ],
            port=config.get("msf_port", 55552),
            health_check="port",
            optional=True,
        ))

        self.register(ManagedService(
            name="zap",
            start_cmd=["zap.sh", "-daemon",
                        "-host", config.get("zap_host", "127.0.0.1"),
                        "-port", str(config.get("zap_port", 8090))],
            port=config.get("zap_port", 8090),
            health_check="port",
            optional=True,
        ))

    @property
    def services(self) -> dict[str, ManagedService]:
        return self._services

    def _resolve_start_order(self) -> list[str]:
        """Topological sort by depends_on."""
        visited = set()
        order = []

        def visit(name: str):
            if name in visited:
                return
            visited.add(name)
            svc = self._services.get(name)
            if svc:
                for dep in svc.depends_on:
                    visit(dep)
            order.append(name)

        for name in self._services:
            visit(name)

        self._start_order = order
        return order

    def _check_port(self, port: int, host: str = "127.0.0.1") -> bool:
        """Check if a port is accepting connections."""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(1)
                return sock.connect_ex((host, port)) == 0
        except OSError:
            return False

    def _check_process(self, name: str) -> bool:
        """Check if a process is running by name."""
        try:
            result = subprocess.run(
                ["pgrep", "-f", name],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return result.returncode == 0
        except FileNotFoundError:
            return False

    def is_healthy(self, svc: ManagedService) -> bool:
        """Run the health check for a service."""
        if svc.health_check == "port":
            return self._check_port(svc.port)
        elif svc.health_check == "process":
            return self._check_process(svc.process_name or svc.name)
        return False

    def _start_service(self, svc: ManagedService) -> bool:
        """Start a single service and wait for health."""
        # Skip if already running
        if self.is_healthy(svc):
            svc.status = ServiceStatus.HEALTHY
            self._on_status(svc.name, ServiceStatus.HEALTHY, "Already running")
            logger.info(f"[+] {svc.name} already running on port {svc.port}")
            return True

        svc.status = ServiceStatus.STARTING
        self._on_status(svc.name, ServiceStatus.STARTING, "Starting...")

        try:
            env = {**os.environ, **svc.env}
            svc.process = subprocess.Popen(
                svc.start_cmd,
                cwd=svc.cwd,
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        except FileNotFoundError:
            svc.status = ServiceStatus.FAILED
            svc.error = f"Command not found: {svc.start_cmd[0]}"
            self._on_status(svc.name, ServiceStatus.FAILED, svc.error)
            logger.error(f"[-] {svc.name}: {svc.error}")
            return False
        except OSError as e:
            svc.status = ServiceStatus.FAILED
            svc.error = str(e)
            self._on_status(svc.name, ServiceStatus.FAILED, svc.error)
            logger.error(f"[-] {svc.name}: {e}")
            return False

        # Poll for health (up to 30s for required, 15s for optional)
        max_wait = 15 if svc.optional else 30
        for _ in range(max_wait):
            if svc.process.poll() is not None:
                svc.status = ServiceStatus.FAILED
                svc.error = f"Process exited with code {svc.process.returncode}"
                self._on_status(svc.name, ServiceStatus.FAILED, svc.error)
                logger.error(f"[-] {svc.name}: {svc.error}")
                return False
            if self.is_healthy(svc):
                svc.status = ServiceStatus.HEALTHY
                self._on_status(svc.name, ServiceStatus.HEALTHY, f"Port {svc.port} ready")
                logger.info(f"[+] {svc.name} healthy on port {svc.port}")
                return True
            time.sleep(1)

        svc.status = ServiceStatus.UNHEALTHY
        svc.error = f"Health check timeout ({max_wait}s)"
        self._on_status(svc.name, ServiceStatus.UNHEALTHY, svc.error)
        logger.warning(f"[!] {svc.name}: {svc.error}")
        return svc.optional  # fail only if required

    def start_all(self) -> bool:
        """Start all services respecting dependencies. Returns True if all required services started."""
        order = self._resolve_start_order()

        # Group by dependency level for parallel startup
        started = set()
        success = True

        for name in order:
            svc = self._services[name]

            # Wait for dependencies
            for dep in svc.depends_on:
                dep_svc = self._services.get(dep)
                if dep_svc and dep_svc.status != ServiceStatus.HEALTHY:
                    svc.status = ServiceStatus.FAILED
                    svc.error = f"Dependency '{dep}' not healthy"
                    self._on_status(svc.name, ServiceStatus.FAILED, svc.error)
                    if not svc.optional:
                        success = False
                    continue

            result = self._start_service(svc)
            if result:
                started.add(name)
            elif not svc.optional:
                success = False

        return success

    def start_parallel(self) -> bool:
        """Start services in parallel, respecting dependency ordering.

        Services with no dependencies start concurrently. Services with
        dependencies wait for those to be healthy first.
        """
        order = self._resolve_start_order()

        # Partition into waves by dependency
        waves: list[list[str]] = []
        placed = set()

        while len(placed) < len(order):
            wave = []
            for name in order:
                if name in placed:
                    continue
                svc = self._services[name]
                if all(dep in placed for dep in svc.depends_on):
                    wave.append(name)
            if not wave:
                break
            waves.append(wave)
            placed.update(wave)

        success = True
        for wave in waves:
            with ThreadPoolExecutor(max_workers=len(wave)) as pool:
                futures = {
                    pool.submit(self._start_service, self._services[name]): name
                    for name in wave
                }
                for future in as_completed(futures):
                    name = futures[future]
                    try:
                        result = future.result()
                        if not result and not self._services[name].optional:
                            success = False
                    except Exception as e:
                        logger.error(f"[-] {name} startup error: {e}")
                        self._services[name].status = ServiceStatus.FAILED
                        self._services[name].error = str(e)
                        if not self._services[name].optional:
                            success = False

        return success

    def stop_all(self) -> None:
        """Gracefully stop all managed services in reverse start order."""
        order = list(reversed(self._resolve_start_order()))

        for name in order:
            svc = self._services[name]
            if svc.process is None:
                continue
            if svc.process.poll() is not None:
                svc.status = ServiceStatus.STOPPED
                self._on_status(svc.name, ServiceStatus.STOPPED, "Already exited")
                continue

            logger.info(f"[~] Stopping {svc.name} (PID {svc.process.pid})...")
            self._on_status(svc.name, ServiceStatus.STOPPED, "Stopping...")

            try:
                os.killpg(os.getpgid(svc.process.pid), signal.SIGTERM)
                try:
                    svc.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    logger.warning(f"[!] {svc.name} didn't stop, sending SIGKILL")
                    os.killpg(os.getpgid(svc.process.pid), signal.SIGKILL)
                    svc.process.wait(timeout=3)
            except (ProcessLookupError, PermissionError):
                pass

            svc.status = ServiceStatus.STOPPED
            svc.process = None
            self._on_status(svc.name, ServiceStatus.STOPPED, "Stopped")
            logger.info(f"[-] {svc.name} stopped")

    def get_status(self) -> dict[str, dict]:
        """Return status of all services for CLI display."""
        result = {}
        for name, svc in self._services.items():
            # Refresh health check
            if svc.status in (ServiceStatus.HEALTHY, ServiceStatus.STARTING):
                if self.is_healthy(svc):
                    svc.status = ServiceStatus.HEALTHY
                else:
                    svc.status = ServiceStatus.UNHEALTHY

            result[name] = {
                "status": svc.status.value,
                "port": svc.port,
                "pid": svc.process.pid if svc.process and svc.process.poll() is None else None,
                "error": svc.error,
                "optional": svc.optional,
            }
        return result
