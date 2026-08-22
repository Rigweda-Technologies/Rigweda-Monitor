"""Shared Employee Monitor flags and realtime updates for the desktop client."""

from __future__ import annotations

import json
import importlib
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

from app.auth import DATA_ROOT, load_auth_session

try:
    import socketio
except ImportError:  # pragma: no cover - dependency may be missing in local dev
    socketio = None  # type: ignore[assignment]

DEFAULT_FEATURE_FLAGS: dict[str, bool] = {
    "screenshotsEnabled": True,
    "mouseEnabled": True,
    "keyboardEnabled": True,
    "appUsageEnabled": True,
    "browserHistoryEnabled": True,
}
DEFAULT_MONITOR_SETTINGS: dict[str, bool | int] = {
    **DEFAULT_FEATURE_FLAGS,
    "screenshotIntervalMinutes": 1,
    "mouseHeartbeatMinutes": 1,
}
FEATURE_FLAGS_FILE = DATA_ROOT / "monitor_feature_flags.json"
ALT_FEATURE_FLAGS_FILE = Path(os.path.expandvars(r"%LOCALAPPDATA%\rigweda-monitor\data\monitor_feature_flags.json"))

_state_lock = threading.Lock()
_callbacks: list[Callable[[dict[str, bool | int]], None]] = []
_listener_stop_event = threading.Event()
_listener_thread: threading.Thread | None = None
_socket_client: socketio.Client | None = None if socketio is not None else None
_current_flags: dict[str, bool | int] = dict(DEFAULT_MONITOR_SETTINGS)


def _force_keyboard_enabled() -> bool:
    return os.getenv("RIGWEDA_MONITOR_FORCE_KEYBOARD_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}


def _hrms_backend_base_url() -> str:
    configured = os.getenv("HRMS_BACKEND_URL", "").strip()
    if configured:
        return configured.rstrip("/")

    login_url = os.getenv("HRMS_LOGIN_URL", "").strip()
    if login_url:
        normalized_login = login_url.rstrip("/")
        if normalized_login.endswith("/users/login"):
            return normalized_login[: -len("/users/login")].rstrip("/")
        if normalized_login.endswith("/login"):
            return normalized_login[: -len("/login")].rstrip("/")
        return normalized_login

    return "https://rigweda-hrms-backend.onrender.com/api"


def _hrms_api_url(path: str) -> str:
    normalized_path = path if path.startswith("/") else f"/{path}"
    base_url = _hrms_backend_base_url()
    if base_url.endswith("/api"):
        return f"{base_url}{normalized_path}"
    return f"{base_url}/api{normalized_path}"


def _hrms_socket_url() -> tuple[str, str]:
    base_url = _hrms_backend_base_url()
    if base_url.endswith("/api"):
        return base_url[:-4].rstrip("/"), "api/socket.io"
    return base_url.rstrip("/"), "api/socket.io"


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
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError):
        return None

    if not response_text:
        return None

    try:
        payload = json.loads(response_text)
    except json.JSONDecodeError:
        return None

    return payload if isinstance(payload, dict) else None


def _normalize_positive_minutes(value: Any, fallback: int = 1) -> int:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        return fallback
    return max(parsed, 1)


def _load_cached_flags() -> dict[str, bool | int] | None:
    for flags_path in dict.fromkeys([FEATURE_FLAGS_FILE, ALT_FEATURE_FLAGS_FILE]):
        try:
            payload = json.loads(flags_path.read_text(encoding="utf-8"))
            break
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            payload = None
    if payload is None:
        return None

    if not isinstance(payload, dict):
        return None

    return {
        "screenshotsEnabled": bool(payload.get("screenshotsEnabled", True)),
        "mouseEnabled": bool(payload.get("mouseEnabled", True)),
        "keyboardEnabled": bool(payload.get("keyboardEnabled", True)) or _force_keyboard_enabled(),
        "appUsageEnabled": bool(payload.get("appUsageEnabled", True)),
        "browserHistoryEnabled": bool(payload.get("browserHistoryEnabled", True)),
        "screenshotIntervalMinutes": _normalize_positive_minutes(payload.get("screenshotIntervalMinutes", 1), 1),
        "mouseHeartbeatMinutes": _normalize_positive_minutes(payload.get("mouseHeartbeatMinutes", 1), 1),
    }


_cached_flags = _load_cached_flags()
if _cached_flags is not None:
    _current_flags = _cached_flags


def _save_cached_flags(flags: dict[str, bool | int]) -> None:
    for flags_path in dict.fromkeys([FEATURE_FLAGS_FILE, ALT_FEATURE_FLAGS_FILE]):
        try:
            flags_path.parent.mkdir(parents=True, exist_ok=True)
            flags_path.write_text(json.dumps(flags, indent=2), encoding="utf-8")
        except OSError:
            pass


