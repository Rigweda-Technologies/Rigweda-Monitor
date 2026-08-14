"""Offline-first foreground app usage and keypress monitor for the signed-in Windows user."""

from __future__ import annotations

import ctypes
import json
import os
import sqlite3
import threading
import time
import traceback
import urllib.error
import urllib.request
import uuid
from ctypes import wintypes
from datetime import UTC, datetime
from pathlib import Path

from app.auth import load_auth_session
from app.env import writable_runtime_path

PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
KEYBOARD_KEY_MIN = 8
KEYBOARD_KEY_MAX = 255
DATA_ROOT = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_DATA_ROOT", r"%LOCALAPPDATA%\rigweda-monitor\data"), "data")
QUEUE_DB = DATA_ROOT / "app_usage_queue.db"
LOCK_FILE = DATA_ROOT / "app_usage_monitor.lock"
LOG_FILE = DATA_ROOT.parent / "logs" / "app_usage_monitor.log"
DEVICE_ID_FILE = DATA_ROOT / "device_id.txt"
POLL_SECONDS = 1
HEARTBEAT_SECONDS = max(int(os.getenv("APP_USAGE_HEARTBEAT_SECONDS", "60")), 15)


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def log_message(message: object, *, exc_info: bool = False) -> None:
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a", encoding="utf-8") as log_file:
            log_file.write(f"{utc_now()} {message}\n")
            if exc_info:
                traceback.print_exc(file=log_file)
    except OSError:
        pass


def log_exception(message: object, error: BaseException | None = None) -> None:
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a", encoding="utf-8") as log_file:
            log_file.write(f"{utc_now()} {message}\n")
            if error is not None:
                log_file.write(f"{utc_now()} {type(error).__name__}: {error}\n")
                traceback.print_exception(type(error), error, error.__traceback__, file=log_file)
            else:
                traceback.print_exc(file=log_file)
    except OSError:
        pass


def get_device_id() -> str:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        value = DEVICE_ID_FILE.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        value = ""
    if not value:
        value = f"dev_{uuid.uuid4().hex}"
        DEVICE_ID_FILE.write_text(value, encoding="utf-8")
    return value


def _query_foreground_window() -> tuple[str, str] | None:
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32

    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return None

    length = user32.GetWindowTextLengthW(hwnd)
    title_buffer = ctypes.create_unicode_buffer(length + 1 if length > 0 else 2)
    user32.GetWindowTextW(hwnd, title_buffer, len(title_buffer))
    window_title = title_buffer.value.strip()

    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if not pid.value:
        return None

    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
    if not handle:
        return None

    try:
        path_buffer = ctypes.create_unicode_buffer(32768)
        size = wintypes.DWORD(len(path_buffer))
        if not kernel32.QueryFullProcessImageNameW(handle, 0, path_buffer, ctypes.byref(size)):
            return None
        process_path = path_buffer.value.strip()
    finally:
        kernel32.CloseHandle(handle)

    process_name = Path(process_path).name if process_path else f"pid_{pid.value}"
    app_name = Path(process_name).stem or process_name
    if not app_name:
        return None

    # Keep window titles out of the first version of app usage tracking.
    return app_name, process_name


def _virtual_key_name(vk: int) -> str:
    if 0x30 <= vk <= 0x39:
        return chr(vk)
    if 0x41 <= vk <= 0x5A:
        return chr(vk)
    if 0x70 <= vk <= 0x7B:
        return f"F{vk - 0x6F}"
    if vk == 8:
        return "Backspace"
    if vk == 9:
        return "Tab"
    if vk == 13:
        return "Enter"
    if vk in {16, 160, 161}:
        return "Shift"
    if vk in {17, 162, 163}:
        return "Ctrl"
    if vk in {18, 164, 165}:
        return "Alt"
    if vk == 27:
        return "Escape"
    if vk == 32:
        return "Space"
    if vk == 91:
        return "LeftWindows"
    if vk == 92:
        return "RightWindows"
    if vk == 93:
        return "ContextMenu"
    if vk == 144:
        return "NumLock"
    if vk == 145:
        return "ScrollLock"
    return f"VK_{vk}"


def _collect_key_presses(pressed_keys: set[int]) -> list[str]:
    """Collect new key press names for the current foreground app session."""
    user32 = ctypes.windll.user32
    key_names: list[str] = []

    for key_code in range(KEYBOARD_KEY_MIN, KEYBOARD_KEY_MAX + 1):
        is_pressed = bool(user32.GetAsyncKeyState(key_code) & 0x8000)
        if is_pressed:
            if key_code not in pressed_keys:
                pressed_keys.add(key_code)
                key_names.append(_virtual_key_name(key_code))
        else:
            pressed_keys.discard(key_code)

    return key_names


