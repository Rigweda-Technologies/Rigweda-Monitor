"""USB allow/block policy enforcement for the desktop agent."""

from __future__ import annotations

import atexit
import ctypes
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

import customtkinter as ctk

from app.auth import load_auth_session
from app.env import HOSTED_HRMS_BACKEND_URL, prefer_hosted_backend_url, writable_runtime_path

DATA_ROOT = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_DATA_ROOT", r"%LOCALAPPDATA%\rigweda-monitor\data"), "data")
LOG_DIR = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_LOG_ROOT", str(DATA_ROOT.parent / "logs")), "logs")
LOG_FILE = LOG_DIR / "usb_control.log"
USB_POLICY_FILE = DATA_ROOT / "usb_control_policy.json"
ALT_USB_POLICY_FILE = Path(os.path.expandvars(r"%LOCALAPPDATA%\rigweda-monitor\data\usb_control_policy.json"))
USB_POLL_SECONDS = max(int(os.getenv("USB_CONTROL_POLL_SECONDS", "60")), 15)
USB_CONTROL_API_PATH = "/agents/usb/control-config"

USBSTOR_SERVICE_KEY = r"HKLM\SYSTEM\CurrentControlSet\Services\USBSTOR"
DEVICE_INSTALL_RESTRICTIONS_KEY = r"HKLM\SOFTWARE\Policies\Microsoft\Windows\DeviceInstall\Restrictions"
REMOVABLE_STORAGE_POLICY_KEY = r"SOFTWARE\Policies\Microsoft\Windows\RemovableStorageDevices"

_state_lock = threading.Lock()
_callbacks: list[Callable[[dict[str, bool]], None]] = []
_current_policy: dict[str, bool] | None = None
_windows_policy_applied = False
_last_applied_policy: dict[str, bool] | None = None
_apply_lock = threading.Lock()
_usb_policy_touched = False
_enforcement_disabled = False
_listener_stop_event = threading.Event()
_listener_thread: threading.Thread | None = None
_HIDDEN_PROCESS_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _hidden_process_kwargs() -> dict[str, int]:
    """Keep Windows helper commands from opening transient console windows."""
    if os.name == "nt" and _HIDDEN_PROCESS_FLAGS:
        return {"creationflags": _HIDDEN_PROCESS_FLAGS}
    return {}


class UsbCommandError(RuntimeError):
    """Raised when a privileged Windows USB command cannot be completed."""


def _log_message(message: str) -> None:
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        with LOG_FILE.open("a", encoding="utf-8") as log_file:
            log_file.write(f"{timestamp} {message}\n")
    except OSError:
        pass


def _desktop_backend_url() -> str:
    configured = os.getenv("HRMS_BACKEND_URL", "").strip()
    if configured:
        return prefer_hosted_backend_url(configured, hosted_default=HOSTED_HRMS_BACKEND_URL)
    return HOSTED_HRMS_BACKEND_URL


def _desktop_api_url(path: str) -> str:
    base_url = _desktop_backend_url().rstrip("/")
    normalized_path = path if path.startswith("/") else f"/{path}"
    if base_url.endswith("/api"):
        return f"{base_url}{normalized_path}"
    return f"{base_url}/api{normalized_path}"


def _request_json(url: str, *, token: str) -> dict[str, Any] | None:
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
        method="GET",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            response_text = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        _log_message(f"USB policy request failed: HTTP {error.code} url={url}")
        return None
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        _log_message(f"USB policy request failed: {type(error).__name__}: {error}")
        return None

    if not response_text:
        return None

    try:
        payload = json.loads(response_text)
    except json.JSONDecodeError:
        return None

    return payload if isinstance(payload, dict) else None


def _is_windows_admin() -> bool:
    if os.name != "nt":
        return False
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except (AttributeError, OSError):
        return False