def _normalize_flags(payload: Any) -> dict[str, bool | int] | None:
    if isinstance(payload, dict) and isinstance(payload.get("settings"), dict):
        settings = payload["settings"]
    else:
        settings = payload
    if not isinstance(settings, dict):
        return None

    return {
        "screenshotsEnabled": bool(settings.get("screenshotsEnabled", True)),
        "mouseEnabled": bool(settings.get("mouseEnabled", True)),
        "keyboardEnabled": bool(settings.get("keyboardEnabled", True)) or _force_keyboard_enabled(),
        "appUsageEnabled": bool(settings.get("appUsageEnabled", True)),
        "browserHistoryEnabled": bool(settings.get("browserHistoryEnabled", True)),
        "screenshotIntervalMinutes": _normalize_positive_minutes(settings.get("screenshotIntervalMinutes", 1), 1),
        "mouseHeartbeatMinutes": _normalize_positive_minutes(settings.get("mouseHeartbeatMinutes", 1), 1),
    }


def _notify_callbacks(flags: dict[str, bool | int]) -> None:
    callbacks = list(_callbacks)
    for callback in callbacks:
        try:
            callback(dict(flags))
        except Exception:
            pass


def _set_current_flags(flags: dict[str, bool | int]) -> bool:
    global _current_flags
    normalized = {
        "screenshotsEnabled": bool(flags.get("screenshotsEnabled", True)),
        "mouseEnabled": bool(flags.get("mouseEnabled", True)),
        "keyboardEnabled": bool(flags.get("keyboardEnabled", True)) or _force_keyboard_enabled(),
        "appUsageEnabled": bool(flags.get("appUsageEnabled", True)),
        "browserHistoryEnabled": bool(flags.get("browserHistoryEnabled", True)),
        "screenshotIntervalMinutes": _normalize_positive_minutes(flags.get("screenshotIntervalMinutes", 1), 1),
        "mouseHeartbeatMinutes": _normalize_positive_minutes(flags.get("mouseHeartbeatMinutes", 1), 1),
    }
    with _state_lock:
        changed = normalized != _current_flags
        _current_flags = normalized
    _save_cached_flags(normalized)
    if changed:
        _notify_callbacks(normalized)
    return changed


def get_monitor_feature_flags() -> dict[str, bool | int]:
    with _state_lock:
        return dict(_current_flags)


def load_monitor_feature_flags(session: dict | None = None) -> dict[str, bool | int]:
    """Backwards-compatible cache read for callers that only need the last known flags."""
    if session is not None:
        token = str(session.get("token") or "").strip()
        if token:
            refresh_monitor_feature_flags(session)

    cached = _load_cached_flags()
    if cached is not None:
        with _state_lock:
            global _current_flags
            _current_flags = dict(cached)
        return dict(cached)

    with _state_lock:
        return dict(_current_flags)


def refresh_monitor_feature_flags(session: dict | None = None) -> dict[str, bool | int]:
    """Fetch the current flags once and update local cache."""
    session = session or load_auth_session() or {}
    token = str(session.get("token") or "").strip()
    global _current_flags

    if not token:
        cached = _load_cached_flags()
        if cached is not None:
            with _state_lock:
                _current_flags = dict(cached)
            return dict(cached)
        return get_monitor_feature_flags()

    payload = _request_json(_hrms_api_url("/agents/cloudinary/upload-config"), token=token)
    flags = _normalize_flags(payload.get("data") if payload else None)
    if flags is None:
        cached = _load_cached_flags()
        if cached is not None:
            with _state_lock:
                _current_flags = dict(cached)
            return dict(cached)
        return get_monitor_feature_flags()

    _set_current_flags(flags)
    return get_monitor_feature_flags()


def _import_monitor_functions(module_name: str, start_name: str, stop_name: str):
    module = sys.modules.get(module_name)
    if module is None:
        try:
            module = importlib.import_module(module_name)
        except Exception:
            return None, None
    return getattr(module, start_name, None), getattr(module, stop_name, None)


def _loaded_monitor_functions(module_name: str, start_name: str, stop_name: str):
    module = sys.modules.get(module_name)
    if module is None:
        return None, None
    return getattr(module, start_name, None), getattr(module, stop_name, None)


