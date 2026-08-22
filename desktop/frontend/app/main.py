"""Entry point for the Rigweda Monitor login front-end."""

from __future__ import annotations

import sys
import threading
import time
import os
import subprocess
import traceback
from pathlib import Path

import psutil

if __package__ in {None, ""}:
    # When launched as a script, add the frontend root so `import app.*` works.
    sys.path.append(str(Path(__file__).resolve().parents[1]))
    from app.auth import ensure_service_running, launch_background_monitor_process, load_auth_session, load_saved_auth_email, register_startup
    from app.env import writable_runtime_path
    from app import screenshot_monitor as _screenshot_monitor  # ensure frozen builds include the screenshot worker
    from app.monitor_settings import apply_monitor_feature_flags, refresh_monitor_feature_flags, start_monitor_settings_listener
    from app.browser_history_monitor import start_browser_monitor, stop_browser_monitor
else:  # pragma: no cover - import path depends on launch style
    from .auth import ensure_service_running, launch_background_monitor_process, load_auth_session, load_saved_auth_email, register_startup
    from .env import writable_runtime_path
    from . import screenshot_monitor as _screenshot_monitor  # ensure frozen builds include the screenshot worker
    from .monitor_settings import apply_monitor_feature_flags, refresh_monitor_feature_flags, start_monitor_settings_listener
    from .browser_history_monitor import start_browser_monitor, stop_browser_monitor  # ADDED EXPLICIT PACKAGE RESOLUTION

DATA_ROOT = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_DATA_ROOT", r"%LOCALAPPDATA%\rigweda-monitor\data"), "data")
LOG_DIR = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_LOG_ROOT", str(DATA_ROOT.parent / "logs")), "logs")
STARTUP_LOG_FILE = LOG_DIR / "startup.log"
CRASH_LOG_FILE = LOG_DIR / "crash.log"
BACKGROUND_HOST_LOCK_FILE = DATA_ROOT / "background_host.lock"
BACKGROUND_WATCHDOG_LOCK_FILE = DATA_ROOT / "background_watchdog.lock"
BACKGROUND_WATCHDOG_POLL_SECONDS = 15


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
        process = psutil.Process(pid)
        command_line = " ".join(process.cmdline()).lower()
    except Exception:
        return False

    return "rigwedamonitor" in command_line or "--background-start" in command_line or "main.py" in command_line


def _read_lock_pid(lock_file: Path) -> int:
    try:
        return int(lock_file.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return 0


def _watchdog_process_exists(pid: int) -> bool:
    if pid <= 0:
        return False
    return _background_process_exists(pid)


def _acquire_watchdog_lock() -> tuple[bool, str]:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        handle = BACKGROUND_WATCHDOG_LOCK_FILE.open("x", encoding="utf-8")
        handle.write(str(os.getpid()))
        handle.flush()
        return True, "Background watchdog lock acquired."
    except FileExistsError:
        existing_pid = _read_lock_pid(BACKGROUND_WATCHDOG_LOCK_FILE)
        if existing_pid and _watchdog_process_exists(existing_pid):
            return False, f"Background watchdog already running with PID {existing_pid}."

        BACKGROUND_WATCHDOG_LOCK_FILE.unlink(missing_ok=True)
        try:
            handle = BACKGROUND_WATCHDOG_LOCK_FILE.open("x", encoding="utf-8")
            handle.write(str(os.getpid()))
            handle.flush()
            return True, "Stale background watchdog lock replaced."
        except Exception as error:
            return False, f"Could not acquire background watchdog lock: {error}"


def _launch_background_watchdog_process() -> tuple[bool, str]:
    if os.name != "nt":
        return False, "Background watchdog launching is only supported on Windows."

    if getattr(sys, "frozen", False):
        executable = str(Path(sys.executable).resolve())
        args = [executable, "--background-watchdog"]
    else:
        python_executable = Path(sys.executable).resolve()
        python_windowed = python_executable.with_name("pythonw.exe")
        launcher = python_windowed if python_windowed.exists() else python_executable
        main_script = Path(__file__).resolve().with_name("main.py")
        args = [str(launcher), str(main_script), "--background-watchdog"]

    creationflags = 0x00000008 | 0x00000200 | 0x08000000
    startupinfo = None
    if hasattr(subprocess, "STARTUPINFO"):
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= 1
        startupinfo.wShowWindow = 0

    try:
        subprocess.Popen(
            args,
            cwd=str(Path(__file__).resolve().parents[1]),
            creationflags=creationflags,
            startupinfo=startupinfo,
            close_fds=True,
        )
    except OSError as error:
        return False, f"Could not launch background watchdog: {error}"

    return True, "Background watchdog launched."


def _run_background_watchdog() -> int:
    _log_startup("Background watchdog startup requested.")
    lock_acquired, lock_message = _acquire_watchdog_lock()
    _log_startup(lock_message)
    if not lock_acquired:
        return 0

    try:
        while True:
            host_pid = _read_lock_pid(BACKGROUND_HOST_LOCK_FILE)
            host_running = _background_process_exists(host_pid)

            if not host_running:
                _log_startup(
                    f"Background host missing or stopped. hostPid={host_pid or 'none'}; relaunching host."
                )
                started, message = launch_background_monitor_process()
                _log_startup(message)
                if started:
                    time.sleep(10)
            time.sleep(BACKGROUND_WATCHDOG_POLL_SECONDS)
    finally:
        _log_startup("Background watchdog exiting.")
        BACKGROUND_WATCHDOG_LOCK_FILE.unlink(missing_ok=True)


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

        flags = start_monitor_settings_listener(session)
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

        try:
            watchdog_started, watchdog_message = _launch_background_watchdog_process()
            _log_startup(watchdog_message if watchdog_started else watchdog_message)
        except Exception as error:
            _log_startup(f"Failed to launch background watchdog from background host: {str(error)}")

        _log_startup("Background monitor controller is active.")
        _log_startup("Keeping the background host process alive.")
        try:
            threading.Event().wait()
        finally:
            _log_startup("Background host exiting.")
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

    if "--background-watchdog" in sys.argv:
        sys.argv = [arg for arg in sys.argv if arg != "--background-watchdog"]
        raise SystemExit(_run_background_watchdog())

    if "--background-start" in sys.argv:
        raise SystemExit(_resume_monitor_in_background())

    startup_session = load_auth_session()
    if startup_session:
        try:
            refreshed_flags = refresh_monitor_feature_flags(startup_session)
            flags = start_monitor_settings_listener(startup_session)
            if refreshed_flags:
                flags = apply_monitor_feature_flags(refreshed_flags)
            _log_startup(
                "Initial monitor settings loaded: "
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

    app = LoginApp(load_auth_session())
    app.run()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        _log_crash(error)
        raise