def _normalize_usb_enabled(value: Any) -> bool:
    if isinstance(value, bool):
        return value

    if isinstance(value, dict):
        if isinstance(value.get("usbEnabled"), bool):
            return bool(value["usbEnabled"])
        if "usbMode" in value:
            return _normalize_usb_enabled(value.get("usbMode"))

    normalized = str(value or "").strip().lower()
    if normalized in {"1", "true", "yes", "on", "allow"}:
        return True
    if normalized in {"0", "false", "no", "off", "block_storage", "block_all"}:
        return False
    return True


def _load_cached_policy() -> dict[str, Any] | None:
    for policy_path in dict.fromkeys([USB_POLICY_FILE, ALT_USB_POLICY_FILE]):
        try:
            payload = json.loads(policy_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            continue

        if isinstance(payload, dict):
            disabled_ids = payload.get("last_disabled_device_ids", [])
            if not isinstance(disabled_ids, list):
                disabled_ids = []
            return {
                "usbEnabled": _normalize_usb_enabled(payload.get("usbEnabled", True)),
                "last_disabled_device_ids": [str(device_id) for device_id in disabled_ids if device_id],
            }

    return None


def _save_cached_policy(policy: dict[str, Any]) -> None:
    payload: dict[str, Any] = {
        "usbEnabled": _normalize_usb_enabled(policy.get("usbEnabled", True)),
    }
    if "last_disabled_device_ids" in policy:
        payload["last_disabled_device_ids"] = list(policy.get("last_disabled_device_ids") or [])
    else:
        cached = _load_cached_policy()
        payload["last_disabled_device_ids"] = list((cached or {}).get("last_disabled_device_ids") or [])

    for policy_path in dict.fromkeys([USB_POLICY_FILE, ALT_USB_POLICY_FILE]):
        try:
            policy_path.parent.mkdir(parents=True, exist_ok=True)
            policy_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        except OSError:
            pass


def _notify_callbacks(policy: dict[str, bool]) -> None:
    for callback in list(_callbacks):
        try:
            callback(dict(policy))
        except Exception:
            pass


def _set_current_policy(policy: dict[str, bool]) -> bool:
    global _current_policy
    normalized = {"usbEnabled": bool(policy.get("usbEnabled", True))}
    with _state_lock:
        changed = normalized != _current_policy
        _current_policy = normalized
    _save_cached_policy(normalized)
    if changed:
        _notify_callbacks(normalized)
    return changed


def get_usb_control_policy() -> dict[str, bool]:
    with _state_lock:
        return dict(_current_policy or {"usbEnabled": True})


def _parse_policy_payload(payload: Any) -> dict[str, bool] | None:
    if isinstance(payload, dict) and isinstance(payload.get("data"), dict):
        payload = payload["data"]

    if not isinstance(payload, dict):
        return None

    if isinstance(payload.get("usbEnabled"), bool):
        return {"usbEnabled": bool(payload["usbEnabled"])}

    if "usbMode" in payload:
        return {"usbEnabled": _normalize_usb_enabled(payload.get("usbMode"))}

    return None


def refresh_usb_control_policy(session: dict | None = None) -> dict[str, bool] | None:
    global _current_policy
    session = session or load_auth_session() or {}
    token = str(session.get("token") or "").strip()

    if not token:
        if _current_policy is None:
            cached = _load_cached_policy()
            if cached is not None:
                with _state_lock:
                    _current_policy = {"usbEnabled": bool(cached.get("usbEnabled", True))}
                _log_message(f"Loaded cached USB policy: usbEnabled={cached.get('usbEnabled', True)}")
                return get_usb_control_policy()
            _log_message("No auth token or cached USB policy; using current policy.")
        return get_usb_control_policy()

    payload = _request_json(_desktop_api_url(USB_CONTROL_API_PATH), token=token)
    policy = _parse_policy_payload(payload)
    if policy is None:
        if _current_policy is None:
            cached = _load_cached_policy()
            if cached is not None:
                _log_message(f"Initial USB policy fetch unavailable; using cached policy: usbEnabled={cached.get('usbEnabled', True)}")
                with _state_lock:
                    _current_policy = {"usbEnabled": bool(cached.get("usbEnabled", True))}
                return get_usb_control_policy()
        _log_message("USB policy fetch failed or response was malformed; enforcement skipped.")
        return None
    _log_message(f"Fetched USB policy from backend: usbEnabled={policy.get('usbEnabled', True)}")
    return policy


def _run_windows_command(args: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            check=False,
            **_hidden_process_kwargs(),
        )
    except PermissionError as error:
        _log_message(f"Access Denied (Error 5) launching Windows command: {' '.join(args)}: {error}")
        raise
    stdout = (result.stdout or "").strip() or "<empty>"
    stderr = (result.stderr or "").strip() or "<empty>"
    _log_message(
        f"Windows command: {' '.join(args)} exitCode={result.returncode} "
        f"stdout={stdout} stderr={stderr}"
    )
    return result


def _run_required_windows_command(args: list[str]) -> subprocess.CompletedProcess[str]:
    result = _run_windows_command(args)
    combined_output = f"{result.stdout or ''}\n{result.stderr or ''}"
    if result.returncode == 5 or "access is denied" in combined_output.lower():
        _log_message(f"Access Denied (Error 5) from Windows command: {' '.join(args)}")
        raise PermissionError(5, "Access is denied", args[0])
    if result.returncode != 0:
        raise UsbCommandError(f"Command failed with exit code {result.returncode}: {' '.join(args)}")
    return result


def _refresh_windows_shell() -> None:
    try:
        ctypes.windll.shell32.SHChangeNotify(0x08000000, 0, None, None)
    except (AttributeError, OSError) as error:
        _log_message(f"Could not refresh Windows shell: {type(error).__name__}: {error}")


def _apply_usb_policy_as_admin(usb_blocked: bool) -> tuple[list[str], list[str]]:
    if usb_blocked:
        _set_removable_storage_policy(True)
        _set_usb_storage_enabled(False)
        _set_usb_install_restriction("DenyRemovableDevices", True)
        _set_usb_install_restriction("DenyUnspecified", True)
        disconnected_devices = []
        device_ids = _get_connected_usb_device_ids()
        _log_message(f"USB storage instances found for disable: count={len(device_ids)} ids={device_ids or '-'}")
        disabled_device_ids = []
        for instance_id in device_ids:
            _run_required_windows_command(["pnputil", "/disable-device", instance_id])
            disabled_device_ids.append(instance_id)
            _save_cached_policy({"usbEnabled": False, "last_disabled_device_ids": disabled_device_ids})
        disconnected_volumes = _disconnect_usb_volumes()
        _run_windows_command(["sc", "stop", "USBSTOR"])
    else:
        _set_removable_storage_policy(False)
        _set_usb_storage_enabled(True)
        _set_usb_install_restriction("DenyRemovableDevices", False)
        _set_usb_install_restriction("DenyUnspecified", False)
        _run_windows_command(["sc", "start", "USBSTOR"])
        cached = _load_cached_policy() or {}
        persisted_device_ids = list(cached.get("last_disabled_device_ids") or [])
        enable_errors = []
        for instance_id in persisted_device_ids:
            try:
                _run_required_windows_command(["pnputil", "/enable-device", instance_id])
            except Exception as error:
                enable_errors.append(error)
                _log_message(f"Persisted USB device enable failed: id={instance_id}: {type(error).__name__}: {error}")
        device_ids = _get_connected_usb_device_ids()
        _log_message(f"USB storage instances found for enable: count={len(device_ids)} ids={device_ids or '-'}")
        for instance_id in device_ids:
            if instance_id in persisted_device_ids:
                continue
            try:
                _run_required_windows_command(["pnputil", "/enable-device", instance_id])
            except Exception as error:
                enable_errors.append(error)
                _log_message(f"Discovered USB device enable failed: id={instance_id}: {type(error).__name__}: {error}")
        _run_required_windows_command(["pnputil", "/scan-devices"])
        if enable_errors:
            raise enable_errors[0]
        _save_cached_policy({"usbEnabled": True, "last_disabled_device_ids": []})
        disconnected_volumes = []
        disconnected_devices = []

    _refresh_windows_shell()
    return disconnected_volumes, disconnected_devices


def _set_usb_storage_enabled(enabled: bool) -> None:
    if os.name != "nt":
        return

    import winreg

    registry_path = r"SYSTEM\CurrentControlSet\Services\USBSTOR"
    value = 3 if enabled else 4
    try:
        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            registry_path,
            0,
            winreg.KEY_SET_VALUE,
        ) as key:
            winreg.SetValueEx(key, "Start", 0, winreg.REG_DWORD, value)
    except PermissionError as error:
        _log_message(
            f"Access Denied (Error 5) winreg write: HKLM\\{registry_path}\\Start="
            f"{value}: {error} stdout=<none> stderr=<none>"
        )
        raise
    except OSError as error:
        _log_message(
            f"winreg write failed: HKLM\\{registry_path}\\Start={value}: {error} "
            "stdout=<none> stderr=<none>"
        )
        raise

    _log_message(
        f"winreg write succeeded: HKLM\\{registry_path}\\Start={value} "
        "stdout=<none> stderr=<none>"
    )