def apply_monitor_feature_flags(flags: dict[str, bool | int] | None = None) -> dict[str, bool | int]:
    """Start or stop each monitor to match the current flags."""
    flags = dict(flags or get_monitor_feature_flags())

    if flags.get("screenshotsEnabled", True):
        start_screenshot_monitor, _ = _import_monitor_functions(
            "app.screenshot_monitor",
            "start_screenshot_monitor",
            "stop_screenshot_monitor",
        )
        if start_screenshot_monitor is not None:
            start_screenshot_monitor()
    else:
        _, stop_screenshot_monitor = _loaded_monitor_functions(
            "app.screenshot_monitor",
            "start_screenshot_monitor",
            "stop_screenshot_monitor",
        )
        if stop_screenshot_monitor is not None:
            stop_screenshot_monitor()

    if flags.get("mouseEnabled", True):
        start_activity_monitor, _ = _import_monitor_functions(
            "app.activity_monitor",
            "start_activity_monitor",
            "stop_activity_monitor",
        )
        if start_activity_monitor is not None:
            start_activity_monitor()
    else:
        _, stop_activity_monitor = _loaded_monitor_functions(
            "app.activity_monitor",
            "start_activity_monitor",
            "stop_activity_monitor",
        )
        if stop_activity_monitor is not None:
            stop_activity_monitor()

    if flags.get("keyboardEnabled", True):
        start_keyboard_monitor, _ = _import_monitor_functions(
            "app.keyboard_monitor",
            "start_keyboard_monitor",
            "stop_keyboard_monitor",
        )
        if start_keyboard_monitor is not None:
            start_keyboard_monitor()
    else:
        _, stop_keyboard_monitor = _loaded_monitor_functions(
            "app.keyboard_monitor",
            "start_keyboard_monitor",
            "stop_keyboard_monitor",
        )
        if stop_keyboard_monitor is not None:
            stop_keyboard_monitor()

    if flags.get("appUsageEnabled", True):
        start_app_usage_monitor, _ = _import_monitor_functions(
            "app.foreground_app_monitor",
            "start_app_usage_monitor",
            "stop_app_usage_monitor",
        )
        if start_app_usage_monitor is not None:
            start_app_usage_monitor()
    else:
        _, stop_app_usage_monitor = _loaded_monitor_functions(
            "app.foreground_app_monitor",
            "start_app_usage_monitor",
            "stop_app_usage_monitor",
        )
        if stop_app_usage_monitor is not None:
            stop_app_usage_monitor()

    if flags.get("browserHistoryEnabled", False):
        start_browser_monitor, _ = _import_monitor_functions(
            "app.browser_history_monitor",
            "start_browser_monitor",
            "stop_browser_monitor",
        )
        if start_browser_monitor is not None:
            start_browser_monitor()
    else:
        _, stop_browser_monitor = _loaded_monitor_functions(
            "app.browser_history_monitor",
            "start_browser_monitor",
            "stop_browser_monitor",
        )
        if stop_browser_monitor is not None:
            stop_browser_monitor()

    return flags


def _listener_worker(token: str) -> None:
    global _socket_client

    if socketio is None:
        return

    base_url, socket_path = _hrms_socket_url()
    client = socketio.Client(
        reconnection=True,
        reconnection_attempts=0,
        reconnection_delay=2,
        reconnection_delay_max=10,
        logger=False,
        engineio_logger=False,
    )

    @client.on("monitor-settings:updated")
    def _on_settings_updated(payload: Any) -> None:  # noqa: ANN001
        flags = _normalize_flags(payload)
        if not flags:
            return
        changed = _set_current_flags(flags)
        if changed:
            apply_monitor_feature_flags(flags)

    @client.event
    def connect() -> None:  # noqa: D401
        pass

    @client.event
    def disconnect() -> None:  # noqa: D401
        pass

    with _state_lock:
        _socket_client = client

    try:
        while not _listener_stop_event.is_set():
            try:
                client.connect(
                    base_url,
                    auth={"token": token},
                    socketio_path=socket_path,
                    transports=["websocket", "polling"],
                    wait_timeout=20,
                )
                client.wait()
            except Exception:
                if _listener_stop_event.is_set():
                    break
                time.sleep(5)
            finally:
                if client.connected:
                    try:
                        client.disconnect()
                    except Exception:
                        pass
    finally:
        with _state_lock:
            if _socket_client is client:
                _socket_client = None


def start_monitor_settings_listener(
    session: dict | None = None,
    *,
    on_change: Callable[[dict[str, bool]], None] | None = None,
) -> dict[str, bool]:
    """Start the realtime monitor-settings listener and return the current flags."""
    session = session or load_auth_session() or {}
    token = str(session.get("token") or "").strip()

    with _state_lock:
        if on_change is not None and on_change not in _callbacks:
            _callbacks.append(on_change)

    current_flags = load_monitor_feature_flags(None)
    if on_change is not None:
        threading.Thread(
            target=on_change,
            args=(dict(current_flags),),
            name="MonitorSettingsApply",
            daemon=True,
        ).start()

    if token:
        threading.Thread(
            target=refresh_monitor_feature_flags,
            args=(session,),
            name="MonitorSettingsRefresh",
            daemon=True,
        ).start()

    if not token or socketio is None:
        return current_flags

    global _listener_thread
    with _state_lock:
        if _listener_thread is not None and _listener_thread.is_alive():
            return current_flags
        _listener_stop_event.clear()
        thread = threading.Thread(target=_listener_worker, args=(token,), name="MonitorSettingsListener", daemon=True)
        _listener_thread = thread
        thread.start()

    return current_flags


def stop_monitor_settings_listener() -> None:
    """Stop the realtime settings listener if it is running."""
    global _listener_thread
    _listener_stop_event.set()

    client = None
    with _state_lock:
        client = _socket_client

    if client is not None:
        try:
            client.disconnect()
        except Exception:
            pass

    thread = _listener_thread
    if thread is not None and thread.is_alive():
        try:
            thread.join(timeout=2)
        except Exception:
            pass
    _listener_thread = None
