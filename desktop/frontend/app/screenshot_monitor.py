"""Start the screenshot monitor in the logged-in user's desktop session."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
VENV_PYTHON = PROJECT_ROOT / ".venv" / "Scripts" / "python.exe"
SCREENSHOT_SCRIPT = PROJECT_ROOT / "src" / "screenshots" / "screenshot.py"
LOG_DIR = Path(r"C:\Rigweda_monitor\logs")
LOG_FILE = LOG_DIR / "screenshot_monitor.log"
PID_FILE = LOG_DIR / "screenshot_monitor.pid"

CREATE_NO_WINDOW = 0x08000000
DETACHED_PROCESS = 0x00000008


def _is_process_running(pid: int) -> bool:
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
    return "rigwedamonitor" in command_line or "screenshot.py" in command_line


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
    else:
        if not SCREENSHOT_SCRIPT.exists():
            return False, f"Screenshot script is missing: {SCREENSHOT_SCRIPT}"
        python_executable = VENV_PYTHON if VENV_PYTHON.exists() else Path("python")
        command = [str(python_executable), str(SCREENSHOT_SCRIPT)]
        working_directory = PROJECT_ROOT

    LOG_DIR.mkdir(parents=True, exist_ok=True)

    log_file = open(LOG_FILE, "a", encoding="utf-8")
    try:
        process = subprocess.Popen(
            command,
            cwd=str(working_directory),
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
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
