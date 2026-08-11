"""Start the screenshot monitor in the logged-in user's desktop session."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from app.env import writable_runtime_path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
VENV_PYTHON = PROJECT_ROOT / ".venv" / "Scripts" / "python.exe"
SCREENSHOT_SCRIPT = PROJECT_ROOT / "src" / "screenshots" / "screenshot.py"
ACTIVITY_SCRIPT = PROJECT_ROOT / "app" / "activity_monitor.py"
DATA_ROOT = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_DATA_ROOT", r"%LOCALAPPDATA%\rigweda-monitor\data"), "data")
LOG_DIR = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_LOG_ROOT", str(DATA_ROOT.parent / "logs")), "logs")
LOG_FILE = LOG_DIR / "screenshot_monitor.log"
PID_FILE = LOG_DIR / "screenshot_monitor.pid"
ACTIVITY_PID_FILE = LOG_DIR / "activity_monitor.pid"

CREATE_NO_WINDOW = 0x08000000
DETACHED_PROCESS = 0x00000008


def _is_process_running(pid: int, expected_script: Path = SCREENSHOT_SCRIPT) -> bool:
    result = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            (
                "$p = Get-CimInstance Win32_Process -Filter \"ProcessId = "
                f"{pid}\" -ErrorAction SilentlyContinue; "
                "if ($p) { $p.CommandLine }"
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    command_line = result.stdout.lower()

    if getattr(sys, "frozen", False):
        return "rigwedamonitor" in command_line or "screenshot.py" in command_line

    if expected_script == ACTIVITY_SCRIPT and "app.activity_monitor" in command_line:
        return True

    expected_path = str(expected_script).lower()
    return expected_script.name.lower() in command_line and expected_path in command_line


def _existing_monitor_is_running() -> bool:
    try:
        pid = int(PID_FILE.read_text(encoding="utf-8").strip())
    except (FileNotFoundError, ValueError):
        return False

    if _is_process_running(pid):
        return True

    PID_FILE.unlink(missing_ok=True)
    return False


def start_screenshot_monitor() -> tuple[bool, str]:
    """Launch screenshot capture outside the Windows service session."""
    if _existing_monitor_is_running():
        return True, "Screenshot monitor is already running."

    if getattr(sys, "frozen", False):
        command = [sys.executable, "--screenshot-monitor"]
        working_directory = Path(sys.executable).resolve().parent
        child_env = {
            **os.environ,
            "PYTHONUNBUFFERED": "1",
            "PYINSTALLER_RESET_ENVIRONMENT": "1",
        }
    else:
        if not SCREENSHOT_SCRIPT.exists():
            return False, f"Screenshot script is missing: {SCREENSHOT_SCRIPT}"
        python_executable = VENV_PYTHON if VENV_PYTHON.exists() else Path("python")
        command = [str(python_executable), str(SCREENSHOT_SCRIPT)]
        working_directory = PROJECT_ROOT
        child_env = {**os.environ, "PYTHONUNBUFFERED": "1"}

    LOG_DIR.mkdir(parents=True, exist_ok=True)

    log_file = open(LOG_FILE, "a", encoding="utf-8")
    try:
        process = subprocess.Popen(
            command,
            cwd=str(working_directory),
            env=child_env,
            stdin=subprocess.DEVNULL,
            stdout=log_file,
            stderr=log_file,
            text=True,
            creationflags=CREATE_NO_WINDOW | DETACHED_PROCESS,
        )
    except Exception as error:
        log_file.close()
        return False, f"Could not start screenshot monitor: {error}"

    PID_FILE.write_text(str(process.pid), encoding="utf-8")
    log_file.close()
    return True, "Screenshot monitor started."


def start_activity_monitor() -> tuple[bool, str]:
    """Launch the durable mouse activity agent in the desktop user session."""
    try:
        existing_pid = int(ACTIVITY_PID_FILE.read_text(encoding="utf-8").strip())
    except (FileNotFoundError, ValueError):
        existing_pid = 0

    if existing_pid and _is_process_running(existing_pid, ACTIVITY_SCRIPT):
        return True, "Activity monitor is already running."
    ACTIVITY_PID_FILE.unlink(missing_ok=True)

    if getattr(sys, "frozen", False):
        command = [sys.executable, "--activity-monitor"]
        working_directory = Path(sys.executable).resolve().parent
    else:
        if not ACTIVITY_SCRIPT.exists():
            return False, f"Activity script is missing: {ACTIVITY_SCRIPT}"
        python_executable = VENV_PYTHON if VENV_PYTHON.exists() else Path("python")
        command = [str(python_executable), "-m", "app.activity_monitor"]
        working_directory = PROJECT_ROOT

    try:
        process = subprocess.Popen(
            command, cwd=str(working_directory), env={**os.environ, "PYTHONUNBUFFERED": "1"},
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=CREATE_NO_WINDOW | DETACHED_PROCESS,
        )
    except Exception as error:
        return False, f"Could not start activity monitor: {error}"
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    ACTIVITY_PID_FILE.write_text(str(process.pid), encoding="utf-8")
    return True, "Activity monitor started."
