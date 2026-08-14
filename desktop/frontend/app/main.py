"""Entry point for the MyApp login front-end."""

from __future__ import annotations

import sys
import threading
import time
import os
import traceback
from pathlib import Path

if __package__ in {None, ""}:
    # Fixed to point to the immediate parent root folder level
    sys.path.append(str(Path(__file__).resolve().parents[0]))
    from app.auth import ensure_service_running, load_auth_session, register_startup
    from app.env import writable_runtime_path
    from app.screenshot_monitor import start_activity_monitor, start_screenshot_monitor
    from app.keyboard_monitor import start_keyboard_monitor
    from app.browser_history_monitor import start_browser_monitor
else:  # pragma: no cover - import path depends on launch style
    from .auth import ensure_service_running, load_auth_session, register_startup
    from .env import writable_runtime_path
    from .screenshot_monitor import start_activity_monitor, start_screenshot_monitor
    from .keyboard_monitor import start_keyboard_monitor
    from .browser_history_monitor import start_browser_monitor  # ADDED EXPLICIT PACKAGE RESOLUTION

DATA_ROOT = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_DATA_ROOT", r"%LOCALAPPDATA%\rigweda-monitor\data"), "data")
LOG_DIR = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_LOG_ROOT", str(DATA_ROOT.parent / "logs")), "logs")
STARTUP_LOG_FILE = LOG_DIR / "startup.log"
CRASH_LOG_FILE = LOG_DIR / "crash.log"


def _log_startup(message: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    with STARTUP_LOG_FILE.open("a", encoding="utf-8") as log_file:
        log_file.write(f"{timestamp} {message}\n")


def _log_crash(error: BaseException) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    with CRASH_LOG_FILE.open("a", encoding="utf-8") as log_file:
        log_file.write(f"{timestamp} Unhandled exception: {error}\n")
        traceback.print_exc(file=log_file)
        log_file.write("\n")


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

    startup_registered, startup_message = register_startup()
    _log_startup(startup_message if startup_registered else startup_message)

    screenshot_started, screenshot_message = start_screenshot_monitor()
    _log_startup(screenshot_message if screenshot_started else screenshot_message)

    activity_started, activity_message = start_activity_monitor()
    _log_startup(activity_message if activity_started else activity_message)

    keyboard_started, keyboard_message = start_keyboard_monitor()
    _log_startup(keyboard_message if keyboard_started else keyboard_message)

    # Added automated browser monitor tracking to background startup routines too
    try:
        browser_started, browser_message = start_browser_monitor()
        _log_startup(browser_message)
    except Exception as e:
        _log_startup(f"Failed to start browser monitor in background: {str(e)}")

    if screenshot_started or activity_started or keyboard_started or browser_started:
        _log_startup("Background monitors requested on startup.")
        _log_startup("Keeping the background host process alive.")
        threading.Event().wait()
        return 0

    _log_startup("No background monitors could be started.")
    return 1


def main() -> None:
    """Launch the login window."""
    if "--screenshot-monitor" in sys.argv:
        sys.argv = [arg for arg in sys.argv if arg != "--screenshot-monitor"]
        if __package__ in {None, ""}:
            from src.screenshots.screenshot import main as screenshot_main
        else:  # pragma: no cover
            from src.screenshots.screenshot import main as screenshot_main
        raise SystemExit(screenshot_main())

    if "--activity-monitor" in sys.argv:
        sys.argv = [arg for arg in sys.argv if arg != "--activity-monitor"]
        if __package__ in {None, ""}:
            from app.activity_monitor import main as activity_main
        else:  # pragma: no cover
            from .activity_monitor import main as activity_main
        raise SystemExit(activity_main())

    if "--keyboard-monitor" in sys.argv:
        sys.argv = [arg for arg in sys.argv if arg != "--keyboard-monitor"]
        if __package__ in {None, ""}:
            from app.keyboard_monitor import main as keyboard_main
        else:  # pragma: no cover
            from .keyboard_monitor import main as keyboard_main
        raise SystemExit(keyboard_main())

    if "--background-start" in sys.argv:
        raise SystemExit(_resume_monitor_in_background())

    if __package__ in {None, ""}:
        from app.login_view import LoginApp
    else:  # pragma: no cover - import path depends on launch style
        from .login_view import LoginApp

    # --- FORCED USER INTERFACE LAUNCH HOOK ---
    try:
        started, msg = start_keyboard_monitor()
        _log_startup(f"UI Interface Keyboard Hook Status: {msg}")
    except Exception as e:
        _log_startup(f"Failed to bind interface keyboard listener: {str(e)}")

    try:
        b_started, b_msg = start_browser_monitor()
        _log_startup(f"UI Interface Browser History Hook Status: {b_msg}")
    except Exception as e:
        _log_startup(f"Failed to bind interface browser tracking thread: {str(e)}")

    app = LoginApp(load_auth_session())
    app.run()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        _log_crash(error)
        raise
