"""Start the screenshot and activity monitors in the logged-in user's desktop session."""

from __future__ import annotations

import os
import threading
import time
import traceback
from pathlib import Path

from app.env import writable_runtime_path
from app.monitor_settings import get_monitor_feature_flags
from src.screenshots.screenshot import run_monitor as screenshot_run_monitor
from src.screenshots.screenshot import stop_screenshot_monitor as screenshot_stop_monitor

DATA_ROOT = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_DATA_ROOT", r"%LOCALAPPDATA%\rigweda-monitor\data"), "data")
LOG_DIR = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_LOG_ROOT", str(DATA_ROOT.parent / "logs")), "logs")
LOG_FILE = LOG_DIR / "screenshot_monitor.log"

_STATE_LOCK = threading.Lock()
_SCREENSHOT_THREAD: threading.Thread | None = None
_ACTIVITY_THREAD: threading.Thread | None = None
_APP_USAGE_THREAD: threading.Thread | None = None


def _log_message(message: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    with LOG_FILE.open("a", encoding="utf-8") as log_file:
        log_file.write(f"{timestamp} {message}\n")


def _log_exception(message: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    with LOG_FILE.open("a", encoding="utf-8") as log_file:
        log_file.write(f"{timestamp} {message}\n")
        traceback.print_exc(file=log_file)


def _thread_is_running(thread: threading.Thread | None) -> bool:
    return thread is not None and thread.is_alive()


def _run_screenshot_worker() -> None:
    try:
        exit_code = screenshot_run_monitor()
        _log_message(f"Screenshot monitor exited with code {exit_code}.")
    except Exception as error:
        _log_exception(f"Screenshot monitor crashed: {type(error).__name__}: {error}")


def _run_activity_worker() -> None:
    try:
        from app.activity_monitor import main as activity_main

        exit_code = activity_main()
        _log_message(f"Activity monitor exited with code {exit_code}.")
    except Exception as error:
        _log_exception(f"Activity monitor crashed: {type(error).__name__}: {error}")


def _run_app_usage_worker() -> None:
    try:
        from app.foreground_app_monitor import run_monitor as app_usage_run_monitor

        exit_code = app_usage_run_monitor()
        _log_message(f"App usage monitor exited with code {exit_code}.")
    except Exception as error:
        _log_exception(f"App usage monitor crashed: {type(error).__name__}: {error}")


def start_screenshot_monitor() -> tuple[bool, str]:
    """Launch screenshot capture in the current desktop process."""
    global _SCREENSHOT_THREAD

    flags = get_monitor_feature_flags()
    if not flags.get("screenshotsEnabled", True):
        return False, "Screenshot monitor is disabled by Employee Monitor settings."

    with _STATE_LOCK:
        if _thread_is_running(_SCREENSHOT_THREAD):
            return True, "Screenshot monitor is already running."

        thread = threading.Thread(target=_run_screenshot_worker, name="ScreenshotMonitor", daemon=False)
        _SCREENSHOT_THREAD = thread
        thread.start()

    return True, "Screenshot monitor started."


def start_activity_monitor() -> tuple[bool, str]:
    """Launch the durable mouse activity agent in the current desktop process."""
    global _ACTIVITY_THREAD

    flags = get_monitor_feature_flags()
    if not flags.get("mouseEnabled", True):
        return False, "Mouse activity monitor is disabled by Employee Monitor settings."

    with _STATE_LOCK:
        if _thread_is_running(_ACTIVITY_THREAD):
            return True, "Activity monitor is already running."

        thread = threading.Thread(target=_run_activity_worker, name="ActivityMonitor", daemon=False)
        _ACTIVITY_THREAD = thread
        thread.start()

    return True, "Activity monitor started."


def start_app_usage_monitor() -> tuple[bool, str]:
    """Launch foreground app tracking in the current desktop process."""
    global _APP_USAGE_THREAD

    flags = get_monitor_feature_flags()
    if not flags.get("appUsageEnabled", True):
        return False, "App usage monitor is disabled by Employee Monitor settings."

    with _STATE_LOCK:
        if _thread_is_running(_APP_USAGE_THREAD):
            return True, "App usage monitor is already running."

        thread = threading.Thread(target=_run_app_usage_worker, name="AppUsageMonitor", daemon=False)
        _APP_USAGE_THREAD = thread
        thread.start()

    return True, "App usage monitor started."


def stop_app_usage_monitor() -> None:
    try:
        from app.foreground_app_monitor import stop_foreground_app_monitor as app_usage_stop_monitor

        app_usage_stop_monitor()
    except Exception:
        pass


def stop_screenshot_monitor() -> None:
    try:
        screenshot_stop_monitor()
    except Exception:
        pass


def stop_activity_monitor() -> None:
    try:
        from app.activity_monitor import stop_activity_monitor as _stop
        _stop()
    except Exception:
        pass