def get_connection() -> sqlite3.Connection:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(QUEUE_DB)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS app_usage_sessions (
          session_id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          observed_at TEXT NOT NULL,
          app_name TEXT NOT NULL,
          process_name TEXT NOT NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT NOT NULL,
          active_seconds INTEGER NOT NULL DEFAULT 0,
          key_press_count INTEGER NOT NULL DEFAULT 0,
          key_names TEXT NOT NULL DEFAULT '[]',
          sync_status TEXT NOT NULL DEFAULT 'pending',
          retry_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    columns = {row[1] for row in connection.execute("PRAGMA table_info(app_usage_sessions)")}
    if "key_press_count" not in columns:
        connection.execute("ALTER TABLE app_usage_sessions ADD COLUMN key_press_count INTEGER NOT NULL DEFAULT 0")
    if "key_names" not in columns:
        connection.execute("ALTER TABLE app_usage_sessions ADD COLUMN key_names TEXT NOT NULL DEFAULT '[]'")
        connection.execute("UPDATE app_usage_sessions SET key_names = '[]' WHERE key_names IS NULL")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_app_usage_sessions_sync ON app_usage_sessions (sync_status, created_at)")
    return connection


def queue_session(
    *,
    device_id: str,
    app_name: str,
    process_name: str,
    started_at: str,
    ended_at: str,
    active_seconds: int,
    key_press_count: int,
    key_names: list[str],
) -> None:
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO app_usage_sessions (
              session_id, device_id, observed_at, app_name, process_name,
              started_at, ended_at, active_seconds, key_press_count, key_names
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"app_{uuid.uuid4().hex}",
                device_id,
                utc_now(),
                app_name,
                process_name,
                started_at,
                ended_at,
                active_seconds,
                key_press_count,
                json.dumps(key_names, ensure_ascii=False),
            ),
        )


def pending_sessions(limit: int = 100) -> list[sqlite3.Row]:
    with get_connection() as connection:
        return connection.execute(
            "SELECT * FROM app_usage_sessions WHERE sync_status IN ('pending', 'failed') ORDER BY created_at LIMIT ?",
            (limit,),
        ).fetchall()


def mark_sessions(session_ids: list[str], *, status: str, error: str | None = None) -> None:
    if not session_ids:
        return
    with get_connection() as connection:
        if status == "synced":
            connection.executemany("DELETE FROM app_usage_sessions WHERE session_id = ?", [(session_id,) for session_id in session_ids])
            return
        connection.executemany(
            "UPDATE app_usage_sessions SET sync_status = ?, retry_count = retry_count + ?, last_error = ? WHERE session_id = ?",
            [(status, 1, error, session_id) for session_id in session_ids],
        )


