"""HRMS authentication and backend service helpers for the login UI."""

from __future__ import annotations

import ctypes
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from ctypes import wintypes
from pathlib import Path

from app.env import load_app_env, writable_runtime_path

load_app_env()

DEFAULT_HRMS_BACKEND_URL = "https://rigweda-hrms-backend.onrender.com/api"
DEFAULT_DESKTOP_BACKEND_URL = "https://rigweda-monitor-backend.vercel.app/api"
DEFAULT_LOGIN_URL = f"{DEFAULT_HRMS_BACKEND_URL}/users/login"
DATA_ROOT = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_DATA_ROOT", r"C:\Rigweda_monitor\data"), "data")
AUTH_FILE = DATA_ROOT / "auth.json"
SERVICE_NAME = "MyAppBackendService"
STARTUP_APP_NAME = "RigwedaMonitor"
PROFILE_SCHEMA_VERSION = 4
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


def _requires_local_windows_service() -> bool:
    """Use the legacy Windows service only when explicitly enabled.

    A local API URL does not mean that ``MyAppBackendService`` exists: during
    development the API is commonly started directly with Node/Python.
    """
    return str(os.getenv("DESKTOP_START_WINDOWS_SERVICE", "false")).strip().lower() in {"1", "true", "yes"}


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


def _pick_first_text(*values: object) -> str | None:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def _object_name(value: object) -> str | None:
    if isinstance(value, dict):
        full_name = " ".join(
            part for part in (value.get("firstName"), value.get("lastName")) if _pick_first_text(part)
        )
        return _pick_first_text(full_name, value.get("name"), value.get("title"), value.get("slug"), value.get("_id"), value.get("id"))
    return _pick_first_text(value)


def _role_names(*values: object) -> str | None:
    names: list[str] = []
    for value in values:
        if isinstance(value, list):
            for item in value:
                name = _object_name(item)
                if name:
                    names.append(name)
        else:
            name = _object_name(value)
            if name:
                names.append(name)

    unique_names = list(dict.fromkeys(names))
    return ", ".join(unique_names) if unique_names else None


def _employee_field(employee: dict, data: dict, *keys: str) -> str | None:
    values: list[object] = []
    for key in keys:
        values.extend([employee.get(key), data.get(key)])
    return _pick_first_text(*values)


def _request_json(url: str, *, token: str | None = None) -> dict:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(request, timeout=30) as response:
        response_text = response.read().decode("utf-8")
        return json.loads(response_text) if response_text else {}


def _response_data(payload: dict) -> dict:
    data = payload.get("data")
    return data if isinstance(data, dict) else payload


def _hrms_backend_url() -> str:
    return os.getenv("HRMS_BACKEND_URL", DEFAULT_HRMS_BACKEND_URL).rstrip("/")


def _hrms_api_url(path: str) -> str:
    base_url = _hrms_backend_url()
    normalized_path = path if path.startswith("/") else f"/{path}"
    if base_url.endswith("/api"):
        return f"{base_url}{normalized_path}"
    return f"{base_url}/api{normalized_path}"


def _extract_employee_details(email: str, payload: dict) -> dict:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    user = data.get("user") if isinstance(data.get("user"), dict) else {}
    employee = data.get("employee") if isinstance(data.get("employee"), dict) else {}
    organization = data.get("organization") if isinstance(data.get("organization"), dict) else {}
    active_role = data.get("activeRole") if isinstance(data.get("activeRole"), dict) else {}
    roles = data.get("roles") if isinstance(data.get("roles"), list) else []

    if not employee and any(key in data for key in ("firstName", "lastName", "employeeCode", "phone")):
        employee = data

    first_name = _pick_first_text(employee.get("firstName"), user.get("firstName"), data.get("firstName"))
    last_name = _pick_first_text(employee.get("lastName"), user.get("lastName"), data.get("lastName"))
    full_name = _pick_first_text(
        employee.get("name"),
        employee.get("fullName"),
        user.get("name"),
        user.get("fullName"),
        data.get("name"),
        data.get("fullName"),
        " ".join(part for part in (first_name, last_name) if part),
    )

    designation = _object_name(employee.get("designationId")) or _pick_first_text(
        employee.get("designation"),
        employee.get("role"),
        user.get("role"),
        data.get("role"),
    )

    return {
        "name": full_name or email,
        "email": _pick_first_text(employee.get("email"), user.get("email"), data.get("email"), email),
        "employeeId": _pick_first_text(
            employee.get("employeeId"),
            data.get("employeeId"),
            employee.get("_id"),
            employee.get("employeeCode"),
            data.get("employeeCode"),
            data.get("userId"),
        ),
        "employeeCode": _pick_first_text(employee.get("employeeCode"), data.get("employeeCode")),
        "phone": _pick_first_text(employee.get("phone"), user.get("phone"), data.get("phone"), employee.get("mobile"), data.get("mobile")),
        "role": _role_names(employee.get("roleIds"), data.get("roleIds"), employee.get("role"), user.get("role"), data.get("role"), active_role, roles)
        or designation,
        "department": _object_name(employee.get("departmentId")) or _pick_first_text(employee.get("department"), data.get("department")),
        "designation": designation,
        "organization": _object_name(organization) or data.get("organizationName"),
        "profileImage": _employee_field(employee, data, "profileImage", "avatar", "imageUrl"),
        "employmentType": _employee_field(employee, data, "employmentType"),
        "status": _employee_field(employee, data, "status"),
        "employmentLifecycleStatus": _employee_field(employee, data, "employmentLifecycleStatus"),
        "manager": _object_name(employee.get("managerId")) or _employee_field(employee, data, "manager"),
        "shift": _object_name(employee.get("shiftId")) or _employee_field(employee, data, "shift"),
        "dateOfJoining": _employee_field(employee, data, "dateOfJoining"),
        "profileCompleted": employee.get("profileCompleted", data.get("profileCompleted")),
    }