def _set_usb_install_restriction(value_name: str, enabled: bool) -> None:
    if os.name != "nt":
        return

    import winreg

    registry_path = r"SOFTWARE\Policies\Microsoft\Windows\DeviceInstall\Restrictions"
    try:
        with winreg.CreateKeyEx(
            winreg.HKEY_LOCAL_MACHINE,
            registry_path,
            0,
            winreg.KEY_SET_VALUE,
        ) as key:
            if enabled:
                winreg.SetValueEx(key, value_name, 0, winreg.REG_DWORD, 1)
            else:
                try:
                    winreg.DeleteValue(key, value_name)
                except FileNotFoundError:
                    _log_message(
                        f"winreg delete skipped; value did not exist: HKLM\\{registry_path}\\{value_name} "
                        "stdout=<none> stderr=<none>"
                    )
                    return
    except PermissionError as error:
        operation = "write" if enabled else "delete"
        _log_message(
            f"Access Denied (Error 5) winreg {operation}: HKLM\\{registry_path}\\{value_name}: "
            f"{error} stdout=<none> stderr=<none>"
        )
        raise
    except OSError as error:
        operation = "write" if enabled else "delete"
        _log_message(
            f"winreg {operation} failed: HKLM\\{registry_path}\\{value_name}: {error} "
            "stdout=<none> stderr=<none>"
        )
        raise

    operation = "write" if enabled else "delete"
    _log_message(
        f"winreg {operation} succeeded: HKLM\\{registry_path}\\{value_name} "
        "stdout=<none> stderr=<none>"
    )


