"""Windows Service entry point for Rigweda Monitor Service.

This file is a service template. It expects pywin32 to be installed on Windows.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import time
from pathlib import Path

try:
    import servicemanager  # type: ignore
    import win32event  # type: ignore
    import win32service  # type: ignore
    import win32serviceutil  # type: ignore
except ImportError as exc:  # pragma: no cover - Windows service runtime only
    raise ImportError(
        "pywin32 is required to run background_service.py as a Windows Service."
    ) from exc


SERVICE_NAME = "RigwedaMonitorService"
SERVICE_DISPLAY_NAME = "Rigweda Monitor Service"
SERVICE_DESCRIPTION = "Backend service for Rigweda desktop monitoring."
LOG_FILE = Path(__file__).resolve().with_name("background_service.log")
FRONTEND_ROOT = Path(__file__).resolve().parents[1]
DESKTOP_ROOT = FRONTEND_ROOT.parent
BACKEND_ROOT = DESKTOP_ROOT / "backend"
BACKEND_SCRIPT = BACKEND_ROOT / "src" / "server.js"


class RigwedaMonitorService(win32serviceutil.ServiceFramework):  # type: ignore[misc]
    _svc_name_ = SERVICE_NAME
    _svc_display_name_ = SERVICE_DISPLAY_NAME
    _svc_description_ = SERVICE_DESCRIPTION

    def __init__(self, args):
        super().__init__(args)
        self.stop_event = win32event.CreateEvent(None, 0, 0, None)
        self.running = True
        self.backend_process: subprocess.Popen[str] | None = None

    def SvcStop(self):
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        self.running = False
        self._stop_backend()
        win32event.SetEvent(self.stop_event)

    def SvcDoRun(self):
        logging.basicConfig(
            filename=str(LOG_FILE),
            level=logging.INFO,
            format="%(asctime)s %(levelname)s %(message)s",
        )
        servicemanager.LogInfoMsg(f"{SERVICE_NAME} started")
        self.ReportServiceStatus(win32service.SERVICE_RUNNING)
        logging.info("%s started", SERVICE_NAME)
        self.main()

    def _resolve_node(self) -> str | None:
        node_path = shutil.which("node.exe") or shutil.which("node")
        if node_path:
            return node_path

        default_node = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "nodejs" / "node.exe"
        if default_node.exists():
            return str(default_node)

        return None

    def _start_backend(self) -> bool:
        if self.backend_process and self.backend_process.poll() is None:
            return True

        node_path = self._resolve_node()
        if not node_path:
            logging.error("Node.js executable was not found.")
            return False

        if not BACKEND_SCRIPT.exists():
            logging.error("Backend script is missing: %s", BACKEND_SCRIPT)
            return False

        log_handle = open(LOG_FILE, "a", encoding="utf-8")
        try:
            self.backend_process = subprocess.Popen(
                [node_path, str(BACKEND_SCRIPT)],
                cwd=str(BACKEND_ROOT),
                env={**os.environ, "NODE_ENV": os.environ.get("NODE_ENV", "development")},
                stdin=subprocess.DEVNULL,
                stdout=log_handle,
                stderr=log_handle,
                text=True,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            log_handle.close()
            logging.info("Started desktop backend with PID %s", self.backend_process.pid)
            return True
        except Exception:
            log_handle.close()
            logging.exception("Could not start desktop backend.")
            return False

    def _stop_backend(self) -> None:
        if not self.backend_process or self.backend_process.poll() is not None:
            return

        logging.info("Stopping desktop backend PID %s", self.backend_process.pid)
        self.backend_process.terminate()
        try:
            self.backend_process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            logging.warning("Backend did not stop in time; killing PID %s", self.backend_process.pid)
            self.backend_process.kill()
            self.backend_process.wait(timeout=10)

    def main(self):
        self._start_backend()
        while self.running:
            if not self._start_backend():
                time.sleep(10)
                continue
            time.sleep(2)


if __name__ == "__main__":  # pragma: no cover - Windows service runtime only
    win32serviceutil.HandleCommandLine(RigwedaMonitorService)
