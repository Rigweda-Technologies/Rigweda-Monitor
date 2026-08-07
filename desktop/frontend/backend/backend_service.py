"""Windows Service entry point for MyAppBackendService.

This file is a service template. It expects pywin32 to be installed on Windows.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path

try:
    import servicemanager  # type: ignore
    import win32event  # type: ignore
    import win32service  # type: ignore
    import win32serviceutil  # type: ignore
except ImportError as exc:  # pragma: no cover - Windows service runtime only
    raise ImportError(
        "pywin32 is required to run backend_service.py as a Windows Service."
    ) from exc


SERVICE_NAME = "MyAppBackendService"
SERVICE_DISPLAY_NAME = "MyApp Backend Service"
SERVICE_DESCRIPTION = "Backend service for MyApp desktop authentication."
LOG_FILE = Path(__file__).resolve().with_name("backend_service.log")


class MyAppBackendService(win32serviceutil.ServiceFramework):  # type: ignore[misc]
    _svc_name_ = SERVICE_NAME
    _svc_display_name_ = SERVICE_DISPLAY_NAME
    _svc_description_ = SERVICE_DESCRIPTION

    def __init__(self, args):
        super().__init__(args)
        self.stop_event = win32event.CreateEvent(None, 0, 0, None)
        self.running = True

    def SvcStop(self):
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        self.running = False
        win32event.SetEvent(self.stop_event)

    def SvcDoRun(self):
        logging.basicConfig(
            filename=str(LOG_FILE),
            level=logging.INFO,
            format="%(asctime)s %(levelname)s %(message)s",
        )
        servicemanager.LogInfoMsg(f"{SERVICE_NAME} started")
        self.ReportServiceStatus(win32service.SERVICE_RUNNING)
        self.main()

    def main(self):
        while self.running:
            time.sleep(1)


if __name__ == "__main__":  # pragma: no cover - Windows service runtime only
    win32serviceutil.HandleCommandLine(MyAppBackendService)