def _set_removable_storage_policy(blocked: bool) -> None:
    """Set Windows' removable-storage access policy and refresh computer policy."""
    if os.name != "nt":
        return

    import winreg

    with winreg.CreateKeyEx(
        winreg.HKEY_LOCAL_MACHINE,
        REMOVABLE_STORAGE_POLICY_KEY,
        0,
        winreg.KEY_SET_VALUE,
    ) as key:
        if blocked:
            winreg.SetValueEx(key, "Deny_All", 0, winreg.REG_DWORD, 1)
        else:
            try:
                winreg.DeleteValue(key, "Deny_All")
            except FileNotFoundError:
                pass

    result = _run_windows_command(["gpupdate", "/target:computer", "/force"])
    if result.returncode != 0:
        _log_message("gpupdate failed; direct device enforcement remains active.")


def _get_connected_usb_device_ids() -> list[str]:
    if os.name != "nt":
        return []

    powershell_script = r"""
Get-PnpDevice |
  Where-Object { $_.InstanceId -like 'USBSTOR*' } |
  Select-Object -ExpandProperty InstanceId
"""

    result = subprocess.run(
        ["powershell", "-NoProfile", "-Command", powershell_script],
        capture_output=True,
        text=True,
        check=False,
        **_hidden_process_kwargs(),
    )

    device_ids: list[str] = []
    for line in (result.stdout or "").splitlines():
        device_id = line.strip()
        if device_id.upper().startswith("USBSTOR\\") and device_id not in device_ids:
            device_ids.append(device_id)
    _log_message(
        f"USB storage instance discovery exitCode={result.returncode} "
        f"stdout={(result.stdout or '').strip() or '<empty>'} "
        f"stderr={(result.stderr or '').strip() or '<empty>'}"
    )
    if result.returncode != 0:
        return []
    return device_ids


