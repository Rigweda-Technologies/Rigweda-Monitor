"""HRMS authentication and backend service helpers for the login UI."""

from __future__ import annotations

import ctypes
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from ctypes import wintypes
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

DEFAULT_LOGIN_URL = "https://www.upanayahr.com/api/users/login"
DATA_ROOT = Path(os.getenv("RIGWEDA_MONITOR_DATA_ROOT", r"C:\Rigweda_monitor\data"))
AUTH_FILE = DATA_ROOT / "auth.json"
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


def _extract_token(headers: object, payload: dict) -> str | None:
    header_token = headers.get("Authorization") or headers.get("authorization")
    candidates = [
        header_token,
        payload.get("token"),
        payload.get("accessToken"),
        payload.get("access_token"),
        payload.get("data", {}).get("token") if isinstance(payload.get("data"), dict) else None,
        payload.get("data", {}).get("accessToken") if isinstance(payload.get("data"), dict) else None,
        payload.get("data", {}).get("access_token") if isinstance(payload.get("data"), dict) else None,
    ]

    for candidate in candidates:
        if not candidate:
            continue
        token = str(candidate).strip()
        if token.lower().startswith("bearer "):
            token = token.split(" ", 1)[1].strip()
        if token:
            return token

    return None


def _store_auth_session(*, email: str, token: str, payload: dict) -> None:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    session = {
        "email": email,
        "token": token,
        "userId": payload.get("data", {}).get("userId") if isinstance(payload.get("data"), dict) else None,
        "organizationId": (
            payload.get("data", {}).get("organization", {}).get("_id")
            if isinstance(payload.get("data"), dict) and isinstance(payload.get("data", {}).get("organization"), dict)
            else None
        ),
        "savedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    AUTH_FILE.write_text(json.dumps(session, indent=2), encoding="utf-8")


def login_to_hrms(email: str, password: str) -> tuple[bool, str, str | None]:
    """Authenticate against HRMS and persist the returned access token."""
    login_url = os.getenv("HRMS_LOGIN_URL", DEFAULT_LOGIN_URL)

    request_body = json.dumps({"email": email, "password": password}).encode("utf-8")
    request = urllib.request.Request(
        login_url,
        data=request_body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            response_text = response.read().decode("utf-8")
            payload = json.loads(response_text) if response_text else {}
            token = _extract_token(response.headers, payload)
    except urllib.error.HTTPError as error:
        try:
            payload = json.loads(error.read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            payload = {}
        message = payload.get("message") or payload.get("error") or f"Login failed with HTTP {error.code}"
        return False, str(message), None
    except (urllib.error.URLError, TimeoutError) as error:
        return False, f"Could not reach login API: {error}", None
    except ValueError:
        return False, "Login API returned an invalid response.", None

    if not token:
        return False, "Login succeeded but no access token was returned.", None

    _store_auth_session(email=email, token=token, payload=payload)
    os.environ["MONITOR_ACCESS_TOKEN"] = token
    return True, "Login successful.", token


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
