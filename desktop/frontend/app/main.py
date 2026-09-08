"""Entry point for the Rigweda Monitor login front-end."""

from __future__ import annotations

import sys
import threading
import time
import os
import traceback
from pathlib import Path

if __package__ in {None, ""}:
    # When launched as a script, add the frontend root so `import app.*` works.
    sys.path.append(str(Path(__file__).resolve().parents[1]))
    from app.auth import ensure_service_running, load_auth_session, load_saved_auth_email, register_startup
    from app.env import writable_runtime_path
    from app import screenshot_monitor as _screenshot_monitor  # ensure frozen builds include the screenshot worker
    from app.monitor_settings import apply_monitor_feature_flags, refresh_monitor_feature_flags, start_monitor_settings_listener
    from app.device_health import start_health_reporter
    from app.browser_history_monitor import start_browser_monitor, stop_browser_monitor
else:  # pragma: no cover - import path depends on launch style
    from .auth import ensure_service_running, load_auth_session, load_saved_auth_email, register_startup
    from .env import writable_runtime_path
    from . import screenshot_monitor as _screenshot_monitor  # ensure frozen builds include the screenshot worker
    from .monitor_settings import apply_monitor_feature_flags, refresh_monitor_feature_flags, start_monitor_settings_listener
    from .device_health import start_health_reporter
    from .browser_history_monitor import start_browser_monitor, stop_browser_monitor  # ADDED EXPLICIT PACKAGE RESOLUTION

DATA_ROOT = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_DATA_ROOT", r"%LOCALAPPDATA%\rigweda-monitor\data"), "data")
LOG_DIR = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_LOG_ROOT", str(DATA_ROOT.parent / "logs")), "logs")
STARTUP_LOG_FILE = LOG_DIR / "startup.log"
CRASH_LOG_FILE = LOG_DIR / "crash.log"
BACKGROUND_HOST_LOCK_FILE = DATA_ROOT / "background_host.lock"


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


def _background_process_exists(pid: int) -> bool:
    if pid <= 0:
        return False

    try:
        import subprocess

        result = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                (
                    "$p = Get-CimInstance Win32_Process -Filter \"ProcessId = "
                    f"{pid}\" -ErrorAction SilentlyContinue; if ($p) {{ $p.CommandLine }} "
                ),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
    except Exception:
        return False

    command_line = (result.stdout or "").lower()
    return "rigwedamonitor" in command_line or "--background-start" in command_line or "main.py" in command_line


def _acquire_background_host_lock() -> tuple[bool, str]:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        handle = BACKGROUND_HOST_LOCK_FILE.open("x", encoding="utf-8")
        handle.write(str(os.getpid()))
        handle.flush()
        return True, "Background host lock acquired."
    except FileExistsError:
        try:
            existing_pid = int(BACKGROUND_HOST_LOCK_FILE.read_text(encoding="utf-8").strip())
        except (OSError, ValueError):
            existing_pid = 0

        if existing_pid and _background_process_exists(existing_pid):
            return False, f"Background host already running with PID {existing_pid}."

        BACKGROUND_HOST_LOCK_FILE.unlink(missing_ok=True)
        try:
            handle = BACKGROUND_HOST_LOCK_FILE.open("x", encoding="utf-8")
            handle.write(str(os.getpid()))
            handle.flush()
            return True, "Stale background host lock replaced."
        except Exception as error:
            return False, f"Could not acquire background host lock: {error}"