def _remove_pnp_device(instance_id: str) -> bool:
    if os.name != "nt" or not instance_id:
        return False

    result = subprocess.run(
        ["pnputil", "/remove-device", instance_id],
        capture_output=True,
        text=True,
        check=False,
        **_hidden_process_kwargs(),
    )
    return result.returncode == 0


def _disable_pnp_device(instance_id: str) -> bool:
    if os.name != "nt" or not instance_id:
        return False

    escaped_instance_id = instance_id.replace("'", "''")
    powershell_script = f"Disable-PnpDevice -InstanceId '{escaped_instance_id}' -Confirm:$false -ErrorAction Stop"
    result = subprocess.run(
        ["powershell", "-NoProfile", "-Command", powershell_script],
        capture_output=True,
        text=True,
        check=False,
        **_hidden_process_kwargs(),
    )
    return result.returncode == 0


def _get_connected_usb_drive_letters() -> list[str]:
    if os.name != "nt":
        return []

    powershell_script = r"""
Get-CimInstance Win32_DiskDrive |
  Where-Object { $_.InterfaceType -eq 'USB' } |
  ForEach-Object {
    $disk = $_
    Get-CimAssociatedInstance -InputObject $disk -ResultClassName Win32_DiskPartition |
      ForEach-Object {
        Get-CimAssociatedInstance -InputObject $_ -ResultClassName Win32_LogicalDisk |
          Select-Object -ExpandProperty DeviceID
      }
  }
"""

    result = subprocess.run(
        ["powershell", "-NoProfile", "-Command", powershell_script],
        capture_output=True,
        text=True,
        check=False,
        **_hidden_process_kwargs(),
    )

    if result.returncode != 0:
        return []

    drive_letters: list[str] = []
    for line in (result.stdout or "").splitlines():
        drive_letter = line.strip().rstrip(":")
        if drive_letter:
            drive_letters.append(drive_letter)
    return drive_letters


def _dismount_usb_drive_letter(drive_letter: str) -> bool:
    if os.name != "nt" or not drive_letter:
        return False

    result = subprocess.run(
        ["mountvol", f"{drive_letter}:", "/p"],
        capture_output=True,
        text=True,
        check=False,
        **_hidden_process_kwargs(),
    )
    return result.returncode == 0


def _disconnect_usb_volumes() -> list[str]:
    disconnected: list[str] = []
    for drive_letter in _get_connected_usb_drive_letters():
        if _dismount_usb_drive_letter(drive_letter):
            disconnected.append(f"{drive_letter}:")
    return disconnected


def _disconnect_active_usb_devices() -> list[str]:
    removed_devices: list[str] = []
    for device_id in _get_connected_usb_device_ids():
        if _remove_pnp_device(device_id) or _disable_pnp_device(device_id):
            removed_devices.append(device_id)
    return removed_devices


