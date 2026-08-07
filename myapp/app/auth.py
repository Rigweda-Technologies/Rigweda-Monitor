"""Static credential and backend service helpers for the login UI."""

from __future__ import annotations

import ctypes
import os
import subprocess
import time
from ctypes import wintypes

USERNAME = "admin@gmail.com"
PASSWORD = "changeme123"
SERVICE_NAME = "MyAppBackendService"
SEE_MASK_NOCLOSEPROCESS = 0x00000040
SW_HIDE = 0


def _run_sc_command(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["sc", *args],
        capture_output=True,
        text=True,
        check=False,
    )


class _ShellExecuteInfo(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("fMask", wintypes.ULONG),
        ("hwnd", wintypes.HWND),
        ("lpVerb", wintypes.LPCWSTR),
        ("lpFile", wintypes.LPCWSTR),
        ("lpParameters", wintypes.LPCWSTR),
        ("lpDirectory", wintypes.LPCWSTR),
        ("nShow", ctypes.c_int),
        ("hInstApp", wintypes.HINSTANCE),
        ("lpIDList", wintypes.LPVOID),
        ("lpClass", wintypes.LPCWSTR),
        ("hkeyClass", wintypes.HKEY),
        ("dwHotKey", wintypes.DWORD),
        ("hIcon", wintypes.HANDLE),
        ("hProcess", wintypes.HANDLE),
    ]


def _is_access_denied(output: str) -> bool:
    normalized = output.upper()
    return "FAILED 5" in normalized or "ACCESS IS DENIED" in normalized


def _start_service_as_admin() -> tuple[bool, str]:
    """Request UAC elevation and start the Windows service as administrator."""
    if os.name != "nt":
        return False, "Administrator elevation is only available on Windows."

    shell_execute_info = _ShellExecuteInfo()
    shell_execute_info.cbSize = ctypes.sizeof(_ShellExecuteInfo)
    shell_execute_info.fMask = SEE_MASK_NOCLOSEPROCESS
    shell_execute_info.hwnd = None
    shell_execute_info.lpVerb = "runas"
    shell_execute_info.lpFile = "sc.exe"
    shell_execute_info.lpParameters = f"start {SERVICE_NAME}"
    shell_execute_info.lpDirectory = None
    shell_execute_info.nShow = SW_HIDE

    if not ctypes.windll.shell32.ShellExecuteExW(ctypes.byref(shell_execute_info)):
        error_code = ctypes.GetLastError()
        if error_code == 1223:
            return False, "Administrator permission was cancelled."
        return False, f"Could not request administrator permission. Windows error {error_code}."

    ctypes.windll.kernel32.WaitForSingleObject(shell_execute_info.hProcess, 30000)
    ctypes.windll.kernel32.CloseHandle(shell_execute_info.hProcess)

    for _ in range(5):
        status_result = _run_sc_command("query", SERVICE_NAME)
        status_output = f"{status_result.stdout}\n{status_result.stderr}".upper()
        if "RUNNING" in status_output:
            return True, "Backend service started with administrator permission."
        time.sleep(1)

    return False, "Administrator permission was granted, but the backend service did not start."


def check_credentials(username: str, password: str) -> bool:
    """Return True when the provided credentials match the static pair."""
    return username == USERNAME and password == PASSWORD


def ensure_service_running() -> tuple[bool, str]:
    """Start the backend service if needed and report the outcome."""
    status_result = _run_sc_command("query", SERVICE_NAME)
    status_output = f"{status_result.stdout}\n{status_result.stderr}".upper()
    if "RUNNING" in status_output:
        return True, "Backend service is already running."

    result = _run_sc_command("start", SERVICE_NAME)
    output = (result.stdout + "\n" + result.stderr).strip()

    if result.returncode == 0:
        return True, "Backend service started."

    if "1056" in output or "already running" in output.lower():
        return True, "Backend service is already running."

    if _is_access_denied(output):
        return _start_service_as_admin()

    if not output:
        output = "Unable to start the backend service."

    return False, output