def _resume_monitor_in_background() -> int:
    _log_startup("Background startup requested.")
    session = load_auth_session()
    if not session:
        saved_email = load_saved_auth_email()
        _log_startup("No valid saved auth token found. Showing sign-in window.")
        if __package__ in {None, ""}:
            from app.login_view import LoginApp
        else:  # pragma: no cover - import path depends on launch style
            from .login_view import LoginApp

        prefill_session = {"email": saved_email} if saved_email else None
        app = LoginApp(
            prefill_session,
            hide_after_resume=False,
            auto_resume_saved_session=False,
            startup_notice=(
                "Your session is missing or expired. Your email is prefilled, so just enter your password."
                if saved_email
                else "Your session is missing or expired. Please sign in again."
            ),
        )
        app.run()
        return 0

    lock_acquired = False
    try:
        lock_acquired, lock_message = _acquire_background_host_lock()
        _log_startup(lock_message)
        if not lock_acquired:
            return 0

        _log_startup("Saved auth session loaded for background monitoring.")
        start_health_reporter(session)
        _log_startup("Laptop health reporter started.")

        service_started, _service_message = ensure_service_running()
        if not service_started:
            _log_startup(f"Service/backend start failed: {_service_message}")
            return 1

        startup_registered, startup_message = register_startup()
        _log_startup(startup_message if startup_registered else startup_message)

        try:
            refreshed_flags = refresh_monitor_feature_flags(session)
            _log_startup(
                "Refreshed monitor settings before starting workers: "
                f"screenshots={refreshed_flags.get('screenshotsEnabled', True)} "
                f"mouse={refreshed_flags.get('mouseEnabled', True)} "
                f"keyboard={refreshed_flags.get('keyboardEnabled', True)} "
                f"appUsage={refreshed_flags.get('appUsageEnabled', True)} "
                f"browser={refreshed_flags.get('browserHistoryEnabled', True)} "
                f"mouseIdle={refreshed_flags.get('mouseIdleThresholdMinutes', 1)}m "
                f"keyboardHeartbeat={refreshed_flags.get('keyboardHeartbeatMinutes', 1)}m "
                f"appUsageHeartbeat={refreshed_flags.get('appUsageHeartbeatMinutes', 1)}m "
                f"browserSync={refreshed_flags.get('browserHistorySyncMinutes', 1)}m"
            )
        except Exception as error:
            _log_startup(f"Failed to refresh monitor settings before worker startup: {str(error)}")
            refreshed_flags = {}

        flags = start_monitor_settings_listener(session, on_change=apply_monitor_feature_flags)
        if refreshed_flags:
            try:
                flags = apply_monitor_feature_flags(refreshed_flags)
            except Exception as error:
                _log_startup(f"Failed to apply refreshed monitor settings: {str(error)}")
        _log_startup(
            "Monitor settings listener started with "
            f"screenshots={flags.get('screenshotsEnabled', True)} "
            f"mouse={flags.get('mouseEnabled', True)} "
            f"keyboard={flags.get('keyboardEnabled', True)} "
            f"appUsage={flags.get('appUsageEnabled', True)} "
            f"browser={flags.get('browserHistoryEnabled', True)}"
        )

        try:
            apply_monitor_feature_flags(flags)
            _log_startup("Initial monitor workers were applied from cached settings.")
        except Exception as e:
            _log_startup(f"Failed to apply initial monitor workers: {str(e)}")

        # Added automated browser monitor tracking to background startup routines too
        try:
            browser_started, browser_message = start_browser_monitor()
            _log_startup(browser_message)
        except Exception as e:
            _log_startup(f"Failed to start browser monitor in background: {str(e)}")

        _log_startup("Background monitor controller is active.")
        _log_startup("Keeping the background host process alive.")
        threading.Event().wait()
        return 0
    finally:
        if lock_acquired:
            BACKGROUND_HOST_LOCK_FILE.unlink(missing_ok=True)


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

    startup_session = load_auth_session(hydrate_details=False)
    if startup_session:
        try:
            flags = start_monitor_settings_listener(startup_session, on_change=apply_monitor_feature_flags)
            _log_startup(
                "Initial monitor settings listener started with cached values: "
                f"screenshots={flags.get('screenshotsEnabled', True)} "
                f"mouse={flags.get('mouseEnabled', True)} "
                f"keyboard={flags.get('keyboardEnabled', True)} "
                f"appUsage={flags.get('appUsageEnabled', True)} "
                f"browser={flags.get('browserHistoryEnabled', True)} "
                f"mouseIdle={flags.get('mouseIdleThresholdMinutes', 1)}m "
                f"keyboardHeartbeat={flags.get('keyboardHeartbeatMinutes', 1)}m "
                f"appUsageHeartbeat={flags.get('appUsageHeartbeatMinutes', 1)}m "
                f"browserSync={flags.get('browserHistorySyncMinutes', 1)}m"
            )
        except Exception as error:
            _log_startup(f"Failed to initialize monitor settings listener: {str(error)}")

    if __package__ in {None, ""}:
        from app.login_view import LoginApp
    else:  # pragma: no cover - import path depends on launch style
        from .login_view import LoginApp

    # --- FORCED USER INTERFACE LAUNCH HOOK ---
    try:
        _log_startup("UI Interface keyboard hook is managed by monitor settings.")
    except Exception as e:
        _log_startup(f"Failed to bind interface keyboard listener: {str(e)}")

    try:
        b_started, b_msg = start_browser_monitor()
        _log_startup(f"UI Interface Browser History Hook Status: {b_msg}")
    except Exception as e:
        _log_startup(f"Failed to bind interface browser tracking thread: {str(e)}")

    app = LoginApp(startup_session or load_auth_session())
    app.run()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        _log_crash(error)
        raise