def apply_usb_control_policy(policy: dict[str, bool] | None = None) -> dict[str, Any]:
    global _windows_policy_applied, _last_applied_policy, _usb_policy_touched
    if _enforcement_disabled:
        return {"applied": False, "error": "enforcement disabled"}
    policy = dict(policy or get_usb_control_policy())
    usb_enabled = bool(policy.get("usbEnabled", True))
    usb_blocked = not usb_enabled
    normalized = {"usbEnabled": usb_enabled}
    _log_message(
        f"Applying USB policy: usbEnabled={usb_enabled} "
        f"enforcement={'block_all' if usb_blocked else 'allow'} os={os.name}"
    )

    if os.name != "nt":
        _set_current_policy(normalized)
        _log_message("USB enforcement is unsupported on this operating system.")
        return {
            "supported": False,
            "applied": False,
            "changed": False,
            "usbEnabled": usb_enabled,
            "enforcement": "block_all" if usb_blocked else "allow",
            "disconnectedVolumeIds": [],
            "disconnectedDevices": [],
            "disconnectedDeviceCount": 0,
        }

    with _apply_lock:
        changed = normalized != _last_applied_policy
    if not changed:
        _save_cached_policy(normalized)
        _log_message("USB policy already applied; no Windows changes required.")
        return {
            "supported": True,
            "applied": False,
            "changed": False,
            "usbEnabled": usb_enabled,
            "enforcement": "block_all" if usb_blocked else "allow",
            "disconnectedVolumeIds": [],
            "disconnectedDevices": [],
            "disconnectedDeviceCount": 0,
    }

    try:
        if not _is_windows_admin():
            _log_message(
                "USB policy was not applied because the desktop process is not elevated; "
                "startup elevation is required."
            )
            return {
                "supported": True,
                "applied": False,
                "changed": True,
                "usbEnabled": usb_enabled,
                "enforcement": "block_all" if usb_blocked else "allow",
                "disconnectedVolumeIds": [],
                "disconnectedVolumes": [],
                "disconnectedVolumeCount": 0,
                "disconnectedDeviceIds": [],
                "disconnectedDevices": [],
                "disconnectedDeviceCount": 0,
                "error": "The desktop process is not running as Administrator.",
            }

        with _apply_lock:
            # Re-check after acquiring the lock so a socket callback and poll cannot duplicate hardware work.
            if normalized == _last_applied_policy:
                return {
                    "supported": True,
                    "applied": False,
                    "changed": False,
                    "usbEnabled": usb_enabled,
                    "enforcement": "block_all" if usb_blocked else "allow",
                    "disconnectedVolumeIds": [],
                    "disconnectedDevices": [],
                    "disconnectedDeviceCount": 0,
                }
            # Mark before touching HKLM so shutdown cleanup also runs after a partial failure.
            _usb_policy_touched = True
            disconnected_volumes, disconnected_devices = _apply_usb_policy_as_admin(usb_blocked)
            _last_applied_policy = dict(normalized)

        _set_current_policy(normalized)
        _windows_policy_applied = True
        _log_message(
            f"USB policy applied successfully: enforcement={'block_all' if usb_blocked else 'allow'} "
            f"disconnectedVolumes={len(disconnected_volumes)} "
            f"disconnectedDevices={len(disconnected_devices)}"
        )
        return {
            "supported": True,
            "applied": True,
            "changed": True,
            "usbEnabled": usb_enabled,
            "enforcement": "block_all" if usb_blocked else "allow",
            "disconnectedVolumeIds": disconnected_volumes,
            "disconnectedVolumes": disconnected_volumes,
            "disconnectedVolumeCount": len(disconnected_volumes),
            "disconnectedDeviceIds": disconnected_devices,
            "disconnectedDevices": disconnected_devices,
            "disconnectedDeviceCount": len(disconnected_devices),
        }
    except Exception as error:
        _windows_policy_applied = False
        _log_message(f"USB policy apply failed: {type(error).__name__}: {error}")
        return {
            "supported": True,
            "applied": False,
            "changed": True,
            "usbEnabled": usb_enabled,
            "enforcement": "block_all" if usb_blocked else "allow",
            "disconnectedVolumeIds": [],
            "disconnectedVolumes": [],
            "disconnectedVolumeCount": 0,
            "disconnectedDeviceIds": [],
            "disconnectedDevices": [],
            "disconnectedDeviceCount": 0,
            "error": error if isinstance(error, str) else str(error),
        }


