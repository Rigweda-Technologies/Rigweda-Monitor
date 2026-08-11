"""Entry point for the MyApp login front-end."""

from __future__ import annotations

import sys
import time
import os
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[1]))
    from app.auth import ensure_service_running, load_auth_session, register_startup
    from app.env import writable_runtime_path
    from app.screenshot_monitor import start_activity_monitor, start_screenshot_monitor
    from src.screenshots.screenshot import main as screenshot_main
else:  # pragma: no cover - import path depends on launch style
    from .auth import ensure_service_running, load_auth_session, register_startup
    from .env import writable_runtime_path
    from .screenshot_monitor import start_activity_monitor, start_screenshot_monitor
    from src.screenshots.screenshot import main as screenshot_main

DATA_ROOT = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_DATA_ROOT", r"C:\Rigweda_monitor\data"), "data")
LOG_DIR = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_LOG_ROOT", str(DATA_ROOT.parent / "logs")), "logs")
STARTUP_LOG_FILE = LOG_DIR / "startup.log"


def _log_startup(message: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    with STARTUP_LOG_FILE.open("a", encoding="utf-8") as log_file:
        log_file.write(f"{timestamp} {message}\n")


def _resume_monitor_in_background() -> int:
    _log_startup("Background startup requested.")
    session = load_auth_session()
    if not session:
        _log_startup("No saved auth token found.")
        return 1

    service_started, _service_message = ensure_service_running()
    if not service_started:
        _log_startup(f"Service/backend start failed: {_service_message}")
        return 1

    monitor_started, _monitor_message = start_screenshot_monitor()
    if not monitor_started:
        _log_startup(f"Screenshot monitor start failed: {_monitor_message}")
        return 1

    activity_started, activity_message = start_activity_monitor()
    if not activity_started:
        _log_startup(f"Activity monitor start failed: {activity_message}")
        return 1

    startup_registered, startup_message = register_startup()
    _log_startup(f"{_monitor_message} {startup_message if startup_registered else startup_message}")
    return 0


def main() -> None:
    """Launch the login window."""
    if "--screenshot-monitor" in sys.argv:
        sys.argv = [arg for arg in sys.argv if arg != "--screenshot-monitor"]
        raise SystemExit(screenshot_main())

    if "--activity-monitor" in sys.argv:
        sys.argv = [arg for arg in sys.argv if arg != "--activity-monitor"]
        if __package__ in {None, ""}:
            from app.activity_monitor import main as activity_main
        else:  # pragma: no cover
            from .activity_monitor import main as activity_main
        raise SystemExit(activity_main())

    if "--background-start" in sys.argv:
        raise SystemExit(_resume_monitor_in_background())

    if __package__ in {None, ""}:
        from app.login_view import LoginApp
    else:  # pragma: no cover - import path depends on launch style
        from .login_view import LoginApp

    app = LoginApp(load_auth_session())
    app.run()


if __name__ == "__main__":
    main()