def _fetch_employee_details(email: str, token: str) -> dict | None:
    for path in ("/employees/me", "/users/me/profile"):
        try:
            payload = _request_json(_hrms_api_url(path), token=token)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError):
            continue

        data = _response_data(payload)
        if data:
            return _extract_employee_details(email, {"data": data})

    return None


def _store_auth_session(*, email: str, token: str, payload: dict) -> dict:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    employee_details = _extract_employee_details(email, payload)
    session = {
        "email": email,
        "token": token,
        "employee": employee_details,
        "userId": payload.get("data", {}).get("userId") if isinstance(payload.get("data"), dict) else None,
        "organizationId": (
            payload.get("data", {}).get("organization", {}).get("_id")
            if isinstance(payload.get("data"), dict) and isinstance(payload.get("data", {}).get("organization"), dict)
            else None
        ),
        "profileSchemaVersion": PROFILE_SCHEMA_VERSION,
        "savedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    AUTH_FILE.write_text(json.dumps(session, indent=2), encoding="utf-8")
    return session


def _save_auth_session(session: dict) -> None:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    AUTH_FILE.write_text(json.dumps(session, indent=2), encoding="utf-8")


def load_auth_session() -> dict | None:
    """Load a saved login session and expose its token to child monitor processes."""
    try:
        session = json.loads(AUTH_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None

    token = str(session.get("token") or "").strip()
    if token.lower().startswith("bearer "):
        token = token.split(" ", 1)[1].strip()
    if not token:
        return None

    session["token"] = token
    os.environ["MONITOR_ACCESS_TOKEN"] = token

    employee = session.get("employee") if isinstance(session.get("employee"), dict) else {}
    profile_keys = ("name", "role", "employeeId", "phone", "profileImage", "department", "designation")
    missing_visible_details = any(not employee.get(key) for key in ("name", "role", "employeeId", "phone")) or any(
        key not in employee for key in profile_keys
    ) or session.get("profileSchemaVersion") != PROFILE_SCHEMA_VERSION
    if missing_visible_details:
        details = _fetch_employee_details(str(session.get("email") or ""), token)
        if details:
            session["employee"] = details
            session["profileSchemaVersion"] = PROFILE_SCHEMA_VERSION
            _save_auth_session(session)

    return session


def register_startup() -> tuple[bool, str]:
    """Start this app automatically for the current Windows user after sign-in."""
    if os.name != "nt":
        return False, "Windows startup registration is only available on Windows."

    try:
        import winreg
    except ImportError:
        return False, "Windows registry access is unavailable."

    if getattr(sys, "frozen", False):
        executable = Path(sys.executable).resolve()
        command = f'"{executable}" --background-start'
    else:
        python_executable = Path(sys.executable).resolve()
        python_windowed = python_executable.with_name("pythonw.exe")
        launcher = python_windowed if python_windowed.exists() else python_executable
        main_script = Path(__file__).resolve().with_name("main.py")
        # pythonw prevents a visible terminal at every Windows sign-in.
        command = f'"{launcher}" "{main_script}" --background-start'

    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            0,
            winreg.KEY_SET_VALUE,
        ) as key:
            winreg.SetValueEx(key, STARTUP_APP_NAME, 0, winreg.REG_SZ, command)
    except OSError as error:
        return False, f"Could not register Windows startup: {error}"

    return True, "Windows startup registered."


def login_to_hrms(email: str, password: str) -> tuple[bool, str, dict | None]:
    """Authenticate against HRMS and persist the returned access token."""
    login_url = os.getenv("HRMS_BACKEND_URL", DEFAULT_HRMS_BACKEND_URL).rstrip("/")
    if login_url.endswith("/api"):
        login_url = f"{login_url}/users/login"
    else:
        login_url = f"{login_url}/api/users/login"

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

    session = _store_auth_session(email=email, token=token, payload=payload)
    details = _fetch_employee_details(email, token)
    if details:
        session["employee"] = details
        _save_auth_session(session)
    os.environ["MONITOR_ACCESS_TOKEN"] = token
    return True, "Login successful.", session


def ensure_service_running() -> tuple[bool, str]:
    """Start the optional legacy backend service if it has been enabled."""
    if not _requires_local_windows_service():
        return True, "Windows backend service is disabled; using the configured API URL."

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