def _listener_worker(token: str) -> None:
    if _enforcement_disabled:
        _log_message("USB control listener not started because enforcement is disabled.")
        return
    _log_message(f"USB control listener started: pollSeconds={USB_POLL_SECONDS}")
    has_successful_fetch = False
    while not _listener_stop_event.is_set() and not _enforcement_disabled:
        try:
            payload = _request_json(_desktop_api_url(USB_CONTROL_API_PATH), token=token)
            if payload is None:
                _log_message("USB policy fetch failed; enforcement skipped this cycle.")
                _listener_stop_event.wait(USB_POLL_SECONDS)
                continue
            policy = _parse_policy_payload(payload)
            if policy is None:
                _log_message("USB policy response was malformed; enforcement skipped this cycle.")
                _listener_stop_event.wait(USB_POLL_SECONDS)
                continue
            current_policy = get_usb_control_policy()
            if has_successful_fetch and policy.get("usbEnabled") == current_policy.get("usbEnabled"):
                _log_message(f"USB policy poll skipped; policy unchanged: usbEnabled={policy.get('usbEnabled')}")
            else:
                apply_usb_control_policy(policy)
            has_successful_fetch = True
        except Exception as error:
            _log_message(f"USB listener cycle failed: {type(error).__name__}: {error}")

        _listener_stop_event.wait(USB_POLL_SECONDS)


def start_usb_control_listener(
    session: dict | None = None,
    *,
    on_change: Callable[[dict[str, bool]], None] | None = None,
) -> dict[str, bool]:
    session = session or load_auth_session() or {}
    token = str(session.get("token") or "").strip()
    _log_message(f"Starting USB control listener: tokenPresent={bool(token)} endpoint={_desktop_api_url(USB_CONTROL_API_PATH)}")

    with _state_lock:
        if on_change is not None and on_change not in _callbacks:
            _callbacks.append(on_change)

    current_policy = get_usb_control_policy()
    if on_change is not None:
        threading.Thread(
            target=on_change,
            args=(dict(current_policy),),
            name="UsbControlApply",
            daemon=True,
        ).start()

    if not token:
        _log_message("USB control listener running without backend polling because no auth token is available.")
        return current_policy

    global _listener_thread
    with _state_lock:
        if _listener_thread is not None and _listener_thread.is_alive():
            _log_message("USB control listener is already running.")
            return current_policy
        _listener_stop_event.clear()
        thread = threading.Thread(target=_listener_worker, args=(token,), name="UsbControlListener", daemon=True)
        _listener_thread = thread
        thread.start()

    return current_policy


def stop_usb_control_listener() -> None:
    global _listener_thread
    _listener_stop_event.set()

    thread = _listener_thread
    if thread is not None and thread.is_alive():
        try:
            thread.join(timeout=2)
        except Exception:
            pass
    _listener_thread = None
    _log_message("USB control listener stopped.")


def stop_all_usb_enforcement() -> None:
    global _enforcement_disabled
    stop_usb_control_listener()
    try:
        if os.name == "nt" and _is_windows_admin():
            _apply_usb_policy_as_admin(False)
        else:
            _log_message("Safe mode could not force USB enable because the process is not elevated or Windows is unavailable.")
    except Exception as error:
        _log_message(f"Safe mode USB enable failed: {type(error).__name__}: {error}")
    for policy_path in dict.fromkeys([USB_POLICY_FILE, ALT_USB_POLICY_FILE]):
        try:
            policy_path.unlink()
        except FileNotFoundError:
            pass
        except OSError as error:
            _log_message(f"Safe mode could not delete USB policy cache {policy_path}: {error}")
    _enforcement_disabled = True
    _log_message("USB enforcement disabled by safe mode.")