def sync_pending_sessions() -> bool:
    rows = pending_sessions()
    if not rows:
        return True

    session = load_auth_session()
    token = str((session or {}).get("token") or "").strip()
    if not token:
        log_message("App usage sync skipped: no saved token.")
        return False

    backend_url = os.getenv("DESKTOP_BACKEND_URL", "https://rigweda-monitor-backend.vercel.app/api").rstrip("/")
    payload = {
        "events": [
            {
                "sessionId": row["session_id"],
                "deviceId": row["device_id"],
                "observedAt": row["observed_at"],
                "appName": row["app_name"],
                "processName": row["process_name"],
                "startedAt": row["started_at"],
                "endedAt": row["ended_at"],
                "activeSeconds": row["active_seconds"],
                "keyPressCount": row["key_press_count"],
                "keyNames": json.loads(row["key_names"] or "[]"),
            }
            for row in rows
        ]
    }
    request = urllib.request.Request(
        f"{backend_url}/app-usage/batch",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    ids = [row["session_id"] for row in rows]
    try:
        with urllib.request.urlopen(request, timeout=30):
            pass
    except urllib.error.HTTPError as error:
        error_body = ""
        try:
          error_body = error.read().decode("utf-8", "replace").strip()
        except Exception:
          error_body = ""
        detail = f"{error} {error_body}".strip()
        mark_sessions(ids, status="failed", error=detail[:1000])
        log_exception("App usage sync failed.", error)
        if error_body:
            log_message(f"App usage sync response body: {error_body[:2000]}")
        return False
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        mark_sessions(ids, status="failed", error=str(error)[:1000])
        log_exception("App usage sync failed.", error)
        return False

    try:
        mark_sessions(ids, status="synced")
    except Exception as error:
        log_exception("App usage sync succeeded but local cleanup failed.", error)
        return False
    log_message(f"App usage sync completed: {len(ids)} session(s).")
    return True


def start_foreground_app_monitor() -> None:
    device_id = get_device_id()
    log_message(f"Foreground app monitor started. heartbeat={HEARTBEAT_SECONDS}s device={device_id}")

    current_app: tuple[str, str] | None = None
    session_started_at: datetime | None = None
    session_active_seconds = 0.0
    session_key_presses = 0
    session_key_names: list[str] = []
    session_last_tick = time.monotonic()
    session_last_flush = session_last_tick
    pressed_keys: set[int] = set()

    def flush_session(*, ended_reason: str) -> None:
        nonlocal current_app, session_started_at, session_active_seconds, session_key_presses, session_key_names, session_last_flush
        if not current_app or not session_started_at:
            return

        ended_at = datetime.now(UTC)
        started_at_text = session_started_at.isoformat().replace("+00:00", "Z")
        ended_at_text = ended_at.isoformat().replace("+00:00", "Z")
        active_seconds = max(int(round(session_active_seconds)), 0)
        key_press_count = max(int(session_key_presses), 0)
        key_names = session_key_names
        if active_seconds <= 0 and key_press_count <= 0 and not key_names:
            current_app = None
            session_started_at = None
            session_active_seconds = 0.0
            session_key_presses = 0
            session_key_names = []
            session_last_flush = time.monotonic()
            return

        queue_session(
            device_id=device_id,
            app_name=current_app[0],
            process_name=current_app[1],
            started_at=started_at_text,
            ended_at=ended_at_text,
            active_seconds=active_seconds,
            key_press_count=key_press_count,
            key_names=key_names,
        )
        log_message(
            f"App usage event queued: app={current_app[0]} process={current_app[1]} "
            f"seconds={active_seconds} keys={key_press_count} reason={ended_reason}"
        )
        sync_pending_sessions()
        current_app = None
        session_started_at = None
        session_active_seconds = 0.0
        session_key_presses = 0
        session_key_names = []
        session_last_flush = time.monotonic()

    try:
        while True:
            time.sleep(POLL_SECONDS)
            now = time.monotonic()
            elapsed = max(now - session_last_tick, 0)
            session_last_tick = now

            try:
                app_context = _query_foreground_window()
            except Exception as error:
                log_exception("Foreground app lookup failed.", error)
                continue

            if app_context is None:
                flush_session(ended_reason="no_foreground_window")
                continue

            key_presses = _collect_key_presses(pressed_keys)

            if current_app is None:
                current_app = app_context
                session_started_at = datetime.now(UTC)
                session_active_seconds = 0.0
                session_key_presses = len(key_presses)
                session_key_names = list(key_presses)
                session_last_flush = now
                continue

            if app_context != current_app:
                flush_session(ended_reason="app_changed")
                current_app = app_context
                session_started_at = datetime.now(UTC)
                session_active_seconds = 0.0
                session_key_presses = len(key_presses)
                session_key_names = list(key_presses)
                session_last_flush = now
                continue

            session_active_seconds += elapsed
            session_key_presses += len(key_presses)
            session_key_names.extend(key_presses)
            if now - session_last_flush >= HEARTBEAT_SECONDS:
                flush_session(ended_reason="heartbeat")
                current_app = app_context
                session_started_at = datetime.now(UTC)
                session_key_presses = 0
                session_key_names = []
    finally:
        try:
            flush_session(ended_reason="shutdown")
        except Exception as error:
            log_exception("App usage flush failed during shutdown.", error)


def main() -> int:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        lock_handle = LOCK_FILE.open("x", encoding="utf-8")
    except FileExistsError:
        try:
            pid = int(LOCK_FILE.read_text(encoding="utf-8").strip())
        except (OSError, ValueError):
            pid = 0
        if pid:
            log_message(f"Foreground app monitor already running with PID {pid}.")
            return 0
        log_message("Removing stale foreground app monitor lock.")
        LOCK_FILE.unlink(missing_ok=True)
        lock_handle = LOCK_FILE.open("x", encoding="utf-8")

    lock_handle.write(str(os.getpid()))
    lock_handle.flush()
    try:
        start_foreground_app_monitor()
    except KeyboardInterrupt:
        return 0
    except Exception:
        log_exception("Foreground app monitor crashed.")
        raise
    finally:
        lock_handle.close()
        LOCK_FILE.unlink(missing_ok=True)
    return 0


def run_monitor() -> int:
    start_foreground_app_monitor()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