@atexit.register
def _shutdown_usb_listener() -> None:
    stop_usb_control_listener()


@atexit.register
def _restore_usb_control_on_exit() -> None:
    """Restore USB storage before an elevated desktop process exits."""
    if os.name != "nt" or not _usb_policy_touched:
        return
    try:
        if not _is_windows_admin():
            _log_message("USB cleanup skipped because the exiting process is not elevated.")
            return
        _set_usb_storage_enabled(True)
        _set_removable_storage_policy(False)
        _set_usb_install_restriction("DenyRemovableDevices", False)
        _set_usb_install_restriction("DenyUnspecified", False)
        _run_windows_command(["pnputil", "/scan-devices"])
        _refresh_windows_shell()
        _log_message("USB cleanup completed on application shutdown: storage enabled and devices scanned.")
    except Exception as error:
        _log_message(f"USB cleanup failed on application shutdown: {type(error).__name__}: {error}")


class USBControllerApp(ctk.CTk):
    """Small optional UI for inspecting and applying the HRMS USB policy."""

    def __init__(self) -> None:
        super().__init__()
        self.title("USB Port Controller")
        self.geometry("400x280")
        self.resizable(False, False)

        ctk.set_appearance_mode("System")
        ctk.set_default_color_theme("blue")

        ctk.CTkLabel(
            self,
            text="USB Storage Access Control",
            font=ctk.CTkFont(size=20, weight="bold"),
        ).pack(padx=20, pady=(20, 10))
        self.status_label = ctk.CTkLabel(self, text="Current Status: Fetching...")
        self.status_label.pack(padx=20, pady=10)

        ctk.CTkButton(
            self,
            text="Block USB Storage",
            command=lambda: self._apply_local(False),
            fg_color="#C0392B",
            hover_color="#94281B",
        ).pack(padx=20, pady=8)
        ctk.CTkButton(
            self,
            text="Allow USB Storage",
            command=lambda: self._apply_local(True),
            fg_color="#27AE60",
            hover_color="#1E8449",
        ).pack(padx=20, pady=8)

        self._initialize_policy()
        self.after(1000, self._refresh_status)

    def _initialize_policy(self) -> None:
        session = load_auth_session() or {}
        try:
            policy = refresh_usb_control_policy(session)
            if policy is not None:
                apply_usb_control_policy(policy)
            start_usb_control_listener(session, on_change=lambda _policy: self._refresh_status())
        except Exception as error:
            self._show_status(f"Error: {error}", "#C0392B")

    def _apply_local(self, usb_enabled: bool) -> None:
        result = apply_usb_control_policy({"usbEnabled": usb_enabled})
        if result.get("error"):
            self._show_status(f"Error: {result['error']}", "#C0392B")
        else:
            self._refresh_status()

    def _show_status(self, text: str, color: str) -> None:
        self.status_label.configure(text=text, text_color=color)

    def _refresh_status(self) -> None:
        if not self.winfo_exists():
            return
        enabled = get_usb_control_policy().get("usbEnabled", True)
        if enabled:
            self._show_status("Current Status: ACCESSIBLE", "#27AE60")
        else:
            self._show_status("Current Status: BLOCKED", "#C0392B")
        self.after(2000, self._refresh_status)


if __name__ == "__main__" and "--safe-mode" in sys.argv:
    stop_all_usb_enforcement()
    print("USB enforcement safe mode enabled; polling stopped and policy caches cleared.")
elif __name__ == "__main__":
    app = USBControllerApp()
    app.mainloop()
